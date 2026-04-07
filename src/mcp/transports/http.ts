/**
 * Production MCP — Streamable HTTP transport entry on Fastify.
 *
 * Architecture:
 *   - Fastify instance binding to `127.0.0.1` on `MCP_HTTP_PORT` (default 4203).
 *   - Three-layer defense:
 *       1. Loopback bind — external addresses cannot reach the process.
 *       2. Host header validation hook (`onRequest`) — replicates DNS rebinding
 *          protection. Allows only `127.0.0.1:{port}`, `localhost:{port}`,
 *          `[::1]:{port}`. Replaces SDK's `createMcpExpressApp` helper so we
 *          stay on Fastify (own TS types, lighter deps).
 *       3. Bearer token preHandler — `Authorization: Bearer {token}` against
 *          a token persisted in `CONFIG_DIR/mcp-http-token` (mode 0600).
 *   - StreamableHTTPServerTransport from the SDK is mounted on
 *     `POST/GET/DELETE /mcp`. The SDK's `handleRequest(req, res, parsedBody?)`
 *     expects raw Node IncomingMessage / ServerResponse, which Fastify exposes
 *     as `request.raw` / `reply.raw`. We pass `request.body` for POSTs so the
 *     SDK does not have to re-parse what Fastify already parsed.
 *   - The HTTP docs mirror is mounted on the same Fastify instance via
 *     `mountHttpDocs(fastify)` so it inherits the same hooks (host validation
 *     + bearer).
 *
 * Session lifecycle in v1: one Streamable HTTP transport + one McpServer per
 * MCP session. The MCP-side session id is assigned by the SDK and mapped 1:1
 * to a DB session id (`mcp-http-{externalId}`) during initialization, so
 * audit/provenance stays isolated per connected client session.
 */

import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createMcpServerInstance } from "../server/create-server.js";
import { createMcpSession, endMcpSession } from "../sessions.js";
import { mountHttpDocs } from "../docs/http-mirror.js";
import { loadOrCreateHttpToken } from "../auth/token.js";
import {
  classifyHttpSessionRequest,
  readMcpSessionId,
} from "./http-session-routing.js";
import logger from "@utils/logger.js";

const DEFAULT_PORT = 4203;
const BIND_HOST = "127.0.0.1";

interface HttpSessionState {
  transport: StreamableHTTPServerTransport;
  dbSessionId?: string;
  ready: Promise<string>;
}

function parsePort(): number {
  const raw = (process.env.MCP_HTTP_PORT ?? "").trim();
  if (!raw) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    logger.warn("mcp.http.invalid_port_using_default", { raw, default: DEFAULT_PORT });
    return DEFAULT_PORT;
  }
  return parsed;
}

/** Build the allowed Host header set for the configured port. */
function buildAllowedHosts(port: number): Set<string> {
  // Browser / curl normalizes the Host header to `<hostname>:<port>` (or just
  // `<hostname>` for default ports — neither stdio nor HTTP MCP uses 80/443).
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
}

export async function startHttpTransport(): Promise<void> {
  const port = parsePort();
  const token = loadOrCreateHttpToken();
  const allowedHosts = buildAllowedHosts(port);
  const sessions = new Map<string, HttpSessionState>();

  const fastify: FastifyInstance = Fastify({
    // Quiet built-in pino logger; we already log via winston on stderr.
    logger: false,
    // Disable trust proxy — we are loopback only.
    trustProxy: false,
  });

  // ── Layer 2: host header validation (DNS rebinding protection) ────────
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const hostHeader = request.headers.host;
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      logger.warn("mcp.http.host_rejected", { host: hostHeader ?? "<missing>" });
      reply.code(403).send({ error: "forbidden" });
    }
  });

  // ── Layer 3: bearer token ────────────────────────────────────────────
  const expectedAuth = `Bearer ${token}`;
  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? "";
    if (auth.length !== expectedAuth.length || auth !== expectedAuth) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Mount docs mirror on the same instance — inherits hooks above.
  mountHttpDocs(fastify);

  // Pass raw Node req/res to the SDK transport. The SDK does not understand
  // Fastify's request/reply abstractions; it expects Node primitives.
  const handleMcp = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const mcpSessionId = readMcpSessionId(request.headers);
    const route = classifyHttpSessionRequest(
      mcpSessionId,
      mcpSessionId ? sessions.has(mcpSessionId) : false,
      request.body,
    );

    try {
      if (route === "existing" && mcpSessionId) {
        const state = sessions.get(mcpSessionId)!;
        await state.ready;
        await state.transport.handleRequest(request.raw, reply.raw, request.body);
        return;
      }

      if (route === "initialize") {
        let state: HttpSessionState | undefined;

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            state = {
              transport,
              ready: createMcpSession({
                transport: "http",
                externalId: initializedSessionId,
              }).then((dbSessionId) => {
                if (state) {
                  state.dbSessionId = dbSessionId;
                }
                logger.info("mcp.http.session_bound", {
                  mcpSessionId: initializedSessionId,
                  dbSessionId,
                });
                return dbSessionId;
              }).catch((err) => {
                sessions.delete(initializedSessionId);
                logger.error("mcp.http.session_bind_failed", {
                  mcpSessionId: initializedSessionId,
                  error: err instanceof Error ? err.message : String(err),
                });
                void transport.close().catch((closeErr) => {
                  logger.warn("mcp.http.transport_close_failed_after_bind_error", {
                    mcpSessionId: initializedSessionId,
                    error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                  });
                });
                throw err;
              }),
            };
            sessions.set(initializedSessionId, state);
          },
        });

        const server = createMcpServerInstance({
          sessionIdProvider: () => {
            if (!state?.dbSessionId) {
              throw new Error("HTTP MCP session is not bound to a DB session");
            }
            return state.dbSessionId;
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport.sessionId;
          if (!closedSessionId) return;

          const closedState = sessions.get(closedSessionId);
          sessions.delete(closedSessionId);

          if (!closedState) return;

          void closedState.ready
            .then((dbSessionId) => endMcpSession(dbSessionId))
            .catch((err) => {
              logger.warn("mcp.http.session_close_without_db_session", {
                mcpSessionId: closedSessionId,
                error: err instanceof Error ? err.message : String(err),
              });
            });

          logger.info("mcp.http.transport_closed", { mcpSessionId: closedSessionId });
        };

        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
        if (state) {
          await state.ready;
        }
        return;
      }

      if (route === "not_found") {
        reply.code(404).send({ error: "session_not_found" });
        return;
      }

      reply.code(400).send({ error: "session_id_required" });
    } catch (err) {
      logger.warn("mcp.http.handle_failed", {
        method: request.method,
        mcpSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!reply.raw.headersSent) {
        reply.code(500).send({ error: "internal" });
      }
    }
  };

  fastify.post("/mcp", handleMcp);
  fastify.get("/mcp", handleMcp);
  fastify.delete("/mcp", handleMcp);

  await fastify.listen({ host: BIND_HOST, port });
  logger.info("mcp.http.listening", { host: BIND_HOST, port });

  // ── Graceful shutdown ─────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("mcp.http.shutdown", { signal, activeSessions: sessions.size });

    for (const [mcpSessionId, state] of Array.from(sessions.entries())) {
      try {
        await state.transport.close();
      } catch (err) {
        logger.warn("mcp.http.transport_close_failed", {
          mcpSessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      await fastify.close();
    } catch (err) {
      logger.warn("mcp.http.close_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
