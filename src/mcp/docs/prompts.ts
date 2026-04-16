/**
 * Production MCP — workflow prompts.
 *
 * Three curated prompts the host MCP client can surface to its agent:
 *   - trade-workflow       — discovery → execute → capture pattern
 *   - knowledge-guidelines — knowledge_write vs document_write, English-only rule
 *   - safety-rules         — how to read tool errors, host confirm semantics
 *
 * Curated text rather than registry projection — these are workflow guidance,
 * not derivable from tool metadata.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWorkflowPrompts(server: McpServer): void {
  server.registerPrompt(
    "trade-workflow",
    {
      title: "Trade workflow",
      description:
        "Recommended pattern for executing protocol trades / mutations through EchoClaw MCP",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "## Trade workflow\n\n" +
              "1. Use `discover_tools` with a short English capability phrase. Filter by " +
              "namespace (e.g. `solana`, `polymarket`, `kyberswap`) when you know it; otherwise " +
              "search by intent (`bridge usdc to base`, `swap on solana`, `prediction market orderbook`, " +
              "`wallet token balances`). Results include `score` and `whyMatched` to help disambiguate.\n" +
              "2. Inspect the returned `params` schema and `exampleParams` for the chosen toolId.\n" +
              "3. For mutations, call the read-side / preview tool first if it exists " +
              "(e.g. `wallet_send_prepare` before `wallet_send_confirm`, `dryRun:true` for protocol tools).\n" +
              "4. Use `execute_tool` with the validated params. Mutating tools execute directly — " +
              "your host's permission UX is the gate.\n" +
              "5. After a successful execution, capture is automatic in `protocol_executions` and " +
              "downstream projections (proj_activity, proj_pnl_lots, etc.). You do NOT need to " +
              "call any 'log' tool.\n" +
              "6. If the trade produces a learnable insight, write it via `knowledge_write` (English).\n",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "knowledge-guidelines",
    {
      title: "Knowledge layer guidelines",
      description:
        "When to use knowledge_* vs document_*; English-only rule; kind reuse",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "## Knowledge vs documents\n\n" +
              "- `knowledge_write` is for **distilled, retrievable** insights: rules, patterns, " +
              "observations the agent should be able to recall later. Goes through embedding-on-write " +
              "and is searchable via `knowledge_recall`.\n" +
              "- `document_write` is for freeform notes / scratchpad. Not embedded, not searched. " +
              "Use when the content is human-readable reference material, not a fact the agent " +
              "needs to retrieve programmatically.\n\n" +
              "## English-only rule for knowledge_*\n\n" +
              "`title`, `summary`, `content_md` and recall queries MUST be in English regardless " +
              "of the conversation language. The embedding model has significantly better recall " +
              "on English text. Translate the user's intent first.\n\n" +
              "## Reuse `kind` values\n\n" +
              "Before inventing a new `kind`, check Active Knowledge → Known kinds and reuse an " +
              "existing one. `kind` is free-form snake_case (e.g. `pumpfun_entry_pattern`, " +
              "`risk_rule`, `bridge_observation`) — it groups entries for filtered recall.\n\n" +
              "## TTL and pinning\n\n" +
              "- Default TTL is 7 days for time-bounded observations.\n" +
              "- `pinned: true` for evergreen rules — bypasses TTL and stays in Active Knowledge.\n" +
              "- `ttl_hours` overrides the default for a single entry.\n\n" +
              "## Updating existing knowledge → `knowledge_supersede`, not a second write\n\n" +
              "Knowledge entries are immutable by content. When a rule or observation needs to change " +
              "meaningfully (new evidence, tightened threshold, different assessment), call " +
              "`knowledge_supersede(previous_id, ...new fields, reason, change_summary?, what_failed?)`. " +
              "It atomically writes the new entry, links it to the old via lineage, and flips the old " +
              "entry to `superseded` (hidden from recall / Active Knowledge, still retrievable via " +
              "`knowledge_get` for history).\n\n" +
              "Do NOT `knowledge_write` the new version and then `knowledge_update_status` the old — " +
              "that leaves split-brain state.\n\n" +
              "## Lifecycle vocabulary\n\n" +
              "- `superseded` → \"same topic, new version\" (via `knowledge_supersede`).\n" +
              "- `invalidated` (via `knowledge_update_status`) → \"this fact was wrong and no replacement exists yet.\"\n" +
              "- `archived` (via `knowledge_update_status`) → \"still correct but no longer relevant to current work.\"\n" +
              "All three are hidden from recall but remain fetchable by id.\n",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "safety-rules",
    {
      title: "Safety and approval semantics",
      description: "How to read MCP tool errors and where the approval gate lives",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "## Where the approval gate lives\n\n" +
              "EchoClaw MCP is a passive tool surface — it does NOT add a server-side approval " +
              "queue for mutations. The gate that decides whether a tool call runs is your host " +
              "(Claude Code / Cursor / Codex permission UX). EchoClaw trusts whatever the host " +
              "tells it to execute.\n\n" +
              "## Tool errors\n\n" +
              "Tool results may have `isError: true`. Read the text content for the failure reason. " +
              "Common categories:\n" +
              "- Validation: missing required params, bad enum value → fix params, retry.\n" +
              "- Provider down: `embedding service unavailable`, `RPC error` → operational, surface " +
              "to user, do NOT retry in a tight loop.\n" +
              "- Approval (rare in production MCP): if you see `pendingApproval` or " +
              "`requires approval in restricted/off mode`, something has misconfigured the MCP " +
              "context — escalate to the user, do not try to bypass.\n\n" +
              "## Sensitive operations\n\n" +
              "- `wallet_send_confirm`, `polymarket_setup`, mutating protocol tools (jupiter swap, " +
              "kyberswap swap, polymarket buy/sell, …) move real funds. Always preview / dry-run " +
              "when the tool supports it before executing.\n" +
              "- For wallet sends, the prepare → confirm two-step is intentional. Always inspect " +
              "the prepared intent (recipient, amount, token, network) before calling confirm.\n",
          },
        },
      ],
    }),
  );
}
