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
} from "@echo-agent/tools/registry.js";
import {
  PROTOCOL_TOOLS,
  PROTOCOL_NAMESPACE_ALLOWLIST,
  NAMESPACE_DEFAULTS,
} from "@echo-agent/tools/protocols/catalog.js";
import {
  NAMESPACE_DESCRIPTIONS,
  NAMESPACE_EXAMPLES,
} from "@echo-agent/tools/protocols/descriptions.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import type { ProtocolNamespace, ProtocolToolManifest } from "@echo-agent/tools/protocols/types.js";

// ── Tool grouping (by capability family) ──────────────────────────

/**
 * Bucket each registry tool by capability family for human-readable docs.
 * The grouping is hand-curated by name prefix so it stays stable when new
 * tools land — adding a `web_news` would land in Web automatically.
 */
const TOOL_GROUP_RULES: Array<{ group: string; match: (name: string) => boolean }> = [
  { group: "Discovery", match: (n) => n === "discover_tools" || n === "execute_tool" },
  { group: "Web",       match: (n) => n.startsWith("web_") },
  { group: "Documents", match: (n) => n.startsWith("document_") },
  { group: "Knowledge", match: (n) => n.startsWith("knowledge_") },
  { group: "Wallet",    match: (n) => n.startsWith("wallet_") },
  { group: "EVM",       match: (n) => n.startsWith("evm_") },
  { group: "Portfolio", match: (n) => n.startsWith("portfolio_") },
  { group: "Schedule",  match: (n) => n.startsWith("schedule_") },
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
    name: "echoclaw-mcp",
    purpose:
      "EchoClaw production MCP server — passive tool surface bridge over Echo Agent. " +
      "Exposes the same internal tools (knowledge, documents, wallet, portfolio, schedule, " +
      "web, EVM, mission, setup) that Echo Agent uses, plus discover_tools / execute_tool " +
      "for protocol capabilities. No subagents.",
    surfaceSize: tools.length,
    protocolNamespaceCount: PROTOCOL_NAMESPACE_ALLOWLIST.length,
    embeddingModel: config?.model ?? "<unknown — EMBEDDING_MODEL not set>",
    embeddingDim: config?.dim ?? 0,
  };
}

// ── Protocols ────────────────────────────────────────────────────

export interface ProtocolNamespaceDoc {
  namespace: ProtocolNamespace;
  /** One-line description of what this namespace does (R5 — shared with Echo Agent prompt). */
  description: string;
  /** Concrete `discover_tools(...)` queries the model can copy to find tools. May be empty. */
  exampleQueries: readonly string[];
  defaultPortfolioRole: string;
  activeToolCount: number;
}

export function buildProtocolList(): ProtocolNamespaceDoc[] {
  return PROTOCOL_NAMESPACE_ALLOWLIST.map((ns) => ({
    namespace: ns,
    description: NAMESPACE_DESCRIPTIONS[ns],
    exampleQueries: NAMESPACE_EXAMPLES[ns] ?? [],
    defaultPortfolioRole: NAMESPACE_DEFAULTS[ns],
    activeToolCount: PROTOCOL_TOOLS.filter((t) => t.namespace === ns && t.lifecycle === "active").length,
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
  /** Header description (R5 — shared with Echo Agent prompt via descriptions.ts). */
  description: string;
  exampleQueries: readonly string[];
  tools: ProtocolToolDoc[];
}

export function buildProtocolNamespace(
  namespace: string,
): ProtocolNamespaceDetailDoc | null {
  if (!PROTOCOL_NAMESPACE_ALLOWLIST.includes(namespace as ProtocolNamespace)) {
    return null;
  }
  const ns = namespace as ProtocolNamespace;
  const tools: ProtocolToolDoc[] = PROTOCOL_TOOLS.filter((t) => t.namespace === ns)
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
    description: NAMESPACE_DESCRIPTIONS[ns],
    exampleQueries: NAMESPACE_EXAMPLES[ns] ?? [],
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
    protocolNamespaces: [...PROTOCOL_NAMESPACE_ALLOWLIST],
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
  "ECHO_AGENT_DB_URL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
  "TAVILY_API_KEY",
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
