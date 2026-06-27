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
Design done; build not started. Next step is the build order in DESIGN.md §8.
