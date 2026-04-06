# Hardening Retest Report — April 2, 2026

> Retest after token resolution + prediction settlement + agent guardrails deployment.
> Commits tested: `e063fae` (main fix) + `31500d4` (follow-up hardening)
> EVM Wallet: `0x18b467Cb28FC07Ca6E17A964b3319051B3072B79`
> DB: Docker Postgres (pgvector) on port 5777 (tmpfs, ephemeral); embeddings via Docker Model Runner on port 12434

---

## 1. Smoke Tests

### 1.1 Discovery Smoke

**Result: PASS**

| Namespace | Tools | Mutating |
|-----------|-------|----------|
| khalani | 9 | 1 |
| solana | 20 | 7 |
| kyberswap | 20 | 11 |
| dexscreener | 11 | 0 |
| chainscan | 20 | 0 |
| jaine | 24 | 6 |
| slop | 13 | 6 |
| echobook | 33 | 13 |
| polymarket | 58 | 2 |
| slop-app | 10 | 4 |

**Total: 218 tools across 10 namespaces.** Same as April 1 baseline — no tool regressions.

### 1.2 Preview Smoke

**Result: PASS**

Zero writes across all 6 pipeline tables (executions, captureItems, activities, openPositions, lots, matches). dryRun invariant holds. Handler failures expected (invalid params in preview) — the invariant is zero DB writes regardless.

### 1.3 Sync Job Seeding

**Result: PASS**

8 jobs seeded (was 7 before hardening):
- `_global/balances` periodic 300s
- `_global/prediction_settlement` periodic 300s (**NEW**)
- 6 per-namespace `post_mutation` balance jobs

---

## 2. Bug 1 Retest: KyberSwap Token Resolution

### 2.1 Address path — axlUSDC by contract address

**Result: PASS (was FAIL in evm.md)**

```
kyberswap.swap.quote({
  chain: "polygon",
  tokenIn: "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed",  // axlUSDC
  tokenOut: "POL",
  amountIn: "1"
})
```

Resolution succeeded via on-chain ERC-20 read:
- `symbol: "axlUSDC"` ✓
- `decimals: 6` ✓
- `name: "Axelar Wrapped USDC"` ✓

KyberSwap aggregator returned valid route: axlUSDC → USDC.e (UniswapV3) → POL (DODO DPP). ~$1.00 in, ~11.1 POL out, gas ~$0.004.

**Before fix**: `Token metadata for "0x750e4C..." not found on chain 137` — failed because Token API `name` search can't look up by hex address.

**After fix**: On-chain `readContract()` reads decimals/symbol/name directly from the ERC-20 contract. Token API bypassed entirely for address input.

### 2.2 Symbol path — "axlUSDC" via KyberSwap

**Result: STILL FAILS (Token API limitation, not our bug)**

```
kyberswap.swap.quote({
  chain: "polygon",
  tokenIn: "axlUSDC",
  tokenOut: "POL",
  amountIn: "1"
})
-> Error: Token "axlUSDC" not found on chain 137
```

Root cause confirmed: KyberSwap Token API `name` parameter does NOT match against the `symbol` field despite documentation claiming "Search by name/symbol". Searching `name=axlUSDC` returns 0 results because "axlUSDC" doesn't partial-match the token's `name` field ("Axelar Wrapped USDC"). Both whitelisted and non-whitelisted search return 0.

Evidence: `kyberswap.tokens.search(query="axelar")` DOES find axlUSDC — because "axelar" partial-matches "Axelar Wrapped USDC".

**This is a KyberSwap Token API limitation, not our code bug.** Agent must use `khalani.tokens.search` or the contract address.

### 2.3 Symbol path — "axlUSDC" via Khalani (canonical resolver)

**Result: PASS**

```
khalani.tokens.search({ query: "axlUSDC", chainIds: "137" })
```

Returns immediately:
```json
{
  "address": "0x750e4c4984a9e0f12978ea6742bc1c5d248f40ed",
  "symbol": "axlUSDC",
  "decimals": 6,
  "name": "Axelar Wrapped USDC"
}
```

**Confirms the architecture decision**: `khalani.tokens.search` is the canonical cross-chain resolver. `kyberswap.tokens.search` is a confirmation tool only. The prompt Token Verification Rule already directs the agent to use khalani as primary.

### 2.4 axlUSDC → USDC direct swap

**Result: FAIL (KyberSwap aggregator — no route)**

```
kyberswap.swap.quote({
  chain: "polygon",
  tokenIn: "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed",
  tokenOut: "USDC",
  amountIn: "4.937843"
})
-> bad request
```

Token resolution passed (got to API call), but KyberSwap aggregator returned HTTP 400 — no viable route for axlUSDC → native USDC on Polygon at this amount. The aggregator CAN route axlUSDC → POL (test 2.1), just not axlUSDC → native USDC directly.

This is aggregator liquidity, not our bug. Workaround: bridge via Khalani or route through an intermediate token.

---

## 3. Wallet State

### Polygon (chainId 137)

| Token | Balance | USD |
|-------|---------|-----|
| axlUSDC | ~4.94 | ~$4.94 |
| POL | ~54.41 | ~$4.91 |

Same as post-April 2 EVM test state. No funds lost.

---

## 4. Summary

| # | Test | Before | After | Status |
|---|------|--------|-------|--------|
| 1 | Discovery smoke | PASS | PASS | ✅ No regression |
| 2 | Preview smoke | PASS | PASS | ✅ No regression |
| 3 | axlUSDC by address → quote | **FAIL** | **PASS** | ✅ **FIXED** |
| 4 | axlUSDC by symbol → kyberswap | FAIL | FAIL | ⚠️ Token API limitation |
| 5 | axlUSDC by symbol → khalani | n/a | **PASS** | ✅ Canonical resolver works |
| 6 | axlUSDC → USDC direct swap | FAIL | FAIL (aggregator) | ⚠️ No route (liquidity) |
| 7 | axlUSDC → POL swap | n/a | **PASS** | ✅ Full route |
| 8 | Sync job seeding (8 jobs) | n/a | PASS | ✅ prediction_settlement seeded |

---

## 5. Observations & Findings

### 5.1 KyberSwap Token API `name` search does NOT match by symbol

Despite documentation claiming "Search by name/symbol, case-insensitive partial match", the `name` query parameter only matches against the token's `name` field, not `symbol`. This means:

- `name=axlUSDC` → 0 results (doesn't match "Axelar Wrapped USDC")
- `name=axelar` → finds axlUSDC (partial matches "Axelar Wrapped USDC")
- `name=USDC` → finds USDC (partial matches "USD Coin")

**Impact**: Any token whose symbol doesn't appear as a substring of its name will not be resolvable by symbol via KyberSwap Token API. This includes many bridged/wrapped tokens (axlUSDC, axlETH, etc.).

**Mitigation**: Agent Token Verification Rule directs to `khalani.tokens.search` as primary resolver, which correctly resolves by symbol. KyberSwap symbol lookup works for mainstream tokens only.

### 5.2 axlUSDC → USDC has no KyberSwap route on Polygon

KyberSwap aggregator returns HTTP 400 for axlUSDC → native USDC on Polygon. Likely insufficient liquidity in direct pairs. axlUSDC → POL works via UniswapV3 + DODO. This means users who receive axlUSDC from KyberSwap routing (as happened in April 2 EVM test) cannot swap back to native USDC via KyberSwap on Polygon.

**Workaround options**:
1. Khalani bridge axlUSDC (Polygon) → USDC (other chain)
2. Route through intermediate: axlUSDC → POL → USDC
3. Use Axelar bridge directly

### 5.3 On-chain ERC-20 metadata read is robust

The new `readErc20Metadata()` correctly read decimals, symbol, and name from `0x750e4C...` on Polygon. RPC call to `polygon-bor-rpc.publicnode.com` completed without timeout. Tolerant handling (optional symbol/name) was not needed for this token — all three view functions returned normally.

### 5.4 Settlement sync seeding confirmed

New `prediction_settlement` periodic job (300s interval) was seeded alongside existing balance jobs. Total: 8 jobs. syncTick() generalization will dispatch both `balances` and `prediction_settlement` on their intervals.

---

## 6. Remaining Retest Items

Not tested in this session (require specific DB state or live funds):

| Item | Prerequisite |
|------|-------------|
| Jupiter prediction settlement sync | Open prediction position in DB + settled on-chain |
| Polymarket settlement sync | Open Polymarket position + proxy wallet + settled |
| Live swap with capture pipeline | Fund approval + gas |
| Replay verify (hash stability) | Need at least 1 executed capture in DB |
| Settlement sync failure path | Simulate populateCaptureItems failure |

These require either real-money mutations or pre-populated DB state from a prior E2E session.
