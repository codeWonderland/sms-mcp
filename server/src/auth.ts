import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Config } from "./config.js";
import { log } from "./logger.js";

/**
 * Constant-time bearer token check. Compares SHA-free raw bytes in constant
 * time to avoid leaking token length/prefix via timing. Length mismatch is
 * handled by comparing equal-length buffers.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual requires equal lengths; if they differ, still do a compare
  // against a same-length buffer so timing doesn't reveal the mismatch reason.
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // burn equivalent time
    return false;
  }
  return timingSafeEqual(a, b);
}

export function bearerAuth(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const prefix = "Bearer ";
    if (!header.startsWith(prefix)) {
      log.warn("auth: missing/!bearer", { ip: req.ip });
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const provided = header.slice(prefix.length);
    if (!tokenMatches(provided, config.bearerToken)) {
      log.warn("auth: bad token", { ip: req.ip });
      res.status(401).json({ error: "invalid token" });
      return;
    }
    next();
  };
}
