/**
 * Phone number normalization. We compare allowlist entries and resolved
 * recipients in a normalized form so "+1 (555) 555-0123" and "+15555550123"
 * are treated as equal. This is deliberately conservative — we do NOT guess
 * country codes; we only strip formatting.
 */
export function normalizeNumber(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

/** Heuristic: does this look like a phone number (vs. a contact name)? */
export function looksLikeNumber(input: string): boolean {
  const t = input.trim();
  return /^\+?[0-9][0-9\s().-]{4,}$/.test(t);
}

export function numbersEqual(a: string, b: string): boolean {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  if (na === nb) return true;
  // Tolerate a missing "+" / leading country code mismatch by comparing the
  // last 10 digits (US-centric fallback; allowlist remains the hard gate).
  const da = na.replace(/^\+/, "");
  const db = nb.replace(/^\+/, "");
  if (da.length >= 10 && db.length >= 10) {
    return da.slice(-10) === db.slice(-10);
  }
  return false;
}
