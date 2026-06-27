import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface Contact {
  name: string;
  number: string;
}

/**
 * Read the phone's contacts via `termux-contact-list` (Termux:API).
 * In mock mode we return the allowlist as the contact book so name->number
 * resolution still works on a dev laptop.
 *
 * termux-contact-list emits a JSON array of { name, number } objects.
 */
export async function listContacts(config: Config): Promise<Contact[]> {
  if (config.backend === "mock") {
    return config.allowlist
      .filter((r) => r.name)
      .map((r) => ({ name: r.name as string, number: r.number }));
  }

  try {
    const { stdout } = await execFileAsync("termux-contact-list", [], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Array<{ name?: string; number?: string }>;
    return parsed
      .filter((c) => c.number)
      .map((c) => ({ name: c.name ?? "", number: c.number as string }));
  } catch (e) {
    log.warn("termux-contact-list failed; returning empty contact list", {
      error: (e as Error).message,
    });
    return [];
  }
}
