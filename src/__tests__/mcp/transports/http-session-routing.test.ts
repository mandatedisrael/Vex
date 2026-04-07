import { describe, expect, it } from "vitest";
import {
  classifyHttpSessionRequest,
  isInitializeRequestBody,
  readMcpSessionId,
} from "../../../mcp/transports/http-session-routing.js";

describe("mcp http session routing", () => {
  it("reads a trimmed MCP session id from a string header", () => {
    expect(readMcpSessionId({ "mcp-session-id": "  abc-123  " })).toBe("abc-123");
  });

  it("reads the first MCP session id from an array header", () => {
    expect(readMcpSessionId({ "mcp-session-id": ["abc-123", "ignored"] })).toBe("abc-123");
  });

  it("returns undefined for missing or blank MCP session headers", () => {
    expect(readMcpSessionId({})).toBeUndefined();
    expect(readMcpSessionId({ "mcp-session-id": "   " })).toBeUndefined();
  });

  it("detects initialize JSON-RPC payloads", () => {
    expect(isInitializeRequestBody({ jsonrpc: "2.0", method: "initialize" })).toBe(true);
    expect(isInitializeRequestBody({ jsonrpc: "2.0", method: "tools/call" })).toBe(false);
    expect(isInitializeRequestBody(null)).toBe(false);
  });

  it("routes to an existing transport when the session is known", () => {
    expect(classifyHttpSessionRequest("session-1", true, { method: "tools/call" })).toBe(
      "existing",
    );
  });

  it("creates a new transport only for initialize without a session header", () => {
    expect(classifyHttpSessionRequest(undefined, false, { method: "initialize" })).toBe(
      "initialize",
    );
  });

  it("returns not_found for unknown session ids", () => {
    expect(classifyHttpSessionRequest("missing-session", false, { method: "tools/call" })).toBe(
      "not_found",
    );
  });

  it("returns missing when a non-initialize request has no session header", () => {
    expect(classifyHttpSessionRequest(undefined, false, { method: "tools/call" })).toBe("missing");
  });
});
