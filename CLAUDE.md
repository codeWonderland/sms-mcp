# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**Design done, build not started.** The repo currently contains only `DESIGN.md`,
`README.md`, and an empty `server/` directory. There is no source code, no
`package.json`, and no build/lint/test tooling yet. Do not invent commands — none
exist until the Path A server is scaffolded.

**`DESIGN.md` is the source of truth.** Read it in full before any build work; it
holds the architecture, auth model, tool surface, open decisions, and the build
order. This file summarizes it but `DESIGN.md` governs.

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

## Open decisions (resolve at build start, see DESIGN.md §6)

- Tailscale required day one, or LAN/home-only? (Leaning: Tailscale from the start.)
- Confirm-before-send: always, or only for non-allowlisted recipients?
- Audit log stores message bodies, or just hashes + metadata?
- Inbound reading in v1? (Probably v2.)
