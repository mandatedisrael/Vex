/**
 * Protocol prompt — constant layer, always present.
 *
 * Auto-generated from PROTOCOL_TOOLS manifests (catalog.ts).
 * Namespace descriptions are a frozen handwritten map (manifests have
 * descriptions per-tool, not per-namespace).
 * Capability families and tool counts are auto-generated from toolId patterns.
 */

import { PROTOCOL_TOOLS } from "@echo-agent/tools/protocols/catalog.js";
import type { ProtocolToolManifest } from "@echo-agent/tools/protocols/types.js";

// ── Namespace descriptions — frozen, handwritten ────────────────

// ── Discovery examples — frozen, handwritten ───────────────────

const NAMESPACE_EXAMPLES: Record<string, string[]> = {
  khalani: [
    'discover_tools(query="token search", namespace="khalani")',
    'discover_tools(query="bridge quote", namespace="khalani")',
  ],
  dexscreener: [
    'discover_tools(query="trending pairs", namespace="dexscreener")',
    'discover_tools(query="token search", namespace="dexscreener")',
  ],
  solana: [
    'discover_tools(query="token search", namespace="solana")',
    'discover_tools(query="swap", namespace="solana")',
    'discover_tools(query="prediction markets", namespace="solana")',
  ],
  kyberswap: [
    'discover_tools(query="token search", namespace="kyberswap")',
    'discover_tools(query="swap", namespace="kyberswap")',
    'discover_tools(query="limit order", namespace="kyberswap")',
    'discover_tools(query="zap liquidity", namespace="kyberswap")',
  ],
  polymarket: [
    'discover_tools(query="prediction markets", namespace="polymarket")',
    'discover_tools(query="buy prediction", namespace="polymarket", includeMutating=true)',
  ],
  jaine: [
    'discover_tools(query="0g swap", namespace="jaine")',
  ],
  slop: [
    'discover_tools(query="bonding curve token", namespace="slop")',
  ],
  chainscan: [
    'discover_tools(query="transaction lookup", namespace="chainscan")',
  ],
  echobook: [
    'discover_tools(query="posts feed", namespace="echobook")',
    'discover_tools(query="notifications", namespace="echobook")',
  ],
  "slop-app": [
    'discover_tools(query="profile", namespace="slop-app")',
  ],
};

const NAMESPACE_DESCRIPTIONS: Record<string, string> = {
  khalani: "Cross-chain balances, token discovery, bridge quotes and execution (40+ chains). Resolve tokens via khalani.tokens.search before bridge/quote",
  dexscreener: "DEX analytics, trending pairs, token profiles, price research",
  solana: "Jupiter swaps, token prices, token discovery, lending, prediction markets (requires JUPITER_API_KEY). Resolve mints via solana.tokens.search before swap/predict",
  kyberswap: "Multi-chain EVM swaps, token safety, limit orders, LP zap. Resolve tokens via kyberswap.tokens.search before swap/order/zap",
  polymarket: "Prediction markets, positions, CLOB trading, analytics, orderbook",
  jaine: "0G DEX swaps, LP management, wrap/unwrap A0GI",
  slop: "0G bonding curve token creation, trading, discovery",
  chainscan: "0G explorer intelligence, transaction lookup, block data",
  echobook: "Social graph — posts, comments, notifications, points, threads",
  "slop-app": "0G social app — profiles, image generation, agent interactions, chat",
  "0g-compute": "0G compute network",
  "0g-storage": "0G storage network",
};

// ── Auto-generation from manifests ──────────────────────────────

interface NamespaceSummary {
  description: string;
  toolCount: number;
  activeCount: number;
  families: string[];
  hasMutating: boolean;
}

function groupByNamespace(tools: readonly ProtocolToolManifest[]): Map<string, ProtocolToolManifest[]> {
  const map = new Map<string, ProtocolToolManifest[]>();
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

function buildNamespaceSummaries(): Map<string, NamespaceSummary> {
  const byNs = groupByNamespace(PROTOCOL_TOOLS);
  const summaries = new Map<string, NamespaceSummary>();

  for (const [ns, tools] of byNs) {
    summaries.set(ns, {
      description: NAMESPACE_DESCRIPTIONS[ns] ?? ns,
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
