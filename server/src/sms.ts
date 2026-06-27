import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Actually send an SMS. Two backends:
 *  - "termux": shells out to `termux-sms-send` (Termux:API).
 *  - "mock":   logs and pretends to succeed (dev / E2E without a real send).
 *
 * SECURITY: we use execFile with an argv array — never a shell string — so the
 * recipient number and message body cannot be interpreted as shell syntax.
 */
export async function sendSms(
  number: string,
  body: string,
  config: Config,
): Promise<SendResult> {
  if (config.backend === "mock") {
    log.info("[mock] would send SMS", { number, length: body.length });
    return { ok: true };
  }

  const args: string[] = ["-n", number];
  if (config.sim !== null) {
    args.push("-s", String(config.sim));
  }
  // termux-sms-send takes the message body as trailing positional args.
  args.push(body);

  try {
    await execFileAsync("termux-sms-send", args, { timeout: 30_000 });
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    log.error("termux-sms-send failed", { number, error: msg });
    return { ok: false, error: msg };
  }
}
