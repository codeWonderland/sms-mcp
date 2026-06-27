import type { Config } from "./config.js";
import {
  appendAudit,
  hasPriorSuccessfulSend,
  newId,
  type AuditStatus,
} from "./audit.js";
import { enqueue, removePending, type PendingMessage } from "./confirm.js";
import { numbersEqual } from "./phone.js";
import { RateLimiter } from "./ratelimit.js";
import { isAllowlisted, RecipientError, resolveRecipient } from "./recipients.js";
import { sendSms } from "./sms.js";

export interface SendOutcome {
  id: string;
  status: AuditStatus | "error";
  to?: string;
  name?: string;
  message: string;
}

/**
 * The full outbound pipeline, in security order:
 *   resolve -> allowlist gate -> confirm decision -> rate limit -> send -> audit.
 *
 * Returns a structured outcome; never throws for policy rejections (they are
 * normal results the client should see). Only unexpected bugs throw.
 */
export async function attemptSend(
  config: Config,
  limiter: RateLimiter,
  args: { to: string; body: string; source: "mcp" | "cli" },
): Promise<SendOutcome> {
  const { body, source } = args;
  const id = newId();

  // 1. Resolve name/number.
  let to: string;
  let name: string | undefined;
  try {
    const r = await resolveRecipient(args.to, config);
    to = r.number;
    name = r.name;
  } catch (e) {
    if (e instanceof RecipientError) {
      return { id, status: "error", message: e.message };
    }
    throw e;
  }

  // 2. Allowlist gate (hard).
  if (config.allowlistEnforced && !isAllowlisted(to, config)) {
    appendAudit(config, { id, to, name, status: "rejected_allowlist", body, source });
    return {
      id,
      status: "rejected_allowlist",
      to,
      name,
      message: `Recipient ${to} is not on the allowlist. Add them to config.json to send.`,
    };
  }

  // 3. Confirm decision.
  const needsConfirm =
    config.confirmMode === "always" ||
    (config.confirmMode === "new" &&
      !hasPriorSuccessfulSend(config, numbersEqual, to));

  if (needsConfirm) {
    const pending: PendingMessage = { id, ts: new Date().toISOString(), to, name, body };
    enqueue(config, pending);
    appendAudit(config, { id, to, name, status: "pending", body, source });
    return {
      id,
      status: "pending",
      to,
      name,
      message: `Queued for approval. The owner must run \`sms-mcp-confirm approve ${id}\` on the phone before this sends.`,
    };
  }

  // 4. Rate limit (only counts actual sends).
  const now = Date.now();
  const blocked = limiter.check(now);
  if (blocked) {
    appendAudit(config, { id, to, name, status: "rejected_ratelimit", body, source });
    return { id, status: "rejected_ratelimit", to, name, message: blocked };
  }

  // 5. Send + audit.
  limiter.record(now);
  const result = await sendSms(to, body, config);
  const status: AuditStatus = result.ok ? "sent" : "failed";
  appendAudit(config, { id, to, name, status, body, source, error: result.error });
  return {
    id,
    status,
    to,
    name,
    message: result.ok ? `Sent to ${to}.` : `Send failed: ${result.error}`,
  };
}

/**
 * Send a message that was previously queued and is now approved out-of-band.
 * Used by the confirm CLI. Records a `confirmed_sent` audit entry and removes
 * the item from the pending queue.
 */
export async function sendApproved(
  config: Config,
  pending: PendingMessage,
): Promise<SendOutcome> {
  const result = await sendSms(pending.to, pending.body, config);
  const status: AuditStatus = result.ok ? "confirmed_sent" : "failed";
  appendAudit(config, {
    id: pending.id,
    to: pending.to,
    name: pending.name,
    status,
    body: pending.body,
    source: "cli",
    error: result.error,
  });
  removePending(config, pending.id);
  return {
    id: pending.id,
    status,
    to: pending.to,
    name: pending.name,
    message: result.ok ? `Sent to ${pending.to}.` : `Send failed: ${result.error}`,
  };
}
