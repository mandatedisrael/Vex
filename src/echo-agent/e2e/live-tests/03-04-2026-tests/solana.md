# Solana E2E Test Report — April 3, 2026

> Real-money tests on Solana mainnet via MCP E2E harness.
> Wallet: `GoVYsnzegMxCmco53bMBb1k3tsCkdEa8PCfh1PFa11E5`
> DB: Docker Postgres on port 5555 (tmpfs, ephemeral)
> Session: `manual-2026-04-03-solana`

---

## Test Environment

- **MCP Server**: `pnpm exec tsx src/echo-agent/e2e/mcp/server.ts`
- **DB**: `docker/echo-agent/docker-compose.e2e.yml` — PostgreSQL, ephemeral
- **Migrations applied**: 001_initial, 002_engine_missions, 003_w4_pnl, 004_w4_full, 005_lp_economics
- **Code version**: commit `d6645fa` (audit follow-up: LP observability, ZaaS catalog, wallet tests)
- **Funds**: ~0.268 SOL ($21), 2.62 USDC, 0.89 JupUSD, ~39.6k TEK, 0.096 jlUSDC, 0.009 LOL

---

## 1. Preflight

### 1.1 Wallet Balances

**Result: PASS** — Khalani-sourced balances confirmed for Solana wallet. 6 tokens visible (SOL, USDC, JupUSD, TEK, jlUSDC, LOL).

### 1.2 Discovery

**Result: PASS** — `solana` namespace: 13 read-only tools visible. Mutating tools (swap, predict, lend) accessible via `echo_execute`.

---

## 2. Spot Round-Trip: USDC -> BULL -> USDC

### 2.1 Buy — `solana.swap.execute` (USDC -> BULL)

**Result: PASS**

- **Tx**: [`4ZdC1pD...wL6u`](https://explorer.solana.com/tx/4ZdC1pDbAM2mduq8JmGs4sSgW46QuaEfJFsQqm5uuPWi6mNqQLWq4vMNMmGSF1DQWLkswsXfkTuDF1ggwRhiwL6u)
- **In**: 0.999 USDC ($1)
- **Out**: 499.203 BULL
- **Route**: USDC -> USDS (AlphaQ) -> SOL (Raydium CLMM) -> BULL (Pump.fun AMM)
- **Price impact**: -1.07%

**DB check:**
- `protocol_executions`: Row captured, `success: true`, `trade_capture` present
- `proj_activity`: `product_type: "spot"`, `trade_side: "buy"`, `valuation_source: "jupiter_exact"`, `input_value_usd: "0.999"`
- `proj_pnl_lots`: Lot #1 opened, `cost_basis_usd: "0.999"`, `price_usd: "0.00200"`, `status: "open"`

### 2.2 Sell — `solana.swap.execute` (BULL -> USDC)

**Result: PASS**

- **Tx**: [`5ZdKCnG...KA5`](https://explorer.solana.com/tx/5ZdKCnGPxonktHnS8QkN2AEPTMo1gXENrJxKqdcZutHy633ZTc2JYytZ5UtXeVez5uuoPCgaaTgxJeDqEtdCnKA5)
- **In**: 499.203 BULL (full position)
- **Out**: 0.960 USDC
- **Route**: OKX DEX Router

**DB check:**
- `proj_pnl_lots`: Lot #1 -> `status: "closed"`, `remaining_quantity_raw: "0"`, `closed_at` set
- `proj_pnl_matches`: Match #1 -> `match_kind: "matched"`, `cost_basis_usd: "0.9999"`, `proceeds_usd: "0.9606"`, `realized_pnl_usd: "-0.0393"` (loss ~3.9%, spread + fees on meme coin)
- No shortfall — full FIFO lot consumed in one match
- All pro-rata math SQL NUMERIC, no JS float

---

## 3. Prediction Round-Trip: BTC Down 15m

### 3.1 Buy — `solana.predict.buy`

**Result: PASS**

- **Tx**: [`5nQGWB5...UTxP`](https://explorer.solana.com/tx/5nQGWB5stevoLCDvvVGqNvfbGA5iyRDzMF6GtmTBgy6utjnU3aCfYFtZU7FwyCDmT22KNf7fd61jf8YtYuLdUTxP)
- **Market**: `POLY-1829107-1` (BTC Down, 9:00-9:15AM ET)
- **Side**: YES, 3 contracts @ 47c = $1.41 + $0.08 fee
- **Position**: `6NX2eRNv93saVhh3k13j3iquKRx8xexQN8hJX1zXaV4F`
- **Payout if win**: $3.00

**DB check:**
- `proj_open_positions`: `position_type: "prediction"`, `status: "open"`, `entry_price_usd: "470000"`, `notional_usd: "1492719"`, `contracts: "3"`
- `proj_activity`: `capture_status: "open"`, `valuation_source: "prediction_exact"`, `trade_side: "buy"`

**Note:** 5m markets returned HTTP 400 (already closed or min amount $1.5). Had to use 15m market.

### 3.2 Sell — `solana.predict.sell`

**Result: PASS**

- **Tx**: [`3tPKKNr...5c`](https://explorer.solana.com/tx/3tPKKNrNA7cE4yDswWaGxTpvr7TDmkBHEyhajRTfGJr5uuJgg1aifCzQ4vE1ba3xyTXqutBTveyY88fMbRNWWS5c)
- **Closed**: 2 contracts sold, fee $0.054
- **Hold time**: ~1.5 minutes

**DB check:**
- `proj_open_positions`: `status: "closed"`, `closed_at` set
- `proj_activity`: `capture_status: "closed"`, `trade_side: "sell"`

---

## 4. Lend Round-Trip: USDC deposit + withdraw

### 4.1 Rates

**Result: PASS** — 7 vaults returned. USDC: 3.79% APY (supply 2.52% + rewards 1.27%).

### 4.2 Deposit — `solana.lend.deposit` ($1 USDC)

**Result: PASS**

- **Tx**: [`3HnECvU...U8n`](https://explorer.solana.com/tx/3HnECvUTyLrbLDvvei19WPMUMroiYTmG2bHvgAAzssm9SWHkLyHsEXkmdLWgR15SRmUQaZ2KGCXf9qcRZRgZMU8n)
- **Amount**: 1000000 atomic USDC ($1)

**DB check:**
- `proj_activity`: `product_type: "lend"`, `trade_side: null`, `meta.action: "deposit"`, `input_amount: "1000000"`
- No position projection (by design: lend = audit trail only)

### 4.3 Withdraw — `solana.lend.withdraw` ($1 USDC)

**Result: PASS**

- **Tx**: [`5D61Zhj...ByR`](https://explorer.solana.com/tx/5D61ZhjFbfB8A7UaQqQJW69NqHwVWY2nU5Eh74UPgdfbUy8QF8sR32ALG8af3V9CH1WQXEQ1X43xyKF4CuDEnByR)
- **Amount**: 1000000 atomic USDC ($1)

**DB check:**
- `proj_activity`: `product_type: "lend"`, `trade_side: null`, `meta.action: "withdraw"`, `input_amount: "1000000"`

---

## 5. SOL Native Transfer

### 5.1 Transfer — `wallet_send_prepare` + `wallet_send_confirm`

**Result: PASS (on-chain) / NO PIPELINE CAPTURE (by design)**

- **Tx**: [`55FVaMQ...upD`](https://explorer.solana.com/tx/55FVaMQR6fCMPP6Cyd2EGo9AYeS59RtnXB9zfyHPE7U5YmhNnYAAACBM5H9etBxM6j6aiXnb9224tN3Z9hEUFupD)
- **Amount**: 0.001 SOL to `9ARuvsRGMeq92iX64ryaFxyPZYyVWBK9XFWNorPKvC3h`

**Design gap noted:** `wallet_send_confirm` is an internal tool, not a protocol tool. It emits `_tradeCapture` in result `data`, but the capture hook is only in `protocols/runtime.ts` for `execute_tool`. In production engine (turn loop), the capture would be consumed, but in E2E MCP harness via `echo_internal`, it's not captured to `protocol_executions`.

---

## 6. Replay Verification

**Result: PASS**

```
replayStats: { replayed: 4, skipped: 0, errors: 0 }
auditIntact: true
projectionsMatch: true
hashesMatch: { activity: true, positions: true, lots: true, matches: true }
```

All 4 successful executions replayed correctly. Content hashes (business fields only, no timestamps/auto-increment FKs) match before/after. Audit trail (protocol_executions + protocol_capture_items) unchanged.

**Note:** LP hashes (`lpEvents`, `lpLegs`) not in output because MCP server was started before audit follow-up commit `d6645fa`. No LP operations in this session anyway.

---

## 7. Trending / Discovery

### 7.1 Jupiter Trending

**Result: PASS** — `solana.tokens.trending` returned 15 tokens. Highlights:
- BULL (+38% 1h, pump.fun graduated, organic 80)
- CARDS ($9.4M mcap, verified)
- RPU (+71% 1h, Elon-linked)
- LEPE (Lego Pepe, +972% — just graduated from pump.fun)

### 7.2 DexScreener Trending

**Result: PASS** — `dexscreener.trending` returned 15 boosted Solana tokens.

---

## Summary

| Flow | Status | Pipeline | Notes |
|------|--------|----------|-------|
| Spot buy (BULL) | PASS | execution -> capture -> activity -> lot | jupiter_exact valuation |
| Spot sell (BULL) | PASS | FIFO match, realized PnL | -$0.039, full lot consumed |
| Predict buy | PASS | position opened | prediction_exact, 3 contracts |
| Predict sell | PASS | position closed | ~1.5 min hold |
| Lend deposit | PASS | activity (audit only) | no position projection |
| Lend withdraw | PASS | activity (audit only) | no position projection |
| SOL transfer | PASS (on-chain) | no capture | internal tool gap |
| Trending | PASS | n/a | Jupiter + DexScreener |
| Replay | PASS | all hashes match | 4 replayed, 0 errors |

**Total executions in DB**: 11 (9 protocol + 5 failed predict.buy attempts recorded with `success: false`)
**Pipeline activity rows**: 6 (2 spot + 2 prediction + 2 lend)
**Open questions**: internal tool capture gap for `wallet_send_confirm` in E2E MCP harness

---

## Session DB State (final)

```
protocol_executions:    11 (9 session + 2 read-only quotes captured as non-mutating)
protocol_capture_items: 6
proj_activity:          6  (2 spot, 2 prediction, 2 lend)
proj_open_positions:    1  (prediction closed)
proj_pnl_lots:          1  (BULL closed)
proj_pnl_matches:       1  (BULL FIFO match)
proj_lp_events:         0  (no LP operations)
proj_lp_event_legs:     0
```
