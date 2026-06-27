import type { Config, Recipient } from "./config.js";
import { listContacts } from "./contacts.js";
import { looksLikeNumber, normalizeNumber, numbersEqual } from "./phone.js";

export interface ResolvedRecipient {
  number: string; // normalized
  name?: string;
}

export class RecipientError extends Error {}

/**
 * Resolve a `to` argument (a phone number OR a contact name) to a concrete
 * normalized number. Throws RecipientError on ambiguity or no match.
 */
export async function resolveRecipient(
  to: string,
  config: Config,
): Promise<ResolvedRecipient> {
  const input = to.trim();
  if (!input) throw new RecipientError("Recipient `to` is empty.");

  if (looksLikeNumber(input)) {
    const number = normalizeNumber(input);
    const known = config.allowlist.find((r) => numbersEqual(r.number, number));
    return { number, name: known?.name };
  }

  // Treat as a name: resolve against contacts, then the allowlist names.
  const contacts = await listContacts(config);
  const q = input.toLowerCase();
  const matches = contacts.filter((c) => c.name.toLowerCase().includes(q));

  // Prefer an exact (case-insensitive) name match if present.
  const exact = matches.filter((c) => c.name.toLowerCase() === q);
  const pool = exact.length ? exact : matches;

  if (pool.length === 0) {
    throw new RecipientError(
      `No contact matches "${input}". Pass a phone number, or check the name with sms.list_contacts.`,
    );
  }
  // Collapse entries that point at the same underlying number.
  const uniqueNumbers = Array.from(
    new Map(pool.map((c) => [normalizeNumber(c.number), c])).values(),
  );
  if (uniqueNumbers.length > 1) {
    const names = uniqueNumbers.map((c) => c.name).join(", ");
    throw new RecipientError(
      `"${input}" is ambiguous — matches: ${names}. Use a phone number to disambiguate.`,
    );
  }
  const c = uniqueNumbers[0];
  return { number: normalizeNumber(c.number), name: c.name || undefined };
}

/** Is a normalized number on the allowlist? */
export function isAllowlisted(number: string, config: Config): boolean {
  return config.allowlist.some((r: Recipient) => numbersEqual(r.number, number));
}
