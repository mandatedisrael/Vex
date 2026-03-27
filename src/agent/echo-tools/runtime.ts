/**
 * echoTools runtime scaffold.
 *
 * This template keeps API shape stable before full implementation:
 * - discover_tools => protocol capabilities only
 * - execute_tool => protocol execution only
 *
 * Internal tools (memory_manage, subagent_*, file_*, web_*, schedule_*, trade_log)
 * are intentionally outside this catalog and remain direct runtime tools.
 */

import type {
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolExecuteRequest,
  PrepareProtocolExecutionResult,
} from "./types.js";
import { PROTOCOL_NAMESPACE_ALLOWLIST } from "./catalog.js";

/**
 * TODO: Implement query/namespace ranking and manifest-backed discovery.
 * For now returns empty protocol list with explicit warning.
 */
export function discoverProtocolCapabilities(
  _request: ProtocolDiscoveryRequest,
): ProtocolDiscoveryResult {
  return {
    success: true,
    count: 0,
    tools: [],
    warnings: [
      "echoTools scaffold mode: protocol catalog is not implemented yet.",
      `Declared namespaces: ${PROTOCOL_NAMESPACE_ALLOWLIST.join(", ")}`,
    ],
  };
}

/**
 * TODO: Implement full toolId resolve + schema validation + command mapping.
 * For now returns explicit NOT_IMPLEMENTED result.
 */
export function prepareProtocolExecution(
  _request: ProtocolExecuteRequest,
): PrepareProtocolExecutionResult {
  return {
    ok: false,
    code: "ECHO_TOOLS_NOT_IMPLEMENTED",
    message: "echoTools scaffold mode: execute_tool mapping is not implemented yet.",
  };
}

