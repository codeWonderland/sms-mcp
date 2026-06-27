import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { log } from "./logger.js";

/**
 * Persisted queue of messages awaiting OUT-OF-BAND approval.
 *
 * Why out-of-band: the MCP client is LLM-driven and untrusted. If confirmation
 * were just another MCP tool, a prompt-injected model could approve its own
 * sends. So approval happens via the `sms-mcp-confirm` CLI run by the owner on
 * the phone — a human action the network client cannot perform.
 *
 * The queue is a JSON file shared between the server process (which enqueues)
 * and the CLI (which approves/rejects and performs the actual send). Writes are
 * atomic (tmp file + rename) to survive concurrent access at low volume.
 */
export interface PendingMessage {
  id: string;
  ts: string;
  to: string; // normalized number
  name?: string;
  body: string; // bodies are always kept here until sent/rejected
}

function pendingPath(config: Config): string {
  return path.resolve(config.dataDir, "pending.json");
}

function ensureDir(config: Config) {
  const dir = path.resolve(config.dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readPending(config: Config): PendingMessage[] {
  const p = pendingPath(config);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PendingMessage[];
  } catch (e) {
    log.error("pending queue is corrupt; treating as empty", {
      error: (e as Error).message,
    });
    return [];
  }
}

function writePending(config: Config, items: PendingMessage[]): void {
  ensureDir(config);
  const p = pendingPath(config);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(items, null, 2), "utf8");
  renameSync(tmp, p);
}

export function enqueue(config: Config, msg: PendingMessage): void {
  const items = readPending(config);
  items.push(msg);
  writePending(config, items);
  if (config.notifyOnPending) void notifyPending(config, msg);
}

export function getPending(config: Config, id: string): PendingMessage | undefined {
  return readPending(config).find((m) => m.id === id);
}

/** Remove an item from the queue (after it is approved or rejected). */
export function removePending(config: Config, id: string): PendingMessage | undefined {
  const items = readPending(config);
  const idx = items.findIndex((m) => m.id === id);
  if (idx === -1) return undefined;
  const [removed] = items.splice(idx, 1);
  writePending(config, items);
  return removed;
}

/** Best-effort Termux notification so the owner knows something is waiting. */
async function notifyPending(config: Config, msg: PendingMessage): Promise<void> {
  if (config.backend === "mock") return;
  const who = msg.name ? `${msg.name} (${msg.to})` : msg.to;
  const preview = msg.body.length > 60 ? msg.body.slice(0, 57) + "..." : msg.body;
  try {
    await new Promise<void>((resolve) => {
      execFile(
        "termux-notification",
        [
          "--title",
          `SMS pending approval -> ${who}`,
          "--content",
          `${preview}\nApprove: sms-mcp-confirm approve ${msg.id}`,
          "--id",
          `sms-mcp-${msg.id}`,
        ],
        () => resolve(),
      );
    });
  } catch {
    /* notifications are best-effort */
  }
}
