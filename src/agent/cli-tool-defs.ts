/**
 * CLI tool definitions — placeholder for discover+execute routing.
 *
 * Previously contained 130+ CLI tool definitions loaded into every API request.
 * Removed as part of tool routing refactor (discover+execute pattern).
 *
 * Tool definitions now live in tool-groups/ files with structured schemas,
 * loaded on-demand via discover_tools + execute_tool internal tools.
 *
 * @see tool-groups/ for per-domain tool definitions
 * @see tool-registry.ts for the discover+execute internal tools
 */

import type { ToolDef } from "./tool-registry.js";

// TODO: Remove this file entirely once discover+execute is fully implemented
export const CLI_TOOLS: ToolDef[] = [];
