# sms-mcp — Design Doc

An MCP server that lets an AI client (Claude Code, etc.) send SMS through my own
Android phone, from my real number, with **auth and safety controls I control**.

Status: design / pre-build
Owner: aeaster
Last updated: 2026-06-27

---

## 1. Goal & non-goals

**Goal.** Send SMS to clients from my computer, routed through my Android phone,
exposed as MCP tools. No third-party SMS gateway touches message content. Auth is
enforced by us, not assumed from "trusted wifi."

**Primary use case.** Conversational replies to clients who've texted me — and
short proactive notes ("running 5 min late", "sent the doc over"). *Not* a bulk
outreach channel.

**Non-goals.**
- Not RCS. No public Android API exists for sending RCS programmatically. SMS/MMS only.
- Not a TCPA/CTIA-compliant marketing platform. For any outreach/automation at
  volume, use a proper A2P provider (Twilio, or HubSpot SMS via a connected
  provider). This tool is for 1:1 conversational texting only.
- Not a Play Store app (at least initially) — SMS-permission apps are restricted
  there; we sideload. See §7.

---

## 2. Architecture overview

```
┌─────────────────┐        Tailscale (WireGuard)        ┌──────────────────────┐
│  Laptop         │  ──────────────────────────────▶    │  Android phone        │
│  Claude Code    │     https://phone.tailnet/mcp        │                       │
│  (MCP client)   │     Authorization: Bearer <tok>      │  MCP server           │
└─────────────────┘                                      │   ├─ auth middleware  │
                                                          │   ├─ recipient allow  │
                                                          │   ├─ confirm queue    │
                                                          │   ├─ audit log        │
                                                          │   └─ SMS send backend │
                                                          │        (termux-sms-   │
                                                          │         send / Kotlin │
                                                          │         SmsManager)   │
                                                          └──────────────────────┘
```

**Core security decision: the server is never reachable on the LAN.** It binds to
the Tailscale interface (or loopback) only. This removes the entire
"anyone on the wifi can text as me" class of risk and gives encrypted remote
access for free. Auth layers sit on top of that, not instead of it.

---

## 3. Two implementation paths

We start with **Path A** and graduate to **Path B** only if we want the polish.

### Path A — Hardened Node server in Termux (START HERE)
- Runs inside Termux on the phone; wraps `termux-sms-send` for the actual send.
- We add: bearer-token auth, recipient allowlist, confirm-before-send queue,
  audit log, rate limiting.
- Pros: fastest to a secure MVP, no Android/Kotlin learning curve, builds on a
  known-working base (htekdev/phone-mcp-server).
- Cons: Termux can be fragile across reboots / Android process death; needs
  Termux:Boot + wake-lock to stay alive.

### Path B — Native Kotlin Android app (FUTURE / if Path A is flaky)
- Kotlin + **official MCP Kotlin SDK** (`io.modelcontextprotocol:kotlin-sdk`,
  Ktor-based Streamable HTTP/SSE server transport) — protocol handled by the SDK.
- SMS via `context.getSystemService(SmsManager::class.java)`:
  `sendTextMessage` / `divideMessage` + `sendMultipartTextMessage` for long msgs.
  `SEND_SMS` permission. **Sending does NOT require being the default SMS app.**
- Foreground Service + battery-optimization exemption to stay alive.
- In-app UI for the confirm queue + audit log.
- Pros: reliable, clean lifecycle, real approval UX. Cons: more work; Android is
  new ground for us (we're Rust/React-shaped).

---

## 4. MCP tool surface (v1)

| Tool | Args | Behavior |
|------|------|----------|
| `sms.send` | `to` (name or number), `body` | Resolve name→number via contacts; enforce allowlist; enqueue for confirm (if enabled); send; return message id + status. |
| `sms.list_contacts` | `query?` | Search contacts (allowlisted only, optionally). |
| `sms.status` | `id` | Delivery/send status for a queued/sent message. |
| `sms.recent` | `limit?` | Recent outbound sends from the audit log (read-only). |

Deferred / maybe: reading inbound SMS (`sms.inbox`) — higher privacy surface,
gate behind its own permission flag. Group MMS — later.

---

## 5. Auth & safety (the point of the project)

Layered, defense-in-depth:

1. **Network reach** — bind to Tailscale/loopback only, never `0.0.0.0` on LAN.
   *Single strongest control.*
2. **Transport encryption** — WireGuard via Tailscale (free). If ever run on LAN,
   self-signed TLS + cert pinning instead.
3. **Authentication** — `Authorization: Bearer <long random token>`, constant-time
   compare. Token stored in env/secret on phone, in MCP client config on laptop.
   (mTLS client cert is the stricter upgrade; the MCP OAuth2 flow is overkill here.)
4. **Authorization / blast-radius limits — matters most for client texting:**
   - **Recipient allowlist** — server only sends to approved numbers. A buggy or
     prompt-injected agent cannot text an arbitrary number.
   - **Confirm-before-send** — outbound messages queue; require an explicit
     approval (phone tap in Path B, or a `confirm` step) before they actually go.
     Toggleable; default ON for new recipients.
   - **Rate limit** — cap sends per minute/hour.
   - **Audit log** — append-only record of every send attempt (to, body hash or
     body, timestamp, result). For accountability + debugging.

**Threat model note:** the MCP client is driven by an LLM, so treat tool calls as
*untrusted input*. Allowlist + confirm queue exist specifically to contain
prompt-injection and model error, not just network attackers.

---

## 6. Open decisions (resolve at build start)

- **Remote access needed, or LAN/home-only?** Drives whether Tailscale is required
  day one. (Leaning: yes, Tailscale from the start — it's also the security model.)
- **Confirm-before-send default:** always, or only for non-allowlisted recipients?
- **Store message bodies in the audit log, or just hashes + metadata?** (Client
  confidentiality vs. debuggability.)
- **Inbound reading in v1?** Adds `READ_SMS`/inbox surface — probably v2.

---

## 7. Known hard limits

- **RCS impossible** — OS-level, no public API. SMS/MMS only.
- **Play Store** restricts `SEND_SMS` apps to default-SMS-handlers / policy
  exceptions. We **sideload** the APK (Path B) or run in Termux (Path A) — fine
  for a personal/agency tool, no store review.
- **Compliance** — TCPA/CTIA still governs business→client texting (consent,
  opt-out, quiet hours). This tool is conversational-reply scope by design; don't
  grow it into outreach without a compliant platform.

---

## 8. Proposed build order

1. **Tailscale** on phone + laptop; confirm laptop can reach phone over the tailnet.
2. **Path A server**: fork/vendor htekdev base → add bearer auth → bind to tailnet
   only → recipient allowlist → audit log → confirm queue → rate limit.
3. Wire **Claude Code MCP client** config (URL + bearer token) on the laptop.
4. End-to-end test: send to one allowlisted test number; verify audit log + confirm.
5. Decide whether Path B (Kotlin app) is worth it based on Path A reliability.

---

## 9. Repo layout (planned)

```
sms-mcp/
├── DESIGN.md          # this file
├── README.md          # quickstart once built
├── server/            # Path A: Node MCP server (runs in Termux)
│   ├── src/
│   ├── config.example.json   # allowlist, token, rate limits
│   └── package.json
└── android/           # Path B: Kotlin app (future)
```
