/**
 * Production MCP — McpServer factory.
 *
 * One server factory shared by both transports. Wires:
 *   - `instructions` (handshake preamble)
 *   - production tool surface (every internal tool registered individually)
 *   - docs resources (`docs://*`, `surface://manifest`, `runtime://env`)
 *   - workflow prompts (trade-workflow, knowledge-guidelines, safety-rules)
 *
 * The session id provider is a callback so transports can supply different
 * sources: stdio passes the single-connection id; HTTP creates one
 * `McpServer` per MCP session and passes the DB session id bound to that
 * transport instance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductionTools } from "../surface/tool-bridge.js";
import { registerDocsResources } from "../docs/resources.js";
import { registerWorkflowPrompts } from "../docs/prompts.js";
import { buildInstructions } from "../docs/instructions.js";

export interface CreateServerOptions {
  /** Returns the current MCP session id for use as `InternalToolContext.sessionId`. */
  sessionIdProvider: () => string;
}

export function createMcpServerInstance(opts: CreateServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "echoclaw-mcp",
      version: "1.0.0",
    },
    {
      instructions: buildInstructions(),
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  registerProductionTools(server, opts.sessionIdProvider);
  registerDocsResources(server);
  registerWorkflowPrompts(server);

  return server;
}
