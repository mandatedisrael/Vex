/**
 * Discovery smoke — enumerate discover_tools per active namespace.
 *
 * Goes through dispatchTool() for faithful E2E (same path as engine).
 * Derives active namespaces from PROTOCOL_TOOLS, not from NAMESPACE_ALLOWLIST
 * (which may contain declared-only namespaces with 0 active tools).
 */

import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { PROTOCOL_TOOLS } from "@echo-agent/tools/protocols/catalog.js";
import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";
import logger from "@utils/logger.js";

export interface DiscoveryResult {
  namespace: string;
  count: number;
  mutatingCount: number;
  warnings: string[];
}

export async function runDiscoverySmoke(context: InternalToolContext): Promise<DiscoveryResult[]> {
  const activeNamespaces = [...new Set(PROTOCOL_TOOLS.map(t => t.namespace))];
  const results: DiscoveryResult[] = [];

  for (const ns of activeNamespaces) {
    const result = await dispatchTool(
      {
        name: "discover_tools",
        args: { namespace: ns, includeMutating: true, limit: 200 },
        toolCallId: `disco-${ns}`,
      },
      context,
    );

    const data = result.data as {
      count?: number;
      tools?: { mutating?: boolean }[];
      warnings?: string[];
    } | undefined;

    const count = data?.count ?? 0;
    const mutatingCount = data?.tools?.filter(t => t.mutating).length ?? 0;
    const warnings = data?.warnings ?? [];

    results.push({ namespace: ns, count, mutatingCount, warnings });

    logger.info("e2e.discovery", { namespace: ns, count, mutatingCount });
  }

  return results;
}
