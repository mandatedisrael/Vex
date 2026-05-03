/**
 * Production MCP — single source-of-truth for documentation payloads.
 *
 * Builds plain serializable structures (no MCP / HTTP envelopes) from the
 * canonical registry + protocol catalog. Both the MCP-native resources
 * (`docs://*`, `surface://manifest`, `runtime://env`) and the optional HTTP
 * docs mirror import these functions and wrap them in their respective
 * envelopes. That way drift between MCP-native and HTTP docs is structurally
 * impossible — there is one function per data set.
 *
 * No long-form workflow text lives here; the curated workflow strings live
 * in `prompts.ts` and `instructions.ts`. This file is purely registry +
 * catalog projection.
 */

import {
  getProductionMcpTools,
} from "@vex-agent/tools/registry.js";
import {
  PROTOCOL_TOOLS,
  PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST,
  NAMESPACE_DEFAULTS,
  countAvailableToolsForNamespace,
  getMissingEnvForNamespace,
  isProtocolToolAvailable,
} from "@vex-agent/tools/protocols/catalog.js";
import {
  getGroupedAdvertisedProtocolNavigation,
  getProtocolNamespaceNavigation,
  getMatchingFacetsForTool,
} from "@vex-agent/tools/protocols/descriptions.js";
import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import type { ProtocolNamespace, ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

// ── Tool grouping (by capability family) ──────────────────────────

/**
 * Bucket each registry tool by capability family for human-readable docs.
 * The grouping is hand-curated by name prefix so it stays stable when new
 * tools land — adding a `web_news` would land in Web automatically.
 */
const TOOL_GROUP_RULES: Array<{ group: string; match: (name: string) => boolean }> = [
  { group: "Discovery", match: (n) => n === "discover_tools" || n === "execute_tool" },
  { group: "Web",       match: (n) => n.startsWith("web_") },
  { group: "Social",    match: (n) => n.startsWith("twitter_") },
  { group: "Documents", match: (n) => n.startsWith("document_") },
  { group: "Knowledge", match: (n) => n.startsWith("knowledge_") },
  { group: "Wallet",    match: (n) => n.startsWith("wallet_") },
  { group: "EVM",       match: (n) => n.startsWith("evm_") },
  { group: "Portfolio", match: (n) => n.startsWith("portfolio_") },
  { group: "Mission",   match: (n) => n.startsWith("mission_") },
  { group: "Setup",     match: (n) => n.endsWith("_setup") },
];

export interface ToolDoc {
  name: string;
  description: string;
  mutating: boolean;
}

export interface ToolGroup {
  group: string;
  tools: ToolDoc[];
}

/**
 * Group + sort the production MCP tool surface for human-readable docs.
 * Order within a group: alphabetical by name. Order of groups follows
 * `TOOL_GROUP_RULES`. Tools that match no rule fall into "Other".
 */
export function buildToolGroups(): ToolGroup[] {
  const tools = getProductionMcpTools();
  const buckets = new Map<string, ToolDoc[]>();
  for (const rule of TOOL_GROUP_RULES) buckets.set(rule.group, []);
  buckets.set("Other", []);

  for (const tool of tools) {
    const rule = TOOL_GROUP_RULES.find((r) => r.match(tool.name));
    const group = rule?.group ?? "Other";
    buckets.get(group)!.push({
      name: tool.name,
      description: tool.description,
      mutating: tool.mutating,
    });
  }

  const result: ToolGroup[] = [];
  for (const [group, list] of buckets) {
    if (list.length === 0) continue;
    list.sort((a, b) => a.name.localeCompare(b.name));
    result.push({ group, tools: list });
  }
  return result;
}

// ── Overview ─────────────────────────────────────────────────────

export interface OverviewDoc {
  name: string;
  purpose: string;
  surfaceSize: number;
  protocolNamespaceCount: number;
  embeddingModel: string;
  embeddingDim: number;
}

export function buildOverview(): OverviewDoc {
  const tools = getProductionMcpTools();
  const config = safeLoadEmbeddingConfig();
  return {
    name: "vex-mcp",
    purpose:
      "Vex production MCP server — passive tool surface bridge over Vex Agent. " +
      "Exposes the host-relevant internal tools (knowledge, documents, wallet, portfolio, " +
      "web, EVM, setup) plus discover_tools / execute_tool for protocol capabilities. " +
      "No subagents, no mission_* — those are Vex Agent runtime concepts.",
    surfaceSize: tools.length,
    protocolNamespaceCount: PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.length,
    embeddingModel: config?.model ?? "<unknown — EMBEDDING_MODEL not set>",
    embeddingDim: config?.dim ?? 0,
  };
}

// ── Protocols ────────────────────────────────────────────────────

export interface ProtocolNamespaceDoc {
  namespace: ProtocolNamespace;
  description: string;
  groupId: string;
  groupLabel: string;
  whenToUse: string;
  preferInstead?: string;
  exampleQueries: readonly string[];
  defaultPortfolioRole: string;
  /**
   * Tools that are *currently usable* — active lifecycle AND any
   * `requiresEnv` actually present. Mirrors what `discover_tools` returns.
   */
  activeToolCount: number;
  /**
   * Distinct unset env vars that gate active tools in this namespace.
   * Empty when nothing is gated. Renderers show a hint when this is
   * non-empty AND `activeToolCount === 0`.
   */
  gatedByEnv: string[];
  paths: Array<{ label: string; summary: string }>;
}

export function buildProtocolList(): ProtocolNamespaceDoc[] {
  return getGroupedAdvertisedProtocolNavigation().flatMap((group) => group.namespaces.map((metadata) => {
    const namespace = metadata.namespace;
    return {
      namespace,
      description: metadata.summary,
      groupId: group.groupId,
      groupLabel: group.groupLabel,
      whenToUse: metadata.whenToUse,
      preferInstead: metadata.preferInstead,
      exampleQueries: metadata.exampleQueries,
      defaultPortfolioRole: NAMESPACE_DEFAULTS[namespace],
      activeToolCount: countAvailableToolsForNamespace(namespace),
      gatedByEnv: getMissingEnvForNamespace(namespace),
      paths: metadata.facets.map((facet) => ({ label: facet.label, summary: facet.summary })),
    };
  }));
}

export interface ProtocolToolDoc {
  toolId: string;
  namespace: ProtocolNamespace;
  description: string;
  mutating: boolean;
  lifecycle: string;
}

export interface ProtocolNamespaceDetailDoc {
  namespace: ProtocolNamespace;
  description: string;
  groupId: string;
  groupLabel: string;
  whenToUse: string;
  preferInstead?: string;
  exampleQueries: readonly string[];
  /**
   * Distinct unset env vars that gate tools in this namespace. Empty when
   * everything required is present. Mirrors `ProtocolNamespaceDoc.gatedByEnv`.
   */
  gatedByEnv: string[];
  paths: Array<{ label: string; summary: string; tools: string[] }>;
  tools: ProtocolToolDoc[];
}

export function buildProtocolNamespace(
  namespace: string,
): ProtocolNamespaceDetailDoc | null {
  if (!PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(namespace as ProtocolNamespace)) {
    return null;
  }
  const ns = namespace as ProtocolNamespace;
  const metadata = getProtocolNamespaceNavigation(ns);
  // Only surface tools that runtime would actually return — keeps docs in
  // sync with `discover_tools` for env-gated namespaces.
  const tools: ProtocolToolDoc[] = PROTOCOL_TOOLS.filter((t) => t.namespace === ns && isProtocolToolAvailable(t))
    .sort((a, b) => a.toolId.localeCompare(b.toolId))
    .map((t: ProtocolToolManifest) => ({
      toolId: t.toolId,
      namespace: t.namespace,
      description: t.description,
      mutating: t.mutating,
      lifecycle: t.lifecycle,
    }));
  return {
    namespace: ns,
    description: metadata.summary,
    groupId: metadata.groupId,
    groupLabel: metadata.groupLabel,
    whenToUse: metadata.whenToUse,
    preferInstead: metadata.preferInstead,
    exampleQueries: metadata.exampleQueries,
    gatedByEnv: getMissingEnvForNamespace(ns),
    paths: metadata.facets.map((facet) => ({
      label: facet.label,
      summary: facet.summary,
      tools: tools
        .filter((tool) => getMatchingFacetsForTool(ns, tool.toolId).some((candidate) => candidate.label === facet.label))
        .map((tool) => tool.toolId),
    })),
    tools,
  };
}

// ── Surface manifest (machine-readable) ──────────────────────────

export interface SurfaceManifest {
  version: 1;
  tools: string[];
  protocolNamespaces: ProtocolNamespace[];
  generatedAt: string;
}

export function buildSurfaceManifest(): SurfaceManifest {
  return {
    version: 1,
    tools: getProductionMcpTools().map((t) => t.name).sort(),
    protocolNamespaces: [...PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST],
    generatedAt: new Date().toISOString(),
  };
}

// ── Runtime env (presence flags only — never values) ─────────────

export interface RuntimeEnvDoc {
  embeddingModel: string;
  embeddingDim: number;
  envFlags: Record<string, "present" | "missing">;
}

const RUNTIME_ENV_KEYS = [
  "VEX_DB_URL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
  "JUPITER_API_KEY",
  "TAVILY_API_KEY",
  "RETTIWT_API_KEY",
  "POLYMARKET_API_KEY",
] as const;

export function buildRuntimeEnv(): RuntimeEnvDoc {
  const config = safeLoadEmbeddingConfig();
  const flags: Record<string, "present" | "missing"> = {};
  for (const key of RUNTIME_ENV_KEYS) {
    flags[key] = (process.env[key] ?? "").trim() ? "present" : "missing";
  }
  return {
    embeddingModel: config?.model ?? "<unknown>",
    embeddingDim: config?.dim ?? 0,
    envFlags: flags,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function safeLoadEmbeddingConfig(): { model: string; dim: number } | null {
  try {
    const cfg = loadEmbeddingConfig();
    return { model: cfg.model, dim: cfg.dim };
  } catch {
    return null;
  }
}
