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

## Quick install (recommended)

A single script does the package upgrade, build, config, and reboot-persistence
setup. **On the phone, in Termux:**

```sh
curl -fsSL https://raw.githubusercontent.com/codeWonderland/sms-mcp/main/setup.sh -o setup.sh
bash setup.sh
```

It will:
- `pkg upgrade` (this also fixes the common node/OpenSSL link error — see
  [Troubleshooting](#troubleshooting)) and install `termux-api`, `nodejs`, `git`.
- Clone + build the server.
- Generate a bearer token and write it + your Tailscale IP into `config.json`
  (it prompts for the IP; an existing `config.json` is never overwritten).
- Install the Termux:Boot script so the server restarts on reboot.
- Print the exact `claude mcp add` command for your laptop, token included.

It can't do three Android-side things for you — it'll remind you at the end:
open the **Termux:Boot** app once, set Termux to **Unrestricted** battery, and
edit your **allowlist**. Run `termux-setup-storage` once to grant SMS/contacts
permissions if Android doesn't prompt.

**Before trusting it, verify the SMS + contacts bridge works:**

```sh
termux-sms-send -n +1XXXXXXXXXX "test from termux"   # should send
termux-contact-list | head                           # should print JSON
```

### Manual install

If you'd rather not run the script:

```sh
pkg update && pkg upgrade -y          # upgrade first (fixes node/OpenSSL — see Troubleshooting)
pkg install termux-api nodejs git
termux-setup-storage

git clone https://github.com/codeWonderland/sms-mcp.git
cd sms-mcp/server
npm install && npm run build

cp config.example.json config.json
npm run gen-token                     # paste the token into config.json
nano config.json                      # set bearerToken, host, allowLanBind, allowlist
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

## Survive reboots (Termux:Boot)

`setup.sh` already installs a boot script at `~/.termux/boot/start-sms-mcp.sh`
that grabs a wake-lock and runs the server under a crash-restart loop. To make
Android actually honor it, do these once (a script can't):

1. **Install Termux:Boot from F-Droid and open it once** — boot scripts are
   ignored until the app has been launched at least once.
2. **Exempt Termux from battery optimization:** Settings → Apps → Termux →
   Battery → **Unrestricted** (do the same for Termux:API). Without this, Android
   kills the server after a while.

Test it: reboot the phone, wait ~1 minute, then from the laptop
`curl http://<tailnet-ip>:8765/health`. After a reboot the server runs headless —
watch it with `tail -f ~/sms-mcp/server/state/boot.log`.

Setting it up manually instead? Create that file yourself:

```sh
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-sms-mcp.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
LOG="$HOME/sms-mcp/server/state/boot.log"
MAXSIZE=1048576; KEEP=3
mkdir -p "$(dirname "$LOG")"
cd "$HOME/sms-mcp/server" || exit 1
rotate() {
  [ -f "$LOG" ] || return 0
  [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -ge "$MAXSIZE" ] || return 0
  i=$KEEP; while [ "$i" -gt 1 ]; do p=$((i-1)); [ -f "$LOG.$p" ] && mv "$LOG.$p" "$LOG.$i"; i=$p; done
  mv "$LOG" "$LOG.1"
}
while true; do
  rotate
  node dist/index.js >> "$LOG" 2>&1
  sleep 5
done
EOF
chmod +x ~/.termux/boot/start-sms-mcp.sh
```

`boot.log` is rotated at ~1 MiB, keeping 3 old files (so ~4 MiB max). Rotation
happens between restarts, which is exactly when a crash-loop would otherwise
flood the log.

## Troubleshooting

**`CANNOT LINK EXECUTABLE "node": cannot link symbol "OSSL_PROVIDER_..."`** — your
`node` binary is newer than the installed OpenSSL because `pkg update` only
refreshes the index; it doesn't upgrade installed packages. Fix:

```sh
pkg upgrade -y          # brings OpenSSL up to what node needs
node -v                 # should print a version now
# still broken? force a clean relink:
pkg reinstall nodejs
```

**Server refuses to start: "host is … (not loopback)"** — you set `host` to a
Tailscale/LAN IP. That's intended, but you must also set `"allowLanBind": true`
to acknowledge it. The server will still never bind `0.0.0.0`.

**`termux-sms-send`/`termux-contact-list` do nothing or error** — Termux and
Termux:API must both come from **F-Droid** (not Play Store), and Termux:API needs
SMS + Contacts permissions (Settings → Apps → Termux:API → Permissions).

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
