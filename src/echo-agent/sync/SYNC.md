# Sync Module — Echo Agent

Balance sync pipeline: Khalani API → `proj_balances` → `proj_portfolio_snapshots`. Asynchronous, deduplicated, triggered by mutations and periodic schedule.

## Architecture

```
sync/
  index.ts               — Public API: initSync(), syncTick()
  balance-sync.ts        — Khalani → proj_balances → snapshot
  activity-populator.ts  — _tradeCapture → proj_activity (from capture-pipeline)
  position-projector.ts  — activity → proj_open_positions + proj_pnl_lots (FIFO)
  replay.ts              — One-time projection correction from immutable audit trail
  worker.ts              — Claims pending sync runs, deduplicates, dispatches
  seed.ts                — Seeds default protocol_sync_jobs
  chains.ts              — Canonical chain hint resolution
```

## Data flow

```
Trigger                        Pipeline                              Projection
──────────────────────────────────────────────────────────────────────────────────
Startup (initSync)        →  drain backlog → fullBalanceSync()  →  proj_balances + snapshot
Post-mutation             →  runtime.ts enqueues sync run       →  worker dedup → selective refresh
  (capture hook)             per namespace                         (only affected chains)
Periodic (syncTick)       →  check last snapshot age            →  fullBalanceSync() if stale
```

## How it works

### Startup (`initSync`)

1. `seedSyncJobs()` — insert default jobs (idempotent, ON CONFLICT DO NOTHING)
2. `drainPendingRuns()` — clean up backlog from previous process (no snapshot)
3. `fullBalanceSync()` — authoritative startup snapshot

Order matters: drain first to avoid double-snapshot from stale pending runs.

### Post-mutation (automatic)

When `runtime.ts` captures a mutating execution, it enqueues sync runs for all matching jobs in that namespace. The worker deduplicates: multiple pending balance runs become ONE Khalani call.

### Periodic (`syncTick`)

Called by engine every ~60s:
1. Drain any pending post-mutation runs
2. If last snapshot is older than `intervalSeconds` (default 300s/5min) → full refresh

## Source of truth: Khalani

One `getTokenBalances(address, chainIds?)` call per wallet family returns:
- Native tokens + altcoins across all chains
- `extensions.balance` (string, smallest units)
- `extensions.price.usd` (string, USD price)
- `decimals` for display formatting

## Balance sync behavior

**`replaceBalancesForChain()`** — transactional full-replace for (walletAddress, chainId). Tokens absent from Khalani response are removed from `proj_balances`. No ghost balances.

**`fullBalanceSync()`** — both wallet families + portfolio snapshot with PnL delta vs previous.

**`selectiveBalanceSync(chainHint)`** — only affected chain(s) after a trade. No snapshot (snapshot only on full sync).

## Chain hint normalization

`_tradeCapture.chain` returns varied formats:
- `"solana"` → family: solana, no chainId filter
- `"0g"`, `"polygon"`, `"base"`, `"ethereum"` → resolved via Khalani `resolveChainId()`
- Numeric string → parsed to chainId

Fallback: if resolution fails, assumes eip155 full refresh.

## Sync jobs (seeded)

| Namespace | Type | Strategy | Interval |
|-----------|------|----------|----------|
| `_global` | balances | periodic | 300s (5min) |
| `khalani` | balances | post_mutation | — |
| `solana` | balances | post_mutation | — |
| `kyberswap` | balances | post_mutation | — |
| `polymarket` | balances | post_mutation | — |
| `jaine` | balances | post_mutation | — |
| `slop` | balances | post_mutation | — |

All backed by `khalani.tokens.balances` as read tool. Worker sees `syncType: "balances"` → same Khalani call regardless of triggering namespace.

## Deduplication

Worker claims ALL pending runs at once (`claimAllPending()` with FOR UPDATE SKIP LOCKED), groups by syncType. For `balances`: one Khalani call serves all pending runs. All claimed runs get the same result.

## Portfolio snapshots

`proj_portfolio_snapshots.positions` JSONB stores per-wallet, per-chain breakdown:

```typescript
{
  wallets: [{
    family: "eip155",
    address: "0x...",
    totalUsd: 1234.56,
    chains: [{
      chainId: 1,
      totalUsd: 1000.00,
      tokens: [{ address, symbol, balanceRaw, balanceUsd, priceUsd, decimals }]
    }]
  }]
}
```

`pnl_vs_prev` / `pnl_pct_vs_prev` = portfolio delta vs previous snapshot.

## Activity population

`activity-populator.ts` is called from `populateCaptureItems()` in `protocols/capture-pipeline.ts` after every mutating tool execution. Maps capture items → `proj_activity` rows.

The shared `capture-pipeline.ts` is imported by both `runtime.ts` (inline after execution) and `replay.ts` (one-time correction).

### Capture model: 1 execution → N capture items → N activity rows

| Handler type | `_tradeCapture` | `_tradeCaptureItems` | Result |
|---|---|---|---|
| Single (swap, lend.deposit) | 1 object | absent | 1 capture item → 1 activity row |
| Batch (predict.closeAll) | summary object | N objects | N capture items → N activity rows |

The runtime records `protocol_capture_items` first, then calls `populateActivity()` per item. Each activity row gets a `capture_item_id` FK pointing to its specific capture item. `execution_id` is shared by all activity rows from the same tool call.

### Activity row fields
- `product_type`: spot, perps, prediction, lp, lend, stake, bridge, reward
- `trade_side`: only for real trades (spot buy/sell, perps open/close, prediction buy/sell). NULL for bridge, lend, stake, lp, reward, claim.
- `instrument_key`: canonical per product (`solana:{mint}`, `polymarket:{conditionId}:{outcome}`, `{chain}:lp:{pool}`)
- `position_key`: positionPubkey, orderKey, positionId
- `capture_item_id`: FK to `protocol_capture_items` — enables per-position correlation for batch captures

### Valuation fields (W4A)
- `input_value_usd`: USD value of input leg (string → NUMERIC). From handler source API.
- `output_value_usd`: USD value of output leg.
- `fee_value_usd`: fees in USD.
- `unit_price_usd`: per-human-unit price of tracked asset (best-effort for display).
- `valuation_source`: `"jupiter_exact"`, `"kyberswap_exact"`, `"polymarket_exact"`, `"prediction_exact"`, `"none"`.

Handlers with `MUTATION_MATRIX.valuationExpected: "exact"` emit exact USD from source API. `"none"` handlers (Jaine, Slop) leave valuation null honestly.

## Position projector

`position-projector.ts` is called from `populateActivity()` after each activity insert. Dispatches by `product_type`:

| Product | Projection | Open/close signal |
|---------|-----------|-------------------|
| **perps** | `proj_open_positions` | `captureStatus`: executed/open → open, closed → close |
| **prediction** | `proj_open_positions` | `captureStatus`: open → open, closed/claimed/cancelled → close |
| **order** (DCA/limit) | `proj_open_positions` | `captureStatus`: open → open, cancelled → cancel (NOT FIFO lots) |
| **lp** | `proj_open_positions` | `meta.action`: zap-in → open, zap-out → close, zap-migrate → close old + open new |
| **spot** | `proj_pnl_lots` + `proj_pnl_matches` (FIFO) | `tradeSide`: buy → open lot (with economics), sell → FIFO reduce + record matches with realized PnL |
| bridge/lend/stake/reward | — | skipped |

Key: `captureStatus` comes from `proj_activity.capture_status` which is set directly from `_tradeCapture.status` — not from meta.

Cross-protocol: slop.trade.buy + jaine.swap.sell match via shared `instrumentKey` (`0g:{tokenAddress}`).

## Replay (`replay.ts`)

One-time projection correction tool. Reads immutable audit trail (`protocol_executions` + `protocol_capture_items`), truncates projection tables, re-runs `populateActivity()` with type correction from `MUTATION_MATRIX.expectedType`.

**What it does:**
1. `TRUNCATE proj_activity, proj_open_positions, proj_pnl_lots, proj_pnl_matches`
2. Read all successful executions chronologically
3. For each: read its `protocol_capture_items` (batch truth), apply type correction, skip previews
4. Re-run `populateActivity()` per corrected item via `replayActivityFromCapture()`

**What it does NOT do:**
- Does NOT modify `protocol_executions` or `protocol_capture_items` (immutable audit trail)
- Does NOT re-record capture items (reads existing)

**When to use:** After handler fixes that change `_tradeCapture.type` (e.g. KyberSwap limit orders `swap` → `order`). Idempotent — safe to run multiple times.

```typescript
import { replayProjections } from "@echo-agent/sync/replay.js";
const stats = await replayProjections(); // { replayed, skipped, errors }
```

**E2E verification:** `echo_replay_verify` MCP tool runs replay + compares before/after pipeline snapshots. See `e2e/E2E.md`.

## PnL match ledger (W4A)

`proj_pnl_matches` is the canonical realized PnL ledger. Each FIFO lot match records:
- `match_kind`: `"matched"` (lot consumed) or `"shortfall"` (sell > inventory)
- `cost_basis_usd`: pro-rata from lot (SQL NUMERIC math, not JS float)
- `proceeds_usd`: pro-rata from sell's `output_value_usd`
- `realized_pnl_usd`: proceeds - cost_basis (computed in SQL)

Shortfall rows have `lot_id = NULL`, `cost_basis_usd = NULL`, `realized_pnl_usd = NULL`.

**Precision model:** All pro-rata math is done in SQL (`NUMERIC` arithmetic). USD values flow as strings through the pipeline: handler → `_tradeCapture` → `proj_activity` → SQL `INSERT` with subquery. No JS `Number()` on USD or raw quantities in the write path.

## What's NOT in this module

- **Unrealized PnL / mark-to-market** — requires live price feed (W4B)
- **Benchmark/quote-asset PnL** (SOL/ETH/USDC/0G) — W4B
- **Khalani fallback valuation** for Jaine/Slop — W4B
- **Cron/timer** — engine responsibility, sync exposes `initSync()` and `syncTick()`
- **UI/API endpoints** — transport layer

## Usage

```typescript
import { initSync, syncTick } from "@echo-agent/sync/index.js";

// On boot (after DB migrations)
await initSync();

// Periodic (engine calls every 60s)
setInterval(() => syncTick().catch(console.error), 60_000);
```
