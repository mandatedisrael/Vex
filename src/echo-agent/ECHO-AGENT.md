# Echo Agent — Architecture Reference

> New-generation autonomous AI agent. Own database, DB-first content model, manifest-driven protocol tools, provider-agnostic inference. Built from scratch .
>
> **Last updated: 2026-03-28**

---

## Directory Structure

```
src/echo-agent/
  db/                    — Own Postgres database layer (ECHO_AGENT_DB_URL)
    client.ts            — Pool singleton + query helpers
    migrate.ts           — Startup migration runner
    migrations/
      001_initial.sql    — Full schema (27 tables, 6 modules)
    repos/               — 17 repo files, one per domain (includes balances.ts)
  inference/             — Provider-agnostic inference (OpenRouter + 0G Compute)
    types.ts             — InferenceProvider interface, InferenceConfig, InferenceUsage
    config.ts            — ENV validation + SubagentConfig
    registry.ts          — Provider resolution singleton
    resilience.ts        — Retry, timeout, error classification
    openrouter.ts        — OpenRouter SDK provider
    0g-compute.ts        — 0G Compute raw HTTP provider
  tools/                 — Everything the LLM can call
    types.ts             — ToolDef, ToolCallRequest, ToolResult
    registry.ts          — 17 internal tool definitions
    dispatcher.ts        — Routes every tool call
    internal/            — In-process handlers
      types.ts           — InternalToolContext, ok/fail helpers
      web.ts             — web_search, web_fetch (Tavily + cache)
      documents.ts       — document_read/write/list/delete (DB-first, folders)
      memory.ts          — memory_manage (CRUD with hash dedup)
      schedule.ts        — schedule_create/remove (no cli_execute)
      subagent.ts        — subagent_spawn/status/stop (session_links)
      wallet.ts          — wallet_read, send_prepare, send_confirm
    protocols/           — discover_tools + execute_tool system
      types.ts           — ProtocolToolManifest, ProtocolHandler
      catalog.ts         — All 10 namespaces registered
      runtime.ts         — Discovery, execution, approval gate, capture hook
      khalani/           — 9 tools (bridge, balances, orders)
      solana-jupiter/    — 37 tools (swap, perps, predict, DCA, limit, lend, stake)
      kyberswap/         — 20 tools (swap buy+sell, limit orders, zap LP)
      polymarket/        — 69 tools (bridge, CLOB, data, gamma)
      dexscreener/       — 11 tools (search, pairs, trending)
      0g/chainscan/      — 17 tools (account, tx, contract, stats)
      0g/jaine/          — 15 tools (pools, swap buy+sell, allowance)
      0g/slop/           — 11 tools (token, trade, curve, fees)
      echobook/          — 28 tools (posts, social, points)
      0g/slop-app/       — 8 tools (profile, image, agents, chat)
  sync/                  — Balance sync pipeline (Khalani → proj_balances → snapshots)
    index.ts             — Public API: initSync(), syncTick()
    balance-sync.ts      — Khalani → proj_balances → proj_portfolio_snapshots
    worker.ts            — Sync run consumer with dedup
    seed.ts              — Default sync job seeding
    chains.ts            — Canonical chain hint resolution
  public/                — Static assets (images, legacy README)
```

---

## How a Tool Call Flows

```
LLM emits tool_call(name, args, toolCallId)
  |
  v
dispatcher.dispatchTool(call, context: InternalToolContext)
  |
  |-- "discover_tools" --> protocols/runtime.ts: search manifests
  |-- "execute_tool"   --> protocols/runtime.ts: validate + approval gate + handler
  |-- internal tool    --> lazy-import from internal/*.ts
  |-- unknown          --> error
  |
  v
ToolResult { success, output, data?, pendingApproval? }
  |
  v
Engine: feeds result back to LLM, enqueues approval if pendingApproval
```

### Approval flow

Mutating tools (protocol or `wallet_send_confirm`) check `context.loopMode` and `context.approved`:
- `full` mode: executes immediately
- `restricted`/`off` + `approved: true`: executes (post-approval retry)
- `restricted`/`off` + `approved: false`: returns `pendingApproval: true`, engine enqueues to `approval_queue`

### Execution capture

Every mutating protocol tool (success or failure) is recorded to `protocol_executions` with:
- `trade_capture` from `_tradeCapture` in handler result
- `external_refs` extracted: `txHash`, `orderId`, `positionPubkey`, `orderKey`, `conditionId`, `signature`
- `session_id` from dispatcher context

On success, sync runs are enqueued via `protocol_sync_jobs` for projection refresh.

### Balance sync pipeline

See `sync/SYNC.md` for full details.

```
Startup   → drain backlog → fullBalanceSync() → proj_balances + snapshot
Trade     → enqueue sync run → worker dedup → selective Khalani refresh (affected chains only)
Periodic  → syncTick() every 60s → full refresh if snapshot > 5min old
```

Source of truth: Khalani `getTokenBalances()` — native + altcoins, balance + USD price + decimals in one call per wallet family. Worker deduplicates multiple pending runs into one Khalani call.

`proj_portfolio_snapshots.positions` stores per-wallet, per-chain breakdown with PnL delta vs previous snapshot.

---

## Database — 27 Tables, 6 Modules

Own Postgres via `ECHO_AGENT_DB_URL`. See `db/README.md` for full details.

| Module | Tables | Purpose |
|--------|--------|---------|
| **A. Identity & Content** | `soul`, `memory_entries`, `folders`, `documents` | Agent identity, persistent memory, markdown documents with folder tree |
| **B. Runtime & Sessions** | `sessions`, `messages`, `messages_archive`, `approval_queue`, `runtime_state`, `runtime_cycles` | Conversation lifecycle, compaction, approval queue, loop engine |
| **C. Automation** | `schedules`, `schedule_runs`, `subagents`, `session_links`, `subagent_messages`, `inbox_events` | Cron tasks, subagent lifecycle, canonical session relationships |
| **D. Inference** | `usage_log`, `billing_snapshots` | Token usage (cached/reasoning breakdown), provider balance tracking |
| **E. Protocol Pipeline** | `protocol_executions`, `protocol_sync_jobs`, `protocol_sync_runs`, `proj_balances`, `proj_portfolio_snapshots`, `proj_open_positions`, `proj_activity` | Execution audit, sync pipeline, projection tables |
| **F. Cache** | `search_cache`, `fetch_cache` | Tavily search/fetch with TTL |

### Key design decisions

- **`session_links` is canonical** — no `parent_session_id` on sessions or subagents. All parent-child via `session_links(parent_session_id, child_session_id, relation_type, subagent_id?)`
- **Documents replace files** — `folders` + `documents` with `space` (knowledge | notes), nested folder paths, soft delete. No `knowledge_files`
- **No `cli_execute`** — scheduler types: `tool_call`, `wake_agent`, `reminder`, `monitor`, `snapshot`, `backup`
- **NULL-safe indexes** — split unique indexes for root vs nested folders/documents

---

## Inference Layer

Provider-agnostic. See `inference/README.md` for full details.

| Provider | Transport | Streaming | Balance | Pricing |
|----------|-----------|-----------|---------|---------|
| OpenRouter | `@openrouter/sdk` | Native EventStream | Credits API (USD) | Per-token with cache + reasoning |
| 0G Compute | Raw HTTP fetch | Non-streaming fallback | On-chain ledger (0G) | Per-M from metadata |

### SubagentConfig

Loaded from `SUBAGENT_*` ENV with fallbacks from `AGENT_*`:

| Variable | Default | Range |
|----------|---------|-------|
| `SUBAGENT_MAX_CONCURRENT` | 5 | 1-20 |
| `SUBAGENT_CONTEXT_LIMIT` | 16384 | 1000-2M |
| `SUBAGENT_MAX_ITERATIONS` | 25 | 1-200 |
| `SUBAGENT_TIMEOUT_MS` | 300000 | 10s-30min |
| `SUBAGENT_MAX_OUTPUT_TOKENS` | inherits `AGENT_MAX_OUTPUT_TOKENS` | 256-128K |
| `SUBAGENT_TEMPERATURE` | inherits `AGENT_TEMPERATURE` | 0-2 |

---

## Internal Tools (17)

See `tools/README.md` for full details.

| Tool | Handler | Description |
|------|---------|-------------|
| `discover_tools` | `protocols/runtime.ts` | Search 220+ protocol capabilities |
| `execute_tool` | `protocols/runtime.ts` | Execute protocol tool by ID (with approval gate) |
| `web_search` | `internal/web.ts` | Tavily search, 15min cache |
| `web_fetch` | `internal/web.ts` | Tavily extract + HTTP fallback, 1h cache |
| `document_read` | `internal/documents.ts` | Read from DB, preview or full context load |
| `document_write` | `internal/documents.ts` | Upsert with auto-slug, nested folder auto-create |
| `document_list` | `internal/documents.ts` | List documents + folders in space |
| `document_delete` | `internal/documents.ts` | Soft-delete (archive) |
| `memory_manage` | `internal/memory.ts` | list / append (dedup) / replace / delete |
| `schedule_create` | `internal/schedule.ts` | Cron task with payload validation per type |
| `schedule_remove` | `internal/schedule.ts` | Remove by ID |
| `subagent_spawn` | `internal/subagent.ts` | Creates session + session_links, background finalize |
| `subagent_status` | `internal/subagent.ts` | Active + recent, deduped |
| `subagent_stop` | `internal/subagent.ts` | Abort + status update |
| `wallet_read` | `internal/wallet.ts` | Address + multi-chain balances via Khalani |
| `wallet_send_prepare` | `internal/wallet.ts` | Build transfer intent (no broadcast) |
| `wallet_send_confirm` | `internal/wallet.ts` | Sign + broadcast (mutating, approval gate) |

---

## Protocol Tools (220+ across 10 namespaces)

LLM uses `discover_tools` to search, `execute_tool` to call. Each namespace has manifests (declarative metadata) and handlers (TS client calls — no CLI spawning).

| Namespace | Tools | Chains | Key capabilities |
|-----------|-------|--------|-----------------|
| `khalani` | 9 | 40+ EVM + Solana | Cross-chain bridge, multi-chain balances, orders |
| `solana` | 37 | Solana | Swap, perps, predictions, DCA, limits, lend, stake, studio |
| `kyberswap` | 20 | 18 EVM | Swap (buy + sell), limit orders (maker + taker), zap LP |
| `polymarket` | 69 | Polygon | CLOB trading (buy/sell), bridge, positions, gamma discovery |
| `dexscreener` | 11 | Multi-chain | Pair search, trending, boosts (all read-only) |
| `chainscan` | 17 | 0G | Account, tx, contract, decode, token stats |
| `jaine` | 15 | 0G | DEX pools, swap buy/sell, allowance, W0G wrap |
| `slop` | 11 | 0G | Bonding curve tokens, trade, fees, rewards |
| `echobook` | 28 | — | Social trading: posts, comments, follows, points |
| `slop-app` | 8 | 0G | Profile, image gen/upload, agents, chat |

---

## Implementation Status (2026-03-28)

### Done
- DB schema (27 tables), client, migrate runner, 17 repos (including balances)
- All 17 internal tools — live handlers, zero stubs
- Approval enforcement for mutating tools (protocol + wallet)
- Execution capture with `external_refs` (normalized) + sync enqueue
- Balance sync pipeline — Khalani → proj_balances → proj_portfolio_snapshots
  - Startup full sync, post-mutation selective, periodic full refresh
  - Worker with dedup, transactional replace, canonical chain resolution
- Subagent spawn creates session + session_links, honest finalize
- Nested folder resolution for documents (`"research/2024"`)
- KyberSwap `swap.buy` (explicit buy side for projections)
- SubagentConfig with ENV overrides
- 1023+ passing tests across 36 test files

### Not yet implemented
- **Subagent inference loop** — spawn creates session/links but doesn't run inference yet
- **Capture normalization** — `extractExternalRefs()` has minimal hotfix, full normalization (asset addresses, instrument keys) is phase 2
- **proj_activity population** — requires capture normalization
- **Trade resolution / PnL** — requires lot matching, position keys, FIFO/avg cost (see `trading_pnl_model` plan)
- **proj_open_positions** — requires protocol-specific read tools
- **Engine integration** — conversation loop, compaction, prompt building
- **Transport layer** — HTTP/SSE server, routes, UI

---

## ENV Variables

```bash
# ── Database ─────────────────────────────────
ECHO_AGENT_DB_URL=postgresql://echo_agent:echo_agent@localhost:5432/echo_agent

# ── Inference provider ───────────────────────
AGENT_PROVIDER=openrouter              # or "0g-compute" (auto-detected if unset)
AGENT_CONTEXT_LIMIT=128000
AGENT_MAX_OUTPUT_TOKENS=16384
AGENT_TEMPERATURE=0.7                  # OpenRouter only
OPENROUTER_API_KEY=sk-or-...
AGENT_MODEL=anthropic/claude-sonnet-4

# ── Subagent overrides ───────────────────────
SUBAGENT_MAX_CONCURRENT=5
SUBAGENT_CONTEXT_LIMIT=16384
SUBAGENT_MAX_ITERATIONS=25
SUBAGENT_TIMEOUT_MS=300000

# ── Optional ─────────────────────────────────
TAVILY_API_KEY=tvly-...                # web_search + web_fetch
POLYMARKET_API_KEY=...                 # CLOB trading (11 tools)
JUPITER_API_KEY=...                    # studio tools (3 tools)
```

---

## Tests

```bash
npx vitest run src/__tests__/echo-agent/    # 36 files, 1023+ tests
pnpm tsc --noEmit                           # zero type errors
```

| Category | Files | Tests | What's covered |
|----------|-------|-------|---------------|
| Inference | 6 | 83 | Config validation, SubagentConfig, resilience, registry, types, cost |
| Dispatcher | 1 | 28 | Routing, protocol discovery, all internal tools, no stubs, approval |
| Internal handlers | 5 | 102 | web, documents (nested folders), memory, schedule (new types), subagent (session links) |
| Protocol manifests | 10 | 300+ | Tool counts, mutating flags, required params, namespace, ENV gating |
| Protocol handlers | 8 | 300+ | Handler coverage, param validation, read-only execution |
| Registry + ENV | 2 | 50+ | Tool lookup, OpenAI format, requiresEnv filtering |

---

## Module Docs

- [`db/DB.md`](db/DB.md) — Schema modules, design decisions, 17 repos API, startup
- [`inference/INFERENCE.md`](inference/INFERENCE.md) — Provider interface, ENV, SubagentConfig, provider differences
- [`tools/TOOLS.md`](tools/TOOLS.md) — Tool call flow, internal tools table, protocol namespaces, execution capture
- [`sync/SYNC.md`](sync/SYNC.md) — Balance sync pipeline, Khalani integration, dedup, snapshots
