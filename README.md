# sms-mcp

An MCP server that sends SMS through my own Android phone — from my real number,
with auth and safety controls I control. No third-party SMS gateway in the path.

**Read [DESIGN.md](./DESIGN.md) first** — it has the architecture, the auth model,
the two implementation paths, and the open decisions.

## TL;DR
- **Path A (start here):** hardened Node MCP server in Termux, behind Tailscale +
  bearer auth + recipient allowlist + confirm-before-send + audit log.
- **Path B (later):** native Kotlin Android app using the official MCP Kotlin SDK
  and `SmsManager`.
- SMS/MMS only (no RCS — OS limit). Conversational 1:1 client texting, not outreach.

## Status
**Path A server is built** and tested end-to-end. Path B (native Kotlin app)
remains future work.

## Install (on your Android phone, in Termux)
```sh
curl -fsSL https://raw.githubusercontent.com/codeWonderland/sms-mcp/main/setup.sh -o setup.sh
bash setup.sh
```
This upgrades packages (fixing the common node/OpenSSL error), builds the server,
writes a config with a fresh token, and sets up reboot persistence. Full guide,
manual steps, and troubleshooting in [`server/README.md`](./server/README.md).
