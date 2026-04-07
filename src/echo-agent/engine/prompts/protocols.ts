/**
 * Protocol prompt — constant layer, always present.
 *
 * Auto-generated from PROTOCOL_TOOLS manifests (catalog.ts).
 * Namespace descriptions and discover_tools example queries come from
 * `tools/protocols/descriptions.ts` — a single source-of-truth shared
 * with the production MCP server (so the same per-namespace copy ends
 * up in both Echo Agent's mission loop prompt and MCP handshake +
 * docs resources).
 * Capability families and tool counts are auto-generated from toolId patterns.
 */

import { PROTOCOL_TOOLS } from "@echo-agent/tools/protocols/catalog.js";
import {
  NAMESPACE_DESCRIPTIONS,
  NAMESPACE_EXAMPLES,
} from "@echo-agent/tools/protocols/descriptions.js";
import type { ProtocolNamespace, ProtocolToolManifest } from "@echo-agent/tools/protocols/types.js";

// ── Auto-generation from manifests ──────────────────────────────

interface NamespaceSummary {
  description: string;
  toolCount: number;
  activeCount: number;
  families: string[];
  hasMutating: boolean;
}

function groupByNamespace(
  tools: readonly ProtocolToolManifest[],
): Map<ProtocolNamespace, ProtocolToolManifest[]> {
  const map = new Map<ProtocolNamespace, ProtocolToolManifest[]>();
  for (const t of tools) {
    const arr = map.get(t.namespace) ?? [];
    arr.push(t);
    map.set(t.namespace, arr);
  }
  return map;
}

function extractFamilies(tools: ProtocolToolManifest[]): string[] {
  const prefixes = new Map<string, number>();

  for (const t of tools) {
    // toolId like "khalani.bridge" → prefix "khalani.bridge"
    // toolId like "solana.swap.quote" → prefix "solana.swap"
    const parts = t.toolId.split(".");
    if (parts.length >= 2) {
      const prefix = parts.slice(0, 2).join(".");
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
  }

  // Return families with 1+ tools, sorted, with wildcard
  return [...prefixes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, count]) => count > 1 ? `${prefix}.*` : prefix);
}

function buildNamespaceSummaries(): Map<ProtocolNamespace, NamespaceSummary> {
  const byNs = groupByNamespace(PROTOCOL_TOOLS);
  const summaries = new Map<ProtocolNamespace, NamespaceSummary>();

  for (const [ns, tools] of byNs) {
    summaries.set(ns, {
      description: NAMESPACE_DESCRIPTIONS[ns],
      toolCount: tools.length,
      activeCount: tools.filter(t => t.lifecycle === "active").length,
      families: extractFamilies(tools),
      hasMutating: tools.some(t => t.mutating),
    });
  }

  return summaries;
}

// ── Public API ──────────────────────────────────────────────────

/** Cached result — built once per process. */
let cached: string | null = null;

export function buildProtocolsPrompt(): string {
  if (cached) return cached;

  const summaries = buildNamespaceSummaries();
  const lines: string[] = [];

  lines.push("# Available Protocol Namespaces");
  lines.push("");
  lines.push(`Total: ${PROTOCOL_TOOLS.length} tools across ${summaries.size} namespaces.`);
  lines.push("Use discover_tools(namespace=...) to explore any namespace.");
  lines.push("");

  for (const [ns, summary] of summaries) {
    lines.push(`## ${ns}`);
    lines.push(summary.description);
    lines.push(`Tools: ${summary.activeCount} active${summary.toolCount > summary.activeCount ? ` / ${summary.toolCount} total` : ""}`);
    if (summary.families.length > 0) {
      lines.push(`Families: ${summary.families.join(", ")}`);
    }
    if (summary.hasMutating) {
      lines.push("⚠ Contains mutating tools (may require approval)");
    }
    const examples = NAMESPACE_EXAMPLES[ns];
    if (examples && examples.length > 0) {
      lines.push("Examples:");
      for (const ex of examples) {
        lines.push(`  ${ex}`);
      }
    }
    lines.push("");
  }

  cached = lines.join("\n");
  return cached;
}

/** For testing — reset cached prompt. */
export function resetProtocolsPromptCache(): void {
  cached = null;
}
