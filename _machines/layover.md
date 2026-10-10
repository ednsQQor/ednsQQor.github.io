---
title: "Layover"
date: 2026-10-09
os: Linux
difficulty: Medium
tags: [htb-airways, wifi-sniffing, chisel, pivoting, craft-cms, ssti, unauthenticated-template-injection, cups, password-reuse, privilege-escalation]
summary: "Credentials sniffed off an open Wi-Fi network, a chisel pivot into an internal Craft CMS instance vulnerable to an unsandboxed-Twig SSTI/RCE, and a CUPS buffer overflow for root."
platform: HTB
status: active
# unlock_date: 2026-XX-XX   # <- fecha de retiro en HTB; al ponerla sale el contador
---

[Layover](https://app.hackthebox.com/machines/Layover?sort_by=created_at&sort_type=desc)

## Machine Information

| | |
|---|---|
| **Name** | Layover |
| **Difficulty** | Medium |
| **OS** | Linux |

This one skips the usual "find your own way in" step — we're handed a working login straight out of the gate:

```
User: contractor
Password: Contractor2026!
```

---

## Mapping the Box

First things first: ping it, make sure it's actually alive before doing anything else.

```bash
ping -c 4 layover.htb
```

![](/assets/machines/layover/pasted-image-20260927194336.png)

It's up. Time for the full TCP sweep:

```bash
sudo nmap -p- --min-rate 5000 -Pn layover.htb -oG allPorts
```

![](/assets/machines/layover/pasted-image-20260927194544.png)

Only two ports open: 22 (SSH) and 3389 (RDP, `ms-wbt-server`). Ran a version/script scan against both to get a feel for what I was actually dealing with:

```bash
sudo nmap -p22,3389 -sCV --min-rate 5000 -Pn layover.htb -oG Ports
```

![](/assets/machines/layover/pasted-image-20260927194757.png)

SSH is OpenSSH 9.6p1 on Ubuntu — nothing outdated or obviously vulnerable there. Nmap couldn't fingerprint the RDP service version from its probe, which isn't unusual for `ms-wbt-server`.

Tried SSH first with the given creds, just to see if they'd work there too:

```bash
ssh contractor@layover.htb
```

![](/assets/machines/layover/pasted-image-20260927195350.png)

No luck — password rejected outright, and the final response only lists `publickey,password` as accepted methods without actually accepting either. Dead end on SSH, so I moved to RDP instead, where the same creds worked immediately:

```bash
xfreerdp3 /v:10.129.72.152 /u:contractor /dynamic-resolution +clipboard
```

![](/assets/machines/layover/pasted-image-20260927200146.png)

In as `contractor`, on a host called `airside-ws01`. First thing I checked once inside was the network config, since a hostname like "airside" on an airport-themed box practically begs for more than one network segment to be involved:

```bash
ip -br a
```

![](/assets/machines/layover/pasted-image-20260927203642.png)

Three interfaces worth noting: `wlan2` (down), `wlan3` (up, already holding an IP on `10.13.37.0/24` — so it's associated with some wireless network), and `eth0` on a separate `10.159.143.0/24` subnet. The box is sitting on a Wi-Fi network I don't have creds for yet, which is the obvious next thing to chase.

---

## Sniffing Creds Off the Wireless Network

To see what else was talking on that Wi-Fi network, I needed to capture traffic beyond just my own — which means putting the wireless adapter into monitor mode. A NIC in normal (managed) mode only hands the OS frames actually addressed to it; monitor mode tells the radio to pass up *every* 802.11 frame it hears, management and data alike, regardless of destination. That's what lets you sniff traffic between other clients and the access point instead of just your own.

```bash
sudo ip link set wlan3 down
sudo iw dev wlan3 set type monitor
sudo ip link set wlan3 up
sudo iw dev wlan3 set channel 6
```

![](/assets/machines/layover/pasted-image-20260927203841.png)

Locked the adapter to channel 6 because that's the channel the target network — broadcast as "HTB International WiFi" — was running on. 2.4 GHz Wi-Fi is channelized, so if your radio isn't tuned to the same channel as the AP, you just won't see its frames.

With the interface in monitor mode, I kicked off a timed capture straight to disk:

```bash
sudo timeout 300 tshark -i wlan3 -w /tmp/cap.pcap
```

![](/assets/machines/layover/pasted-image-20260927214114.png)

Once it finished, I checked the protocol breakdown to see what was actually worth digging into:

```bash
sudo tshark -r /tmp/cap.pcap -q -z io,phs
```

![](/assets/machines/layover/pasted-image-20260927220058.png)

HTTP traffic stood out immediately. Since HTTP is plaintext, any login form submitted during the capture window would be sitting right there in the PCAP. Filtered specifically for URL-encoded form submissions:

```bash
sudo tshark -r /tmp/cap.pcap -Y 'urlencoded-form' -T fields \
  -e ip.src -e http.request.full_uri -e urlencoded-form.key -e urlencoded-form.value
```

![](/assets/machines/layover/pasted-image-20260927220317.png)

And there it is — clean login credentials pulled straight out of the air: a POST to `http://portal.international.htb/miles/login.php` with `username=jenny` and `password=Fl1ghtDeck2026!`, repeated across several frames (probably the client retrying, or the capture just caught the same keep-alive session multiple times).

Added `portal.international.htb` to my hosts file and logged into the miles portal with Jenny's creds to confirm they were live:

![](/assets/machines/layover/pasted-image-20260927221644.png)

They worked — into the "HTB Airways Miles" customer portal as Jenny.

---

## Tunneling Into the Internal Network

`portal.international.htb` only resolves and routes from inside the internal network, so before poking at it any further I set up a pivot: instead of running every tool from the low-resource RDP session itself, I used `chisel` to tunnel traffic from that internal network back to my own machine.

Dropped the chisel binary into `/tmp` on the RDP host to keep it off the more obvious paths:

![](/assets/machines/layover/pasted-image-20261009203355.png)

On my machine, started a chisel server to act as the listener for the reverse connection:

![](/assets/machines/layover/pasted-image-20261009203525.png)

Then, from the compromised host, connected a chisel client back to that listener with the SOCKS flag — that opens a SOCKS5 proxy on my machine that forwards traffic into the internal network as if I were sitting on that box myself:

![](/assets/machines/layover/pasted-image-20261009203640.png)

Tunnel's up, and I can reach every port on the internal network through that SOCKS proxy:

![](/assets/machines/layover/pasted-image-20261009203821.png)

To route my existing tools through it instead of prefixing every single command, I pointed `proxychains.conf` at chisel's local SOCKS port (`socks5 127.0.0.1 1080`), so `proxychains` would transparently tunnel anything I ran:

```bash
proxychains -q whatweb http://portal.international.htb/
```

![](/assets/machines/layover/pasted-image-20260927223334.png)

That's the site root — "HTB International Airport – Passenger Portal," running on the same Nginx/Ubuntu stack. Checked for an admin panel next, since a passenger-facing portal this size almost always has a separate staff/admin interface:

```bash
proxychains -q whatweb http://portal.international.htb/admin
```

![](/assets/machines/layover/pasted-image-20260927223830.png)

Found it — `/admin` redirects to `/admin/login`, and the response headers give away the stack: `X-Powered-By: Craft CMS`, running on Nginx 1.24.0. So the next target is a Craft CMS admin login, reachable only through the internal network behind the airside workstation.

![](/assets/machines/layover/pasted-image-20261009211039.png)

---

## An Unsandboxed Twig Template Turns Into RCE

Tried fingerprinting the exact Craft CMS version with `curl`, grepping the response for strings like "version" or "craft," but came up empty:

![](/assets/machines/layover/pasted-image-20261009215017.png)

Found it a different way instead — visible directly in the admin panel once you know where to look — confirming Craft 5.9.8:

![](/assets/machines/layover/pasted-image-20261009214045.png)

[Exploit](https://kitploit.com/es/tools/github/0asylum/cve-2026-31857)

A bit of research turned up a Craft CMS vulnerability (CVE-2026-31857) affecting versions 4.0.0-beta.1 through 4.17.3 and 5.0.0-RC1 through 5.9.8. Our target runs Craft Solo 5.9.8, right inside the affected range.

The vulnerability is an authenticated RCE that abuses the relational condition rules of the control panel. The method `BaseElementSelectConditionRule::getElementIds()` takes user-controlled input and renders it as an unsandboxed Twig template.

The idea: an authenticated control panel user (no admin privileges required) can submit a crafted condition through an element-listing endpoint (`/admin/actions/element-search/search`). Because that input gets evaluated as Twig with zero sandboxing, it opens the door to a Server-Side Template Injection. Drop a Twig payload into the condition, and Craft renders it server-side — and that rendering is what ends up executing commands, turning the SSTI into full RCE.

Used the PoC to check whether the target was actually vulnerable. Since the flaw requires authentication, I supplied a valid control panel username and password (Jenny's):

![](/assets/machines/layover/pasted-image-20261009215348.png)

Running the PoC from the article got me a shell as `www-data`:

![](/assets/machines/layover/pasted-image-20261009215903.png)

Started a listener to upgrade the shell:

![](/assets/machines/layover/pasted-image-20261009220450.png)

Used chisel again, same way as before, to redirect this new connection through my machine:

![](/assets/machines/layover/pasted-image-20261009220518.png)

From the cmd shell I sent a reverse shell back to my machine, and caught it with `penelope` to get a proper interactive session:

![](/assets/machines/layover/pasted-image-20261009222156.png)

---

## From www-data to aporter

Inside the `portal` directory I found a `.env` file with credentials for the database:

![](/assets/machines/layover/pasted-image-20261009222516.png)

Using those, got access to an interactive MariaDB shell:

![](/assets/machines/layover/pasted-image-20261009222606.png)

![](/assets/machines/layover/pasted-image-20261009222626.png)

Two databases visible, so I started by enumerating `craft` to see if it held anything useful for finding a new system user. Asked Claude AI to help spot anything unusual in the schema, and three tables stood out as non-standard:

![](/assets/machines/layover/pasted-image-20261009222901.png)

The first of those tables held a new user, `aporter`, with a password value stored as a long base64 string:

![](/assets/machines/layover/pasted-image-20261009223136.png)

The same `.env` also contained Craft's security key, which Craft uses to encrypt stored secrets — so I wrote a small Python script to decrypt the stored value using that key:

![](/assets/machines/layover/pasted-image-20261009223649.png)

Ran it against the stored value and got `aporter`'s plaintext password back:

![](/assets/machines/layover/pasted-image-20261009223743.png)

That same password also worked against the user's email account — password reuse, confirmed:

![](/assets/machines/layover/pasted-image-20261009223834.png)

With that account, found the user flag sitting on `aporter`'s desktop:

![](/assets/machines/layover/pasted-image-20261009223923.png)

---

## From aporter to Root via CUPS

Checked the user's groups, permissions, and any SUID binaries, but nothing usable turned up there:

![](/assets/machines/layover/pasted-image-20261009224137.png)

The crontab didn't offer anything either:

![](/assets/machines/layover/pasted-image-20261009224653.png)

Checking which processes root was running turned up `cupsd -f`. Since `aporter` had an associated email account, it seemed plausible this user interacted with CUPS printing somehow:

![](/assets/machines/layover/pasted-image-20261009224601.png)

The running CUPS version was 2.4.16:

![](/assets/machines/layover/pasted-image-20261009225212.png)

A search against that version turned up a recent buffer overflow vulnerability (CVE-2026-34990):

![](/assets/machines/layover/pasted-image-20261009225345.png)

The exploit is race-dependent, so success isn't guaranteed on every attempt. The published reproduction is built as a controlled vulnerability harness — it assumes a dedicated CUPS install and runs setup/reset steps that make sense for a lab, not for an already-running production-style distribution. The PoC I used instead adapts the technique to work against an existing CUPS install:

- Uses the system's existing CUPS service.
- Uses the installed `ipptool` binary.
- Uses the system's `cups-create-local-printer.test` definition when available.
- Captures the CUPS local authorization token.
- Reuses that token for authenticated IPP administration.
- Reproduces the local-printer / `file://` primitive.
- Performs the printer/job sequence used in the original reproduction.
- Treats the final privilege check as the success condition.

Used the following [PoC](https://github.com/0xc4rc3l/cve-2026-34990-poc):

![](/assets/machines/layover/pasted-image-20261009225433.png)

Ran it, and got a root shell:

![](/assets/machines/layover/pasted-image-20261009225822.png)

![](/assets/machines/layover/pasted-image-20261009225920.png)

Machine pwned.

---

## Flags

- **User:** read from `aporter`'s desktop, reached by decrypting a Craft CMS-encrypted password out of the `craft` database using the security key leaked in `.env`.
- **Root:** read after exploiting a CUPS 2.4.16 buffer overflow (CVE-2026-34990) running as root.

---

## Lessons Learned / Mitigation

- **Wi-Fi traffic carried plaintext HTTP login credentials.** Any authentication over an unencrypted wireless network is trivially sniffable by anyone in range with a monitor-mode-capable adapter — the miles portal login should have been served over HTTPS.
- **A Craft CMS instance ran unsandboxed Twig evaluation on authenticated, non-admin input.** Any templating engine exposed to user input needs to run in a sandboxed mode that blocks function calls and filesystem/process access, regardless of the caller's privilege level.
- **A `.env` file held both database credentials and the application's security/encryption key together.** Once an attacker has both, any value encrypted with that key (like the `aporter` password) becomes recoverable — secrets that protect other secrets shouldn't sit next to the data they protect.
- **A system account's password was reused for its associated email account.** Credential reuse across unrelated services turns a single leak into a much wider compromise.
- **CUPS was left running an outdated, vulnerable version exposed to a low-privileged local user.** Printing services running as root are a common, often-overlooked local attack surface — they should be patched on the same cadence as any other root-privileged daemon.
