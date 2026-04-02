# Prediction & Token Hardening — Fix Report

> Fixes applied for bugs found in Solana E2E (April 1) and EVM E2E (April 2) test reports.
> Applied: April 2, 2026

---

## Bug 1: KyberSwap `resolveTokenMetadata` fails for contract address input (evm.md)

**Status: FIXED**

**Root cause**: `resolveTokenMetadata()` passed hex addresses as the `name` query parameter to KyberSwap Token API. The `name` param does partial match on name/symbol — not address lookup. Always returned 0 results for hex addresses.

**Fix applied** (`src/commands/kyberswap/helpers.ts`, `src/tools/kyberswap/evm-utils.ts`):

- **Address path**: Replaced Token API `name` search with on-chain ERC-20 metadata read via viem `readContract()`. New `readErc20Metadata(slug, address)` reads `decimals()` (mandatory), `symbol()` (tolerant), `name()` (tolerant) directly from the contract.
- **Symbol path**: Added whitelisted-first → broader fallback. If `isWhitelisted: true` returns 0 results, retries without `isWhitelisted`. Fixes `axlUSDC` and similar non-whitelisted tokens.
- Same fallback applied to `resolveTokenAddress()`.

**Regression scenario**: `kyberswap.swap.sell({ chain: "polygon", tokenIn: "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed", tokenOut: "USDC" })` — previously threw `Token metadata not found`, now resolves via on-chain read.

---

## Bug 2: Prediction settlement invisible to pipeline (solana.md, section 9.6)

**Status: FIXED**

**Root cause**: Jupiter Prediction and Polymarket settle positions via on-chain keepers, bypassing `execute_tool`. Our capture pipeline never sees the settlement event. Positions remain `open` in `proj_open_positions` forever (zombies).

**Fix applied** (new modules + sync infrastructure):

### New: `prediction-settlement-sync.ts`

Periodic reconciliation job (`reconcilePredictionSettlements()`):

1. Queries open prediction positions from `proj_open_positions`
2. Groups by namespace + wallet (one API call per wallet)
3. Matches against protocol read APIs for settlement events
4. Creates synthetic captures via `synthetic-capture.ts` → standard pipeline → position closed

**Jupiter** — uses `getJupiterPredictionHistory()` + `getJupiterPredictionPositions()`:
- `position_lost` → status `"closed"`, no `outputValueUsd` (payout = $0)
- `position_won + claimed=false` → status `"closed"`, payout in `meta` only (claim pending)
- `position_won + claimed=true` → status `"claimed"`, `outputValueUsd = payoutAmountUsd`

**Polymarket** — uses `getPolyDataClient().getClosedPositions(proxyWallet)`:
- Proxy wallet derived via `getRelayPayload(eoa, "SAFE")` from relayer API
- Status `"closed"`, `meta.realizedPnl` from Data API

### New: `synthetic-capture.ts`

Reusable helper for recording settlement events through the standard capture pipeline:
- Own local validation boundary (type, status, walletAddress, positionKey)
- Uses `extractExternalRefs()` from `capture-pipeline.ts`
- Calls `recordExecution()` + `populateCaptureItems()` directly
- NOT in MUTATION_MATRIX (no phantom entries — capture validator returns `true` for unknown toolIds)

### Infrastructure changes

- `sync/index.ts`: Generalized `syncTick()` — dispatches all `_global` periodic jobs, not just `balances`
- `sync/seed.ts`: New `prediction_settlement` periodic job (5 min interval)
- `sync/worker.ts`: New `prediction_settlement` branch in `drainPendingRuns()`

---

## Agent guardrails: Token verification rule

**Status: IMPLEMENTED**

**Problem**: Agent guessed token addresses from memory/examples instead of resolving via lookup tools. Led to wrong-chain address usage.

**Fix applied**:

### Prompt layer
- `tool-usage.ts`: New "Token Verification Rule" section — resolve via read tool before any mutating tool. Primary resolver: `khalani.tokens.search` (cross-chain). Confirmation: `kyberswap.tokens.search`, `solana.tokens.search`.
- `protocols.ts`: Updated `NAMESPACE_DESCRIPTIONS` with resolver guidance. Updated `NAMESPACE_EXAMPLES` with lookup-first patterns (discover token search before swap/bridge/order/zap).

### Manifest descriptions
- Khalani `quote.get` + `bridge`: "Resolve fromToken/toToken addresses via khalani.tokens.search first."
- KyberSwap `zap.in`, `zap.out`: "Resolve tokenIn/tokenOut address via kyberswap.tokens.search first."
- KyberSwap `limitOrder.activeMakingAmount`: "Resolve makerAsset address via kyberswap.tokens.search first."
- Solana `prices`: Simplified exampleParams to SOL mint only (removed USDC mint example).

### Runtime layer
- KyberSwap zap handlers: Address format validation (`isAddress()` check) before passing to ZaaS API. Fail-loud with resolver guidance on invalid input.

**Limitation**: Prompt rule reduces hallucination but cannot prove address provenance (that it came from a prior read tool call). Full provenance tracking is architectural and out of scope.

---

## Test coverage

| Test file | New/Updated | Cases |
|-----------|-------------|-------|
| `kyberswap-helpers.test.ts` | Updated | Address on-chain read, symbol whitelisted fallback, axlUSDC regression |
| `prediction-settlement-sync.test.ts` | **New** | Jupiter position_lost/won/claimed, Polymarket proxy+close, idempotency, relay failure |
| `seed.test.ts` | Updated | 8 jobs (was 7), prediction_settlement job verification |
| `khalani-manifest.test.ts` | Verified | exampleParams still pass with updated descriptions |
| `kyberswap-manifest.test.ts` | Verified | No regression |
| `capture-contract.test.ts` | Verified | No phantom entries in MUTATION_MATRIX |

**Full suite**: 202 test files, 2847 tests — all pass.

---

## Files changed

| File | Change |
|------|--------|
| `src/tools/kyberswap/evm-utils.ts` | +ERC20 ABI (decimals/symbol/name), +getKyberPublicClient(), +readErc20Metadata() |
| `src/commands/kyberswap/helpers.ts` | Address→on-chain, symbol→whitelisted fallback |
| `src/echo-agent/sync/synthetic-capture.ts` | **New** — validated synthetic execution capture helper |
| `src/echo-agent/sync/prediction-settlement-sync.ts` | **New** — Jupiter + Polymarket settlement reconciliation |
| `src/echo-agent/sync/index.ts` | Generalized syncTick() periodic dispatch |
| `src/echo-agent/sync/seed.ts` | +prediction_settlement periodic job |
| `src/echo-agent/sync/worker.ts` | +prediction_settlement branch |
| `src/echo-agent/tools/protocols/khalani/manifest.ts` | Description: resolver guidance |
| `src/echo-agent/tools/protocols/kyberswap/manifests/zap.ts` | Description: resolver guidance |
| `src/echo-agent/tools/protocols/kyberswap/manifests/limit-order.ts` | Description: resolver guidance |
| `src/echo-agent/tools/protocols/solana-jupiter/manifests/core.ts` | Simplified prices exampleParams |
| `src/echo-agent/engine/prompts/tool-usage.ts` | +Token Verification Rule |
| `src/echo-agent/engine/prompts/protocols.ts` | Updated NAMESPACE_EXAMPLES + NAMESPACE_DESCRIPTIONS |
| `src/echo-agent/tools/protocols/kyberswap/handlers.ts` | +Address validation in zap handlers |
| `src/echo-agent/sync/SYNC.md` | +Settlement sync docs |
| `src/echo-agent/tools/TOOLS.md` | +Token verification policy |
| `src/echo-agent/engine/ENGINE.md` | +Prompt layer update note |
