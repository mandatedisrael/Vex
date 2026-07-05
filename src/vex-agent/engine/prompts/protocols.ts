/**
 * Protocol prompt — constant layer, always present.
 *
 * Auto-generated from protocol manifests plus shared navigation metadata.
 * The prompt intentionally exposes product groups and "when to use" guidance
 * instead of heuristic toolId families.
 */

import {
  PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST,
  PROTOCOL_TOOLS,
  isProtocolToolAvailable,
  getMissingEnvForNamespace,
} from "@vex-agent/tools/protocols/catalog.js";
import {
  getGroupedAdvertisedProtocolNavigation,
} from "@vex-agent/tools/protocols/descriptions.js";
import type { ProtocolNamespace, ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

// ── Auto-generation from manifests ──────────────────────────────

interface NamespaceSummary {
  toolCount: number;
  activeCount: number;
  hasMutating: boolean;
  missingEnv: string[];
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

function buildNamespaceSummaries(): Map<ProtocolNamespace, NamespaceSummary> {
  const byNs = groupByNamespace(
    PROTOCOL_TOOLS.filter((tool) => PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(tool.namespace)),
  );
  const summaries = new Map<ProtocolNamespace, NamespaceSummary>();

  for (const [ns, tools] of byNs) {
    summaries.set(ns, {
      toolCount: tools.length,
      // env-aware: matches what discover_tools would return right now
      activeCount: tools.filter((t) => isProtocolToolAvailable(t)).length,
      hasMutating: tools.some(t => t.mutating),
      missingEnv: getMissingEnvForNamespace(ns),
    });
  }

  return summaries;
}

// ── Public API ──────────────────────────────────────────────────

/** Cached result — built once per process. */
let cached: string | null = null;

export function buildProtocolsPrompt(): string {
  if (cached) return cached;

  const advertisedTools = PROTOCOL_TOOLS.filter((tool) =>
    PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(tool.namespace),
  );
  const summaries = buildNamespaceSummaries();
  const lines: string[] = [];

  lines.push("# Available Protocol Namespaces");
  lines.push("");
  lines.push(`Total: ${advertisedTools.length} tools across ${summaries.size} namespaces.`);
  lines.push("Use discover_tools(namespace=...) to explore any namespace.");
  lines.push("");

  // Heading discipline (P3 style contract): layer H1 → group H2 → namespace H3.
  // Fixes the former inversion where namespaces (##) outranked their group (###).
  for (const group of getGroupedAdvertisedProtocolNavigation()) {
    lines.push(`## ${group.groupLabel}`);
    lines.push("");

    for (const metadata of group.namespaces) {
      const summary = summaries.get(metadata.namespace);
      if (!summary || summary.toolCount === 0) continue;

      lines.push(`### ${metadata.namespace}`);
      lines.push(metadata.summary);
      lines.push(`Use when: ${metadata.whenToUse}`);
      if (metadata.preferInstead) {
        lines.push(`Use instead: ${metadata.preferInstead}`);
      }
      lines.push(`Tools: ${summary.activeCount} active${summary.toolCount > summary.activeCount ? ` / ${summary.toolCount} total` : ""}`);
      // Surface env requirement only when the namespace is fully gated —
      // partial gating is silent (the count itself is correct).
      if (summary.activeCount === 0 && summary.missingEnv.length > 0) {
        lines.push(`Requires env: ${summary.missingEnv.join(", ")} to enable any tool in this namespace.`);
      }
      if (summary.hasMutating) {
        lines.push("Contains mutating tools (may require approval).");
      }
      if (metadata.facets.length > 0) {
        lines.push("Paths:");
        for (const facet of metadata.facets) {
          lines.push(`- ${facet.label}: ${facet.summary}`);
        }
      }
      if (metadata.exampleQueries.length > 0) {
        lines.push("Examples:");
        for (const example of metadata.exampleQueries) {
          lines.push(`  ${example}`);
        }
      }
      lines.push("");
    }
  }

  // ── Venue & Bridge Routing (Wave 2c) — static routing policy, lands WITH the
  // tools it describes. Imperative rules; no live data (KV-cache safe). Mirrors
  // the venue-router policy modules so guidance and code stay aligned.
  lines.push("## Venue & Bridge Routing");
  lines.push("");
  lines.push("Swap venue by chain:");
  lines.push("- On KyberSwap-supported EVM chains, prefer `kyberswap.*` (aggregated pricing plus honeypot/fee-on-transfer flags).");
  lines.push("- If KyberSwap fails or lacks the chain, fall back to `uniswap.*` (best route across Uniswap V2 and V3).");
  lines.push("- On Robinhood Chain, `uniswap.*` is the ONLY venue. $VEX and other Virtuals agent tokens trade against VIRTUAL there, so route through VIRTUAL (or WETH) as the base pair.");
  lines.push("- Quote and execute on the SAME venue: a `kyberswap` quote authorizes only a `kyberswap` execute, and a `uniswap` quote only a `uniswap` execute. The runtime enforces this.");
  lines.push("");
  lines.push("Bridge venue by chain:");
  lines.push("- Between Khalani-supported chains, use `khalani.*`.");
  lines.push("- Khalani does NOT cover Robinhood Chain — to or from it, use `relay.*`.");
  lines.push("- To fund Robinhood Chain, bridge ETH, USDG, or VIRTUAL in with `relay.*`, then swap on-chain with `uniswap.*`; reverse the flow to exit.");
  lines.push("- Quote and execute on the SAME bridge provider (`khalani` or `relay`). The runtime enforces this.");
  lines.push("");

  cached = lines.join("\n");
  return cached;
}

/** For testing — reset cached prompt. */
export function resetProtocolsPromptCache(): void {
  cached = null;
}
