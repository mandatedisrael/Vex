# Polymarket E2E Test Report — April 3, 2026

> 69 tools tested across 4 modules: Gamma (discovery), CLOB (orderbook), Data (analytics), Bridge.
> Wallet: `0x18b467Cb28FC07Ca6E17A964b3319051B3072B79`
> Session: `manual-2026-04-03-polymarket`

---

## Summary

| Module | Total | Tested | Pass | Fail/Bug | Blocked |
|--------|-------|--------|------|----------|---------|
| Gamma (discovery) | 22 | 10 | 8 | 2 | 0 |
| CLOB (orderbook) | 18 | 10 | 6 | 4 | 2 (auth) |
| Data (analytics) | 14 | 6 | 4 | 2 | 0 |
| Bridge | 5 | 1 | 1 | 0 | 0 |
| **Total** | **69** | **27** | **19** | **8** | **2** |

Trading (buy/sell/cancel) blocked — credentials not loaded into process.env + geoblock.

---

## Bugs Found

### BUG 1 (High): `clob.buy` handler uses conditionId as Gamma market ID

**File:** `src/echo-agent/tools/protocols/polymarket/handlers-clob.ts:130`

Handler does `getPolyGammaClient().getMarket(conditionId)` but Gamma API `GET /markets/{id}` expects numeric ID (e.g. `1640919`) or slug, NOT hex conditionId.

- With conditionId (hex): `"Polymarket Gamma: id is invalid"`
- With numeric ID: dryRun works correctly

**Fix:** Either resolve conditionId → numeric ID via Gamma search, or change manifest to accept numeric market ID.

### BUG 2 (High): `clob.buy` price=0 causes NaN/Infinity

When `getPrice(tokenId, "BUY")` returns 0 (no immediate fill), handler computes:
```
shares = amount / 0 = Infinity
calcAmounts("BUY", Infinity, 0) → NaN
→ "Cannot convert NaN to a BigInt"
```

**Fix:** Guard against price=0, fall back to bestAsk from orderbook or require explicit `price` param.

### BUG 3 (Medium): `polymarket_setup` doesn't set process.env

`polymarket_setup` saves credentials to `~/.config/echoclaw/.env` file and reports "configured", but doesn't set `process.env.POLYMARKET_API_KEY`. Registry has `requiresEnv: "POLYMARKET_API_KEY"` → tools remain blocked until process restart with env vars.

**Impact:** After running `polymarket_setup`, trading tools still unavailable. User must manually restart MCP/engine with env vars.

**Fix:** After saving to file, do `process.env[key] = value` for each credential.

### BUG 4 (Medium): `gamma.comments` param mismatch

Handler sends `marketId` but API requires `parent_entity_id` + `entity_entity_type`.

**Error:** `"parent_entity_id and entity_entity_type are mandatory"`

### BUG 5 (Low): `clob.price` / `clob.midpoint` return 0

`clob.price` with side=BUY returns `{ price: 0 }` and `clob.midpoint` returns `{ mid_price: "0" }` even though orderbook has bids to 0.75 and asks from 0.76. Possible CLOB API quirk or tokenId-specific issue.

### Manifest Param Issues (4):

| Tool | Issue |
|------|-------|
| `clob.price` | `side` param is required by API but not marked `required: true` in manifest |
| `clob.prices` | `sides` param not documented in manifest |
| `data.activity` | Manifest says `address` param but handler/API expects `user` |
| `data.liveVolume` | Requires `eventId` (numeric) not `conditionId` |

### External Issues (2):

| Issue | Cause |
|-------|-------|
| `clob.trades` auth failure | POLYMARKET_API_KEY not in process.env (not a code bug per se) |
| Geoblock on trading | Polymarket restricts EU/PL regions. VPN needed at system level, not browser. |

---

## Test Results — Gamma (Discovery)

| Tool | Status | Notes |
|------|--------|-------|
| `gamma.search` | PASS | 91 results for "Trump tariffs" |
| `gamma.events` | PASS | Active events sorted by volume, top: FIFA World Cup $17M |
| `gamma.markets` | PASS | Top non-negRisk: "US forces Iran" $21M vol, accepting orders |
| `gamma.market` | PASS | Returns full data with numeric ID (1640919) |
| `gamma.marketBySlug` | PASS | Slug lookup works |
| `gamma.eventBySlug` | FAIL | "slug not found" — may need different slug format vs market slug |
| `gamma.tags` | PASS | 100 tags returned |
| `gamma.profile` | PASS | "not found" for our wallet (expected — no trading history) |
| `gamma.comments` | FAIL | Param mismatch (BUG 4) |
| `gamma.series` | PASS | 100 series (ETH hourly, BTC hourly, etc.) |
| `gamma.sportsMarketTypes` | PASS | 98 types (moneyline, spreads, totals, UFC, cricket, etc.) |
| `gamma.teams` | PASS | Returns team data with logos |

## Test Results — CLOB (Orderbook)

| Tool | Status | Notes |
|------|--------|-------|
| `clob.serverTime` | PASS | Unix timestamp |
| `clob.orderbook` | PASS | Full depth: 75 bids, 23 asks for Iran market |
| `clob.price` | WARN | Returns 0 for BUY side (BUG 5), requires `side` param |
| `clob.midpoint` | WARN | Returns "0" (BUG 5) |
| `clob.spread` | PASS | "0.01" |
| `clob.tickSize` | PASS | 0.01 |
| `clob.lastTrade` | PASS | price: "0.75", side: "SELL" |
| `clob.feeRate` | PASS | base_fee: 0 |
| `clob.trades` | FAIL | "Invalid api key" — env not loaded |
| `clob.buy` (dryRun) | PARTIAL | Works with numeric ID, fails with conditionId (BUG 1), price=0 causes NaN (BUG 2) |

## Test Results — Data (Analytics)

| Tool | Status | Notes |
|------|--------|-------|
| `data.positions` | PASS | Empty (no positions — expected) |
| `data.activity` | PASS | Empty, but param is `user` not `address` |
| `data.openInterest` | PASS | $413M global open interest |
| `data.leaderboard` | PASS | Top 3: $398k PnL leader, texaskid $179k, cicade $172k |
| `data.liveVolume` | WARN | Requires `eventId` not `conditionId` |
| `data.closedPositions` | not tested | |

## Test Results — Bridge

| Tool | Status | Notes |
|------|--------|-------|
| `bridge.assets` | PASS | 163 assets across 10+ chains (Ethereum, Polygon, Solana, Base, Arbitrum, BSC, Monad, HyperEVM, Abstract, Tron, Bitcoin) |

---

## Trading Test — Blocked

Trading could not be tested due to:
1. `POLYMARKET_API_KEY` not in `process.env` → `requiresEnv` blocks tool
2. Even with numeric ID workaround, geoblock from EU/PL
3. `polymarket_setup` saves to file but doesn't propagate to env (BUG 3)

### Workaround for next session:
Pass credentials as env vars when starting MCP server, and use system-level VPN for US region.

---

## Wallet Transfer Test

| Action | Status |
|--------|--------|
| Send 5 USDC to `0x14c6ed...7a0e` | PASS — `wallet_send_prepare` + `wallet_send_confirm` via Polygon, tx confirmed |

---

## Action Items (Priority Order)

1. **Fix `clob.buy` conditionId → numeric ID resolution** (BUG 1) — blocks all trading
2. **Fix `clob.buy` price=0 guard** (BUG 2) — NaN crash
3. **Fix `polymarket_setup` process.env propagation** (BUG 3) — UX blocker
4. **Fix `gamma.comments` params** (BUG 4)
5. **Update 4 manifest param definitions** — side required, sides, user vs address, eventId
6. **Investigate `clob.price`/`midpoint` returning 0** (BUG 5)
7. **Re-test trading with credentials + VPN** — separate session
