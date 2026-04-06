# KyberSwap ZaaS Zap E2E Test Report — April 3, 2026

> LP lifecycle test on Polygon mainnet via MCP E2E harness.
> Wallet: `0x18b467Cb28FC07Ca6E17A964b3319051B3072B79`
> DB: Docker Postgres (pgvector) on port 5777 (tmpfs, ephemeral); embeddings via Docker Model Runner on port 12434
> Session: `manual-2026-04-03-evm`

---

## Test Environment

- **MCP Server**: `pnpm exec tsx src/echo-agent/e2e/mcp/server.ts` (pre-audit code — LP hashes not in replay)
- **DB**: PostgreSQL 16.11, ephemeral (tmpfs)
- **Migrations**: 001-005 (incl. 005_lp_economics)
- **Code version**: `d6645fa` (audit follow-up)
- **Funds**: ~51.6 POL ($4.80), 3.13 USDC on Polygon; 0.0005 ETH on Optimism

---

## 1. Pool Selection

**Source**: DexScreener search `USDC POL polygon`

**Selected pool**: Uniswap V3 USDC/WPOL on Polygon
- **Address**: `0xB6e57ed85c4c9dbfEF2a68711e9d6f36c56e0FcB`
- **Liquidity**: $246k
- **24h Volume**: $357k
- **DEX ID**: `DEX_UNISWAPV3`

**ZaaS catalog**: Polygon has 10 DEXes in curated catalog (verified). UniswapV3 confirmed.

---

## 2. Zap.in — dryRun Preview

**Result: PASS**

```
initialAmountUsd: "1.00020006"
finalAmountUsd:   "0.99997793"
priceImpact:      0.022%
```

ZaaS route:
1. Protocol fee: $0.001 (0.1% PCM)
2. Pool swap: $0.50 USDC → 5.38 WPOL
3. Add liquidity: 5.38 WPOL + $0.50 USDC → full-range position

Tick range: -887220 to 887220 (full range, safe for test).

---

## 3. Zap.in — Live Execution

**Result: TX SUCCESS / PIPELINE PARTIAL FAILURE**

- **Tx**: [`0x864a7d2...9171`](https://polygonscan.com/tx/0x864a7d240d3fa17d23cd22a50e7871c9ec7d233c9c95bb67ab066d1d149c9171)
- **NFT minted**: Token ID `2880191` (Uniswap V3 Positions NFT, confirmed via Polygonscan)
- **On-chain**: SUCCESS — LP position created, USDC deducted

**Pipeline capture**:
- `protocol_executions`: Row captured, `success: true`
- `_tradeCapture.type`: `"lp"`, `chain: "polygon"`, `instrumentKey: "polygon:lp:0xB6e57ed...0FcB"`

### FINDING 1: `positionKey` missing from capture

`extractMintedNftId()` returned `undefined`. The function searches for ERC-721 Transfer with `from=0x0` (mint) to our wallet. But on ZaaS zap.in, the flow is:

1. Uniswap V3 Position Manager mints NFT → **ZaaS router** (not our wallet)
2. ZaaS router transfers NFT → our wallet

So the mint event has `to=router`, not `to=wallet`. Our function only matches `from=0x0 AND to=wallet`, missing the intermediary pattern.

**Impact**: Without `positionKey`, position projector does `if (!positionKey) return;` → skip. No row in `proj_open_positions`, no LP economics recorded. The execution is captured in audit trail but projection pipeline is broken for LP.

**Fix needed**: `extractMintedNftId()` should also check for non-mint Transfer events (from=router, to=wallet) as fallback, or parse `IncreaseLiquidity` event from Position Manager which contains the tokenId directly.

### FINDING 2: `zapDetails` missing from capture meta

The `_tradeCapture.meta` only contains `{ dex, pool, action: "zap-in" }` — no `zapDetails`, no `positionId`, no `inputValueUsd`. This means even if positionKey was present, LP economics (`recordLpEconomics`) would have no legs to extract.

**Root cause**: Likely `zapDetails` was `undefined` in the route response for the live (non-dryRun) path, or was lost during capture serialization.

---

## 4. Zap.out — Live Execution

**Result: REVERTED**

```
ERC721: transfer caller is not owner nor approved
```

### FINDING 3: Zap.out missing ERC-721 approve

The zap.out handler calls `ensureKyberAllowance()` for ERC-20 tokens only. For zap.out, the ZaaS router needs to transfer/burn the LP NFT, which requires either:
- `approve(routerAddress, tokenId)` on Uniswap V3 Position Manager
- `setApprovalForAll(routerAddress, true)` on Position Manager

Neither is done in the handler. The `ensureKyberAllowance()` utility only handles ERC-20 `approve()`.

**Fix needed**: Add ERC-721 `approve(router, positionId)` call before `buildZapOut()` in the zap.out handler. The Position Manager address on Polygon is `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`.

---

## 5. Summary of Findings

| # | Severity | Finding | Impact | Fix | Status |
|---|----------|---------|--------|-----|--------|
| 1 | **High** | `extractMintedNftId` misses router-intermediated mints | LP positions not tracked in proj_open_positions | Added pass 2 (router→wallet) + `expectedContract` filter | **FIXED** (commit pending) |
| 2 | **Medium** | `zapDetails` missing from live capture meta | LP economics (legs, valuation) not recorded | `zapDetails` now included in capture meta; `ZapRouteResponse` extended with `poolDetails`/`positionDetails` | **FIXED** (commit pending) |
| 3 | **High** | zap.out missing ERC-721 approve to router | zap.out always reverts — LP positions can't be closed via agent | Family-aware approval via `resolveZapApprovalTarget()` — ERC-721/ERC-20/ERC-1155 per `approvalStandard` + `approvalTargetKind` | **FIXED** (commit pending) |

### Missing Tooling Identified

| Tool | Purpose | Status |
|------|---------|--------|
| **erc721_balance** | List ERC-721 NFTs owned by wallet on any contract — generic, works across DEXes (Uniswap, QuickSwap, SushiSwap, etc.) | NOT IMPLEMENTED — add as `evm_read` action: `balanceOf(owner)` + `tokenOfOwnerByIndex(owner, i)` for Enumerable contracts. Khalani only returns fungible tokens. |
| **evm_read in E2E MCP** | On-chain reads (tx_receipt, erc721_mint) | EXISTS in code but MCP server was running pre-commit code. After restart would work. |

---

## 6. DB State (post-test)

```
protocol_executions:    12 (9 solana + 2 kyberswap zap + 1 dexscreener)
  - kyberswap.zap.in:   success=true, positionKey=null (FINDING 1)
  - kyberswap.zap.out:  success=false (ERC721 revert, FINDING 3)
proj_open_positions:    1  (solana prediction only, no LP — FINDING 1)
proj_lp_events:         0  (no LP economics recorded — FINDING 1+2)
proj_lp_event_legs:     0
```

---

## 7. On-chain State (outside pipeline)

- **LP Position NFT #2880191** exists on Polygon, owned by `0x18b467Cb28FC07Ca6E17A964b3319051B3072B79`
- Full-range USDC/WPOL position on Uniswap V3
- Position is live and earning fees, but not tracked in our DB
- To exit: manual approve + zap.out, or direct interaction with Position Manager
