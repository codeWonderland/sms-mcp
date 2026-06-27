import type { Config } from "./config.js";

/**
 * In-memory sliding-window rate limiter. Counts actual send attempts against
 * per-minute and per-hour caps. Resets on process restart — acceptable for a
 * single-owner tool; the audit log is the durable record.
 */
export class RateLimiter {
  private sends: number[] = []; // timestamps (ms)
  constructor(private readonly config: Config) {}

  /** Returns null if allowed, or a human-readable reason if blocked. */
  check(now: number): string | null {
    this.prune(now);
    const lastMinute = this.sends.filter((t) => now - t < 60_000).length;
    const lastHour = this.sends.length;
    if (lastMinute >= this.config.rateLimit.perMinute) {
      return `rate limit: ${this.config.rateLimit.perMinute} sends/minute exceeded`;
    }
    if (lastHour >= this.config.rateLimit.perHour) {
      return `rate limit: ${this.config.rateLimit.perHour} sends/hour exceeded`;
    }
    return null;
  }

  record(now: number): void {
    this.sends.push(now);
    this.prune(now);
  }

  private prune(now: number): void {
    this.sends = this.sends.filter((t) => now - t < 3_600_000);
  }
}
