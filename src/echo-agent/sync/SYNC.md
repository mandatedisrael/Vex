# Sync Module — Echo Agent

Balance sync pipeline: Khalani API → `proj_balances` → `proj_portfolio_snapshots`. Asynchronous, deduplicated, triggered by mutations and periodic schedule.

## Architecture

```
sync/
  index.ts                         — Public API: initSync(), syncTick()
  balance-sync.ts                  — Khalani → proj_balances → snapshot → MTM refresh
  activity-populator.ts            — _tradeCapture → proj_activity (from capture-pipeline)
  position-projector.ts            — activity → proj_open_positions + proj_pnl_lots + proj_pnl_matches (transactional FIFO)
  mtm.ts                           — Mark-to-market: Jupiter Prediction + Polymarket exit prices
  prediction-settlement-sync.ts    — Auto-close settled prediction positions (Jupiter + Polymarket)
  synthetic-capture.ts             — Record settlement/reconciliation events through capture pipeline
  lp-economics.ts                  — Extract LP cashflow legs from ZaaS zapDetails → proj_lp_events
  replay.ts                        — One-time projection correction from immutable audit trail
  worker.ts                        — Claims pending sync runs, deduplicates, dispatches → MTM refresh
  seed.ts                          — Seeds default protocol_sync_jobs
  chains.ts                        — Canonical chain hint resolution
  benchmark.ts                     — Chain → benchmark asset key resolution (SOL, ETH, 0G, etc.)
  instrument-key.ts                — parseInstrumentKey() typed helper for all instrumentKey patterns
```

## Data flow

```
Trigger                        Pipeline                              Projection
──────────────────────────────────────────────────────────────────────────────────
Startup (initSync)        →  drain backlog → fullBalanceSync()  →  proj_balances + snapshot
Post-mutation             →  runtime.ts enqueues sync run       →  worker dedup → selective refresh
  (capture hook)             per namespace                         (only affected chains)
Periodic (syncTick)       →  check all _global periodic jobs    →  balances: fullBalanceSync()
                                                                   prediction_settlement: reconcile
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
2. For each `_global` periodic job: if last run is older than `intervalSeconds` → execute
   - `balances` → `fullBalanceSync()`
   - `prediction_settlement` → `reconcilePredictionSettlements()`

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
| `_global` | prediction_settlement | periodic | 300s (5min) |
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
1. `TRUNCATE proj_activity, proj_open_positions, proj_pnl_lots, proj_pnl_matches, proj_lp_events, proj_lp_event_legs`
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

## Mark-to-market (W4)

`mtm.ts` refreshes `current_value_usd` / `unrealized_pnl_usd` on open prediction positions.

- **Jupiter**: `getJupiterPredictionMarket()` → `pricing.sellYesPriceUsd` / `sellNoPriceUsd` (exit price)
- **Polymarket**: `getPolyClobClient().getPrice(tokenId, "SELL")` — public endpoint, no API key
- **Math**: SQL-side `contracts * $markPrice::numeric`
- **Triggered**: after `fullBalanceSync()` and `drainPendingRuns()`
- **Resilience**: per-position try/catch, dedup marketIds
- **Close**: `closePosition()` nulls MTM fields

Spot unrealized is read-model only — CTE join `proj_pnl_lots` × `proj_balances` at query time.

## Benchmark-native PnL (W4)

`benchmarkAssetKey` = chain-level analytic benchmark (SOL, 0G, ETH). Set ONLY when native leg present in swap.

`settlementAssetKey` = actual quote/collateral of the trade (SOL, USDC, 0G). Trade-specific, not chain-mapped.

Native values (`input_value_native`, `output_value_native`) = human-unit amount of native leg. NULL when swap doesn't touch native asset.

Native pro-rata in FIFO match ledger: `cost_basis_native`, `proceeds_native`, `realized_pnl_native`.

## Prediction settlement sync

`prediction-settlement-sync.ts` auto-closes prediction positions settled by on-chain keepers (bypasses `execute_tool`).

**Problem**: Jupiter Prediction and Polymarket settle via protocol keepers. Our pipeline only captures events through `execute_tool`. Settled positions become zombies (`status: 'open'` in DB, closed on-chain).

**Solution**: Periodic reconciliation via `reconcilePredictionSettlements()`:
1. Query open prediction positions from `proj_open_positions`
2. Group by namespace + wallet (one API call per wallet)
3. Match against protocol read APIs for settlement events
4. Create synthetic captures via `synthetic-capture.ts` → standard pipeline → position closed

**Jupiter** — `getJupiterPredictionHistory()` + `getJupiterPredictionPositions()`:
- `position_lost` → `status: "closed"`, no `outputValueUsd`
- `position_won + claimed=false` → `status: "closed"`, payout in `meta` only
- `position_won + claimed=true` → `status: "claimed"`, `outputValueUsd = payoutAmountUsd`

**Polymarket** — `getPolyDataClient().getClosedPositions(proxyWallet)`:
- Proxy wallet derived via `getRelayPayload(eoa, "SAFE")` from relayer API
- `status: "closed"`, `meta.realizedPnl` from API, no `outputValueUsd`

**Synthetic captures** use toolIds not in MUTATION_MATRIX (`settlement_sync.jupiter`, `settlement_sync.polymarket`). The capture validator returns `true` for unknown toolIds. `synthetic-capture.ts` has its own local validation boundary (type, status, walletAddress, positionKey).

## LP Economics

`lp-economics.ts` extracts multi-leg cashflows from ZaaS `zapDetails` stored in `_tradeCapture.meta`.

**Tables**: `proj_lp_events` + `proj_lp_event_legs` (projection tables, included in replay truncate cycle).

**Leg types**: `deposit` (tokens into pool), `withdraw` (tokens out of pool), `fee` (protocol/partner fees), `refund` (leftover tokens).

**Triggered from**: `position-projector.ts` → `recordLpEconomics()` after each LP activity insert. Only runs when `meta.zapDetails` is present.

**Semantics**:
- `zap-in`: deposit legs + fee legs. Position gets `notionalUsd` from `inputValueUsd`.
- `zap-out`: withdraw legs + fee legs (if `collectFee` enabled, default true).
- `zap-migrate`: cost basis carry from old position's `notionalUsd` to new. Fee/refund legs from migration.

**Valuation**: `zaas_estimate` — from ZaaS route preview, not on-chain exact. Good for audit trail and approximate PnL, not accounting-grade precision.

**No FK to proj_activity.id or proj_open_positions.id** — link via `execution_id`, `capture_item_id`, `position_key`, `instrument_key` (stable across replay).

## What's NOT in this module

- **Khalani fallback valuation** for Jaine/Slop (needs timestamped price source)
- **Perps MTM** (no active runtime shelf)
- **LP PnL** (lifecycle only)
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
