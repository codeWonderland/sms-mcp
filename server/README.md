# sms-mcp-server (Path A)

A hardened Node MCP server that sends SMS through **your own Android phone**, from
your real number, wrapping `termux-sms-send`. The MCP client (e.g. Claude Code on
your laptop) reaches it over Tailscale; you keep the auth and safety controls.

> Read the repo-root [`DESIGN.md`](../DESIGN.md) for the architecture and threat
> model. This README is the install/run guide.

## What you need

- An Android phone you control, with [Termux](https://termux.dev) and the
  [Termux:API](https://wiki.termux.com/wiki/Termux:API) app **both installed from
  F-Droid** (the Play Store builds are stale and won't talk to each other).
- [Tailscale](https://tailscale.com) on the phone and on the laptop, signed into
  the same tailnet. (Or run laptop-side over loopback via an SSH tunnel — see below.)
- Node 18+ on the phone (`pkg install nodejs`).

## Install (on the phone, in Termux)

```sh
# Termux:API bridge + node
pkg install termux-api nodejs git
termux-setup-storage           # grant Termux storage/SMS/contacts perms when prompted

git clone https://github.com/codeWonderland/sms-mcp.git
cd sms-mcp/server
npm install
npm run build

# Generate a bearer token and create your config
cp config.example.json config.json
npm run gen-token              # prints a token — paste it into config.json
nano config.json               # set bearerToken, host, and your allowlist
```

Verify the SMS + contacts bridge works before wiring up MCP:

```sh
termux-sms-send -n +15555550123 "test from termux"   # should send
termux-contact-list | head                            # should print JSON
```

## Configure

Edit `config.json` (validated against `src/config.ts` at startup — it refuses to
boot in an unsafe posture):

| Key | Default | Notes |
|-----|---------|-------|
| `host` | `127.0.0.1` | **Set this to the phone's Tailscale IP** (`tailscale ip -4`) to reach it from the laptop. Non-loopback binds require `allowLanBind: true` as an explicit ack. The server **refuses to bind `0.0.0.0`**. |
| `port` | `8765` | |
| `bearerToken` | — | Required, ≥24 chars. Generate with `npm run gen-token`. |
| `allowlist` | `[]` | `{ "name", "number" }` entries. The **only** numbers the server will ever text. |
| `allowlistEnforced` | `true` | Leave on. |
| `confirmMode` | `"new"` | `"new"` = confirm first-time recipients; `"always"`; `"off"`. |
| `rateLimit` | 5/min, 30/hr | Caps actual sends. |
| `audit.logBodies` | `false` | `false` stores a body hash + length only (client confidentiality). |
| `sim` | `null` | SIM slot for dual-SIM phones. |
| `backend` | `"termux"` | Set `"mock"` (or `SMS_MCP_BACKEND=mock`) to test without sending. |

The audit log and pending-approval queue live in `dataDir` (`state/` by default)
and are **git-ignored** — they can contain numbers and message bodies.

## Run

```sh
npm start
# [...] sms-mcp listening {"url":"http://100.x.y.z:8765/mcp", ...}
```

To survive reboots/process death, install **Termux:Boot** and acquire a wake-lock
(`termux-wake-lock`); add a boot script that runs `npm start` from this directory.

## Approving messages (the out-of-band gate)

Because the MCP client is LLM-driven and untrusted, confirmation is **not** an MCP
tool — a prompt-injected model can't approve its own sends. You approve on the
phone with the CLI:

```sh
npx sms-mcp-confirm list                 # show queued messages
npx sms-mcp-confirm approve <id>         # send it
npx sms-mcp-confirm reject  <id>
npx sms-mcp-confirm approve-all
```

When `notifyOnPending` is on, a Termux notification fires for each queued message.

## Wire up the laptop (Claude Code MCP client)

Add to your MCP client config (e.g. `~/.claude.json` or via `claude mcp add`),
using the phone's tailnet IP and your token:

```json
{
  "mcpServers": {
    "sms": {
      "type": "http",
      "url": "http://100.x.y.z:8765/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

No Tailscale? Tunnel over SSH (Termux `sshd`) and point the client at
`http://127.0.0.1:8765/mcp` — the server stays loopback-bound.

## Tools (v1)

| Tool | Purpose |
|------|---------|
| `sms.send` | Send to a name/number; enforces allowlist, may queue for approval. |
| `sms.list_contacts` | Search contacts; flags which are allowlisted. |
| `sms.status` | Status of a message id (pending/sent/failed/rejected). |
| `sms.recent` | Recent audit-log entries (read-only). |

Inbound reading (`sms.inbox`) is intentionally **not** in v1 (extra `READ_SMS`
privacy surface) — see DESIGN.md.

## Dev

```sh
npm run dev          # tsx watch, reads ./config.json
npm run typecheck
SMS_MCP_BACKEND=mock npm start   # no real sends
```
