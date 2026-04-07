import type { IncomingHttpHeaders } from "node:http";

export const MCP_SESSION_HEADER = "mcp-session-id";

export type HttpSessionRoute = "existing" | "initialize" | "missing" | "not_found";

/**
 * Read the MCP session header from Node/Fastify headers.
 * Fastify can expose headers as either a single string or a string array.
 */
export function readMcpSessionId(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers[MCP_SESSION_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Minimal initialize detector for POST /mcp routing.
 * MCP initialize requests are JSON-RPC messages with method "initialize".
 */
export function isInitializeRequestBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return (body as { method?: unknown }).method === "initialize";
}

export function classifyHttpSessionRequest(
  sessionId: string | undefined,
  hasTransport: boolean,
  body: unknown,
): HttpSessionRoute {
  if (sessionId && hasTransport) return "existing";
  if (!sessionId && isInitializeRequestBody(body)) return "initialize";
  if (sessionId) return "not_found";
  return "missing";
}
