# Sync Module — Echo Agent

Balance sync pipeline: Khalani API → `proj_balances` → `proj_portfolio_snapshots`. Asynchronous, deduplicated, triggered by mutations and periodic schedule.

## Architecture

```
sync/
  index.ts          — Public API: initSync(), syncTick()
  balance-sync.ts   — Khalani → proj_balances → snapshot
  worker.ts         — Claims pending sync runs, deduplicates, dispatches
  seed.ts           — Seeds default protocol_sync_jobs
  chains.ts         — Canonical chain hint resolution
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

## What's NOT in this module

- **Trade resolution / realized PnL** — separate reconciliation layer (see `trading_pnl_model` plan)
- **proj_activity population** — requires capture normalization (phase 2)
- **proj_open_positions** — requires protocol-specific read tools
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
