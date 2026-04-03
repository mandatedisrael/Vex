# Tools Layer — Echo Agent

Everything the LLM can call. Two systems: **internal tools** (handled in-process) and **protocol tools** (via discover+execute meta-tools).

## Architecture

```
tools/
  types.ts            — ToolDef, ToolCallRequest, ToolResult, OpenAITool
  registry.ts         — All tool definitions + registry API (getToolDef, isInternalTool, getOpenAITools)
  dispatcher.ts       — Routes every LLM tool call: protocol meta-tools or internal handlers
  internal/           — In-process handlers (web, documents, memory, schedule, subagent, wallet)
  protocols/          — discover_tools + execute_tool system (10 protocol namespaces, 200+ tools)
```

## How a tool call flows

```
LLM → tool_call(name, args)
  → dispatcher.dispatchTool(call, context)
    → if "discover_tools" or "execute_tool" → protocols/runtime.ts
    → if internal tool → lazy-import handler from internal/
    → else → "Unknown tool" error
  → ToolResult → back to LLM
```

## Internal tools

Defined in `registry.ts`. Each handler is a pure `(params, context) → ToolResult` function. No DB writes to session messages, no SSE events — the engine handles that.

| Tool | Handler file | What it does |
|------|-------------|--------------|
| `discover_tools` | `protocols/runtime.ts` | Search protocol capabilities by query/namespace |
| `execute_tool` | `protocols/runtime.ts` | Execute a discovered protocol tool by toolId |
| `web_search` | `internal/web.ts` | Tavily search with Postgres cache (15min TTL) |
| `web_fetch` | `internal/web.ts` | Tavily extract + HTTP fallback, cached (1h TTL) |
| `document_read` | `internal/documents.ts` | Read document from DB, preview or full context load |
| `document_write` | `internal/documents.ts` | Create/update document (auto-creates folders) |
| `document_list` | `internal/documents.ts` | List documents and folders in a space |
| `document_delete` | `internal/documents.ts` | Soft-delete (archive) a document |
| `memory_manage` | `internal/memory.ts` | CRUD on persistent memory entries (list/append/replace/delete) |
| `schedule_create` | `internal/schedule.ts` | Create cron task (tool_call/wake_agent/reminder/monitor/snapshot/backup) |
| `schedule_remove` | `internal/schedule.ts` | Remove a scheduled task |
| `subagent_spawn` | `internal/subagent.ts` | Spawn background subagent — runs engine-core turn-loop (session_links + engine). Excluded for subagents. |
| `subagent_status` | `internal/subagent.ts` | Check subagent progress/results. Enriches with pendingRequest (waiting) or report (completed). |
| `subagent_stop` | `internal/subagent.ts` | Stop a running subagent. Ownership-guarded via session_links. |
| `subagent_reply` | `internal/subagent.ts` | Parent replies to waiting child's request. Resumes child via shared lifecycle helper. Excluded for subagents. |
| `subagent_request_parent` | `internal/subagent.ts` | Child requests parent help. Returns `wait_for_parent` engine signal. Excluded for parents. |
| `subagent_report_complete` | `internal/subagent.ts` | Child submits structured final report. Returns `complete_subagent` engine signal. Excluded for parents. |
| `portfolio_inspect` | `internal/portfolio-inspect.ts` (router) + `internal/inspect-views/*.ts` (4 modules) | DB-backed self-inspection: 14 views across 4 families — trading (lots, profits, unrealized), positions (open, closed, orders), activity (activity, bridges, lp_history, non_trading), portfolio (summary, balances, snapshots, executions) |
| `polymarket_setup` | `internal/polymarket-setup.ts` | Derive + save Polymarket CLOB API credentials from wallet keystore. Visible ONLY when `POLYMARKET_API_KEY` not configured (`showOnlyWhenEnvMissing`). No secrets in output. |
| `mission_stop` | `internal/mission.ts` | Model-driven mission stop — returns engineSignal to turn-loop. Guarded: requires active missionRunId. Excluded for subagents. |
| `wallet_read` | `internal/wallet.ts` | Wallet address + multi-chain balances via Khalani |
| `wallet_send_prepare` | `internal/wallet.ts` | Prepare transfer intent (no broadcast) |
| `wallet_send_confirm` | `internal/wallet.ts` | Sign + broadcast transfer (mutating, needs approval) |

## internal/types.ts — shared contract

```typescript
// Context passed to every internal handler
interface InternalToolContext {
  sessionId: string;
  loadedDocuments: Map<string, string>;  // documents currently in LLM context
  loopMode: "full" | "restricted" | "off";
  approved: boolean;
}

// Param helpers
str(params, key)   → string (safe accessor)
num(params, key)   → number | undefined
bool(params, key)  → boolean

// Result helpers
ok(data)    → { success: true, output: JSON.stringify(data), data }
fail(msg)   → { success: false, output: msg }
```

## Protocol tools

10 namespaces, 200+ tools. LLM accesses them via two meta-tools:

1. `discover_tools` — search manifests by query/namespace, get toolId + params + description
2. `execute_tool` — call handler by toolId with params, runtime validates + executes

```
protocols/
  types.ts       — ProtocolToolManifest, ProtocolHandler, ProtocolDiscoveryResult
  catalog.ts     — All manifests + handlers registered here
  runtime.ts     — discover + execute logic + execution capture hook
  khalani/       — 9 tools: bridge, balances, orders, chains, tokens
  solana-jupiter/— 20 tools: prices, tokens, swap, predict, lend (requires JUPITER_API_KEY)
  kyberswap/     — 21 tools: swap, limit orders (maker+taker), zap LP (in/out/migrate/list), chains, tokens
  polymarket/    — 69 tools: bridge, CLOB trading, data/positions, gamma discovery
  dexscreener/   — 11 tools: search, pairs, trending, orders (all read-only)
  0g/chainscan/  — 17 tools: account, transaction, contract, decode, token, stats
  0g/jaine/      — 15 tools: pools, swap (buy+sell), allowance, w0g wrap
  0g/slop/       — 11 tools: token create/info, trade buy/sell, curve, fees, rewards
  echobook/      — 28 tools: posts, comments, profile, social, submolts, points
  0g/slop-app/   — 8 tools: profile, image upload/generate, agents, chat
```

### Execution capture

Every mutating protocol tool call (success AND failure) is captured to `protocol_executions`. Extracts:

- `trade_capture` — from `_tradeCapture` in handler result data
- `external_refs` — canonical keys (`txHash`, `orderId`, `positionPubkey`, `orderKey`, `conditionId`, `signature`) extracted from handler result

This feeds the execution → sync → projection pipeline (see `db/DB.md` and `sync/SYNC.md`).

### Coverage matrix

Canonical source-of-truth: `protocols/mutation-matrix.ts` (`MUTATION_MATRIX`). Imported by runtime (validation, preview detection), tests (structural coverage), and replay (type correction).

Each mutating tool has a `MutationContract`: `role`, `capture`, `expectedType`, `previewSupport`, `fanOut`, `requiredFields`, `valuationExpected`.

`valuationExpected` (W4A): `"exact"` (always emits USD from source), `"conditional"` (path-dependent, e.g. Polymarket matched vs unmatched), `"none"` (no source USD — honest null). **Runtime hard gate** — `capture-validator.ts` rejects `exact` captures missing `inputValueUsd`/`outputValueUsd` or `valuationSource`. Projection is blocked on validation failure.

- `pnl_spot` (7 tools): tradeSide + instrumentKey + atomic amounts required. `classifySolanaSwap()` in `src/tools/solana-ecosystem/shared/swap-classify.ts` for deterministic Solana classification.
- `pnl_prediction`: positionKey + instrumentKey required. Polymarket buy/sell are dual-type (`["prediction","order"]`): matched → prediction position lifecycle, live → order lifecycle.
- `projection`: orders/LP lifecycle. positionKey required. KyberSwap limit orders use `type: "order"` (not "swap"). Polymarket cancel* reclassified here from pnl_prediction.
- `audit` (11 with capture, 2 without): balance/state mutations. Audit trail only.
- `utility` (18): social/operational. No `_tradeCapture`.

### Preview (dryRun)

Tools with `previewSupport: true` in `MUTATION_MATRIX` skip approval gate and capture pipeline when `params.dryRun === true`. Defense-in-depth: `result.data?.dryRun === true` also skips capture in `captureExecution()`.

### Runtime validation boundary

`capture-validator.ts` checks `capture:"full"` handlers return required fields BEFORE sending to projection pipeline. Missing fields → logger.error + skip projection (fail-loud, not silent null-fill).

### Bulk operations (_tradeCaptureItems)

Handlers that touch N logical entities in one execution emit `_tradeCaptureItems: Record<string, unknown>[]`. Runtime records N capture items → N activity rows. Single-capture handlers emit only `_tradeCapture`.

Used by: `solana.predict.closeAll`, `kyberswap.limitOrder.batchFill`, `kyberswap.limitOrder.cancelAll`, `polymarket.clob.cancelOrders`, `polymarket.clob.cancelAll`, `polymarket.clob.cancelMarket`.

### Token verification policy

Agent-facing manifests include token resolution guidance in descriptions. Prompt layer (`tool-usage.ts`) defines the Token Verification Rule: resolve tokens via read tools before mutating. Canonical resolver: `khalani.tokens.search` (cross-chain). `kyberswap.tokens.search` is confirmation only (same Token API name search). `solana.tokens.search` for Solana mints.

Runtime-level: `resolveTokenMetadata()` reads ERC-20 metadata on-chain for address input, Token API fallback for symbol. Zap handlers validate address format before passing to ZaaS API.

### EVM on-chain reads (`evm_read`)

Internal read-only tool for direct on-chain data access. Uses khalani chain registry (`getChains()` → `rpcUrls`) + `createDynamicPublicClient()` from `khalani/evm-client.ts`.

4 scoped actions:
- `tx_receipt` — transaction receipt (status, gasUsed, logs count, block number)
- `erc721_mint` — extract minted NFT IDs from receipt logs (filtered by recipient)
- `erc20_metadata` — decimals, symbol, name from ERC-20 contract
- `balance` — native token balance in wei

Not a generic RPC gateway — actions are whitelisted and validated. Chain resolved via khalani aliases (e.g. "polygon", "137", "ethereum").

### LP position capture (zap.in)

`kyberswap.zap.in` uses `sendKyberTransactionWithReceipt()` to get tx receipt, then `extractMintedNftId()` parses ERC-721 Transfer mint logs filtered by recipient address. Extracted `positionId` (NFT token ID) is stored in `_tradeCapture.positionKey`, enabling projection into `proj_open_positions` and subsequent `zap.out`.

### LP economics model

LP positions tracked via `proj_lp_events` + `proj_lp_event_legs` (projection tables). Populated from `_tradeCapture.meta.zapDetails` by position-projector → `recordLpEconomics()`. Legs: deposit, withdraw, fee, refund. `valuation_source: "zaas_estimate"` — route preview estimates, not on-chain exacts.

`zap.out` and `zap.migrate` support `collectFee` param (default true) — collects accumulated LP fees during exit/migration.

`zap.list` returns structured DEX entries per chain from curated catalog (`src/tools/kyberswap/zaas/zap-dexes/`): id, name, supports (capability-aware: Curve/Balancer source-only), verification status, DexScreener mapping fields.

### EVM wallet transfers

`wallet_send_prepare/confirm` supports dynamic EVM chains (not just 0G): native tokens, ERC-20 (`transfer()`), ERC-721 (`safeTransferFrom()`). Uses khalani chain discovery (`createDynamicPublicClient/WalletClient`) for RPC resolution. Token format: `"native"`, contract address (ERC-20), `"nft:{contract}:{tokenId}"` (ERC-721).

Solana transfers: SOL native + SPL tokens. Standard SPL NFT transfer may incidentally work as a token transfer, but is NOT first-class. pNFT and cNFT require Metaplex instruction set not present in this module.

### DeFi safety policy

Prompt layer (`tool-usage.ts`) defines DeFi Safety Rules:
1. **Gas reserve**: never spend 100% of native token, leave gas for follow-up tx
2. **Fresh balance**: read live balances after each mutation, don't chain on estimates
3. **Quote before execute**: preview every mutating DeFi tool that supports dryRun
4. **Address-first**: resolve via khalani before EVM mutations, pass address not symbol

These are behavioral guidelines enforced via prompt. Runtime gas reserve backstop planned for PR B.

Synthetic captures from settlement sync use toolIds not in MUTATION_MATRIX (`settlement_sync.jupiter`, `settlement_sync.polymarket`). `capture-validator.ts` returns `true` for unknown toolIds. `synthetic-capture.ts` has its own local validation boundary.

### History replay

`sync/replay.ts` — one-time projection correction. Reads immutable `protocol_executions` + `protocol_capture_items`, truncates projection tables, re-runs `populateActivity()` with type correction from `MUTATION_MATRIX.expectedType`. Idempotent.

`NAMESPACE_DEFAULTS` in `catalog.ts` is a helper for pure namespaces, NOT runtime truth.

### E2E verification

Full pipeline verified via local MCP harness (`e2e/E2E.md`). Automated: discovery smoke + preview zero-write. Manual: real-funds mutations via `echo_execute`. Replay: `echo_replay_verify` after multi-namespace sessions.

## Key differences from legacy src/agent/

| Aspect | Legacy (src/agent/) | Echo Agent (src/echo-agent/) |
|--------|--------------------|-----------------------------|
| File tools | `file_read/write/list/delete` on `knowledge_files` | `document_read/write/list/delete` on `folders` + `documents` |
| Schedule types | `cli_execute`, `inference`, `alert` | `tool_call`, `wake_agent`, `reminder`, `monitor` |
| Trade logging | Manual `trade_log` tool | Auto-captured via `_tradeCapture` in protocol handlers |
| Session relations | `parent_session_id` on sessions + subagents | `session_links` table (canonical) |
| Context tracking | `loadedKnowledge: Map<string, string>` | `loadedDocuments: Map<string, string>` |
| DB layer | Imports from `src/agent/db/repos/` | Own repos in `src/echo-agent/db/repos/` |
| Subagent execution | Placeholder finalize | Engine-core turn-loop with prompt stack, tool dispatch, approval |
