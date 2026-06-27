# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**Path A server is implemented** in `server/` (TypeScript, MCP SDK over Streamable
HTTP) and verified end-to-end against the mock backend. Path B (native Kotlin app)
is still future work. `DESIGN.md` remains the source of truth for architecture and
the threat model; `server/README.md` is the install/run guide.

## Commands (run from `server/`)

- `npm install` then `npm run build` — compile TS to `dist/`.
- `npm start` — run the server (reads `./config.json`; override path with `SMS_MCP_CONFIG`).
- `npm run dev` — tsx watch mode.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run gen-token` — print a fresh 32-byte bearer token.
- `npm run confirm -- <list|approve|reject|approve-all> [id]` — the out-of-band approval CLI.
- `SMS_MCP_BACKEND=mock npm start` — run without sending real SMS (dev/E2E).

There is no test framework yet; verification is done by running the server in mock
mode and driving it with an MCP client (see how the smoke test was structured).

`setup.sh` (repo root) is the one-shot Termux installer: it runs `pkg upgrade`
(which fixes the node/OpenSSL `OSSL_PROVIDER` link error), builds, writes
`config.json` with a token + tailnet host, and installs the Termux:Boot script for
reboot persistence. Keep it in sync when the build/config flow changes.

## What this is

An MCP server that sends SMS through the owner's own Android phone, from their real
number, with auth and safety controls enforced by us (not by "trusted wifi"). Scope
is **conversational 1:1 client texting**, *not* bulk outreach. SMS/MMS only — RCS is
impossible (no public Android API). For anything at outreach volume, the design
explicitly defers to a compliant A2P provider (Twilio, HubSpot SMS) instead.

## Architecture

Laptop (Claude Code = MCP client) → Tailscale/WireGuard → Android phone (MCP server
→ SMS send backend). The MCP server runs **on the phone**.

**The single strongest security control is network reach:** the server binds to the
Tailscale interface or loopback only — *never* `0.0.0.0` on the LAN. This eliminates
the "anyone on the wifi can text as me" risk class. All other auth layers sit on top
of that, not instead of it.

Two implementation paths (start with A):
- **Path A (start here)** — hardened Node MCP server inside Termux, wrapping
  `termux-sms-send` for the actual send. Lives in `server/`. Builds on the
  htekdev/phone-mcp-server base. Needs Termux:Boot + wake-lock to survive reboots.
- **Path B (future)** — native Kotlin Android app using the official MCP Kotlin SDK
  (`io.modelcontextprotocol:kotlin-sdk`, Ktor Streamable HTTP/SSE) and `SmsManager`.
  Would live in `android/`. Only pursue if Path A proves flaky.

## Security model — the point of the project

Treat **every MCP tool call as untrusted input**: the client is LLM-driven, so the
allowlist and confirm queue exist to contain prompt injection and model error, not
just network attackers. Defense-in-depth layers, in order:

1. **Network reach** — Tailscale/loopback bind only (strongest control).
2. **Transport** — WireGuard via Tailscale; self-signed TLS + cert pinning if ever on LAN.
3. **Authentication** — `Authorization: Bearer <long random token>`, constant-time compare.
4. **Authorization / blast radius:**
   - **Recipient allowlist** — server only sends to approved numbers.
   - **Confirm-before-send** — outbound messages queue for explicit approval; default ON for new recipients.
   - **Rate limit** — cap sends per minute/hour.
   - **Audit log** — append-only record of every send attempt.

When implementing any send path, these controls are load-bearing, not optional
hardening — preserve them.

## Planned MCP tool surface (v1)

`sms.send` (to + body; resolve name→number, enforce allowlist, enqueue for confirm,
send, return id+status), `sms.list_contacts`, `sms.status`, `sms.recent` (read-only
audit log). Inbound reading (`sms.inbox`) is deferred to v2 behind its own permission
flag — it adds `READ_SMS` privacy surface.

## Build order (from DESIGN.md §8)

1. Tailscale on phone + laptop; confirm laptop reaches phone over the tailnet.
2. Path A server in `server/`: vendor htekdev base → bearer auth → bind to tailnet
   only → recipient allowlist → audit log → confirm queue → rate limit.
3. Wire Claude Code MCP client config (URL + bearer token) on the laptop.
4. End-to-end test against one allowlisted test number; verify audit log + confirm.
5. Decide whether Path B is worth it based on Path A reliability.

Config (allowlist, token, rate limits) is planned to live in `server/config.example.json`.

## Open decisions — resolved (DESIGN.md §6)

All four are now config-driven with safe defaults; nothing is hard-locked:

- **Network bind** — `host` config, defaults to loopback. Code *refuses to start* on
  a non-loopback bind without `allowLanBind: true`, and never on `0.0.0.0`. Tailscale
  IP is the intended non-loopback value.
- **Confirm-before-send** — `confirmMode: "new" | "always" | "off"`, default `"new"`.
  Approval is **out-of-band** via the `sms-mcp-confirm` CLI (a human gate the
  LLM-driven client cannot perform), not an MCP tool.
- **Audit bodies** — `audit.logBodies`, default `false` (sha256 hash + length only).
- **Inbound reading** — not in v1 (no `sms.inbox` tool).
