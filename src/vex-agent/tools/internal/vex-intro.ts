/**
 * `vex_introduction` handler — top-level orientation tool for the MCP host.
 *
 * Two product narratives need to land in any host that connects to the
 * Vex MCP server (Claude Code, Cursor, Codex):
 *   1. **What Vex is**: dual product (VEX agent CLI + MCP package shown
 *      as `mcp__vex__*`); architecture; local stack (Postgres + pgvector
 *      + EmbeddingGemma).
 *   2. **How to talk to it**: discover_tools intent-first, English query
 *      rule, score / whyMatched semantics, dense retrieval roadmap.
 *
 * The default brief (no `topic`) leads with the five active protocol
 * namespaces because that is the highest-priority context for an
 * orchestrating agent — it tells the model where to look before issuing
 * a discover_tools call.
 *
 * Static narrative (priority brief, querying, knowledge) is wired here as
 * markdown consts. Dynamic sections (overview, namespaces) re-use the
 * same projection functions that drive the `docs://*` MCP resources, so
 * tool output and resource content never drift.
 */

import type { ToolResult } from "../types.js";
import {
  buildOverview,
  buildProtocolList,
  type ProtocolNamespaceDoc,
} from "../../../mcp/docs/registry-projection.js";
import { NAMESPACE_LIFECYCLE } from "../protocols/lifecycle.js";

type Topic = "overview" | "querying" | "knowledge" | "namespaces";

export async function handleVexIntroduction(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const topic = parseTopic(args.topic);
  const sections = renderSections(topic);
  return { success: true, output: sections };
}

function parseTopic(value: unknown): Topic | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "overview" || v === "querying" || v === "knowledge" || v === "namespaces") return v;
  return undefined;
}

function renderSections(topic: Topic | undefined): string {
  if (topic === "overview") return renderOverview();
  if (topic === "querying") return QUERYING_MD;
  if (topic === "knowledge") return KNOWLEDGE_MD;
  if (topic === "namespaces") return renderNamespaces();
  return renderDefaultBrief();
}

function renderDefaultBrief(): string {
  return [
    "# Vex — quick brief",
    "",
    "Two products share this stack: **Vex Agent** (CLI + Ink TUI for software-agent missions on your machine) and **Vex MCP** (npm package, mounted as `mcp__vex__*` in Claude Code / Cursor / Codex). You are talking to the MCP surface right now.",
    "",
    "Pass `topic` to focus: `overview` (architecture), `querying` (how to call discover_tools), `knowledge` (long-term memory), `namespaces` (full protocol list). Keep going below for the **active-protocol priority brief** — what each of the five live namespaces is for.",
    "",
    PRIORITY_PROTOCOLS_MD,
    "",
    "For the per-namespace tool catalog with parameters and examples, call `vex_namespace_tools(namespace?)`. The same machine-readable data is at MCP resource `docs://protocols/{namespace}` if your host renders resources.",
  ].join("\n");
}

function renderOverview(): string {
  const overview = buildOverview();
  return [
    "# Vex — overview",
    "",
    "## Two products on one stack",
    "",
    "**Vex Agent** — a software agent that runs on the user's machine. Has its own engine (chat / mission / full-autonomous shapes), turn loop, knowledge memory, and dispatch layer. Lives at `src/vex-agent/`. End-user-facing.",
    "",
    "**Vex MCP** — `vex-mcp` npm package. Mounts the relevant subset of the Vex tool surface into a host MCP client (Claude Code, Cursor, Codex). Lives at `src/mcp/`. Agent-host-facing. You are talking to this product right now.",
    "",
    "Both share the same registry, dispatcher, knowledge layer, and protocol catalog. Vex Agent uses everything; Vex MCP uses the host-relevant subset (no subagents, no mission_*, no autonomy primitives).",
    "",
    "## Architecture in one paragraph",
    "",
    `${overview.surfaceSize} internal tools exposed in this MCP (knowledge, documents, wallet, portfolio, web, EVM, setup, plus discover_tools / execute_tool meta tools). ${overview.protocolNamespaceCount} active protocol namespaces are reachable through discover_tools / execute_tool — each namespace has its own manifest in \`src/vex-agent/tools/protocols/<ns>/\`.`,
    "",
    "## Local stack",
    "",
    `- **Postgres + pgvector**: long-term knowledge layer (\`knowledge_entries\` table) and tool discovery embeddings (\`tool_embeddings\` table, populated on bootstrap).`,
    `- **Embedding model**: \`${overview.embeddingModel}\` at ${overview.embeddingDim}d via local Docker Model Runner. The same model embeds knowledge entries and tool descriptions.`,
    `- **Inference providers**: OpenRouter (Anthropic / OpenAI / Azure routes) and 0G Compute (decentralized).`,
    "",
    "Pass `topic=querying` to learn how to drive discover_tools, or `topic=knowledge` for the memory layer.",
  ].join("\n");
}

function renderNamespaces(): string {
  const list = buildProtocolList();
  const lines: string[] = [
    "# Vex — protocol namespaces",
    "",
    "Active protocol namespaces (all reachable through `discover_tools(query, namespace?)` and invokable via `execute_tool(toolId, params)`). Re-rendered from the same projection that backs MCP resource `docs://protocols`.",
    "",
    "| Namespace | Active tools | Description |",
    "|---|---|---|",
  ];
  for (const ns of list) {
    const lifecycle = NAMESPACE_LIFECYCLE[ns.namespace] ?? "active";
    const lifecycleTag = lifecycle === "active" ? "" : ` _(${lifecycle})_`;
    const envHint = ns.gatedByEnv.length > 0 && ns.activeToolCount === 0
      ? ` _(requires ${ns.gatedByEnv.join(", ")})_`
      : "";
    lines.push(`| \`${ns.namespace}\`${lifecycleTag} | ${ns.activeToolCount} | ${ns.description}${envHint} |`);
  }
  lines.push("");
  lines.push("Five namespaces (`chainscan`, `jaine`, `slop`, `echobook`, `slop-app`) are deprecated and excluded from discovery. See `embeddings/_DEPRECATED.md` in the source tree for rationale.");
  lines.push("");
  lines.push("Drill into a namespace: `vex_namespace_tools(namespace=\"<name>\")`.");
  return lines.join("\n");
}

function buildPriorityProtocols(): ProtocolNamespaceDoc[] {
  return buildProtocolList().filter((n) =>
    PRIORITY_NAMESPACES.includes(n.namespace as PriorityNamespace),
  );
}

void buildPriorityProtocols; // referenced for future enrichment; static narrative below for now

const PRIORITY_NAMESPACES = ["polymarket", "solana", "khalani", "kyberswap", "dexscreener"] as const;
type PriorityNamespace = typeof PRIORITY_NAMESPACES[number];

const PRIORITY_PROTOCOLS_MD = [
  "## Active protocols (priority)",
  "",
  "**polymarket** — prediction markets on Polygon. Discover events, get the orderbook, place CLOB orders (limit / market), inspect positions and PnL projection, manage USDC bridge, claim rewards. Use when the user wants to bet on an event outcome (sports, crypto prices, politics), check market prices, or manage prediction position lifecycle.",
  "",
  "**solana (jupiter)** — Solana ecosystem aggregator: token swaps via Jupiter (400+ DEXes with MEV protection), lend/borrow on Jupiter Lend, perpetuals, Jupiter prediction markets. Use when the user wants to swap on Solana, ape into a sol memecoin, lend SOL/USDC, open a perp position, or trade Jupiter prediction outcomes.",
  "",
  "**khalani** — cross-chain bridge across 40+ EVM and Solana chains. List supported chains, search tokens by symbol, get bridge quotes (output amount, route, ETA, gas), inspect bridge orders, execute bridges. Use when the user wants to move tokens between chains — USDC from Ethereum to Solana, get assets onto Base, transfer to Arbitrum, etc.",
  "",
  "**kyberswap** — EVM DEX aggregator across Polygon, Base, Arbitrum, Optimism, BSC, Linea and others. Quote and execute swaps, create / fill / cancel limit orders, search tokens and balances, zap LP positions in/out/migrate. Use when the user wants to swap on an EVM chain, get the best aggregated price, post a limit order, or manage LP positions in one click.",
  "",
  "**dexscreener** — multi-chain market data: token metadata, OHLCV, trending tokens, latest community takeovers, DEX pairs and orders. Use when the user wants to research a token before swapping, see what is trending on Solana / Base, verify a contract address, or inspect liquidity on a pair.",
].join("\n");

const QUERYING_MD = [
  "# Vex — how to call discover_tools",
  "",
  "## Inputs",
  "",
  "`discover_tools({ query, namespace?, limit? })` accepts a free-text English query, an optional namespace filter (single value), and an optional limit (default 5). Returns ranked tools with `score`, `whyMatched`, params schema, and example params.",
  "",
  "## Query writing",
  "",
  "- Be **intent-first**: write what the user wants to *do*, not what tool name they want. `swap usdc on base`, `bridge sol from solana to ethereum`, `prediction market orderbook for trump`.",
  "- **English intent**: write concise English intent text even when the user speaks another language. Tool passages and manifests are authored in English.",
  "- **Filter when you know**: passing `namespace=\"polymarket\"` cuts the search space and pushes recall on near-duplicate tools across namespaces.",
  "",
  "## Reading results",
  "",
  "- `score` — relative rank within this call. A drop of >20% between #1 and #2 usually means #1 is unambiguously the best fit; a flat score curve is the time to ask the user to disambiguate.",
  "- `whyMatched` — which fields contributed to the score. In the default dense path this is usually `dense`; in lexical fallback it can include fields such as `toolId`, `description`, `aliases`, `exampleIntents`, `chains`, or `preferredFor`.",
  "- `params` + `exampleParams` — what `execute_tool` expects. Always inspect before invoking.",
  "",
  "## Retrieval modes",
  "",
  "- Default mode is **dense**: EmbeddingGemma 768d via local Docker Model Runner ranks `tool_embeddings` by semantic similarity.",
  "- If dense retrieval is unavailable or returns no usable rows, discovery degrades to lexical fallback (`dense_failed: true`) so user-facing calls do not crash on sidecar or table issues.",
  "- `tool_embeddings` is populated on MCP bootstrap (non-blocking) and re-embedded only on `content_hash` changes. Run `pnpm tool-reembed` to populate synchronously during dev.",
  "",
  "## Cold path",
  "",
  "If `discover_tools` returns nothing useful, **reformulate the intent** with synonyms or add a chain / venue hint (`swap on base`, `bridge to monad`, `lp on berachain`). Avoid escalating to namespace-only listing — `discover_tools(namespace=\"<name>\")` returns an unsorted slice that is usually noisier than a refined query.",
].join("\n");

const KNOWLEDGE_MD = [
  "# Vex — long-term knowledge layer",
  "",
  "Knowledge is the **canonical agent memory**: distilled rules, observations, and facts the model needs to recall later. It is not a freeform notebook — for that, use `document_*`.",
  "",
  "## Storage",
  "",
  "- **Postgres + pgvector** locally. The `knowledge_entries` table holds title / summary / content_md / tags / status / lifecycle metadata + embedding vector + audit columns (`embedding_model`, `embedding_dim`, `content_hash`).",
  "- **Embedding model** is local — Docker Model Runner with EmbeddingGemma 768d (configurable via `EMBEDDING_*` env). The same model embeds tool descriptions for dense discovery.",
  "- **Source surface** stamped on every entry: `vex_agent` (mission loop, chat) or `mcp_local` (this MCP server). Lets you grep history later for what wrote what.",
  "",
  "## Write / recall pipeline",
  "",
  "- `knowledge_write({ kind, title, summary, ... })` — embeds title + summary on write, returns the entry id.",
  "- `knowledge_recall({ query, k?, kind? })` — semantic search over active entries. Returns up to ~10 inline; overflow goes to a 15-minute tmp cache fetched via `knowledge_recall_overflow(cacheKey)`.",
  "- `knowledge_get(id)` — fetch by id (active or historical).",
  "- `knowledge_supersede({ previous_id, ... })` — atomic replace of an active entry; old row flips to `superseded` (hidden from recall).",
  "- `knowledge_update_status(id, status)` — terminal lifecycle: `invalidated` (was wrong) or `archived` (no longer relevant).",
  "- `knowledge_lineage(id)` / `knowledge_history(...)` — browse version chains and historical entries.",
  "",
  "## Strict rules",
  "",
  "- **English only** for `title`, `summary`, `content_md`, and recall queries. The embedding model has substantially better recall on English; translate intent first.",
  "- `kind` is free-form snake_case (`pumpfun_entry_pattern`, `risk_rule`, `bridge_observation`). Reuse from Active Knowledge → Known kinds before inventing.",
  "- `pinned: true` for evergreen rules (no TTL); otherwise the default 7-day TTL applies.",
  "- Updating an existing entry → use `knowledge_supersede`, not write+update_status. Split-brain is what the supersede transaction prevents.",
  "",
  "## What knowledge is NOT",
  "",
  "- Not a notebook — `document_*` (read/write/list/delete) is the freeform scratchpad. No embeddings, no semantic recall.",
  "- Not a log — `protocol_executions` (database table) auto-captures every mutating tool call for audit. You don't need to mirror that into knowledge.",
].join("\n");
