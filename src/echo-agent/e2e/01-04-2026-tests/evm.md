# EVM E2E Test Report — April 2, 2026

> Real-money tests on EVM chains via MCP E2E harness.
> EVM Wallet: `0x18b467Cb28FC07Ca6E17A964b3319051B3072B79`
> Solana Wallet: `GoVYsnzegMxCmco53bMBb1k3tsCkdEa8PCfh1PFa11E5`
> DB: Docker Postgres on port 5555 (tmpfs, ephemeral)

---

## 1. Khalani Bridge — Optimism USDC to Polygon POL

### 1.1 Quote

**Result: PASS**

| Route | Type | amountIn | amountOut | ETA |
|-------|------|----------|-----------|-----|
| Hyperstream | native-filler | 1000000 | ~10.76 POL | 10s |
| Across | external-intent-router | 1000000 | ~10.94 POL | 2s |

Khalani returned 2 routes for Optimism USDC to Polygon native POL. Best route: Across (higher amountOut, faster).

Note: Khalani does NOT route from Solana outbound — 0 routes for Solana to any EVM chain (tested Optimism, Base, Arbitrum, Polygon, Ethereum, BSC). Only EVM to EVM supported.

### 1.2 Bridge Execute

**Result: PASS**

- **Tx (deposit)**: `0xb5c2489f2f356a5427ff26e1fefd97158d87b845ef5e35d442e639d17a2736bf` (Optimism)
- **Tx (fill)**: `0xa5811e35f7af2441632da835bc38817aa98771a64cfbdadca80b730e55c1c8b8` (Polygon)
- **Order**: `cmnhc34vi0000psp7hy2vk5v3`
- **Input**: 9.896308 USDC (Optimism)
- **Output**: ~108.89 POL (Polygon)
- **Route**: Across (2s ETA)
- **Steps**: created -> deposited -> published -> filled (~10s total)

### 1.3 Pipeline verification

| Table | Field | Value | Status |
|-------|-------|-------|--------|
| `proj_activity` | `type` | `bridge` | PASS |
| | `product_type` | `bridge` | PASS |
| | `namespace` | `khalani` | PASS |
| | `chain` | `10` (Optimism, source) | PASS |
| | `inputValueUsd` | `null` | see note |
| | `outputValueUsd` | `null` | see note |
| | `captureStatus` | `pending` | PASS |
| `bridges` view | count | 1 | PASS |

**Note**: Bridge has no USD valuation — this is by design. Bridges are transfers, not trades. `captureStatus: pending` because bridge is async (deposit sent, fill arrives later). No position/lot opened — correct for audit-only flow.

---

## 2. KyberSwap Swap — POL to USDC (Polygon)

### 2.1 Swap Execute (50% POL to USDC)

**Result: PASS (with routing surprise)**

- **Tx**: `0x875c0fa09b948bb7011d2842743d0414401c0987a4672a43baad176cd884af99` (Polygon)
- **Input**: 54.44 POL ($4.94)
- **Output**: 4.940354 axlUSDC ($4.94)
- **Spread**: ~$0.0005

KyberSwap routed to **axlUSDC** (Axelar Wrapped USDC, `0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed`) instead of native USDC (`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`). Better pricing on that pair at the time.

### 2.2 Pipeline verification

| Table | Field | Value | Status |
|-------|-------|-------|--------|
| `proj_activity` | `type` | `swap` | PASS |
| | `product_type` | `spot` | PASS |
| | `trade_side` | `sell` | PASS |
| | `inputValueUsd` | $4.94 | PASS |
| | `outputValueUsd` | $4.94 | PASS |
| | `valuationSource` | `kyberswap_exact` | PASS |
| | `captureStatus` | `executed` | PASS |

### 2.3 Swap axlUSDC to USDC

**Result: FAIL — BUG in token resolution (Bug 1)**

Attempted swap of axlUSDC to native USDC. Handler rejected with:

```
Token metadata for "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed" not found on chain 137
```

Also tried by symbol:

```
Token "axlUSDC" not found on chain 137
```

See Bug 1 in section 4 for full analysis.

---

## 3. DB State After Tests

### 3.1 Activity (2 records)

| # | Type | Namespace | Details | Valuation | Status |
|---|------|-----------|---------|-----------|--------|
| 1 | bridge | khalani | 9.9 USDC (OP) -> 108.89 POL (Polygon) | null/null | `pending` |
| 2 | swap | kyberswap | 54.44 POL -> 4.94 axlUSDC (Polygon) | $4.94/$4.94 | `executed` |

### 3.2 Executions (5 total)

| id | toolId | success | notes |
|----|--------|---------|-------|
| 1 | khalani.bridge | false | Validation failed (Solana source — not supported) |
| 2 | khalani.bridge | false | Validation failed (wrong params) |
| 3 | khalani.bridge | true | Optimism -> Polygon, 5935ms |
| 4 | kyberswap.swap.sell | false | Token metadata not found (Bug 1) |
| 5 | kyberswap.swap.sell | true | POL -> axlUSDC, 9384ms |

### 3.3 Positions/Lots

None — correct. Bridge = audit-only, swap sell without prior lot = no matching.

### 3.4 Wallet Balances (Polygon, post-test)

| Token | Balance | USD |
|-------|---------|-----|
| POL | ~54.41 | ~$4.94 |
| axlUSDC | ~4.94 | ~$4.94 |

---

## 4. Bugs Found

### Bug 1: KyberSwap `resolveTokenMetadata` fails for contract address input

**Severity: Medium** — blocks any swap where tokenIn/tokenOut is specified by contract address for non-mainstream tokens.

**Reproduction:**

```
kyberswap.swap.sell({
  chain: "polygon",
  tokenIn: "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed",  // axlUSDC address
  tokenOut: "USDC",
  amountIn: "4.940354"
})
-> Error: Token metadata for "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed" not found on chain 137

kyberswap.swap.sell({
  chain: "polygon",
  tokenIn: "axlUSDC",  // by symbol
  tokenOut: "USDC",
  amountIn: "4.940354"
})
-> Error: Token "axlUSDC" not found on chain 137
```

**Root cause analysis:**

File: `src/commands/kyberswap/helpers.ts`, function `resolveTokenMetadata()` (line 96-155).

**Path 1 — Address input (lines 112-131):**

When the input is a valid hex address (`isAddress(input) === true`), the function calls:

```typescript
const tokens = await client.searchTokens(String(chainId), {
  name: address,   // BUG: passes "0x750e4C..." as the `name` query parameter
  pageSize: 20,
});
```

This calls the KyberSwap Token API endpoint `GET /api/v1/public/tokens?chainIds=137&name=0x750e4C...`.

The `name` parameter performs **case-insensitive partial match on token name and symbol** — it is designed for queries like `name=USDC` or `name=wrapped`. A hex address string will never match any token name or symbol. The API returns 0 results, `pickBestTokenMatch` returns null, and the function throws `KYBER_TOKEN_NOT_FOUND`.

**Path 2 — Symbol input (lines 134-154):**

When input is `"axlUSDC"`, the function searches with `isWhitelisted: true`:

```typescript
const tokens = await client.searchTokens(String(chainId), {
  name: input,          // "axlUSDC"
  isWhitelisted: true,  // only whitelisted tokens
  pageSize: 10,
});
```

The KyberSwap Token API `name` parameter does partial match against the token's **name** field ("Axelar Wrapped USDC"), not the symbol field. The query `name=axlUSDC` likely doesn't partial-match "Axelar Wrapped USDC" well enough, so the API returns 0 results.

Ironically, `kyberswap.tokens.search` tool (which calls the same API endpoint via our handler in `echo-agent/tools/protocols/kyberswap/handlers.ts`) DOES find axlUSDC when queried with `"axelar"` — because "axelar" partial-matches "Axelar Wrapped USDC". But the swap handler uses the raw symbol `"axlUSDC"` which doesn't match the name.

**Evidence from KyberSwap official documentation:**

Source: [KyberSwap LLM Documentation (llms.txt)](https://1368568567-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2Fw1XgQJc40kVeGUIxgI7c%2Fuploads%2F41EkzAy0viNKsn6feMY0%2Fllms.txt?alt=media&token=d6ee8c76-d5a6-42e7-9f05-2a2bc891d5ad)

The Token API documentation states:

- **Endpoint**: `GET /api/v1/public/tokens`
- **`name` parameter**: "Search by name/symbol, case-insensitive partial match"
- **There is NO `address` or `addresses` query parameter** for this endpoint
- The only endpoint that accepts a token contract address is `GET /api/v1/public/tokens/honeypot-fot-info` (safety check only, not metadata)
- Results are "sorted by marketCap"

The API was **never designed** to look up tokens by contract address via the `name` field. Our code incorrectly assumes it can.

**Affected code path:**

```
kyberswap.swap.sell / kyberswap.swap.buy (protocol handler)
  -> resolveTokenMetadata (commands/kyberswap/helpers.ts:96)
    -> client.searchTokens(chainId, { name: hexAddress })
    -> API returns 0 results (hex address != token name)
    -> throws KYBER_TOKEN_NOT_FOUND
```

**Impact:**

- Any swap where tokenIn or tokenOut is a contract address for a non-mainstream token fails
- Symbol lookup fails for tokens where the symbol doesn't partial-match the `name` field (e.g. `axlUSDC` vs name "Axelar Wrapped USDC")
- Mainstream tokens like `USDC`, `ETH`, `POL` work because their symbols DO partial-match their names
- This creates an asymmetry: KyberSwap can *route through* these tokens (aggregator works by address) but our handler can't *initiate* a swap with them (metadata resolution fails)

**Workaround (for users):**

- Use well-known token symbols (`USDC`, `POL`, `ETH`) instead of addresses
- For niche tokens with no symbol match — currently no workaround

---

## 5. Observations

### 5.1 Khalani Solana Outbound Not Supported

Khalani bridge returns 0 routes for any Solana source chain. Tested destinations: Ethereum, Optimism, Base, Arbitrum, Polygon, BSC. All returned `routeCount: 0`. Only EVM-to-EVM routing works. This is a Khalani limitation, not our bug.

### 5.2 KyberSwap Route Selection Surprises

KyberSwap may route to wrapped/bridged token variants (axlUSDC instead of native USDC) for better pricing. This is correct aggregator behavior but can leave users holding unexpected token variants that are then hard to swap out (due to Bug 1).

### 5.3 Bridge Valuation Gap

Khalani bridge captures have `inputValueUsd: null` / `outputValueUsd: null`. By design (bridges are transfers, not trades). But means portfolio summary doesn't reflect USD value of bridge operations.

---

## 6. Summary

| # | Test | Result |
|---|------|--------|
| 1 | Khalani quote (OP -> Polygon) | PASS |
| 2 | Khalani bridge execute | PASS |
| 3 | Bridge pipeline capture | PASS |
| 4 | KyberSwap swap POL -> USDC | PASS |
| 5 | Swap pipeline capture | PASS |
| 6 | Swap axlUSDC -> USDC (by address) | FAIL (Bug 1) |
| 7 | Swap axlUSDC -> USDC (by symbol) | FAIL (Bug 1) |

**5/7 PASS, 2 FAIL (same root cause — KyberSwap token resolution bug).**
