/**
 * Tiny structured logger to stderr. We log to stderr (not stdout) so it never
 * interferes with anything and is easy to redirect in Termux.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const tail = extra && Object.keys(extra).length ? " " + JSON.stringify(extra) : "";
  process.stderr.write(`[${ts}] ${level.toUpperCase()} ${msg}${tail}\n`);
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
};
