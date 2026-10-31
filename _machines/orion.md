---
title: "Orion"
date: 2026-10-17
os: Linux
difficulty: Easy
platform: HTB
tags: [craftcms, cve-2025-32432, pre-auth-rce, bcrypt, password-reuse, telnet, inetutils, cve-2026-24061, argument-injection]
summary: "Pre-auth RCE in Craft CMS (CVE-2025-32432) for a foothold, DB creds from env leaking the admin bcrypt hash, SSH in via password reuse, and root through a GNU inetutils telnetd argument injection (CVE-2026-24061)."
---

[Orion](https://app.hackthebox.com/machines/Orion?tab=play_machine)

## Reconnaissance

We will check the connectivity with the machine as always to see the VPN network is working correctly and we can see the machine.

![](/assets/machines/orion/pasted-image-20261017012401.png)

We can see the host is reachable so we will start digging into the machine.
First thing we will do is perform an Nmap scan to check what ports of this machine are open.

![](/assets/machines/orion/pasted-image-20261017012527.png)

We can see port 80 and 22 are open, we will perform a version scan to see what services are running.

![](/assets/machines/orion/pasted-image-20261017013219.png)

We can see port 80 it's running nginx 1.18.0, no outdated version.

---

## Enumeration

We will check the web page to see the content.

![](/assets/machines/orion/pasted-image-20261017013337.png)

But before, I used whatweb to see more information about the page.
We can see it was built with Craft CMS.

![](/assets/machines/orion/pasted-image-20261017013433.png)

We can see this page here.
I will fuzz subdomains and directories to find more information about the page.

![](/assets/machines/orion/pasted-image-20261017014459.png)

We can see the following directories.

![](/assets/machines/orion/pasted-image-20261017014622.png)

In the admin panel we can see the Craft CMS version.

![](/assets/machines/orion/pasted-image-20261017014733.png)

---

## Foothold: Craft CMS pre-auth RCE (CVE-2025-32432)

Found the following POC using the CVE-2025-32432 that leads to an unauthenticated RCE.
[POC](https://github.com/vulhub/vulhub/blob/master/craftcms/CVE-2025-32432/poc.py)

This POC had some errors and I couldn't use it.
We will try to see if there is a msfconsole exploit.

![](/assets/machines/orion/pasted-image-20261017021516.png)

We can see there is an exploit so we will select it.

![](/assets/machines/orion/pasted-image-20261017023340.png)

Then we will run the exploit.

![](/assets/machines/orion/pasted-image-20261017025435.png)

And as we can see we get the shell.

![](/assets/machines/orion/pasted-image-20261017025649.png)

After a while enumerating the system, in the env command we can see the craft db user and password.

![](/assets/machines/orion/pasted-image-20261017025749.png)

We will connect to the db and start enumerating.

![](/assets/machines/orion/pasted-image-20261017025814.png)

We can see the following databases.
We will use the orion one.

![](/assets/machines/orion/pasted-image-20261017025941.png)

We can see the table users in the orion database.

![](/assets/machines/orion/pasted-image-20261017030036.png)

We can see this table stores credentials, usernames, id...

![](/assets/machines/orion/pasted-image-20261017030135.png)

And we can see the admin user with his password stored in a hash type **bcrypt**.
Using hashcat we will try to crack it.

![](/assets/machines/orion/pasted-image-20261017030701.png)

And we crack the password.
After a while I tried if other users were reusing credentials and I found out that the user adam is using the same credentials, so we access this user with ssh.

![](/assets/machines/orion/pasted-image-20261017030846.png)

And we can see we get a shell.

![](/assets/machines/orion/pasted-image-20261017030927.png)

We get the user flag.

![](/assets/machines/orion/pasted-image-20261017031055.png)

---

## Privilege escalation: GNU inetutils telnetd argument injection (CVE-2026-24061)

We can see adam can not execute any command as sudo.

![](/assets/machines/orion/pasted-image-20261017031121.png)

No interesting SUID file.

![](/assets/machines/orion/pasted-image-20261017031615.png)

I launched **linpeas.sh** to help me enumerate the machine.
We can see a new port running, .23.
This is the Telnet default port.

![](/assets/machines/orion/pasted-image-20261017031837.png)

If we try to connect we can see a Linux version.
We will search if there is any vulnerability with this version.

![](/assets/machines/orion/pasted-image-20261017031947.png)

And we can see it exists.
[CVE-2026-24061](https://www.offsec.com/blog/cve-2026-24061/)
The CVE is an argument injection: telnetd passes the username straight to login, so sending -f root as the username logs us in as root with no password.

![](/assets/machines/orion/pasted-image-20261017032430.png)

And as we can see we get a root session.

![](/assets/machines/orion/pasted-image-20261017032448.png)

![](/assets/machines/orion/pasted-image-20261017032504.png)

Machine pwned.

---

## Reflection

- Learned that an outdated Craft CMS exposed a pre-auth RCE (CVE-2025-32432), and that the msfconsole module worked where the public POC didn't.
- The DB credentials sat in plain env output, and the admin's bcrypt password was reused for the adam system account, so one cracked hash gave SSH access.
- Root came from a telnetd argument injection (CVE-2026-24061): sending -f root as the username makes login authenticate as root with no password.
