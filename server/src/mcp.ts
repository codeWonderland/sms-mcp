import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { findById, recent } from "./audit.js";
import { getPending } from "./confirm.js";
import { listContacts } from "./contacts.js";
import { normalizeNumber } from "./phone.js";
import { RateLimiter } from "./ratelimit.js";
import { isAllowlisted } from "./recipients.js";
import { attemptSend } from "./service.js";

/** Wrap a JS value as an MCP text-content result. */
function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Build a fresh McpServer with the v1 tool surface. One server instance is
 * created per request (stateless transport), but the RateLimiter is shared so
 * limits hold across requests.
 */
export function buildMcpServer(config: Config, limiter: RateLimiter): McpServer {
  const server = new McpServer({ name: "sms-mcp", version: "0.1.0" });

  server.registerTool(
    "sms.send",
    {
      title: "Send SMS",
      description:
        "Send an SMS to a contact name or phone number. Enforces the recipient " +
        "allowlist and may queue the message for the owner's out-of-band approval. " +
        "Returns a message id and status (sent | pending | rejected_*).",
      inputSchema: {
        to: z.string().describe("Contact name or phone number"),
        body: z.string().min(1).max(1600).describe("Message text"),
      },
    },
    async ({ to, body }) => {
      const outcome = await attemptSend(config, limiter, { to, body, source: "mcp" });
      return textResult(outcome);
    },
  );

  server.registerTool(
    "sms.list_contacts",
    {
      title: "List contacts",
      description:
        "List phone contacts, optionally filtered by a name/number query. Each " +
        "result is flagged with whether it is on the send allowlist.",
      inputSchema: {
        query: z.string().optional().describe("Filter by name or number substring"),
      },
    },
    async ({ query }) => {
      const contacts = await listContacts(config);
      const q = query?.trim().toLowerCase();
      const filtered = q
        ? contacts.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              normalizeNumber(c.number).includes(normalizeNumber(q)),
          )
        : contacts;
      return textResult(
        filtered.map((c) => ({
          name: c.name,
          number: c.number,
          allowlisted: isAllowlisted(normalizeNumber(c.number), config),
        })),
      );
    },
  );

  server.registerTool(
    "sms.status",
    {
      title: "Message status",
      description:
        "Look up the status of a message by id (from sms.send). Reports whether " +
        "it is pending approval, sent, failed, or was rejected.",
      inputSchema: {
        id: z.string().describe("Message id returned by sms.send"),
      },
    },
    async ({ id }) => {
      const entry = findById(config, id);
      const pending = getPending(config, id);
      if (!entry && !pending) {
        return textResult({ id, status: "unknown", message: "No such message id." });
      }
      return textResult({
        id,
        status: entry?.status ?? "pending",
        to: entry?.to ?? pending?.to,
        name: entry?.name ?? pending?.name,
        awaitingApproval: Boolean(pending),
        ts: entry?.ts,
        error: entry?.error,
      });
    },
  );

  server.registerTool(
    "sms.recent",
    {
      title: "Recent sends",
      description:
        "Read recent entries from the append-only audit log (most recent first). " +
        "Message bodies are included only if the server is configured to log them; " +
        "otherwise a body hash and length are returned.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Max entries (default 20)"),
      },
    },
    async ({ limit }) => {
      return textResult(recent(config, limit ?? 20));
    },
  );

  return server;
}
