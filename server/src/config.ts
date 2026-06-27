import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Config schema. This file is the contract for config.json.
 * Safe-by-default: loopback bind, allowlist enforced, confirm new recipients,
 * bodies NOT logged. See config.example.json for an annotated template.
 */

const RecipientSchema = z.object({
  name: z.string().min(1).optional(),
  number: z.string().min(3),
});

const ConfigSchema = z.object({
  // --- Network reach (the strongest control) ---
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(8765),
  // Explicit, loud opt-in required to bind anything that isn't loopback/tailscale.
  // Binding 0.0.0.0 exposes "anyone on the wifi can text as me" — never the default.
  allowLanBind: z.boolean().default(false),

  // --- Authentication ---
  bearerToken: z.string().min(1),

  // --- Authorization / blast radius ---
  allowlistEnforced: z.boolean().default(true),
  allowlist: z.array(RecipientSchema).default([]),
  // "new"    -> confirm only recipients with no prior successful send (default)
  // "always" -> confirm every send
  // "off"    -> never confirm (still subject to allowlist + rate limit)
  confirmMode: z.enum(["new", "always", "off"]).default("new"),
  rateLimit: z
    .object({
      perMinute: z.number().int().min(1).default(5),
      perHour: z.number().int().min(1).default(30),
    })
    .default({ perMinute: 5, perHour: 30 }),
  audit: z
    .object({
      // false -> store a body hash + metadata only (client confidentiality)
      logBodies: z.boolean().default(false),
    })
    .default({ logBodies: false }),

  // --- SMS backend ---
  // "termux" wraps termux-sms-send; "mock" logs instead of sending (dev/E2E).
  backend: z.enum(["termux", "mock"]).default("termux"),
  // Optional SIM slot for dual-SIM phones (termux-sms-send -s). null = default SIM.
  sim: z.number().int().min(0).nullable().default(null),
  // Fire a termux-notification when a message is queued for confirmation.
  notifyOnPending: z.boolean().default(true),

  // Where the audit log + pending queue live. Relative paths resolve from cwd.
  dataDir: z.string().default("state"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Recipient = z.infer<typeof RecipientSchema>;

const PLACEHOLDER_TOKENS = new Set([
  "REPLACE_WITH_LONG_RANDOM_TOKEN",
  "changeme",
  "",
]);

export function loadConfig(configPath: string): Config {
  const abs = path.resolve(configPath);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    throw new Error(
      `Could not read config at ${abs}. Copy config.example.json to config.json and edit it.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config.json is not valid JSON: ${(e as Error).message}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`config.json failed validation:\n${issues}`);
  }
  const cfg = result.data;

  // --- Hard safety checks: refuse to start in an unsafe posture. ---
  if (PLACEHOLDER_TOKENS.has(cfg.bearerToken)) {
    throw new Error(
      "bearerToken is unset or a placeholder. Generate one with `npm run gen-token` and put it in config.json.",
    );
  }
  if (cfg.bearerToken.length < 24) {
    throw new Error(
      `bearerToken is too short (${cfg.bearerToken.length} chars). Use at least 24 random chars; generate with \`npm run gen-token\`.`,
    );
  }

  const loopback = cfg.host === "127.0.0.1" || cfg.host === "::1" || cfg.host === "localhost";
  if (!loopback && !cfg.allowLanBind) {
    throw new Error(
      `host is "${cfg.host}" (not loopback). Binding a non-loopback interface is only safe on a Tailscale/WireGuard address. ` +
        `If this IS your tailnet address, set "allowLanBind": true to acknowledge. Never bind 0.0.0.0 on an untrusted LAN.`,
    );
  }
  if (cfg.host === "0.0.0.0" || cfg.host === "::") {
    // Even with allowLanBind, 0.0.0.0 is almost never what you want for this tool.
    if (!cfg.allowLanBind) {
      throw new Error(
        `Refusing to bind ${cfg.host}: this exposes the server to the whole network. ` +
          `Bind your Tailscale IP or 127.0.0.1 instead.`,
      );
    }
  }

  if (cfg.allowlistEnforced && cfg.allowlist.length === 0) {
    // Not fatal, but the server can never send anything — warn loudly at startup.
    // (Handled by the caller's logger; we just flag it here for clarity.)
  }

  return cfg;
}
