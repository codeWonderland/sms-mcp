import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { bearerAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { buildMcpServer } from "./mcp.js";
import { RateLimiter } from "./ratelimit.js";

const configPath = process.env.SMS_MCP_CONFIG ?? "config.json";

let config;
try {
  config = loadConfig(configPath);
} catch (e) {
  log.error((e as Error).message);
  process.exit(1);
}

// Allow a dev override to the mock backend without editing config.json.
if (process.env.SMS_MCP_BACKEND === "mock") {
  config.backend = "mock";
}

const limiter = new RateLimiter(config);
const app = express();
app.use(express.json({ limit: "256kb" }));

// Unauthenticated liveness probe (safe: returns no data, server is loopback/tailnet-bound).
app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "sms-mcp", version: "0.1.0" });
});

// MCP endpoint — stateless: a fresh server + transport per request.
app.post("/mcp", bearerAuth(config), async (req, res) => {
  try {
    const server = buildMcpServer(config, limiter);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    log.error("error handling MCP request", { error: (e as Error).message });
    if (!res.headersSent) {
      res.status(500).json({ error: "internal error" });
    }
  }
});

// In stateless mode there is no session to GET/DELETE.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({ error: "method not allowed (stateless server)" });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const httpServer = app.listen(config.port, config.host, () => {
  log.info("sms-mcp listening", {
    url: `http://${config.host}:${config.port}/mcp`,
    backend: config.backend,
    confirmMode: config.confirmMode,
    allowlistEnforced: config.allowlistEnforced,
    allowlistSize: config.allowlist.length,
    logBodies: config.audit.logBodies,
    rateLimit: config.rateLimit,
  });
  if (config.allowlistEnforced && config.allowlist.length === 0) {
    log.warn("allowlist is empty and enforced — the server cannot send to anyone yet. Add recipients to config.json.");
  }
  if (config.backend === "mock") {
    log.warn("backend is MOCK — no real SMS will be sent.");
  }
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info(`received ${sig}, shutting down`);
    httpServer.close(() => process.exit(0));
  });
}
