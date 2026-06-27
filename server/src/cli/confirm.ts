#!/usr/bin/env node
import { loadConfig } from "../config.js";
import { getPending, readPending, removePending } from "../confirm.js";
import { sendApproved } from "../service.js";

/**
 * Owner-facing CLI to approve/reject messages the server queued. This is the
 * OUT-OF-BAND human gate: the LLM-driven MCP client cannot run it, so it can't
 * approve its own sends. Run on the phone (in Termux).
 *
 * Usage:
 *   sms-mcp-confirm list
 *   sms-mcp-confirm approve <id>
 *   sms-mcp-confirm reject  <id>
 *   sms-mcp-confirm approve-all
 */
function usage(): never {
  process.stderr.write(
    [
      "Usage:",
      "  sms-mcp-confirm list",
      "  sms-mcp-confirm approve <id>",
      "  sms-mcp-confirm reject  <id>",
      "  sms-mcp-confirm approve-all",
      "",
      "Config path via SMS_MCP_CONFIG (default ./config.json).",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

function fmt(m: { id: string; ts: string; to: string; name?: string; body: string }): string {
  const who = m.name ? `${m.name} (${m.to})` : m.to;
  const preview = m.body.length > 80 ? m.body.slice(0, 77) + "..." : m.body;
  return `  ${m.id}\n    to: ${who}\n    at: ${m.ts}\n    body: ${preview}`;
}

async function main() {
  const configPath = process.env.SMS_MCP_CONFIG ?? "config.json";
  const config = loadConfig(configPath);
  const [cmd, id] = process.argv.slice(2);

  switch (cmd) {
    case "list": {
      const items = readPending(config);
      if (items.length === 0) {
        process.stdout.write("No messages pending approval.\n");
        return;
      }
      process.stdout.write(`${items.length} pending:\n${items.map(fmt).join("\n")}\n`);
      return;
    }
    case "approve": {
      if (!id) usage();
      const msg = getPending(config, id);
      if (!msg) {
        process.stderr.write(`No pending message with id ${id}.\n`);
        process.exit(1);
      }
      const outcome = await sendApproved(config, msg);
      process.stdout.write(`${outcome.status}: ${outcome.message}\n`);
      process.exit(outcome.status === "confirmed_sent" ? 0 : 1);
      return;
    }
    case "reject": {
      if (!id) usage();
      const removed = removePending(config, id);
      process.stdout.write(
        removed ? `Rejected and removed ${id}.\n` : `No pending message with id ${id}.\n`,
      );
      return;
    }
    case "approve-all": {
      const items = readPending(config);
      if (items.length === 0) {
        process.stdout.write("Nothing to approve.\n");
        return;
      }
      for (const msg of items) {
        const outcome = await sendApproved(config, msg);
        process.stdout.write(`${msg.id} -> ${outcome.status}: ${outcome.message}\n`);
      }
      return;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exit(1);
});
