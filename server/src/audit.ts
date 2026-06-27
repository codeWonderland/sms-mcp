import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { log } from "./logger.js";

export type AuditStatus =
  | "sent"
  | "failed"
  | "pending"
  | "confirmed_sent"
  | "rejected_allowlist"
  | "rejected_ratelimit"
  | "rejected_confirm";

export interface AuditEntry {
  id: string;
  ts: string;
  to: string;
  name?: string;
  status: AuditStatus;
  bodyHash: string;
  bodyLength: number;
  body?: string; // only present when audit.logBodies is true
  error?: string;
  source: "mcp" | "cli";
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function newId(): string {
  return randomUUID();
}

function auditPath(config: Config): string {
  return path.resolve(config.dataDir, "audit.jsonl");
}

function ensureDir(config: Config) {
  const dir = path.resolve(config.dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append one entry to the append-only audit log. */
export function appendAudit(
  config: Config,
  entry: Omit<AuditEntry, "ts" | "bodyHash" | "bodyLength"> & { body: string },
): AuditEntry {
  ensureDir(config);
  const full: AuditEntry = {
    id: entry.id,
    ts: new Date().toISOString(),
    to: entry.to,
    name: entry.name,
    status: entry.status,
    bodyHash: hashBody(entry.body),
    bodyLength: entry.body.length,
    body: config.audit.logBodies ? entry.body : undefined,
    error: entry.error,
    source: entry.source,
  };
  try {
    appendFileSync(auditPath(config), JSON.stringify(full) + "\n", "utf8");
  } catch (e) {
    log.error("failed to write audit entry", { error: (e as Error).message });
  }
  return full;
}

export function readAll(config: Config): AuditEntry[] {
  const p = auditPath(config);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: AuditEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as AuditEntry);
    } catch {
      // skip a corrupt line rather than failing the whole read
    }
  }
  return out;
}

export function recent(config: Config, limit: number): AuditEntry[] {
  const all = readAll(config);
  return all.slice(-limit).reverse();
}

export function findById(config: Config, id: string): AuditEntry | undefined {
  const all = readAll(config);
  // Last write wins (a pending entry may later be followed by sent/failed).
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].id === id) return all[i];
  }
  return undefined;
}

/** Has a given (normalized) number ever been successfully sent to? */
export function hasPriorSuccessfulSend(
  config: Config,
  numbersEqual: (a: string, b: string) => boolean,
  number: string,
): boolean {
  return readAll(config).some(
    (e) =>
      (e.status === "sent" || e.status === "confirmed_sent") &&
      numbersEqual(e.to, number),
  );
}
