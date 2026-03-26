# Solana Module Map — Portfolio Data Sources & Transaction History

This document maps every `.ts` file in `src/tools/chains/solana/` to the data it provides for wallet portfolio tracking, transaction history, and UI/UX.

---

## Transaction History Sources (by domain)

### Spot (Swaps & Transfers)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `jupiter-client.ts` | `jupiterGetSpotHistory(params)` | Swap trades: buy/sell type, USD volume, profit, cost, price, amount, txHash, blockTime | `GET /_datapi/v1/txs/users` |
| `swap-service.ts` | `executeSwap()` | Single swap result: signature, explorerUrl, inputAmount, outputAmount | Ultra `/order` + `/execute` |
| `transfer-service.ts` | `sendSol()` / `sendSplToken()` | Transfer result: signature, explorerUrl | RPC `sendRawTransaction` |
| `send-service.ts` | `craftSend()` | Send-invite result: inviteCode, signature, explorerUrl | `POST /send/v1/craft-send` |
| `send-service.ts` | `craftClawback()` | Clawback result: signature, explorerUrl | `POST /send/v1/craft-clawback` |

**Preview before execution**: `getSwapQuote()` from `swap-service.ts` — returns quote without executing (input/output amounts, price impact, route, slippage). Essential for confirmation UI.

**Best for UI history tab**: `jupiterGetSpotHistory` — paginated, filterable by token/date, includes P&L per trade. Double-bookkeeping entries grouped by txHash.

### Perps (Leveraged Trading)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `perps-client.ts` | `perpsGetTrades(params)` | Trade history: action (Increase/Decrease), side (long/short), price, size, PnL, pnlPercentage, fee, txHash, createdTime | `GET perps-api.jup.ag/v2/trades` |
| `perps-service.ts` | `openPerpsPosition()` | Open result: positionPubkey, signature, type (market/limit), quote | `POST /positions/increase` |
| `perps-service.ts` | `closePerpsPosition()` | Close result: signature, quote (PnL, fees, received) | `POST /positions/decrease` |
| `perps-service.ts` | `closeAllPerpsPositions()` | Batch close: array of signatures | `POST /positions/close-all` |

**Best for UI history tab**: `perpsGetTrades` — filterable by asset/side/action/date, includes realized PnL per trade.

### Predictions (Binary Markets)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `prediction-service.ts` | `getPredictHistory(address, opts)` | History: eventType, side (yes/no), action (buy/sell), contracts, avgPriceUsd, realizedPnl, signature | `GET /prediction/v1/history` |
| `prediction-service.ts` | `createPredictOrder()` | Order result: signature, positionPubkey | `POST /prediction/v1/orders` |
| `prediction-service.ts` | `claimPosition()` | Claim result: signature, explorerUrl | `POST /positions/{pubkey}/claim` |
| `prediction-service.ts` | `closePosition()` | Close result: signature, explorerUrl | `DELETE /positions/{pubkey}` |

**Single lookups**: `getPosition(pubkey)` — single position detail. `getEvent(eventId)` — single event with markets. `searchEvents(query)` — keyword search.

**Best for UI history tab**: `getPredictHistory` — paginated, includes event types (order_filled, position_lost, payout_claimed).

### DCA & Limit Orders

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `order-service.ts` | `createDcaOrder()` | DCA created: orderKey, signature | `POST /recurring/v1/createOrder` |
| `order-service.ts` | `cancelDcaOrder()` | DCA cancelled: signature | `POST /recurring/v1/cancelOrder` |
| `order-service.ts` | `createLimitOrder()` | Limit created: orderKey, signature | `POST /trigger/v1/createOrder` |
| `order-service.ts` | `cancelLimitOrder()` | Limit cancelled: signature | `POST /trigger/v1/cancelOrder` |

**Note**: No dedicated history endpoint for DCA/limit — individual transaction signatures can be tracked via Solana explorer.

### Staking

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `stake-service.ts` | `createAndDelegateStake()` | Stake created: stakeAccount, signature, explorerUrl | RPC (StakeProgram) |
| `stake-service.ts` | `withdrawStake()` | Withdraw: signature, explorerUrl | RPC (StakeProgram) |
| `stake-service.ts` | `claimMev()` | MEV claimed: array of {stakeAccount, claimedSol, signature} | RPC (StakeProgram) |

### Lending

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `lend-service.ts` | `lendDeposit()` | Deposit: signature, explorerUrl | `POST /lend/v1/earn/deposit` |
| `lend-service.ts` | `lendWithdraw()` | Withdraw: signature, explorerUrl | `POST /lend/v1/earn/withdraw` |

### Studio (Token Creation)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `studio-service.ts` | `studioCreateToken()` | Token created: mint, signature, explorerUrl | `POST /studio/v1/dbc-pool/create-tx` |
| `studio-service.ts` | `studioClaimFees()` | Fees claimed: signature, explorerUrl | `POST /studio/v1/dbc/fee/create-tx` |

### Account Management

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `account-service.ts` | `burnSplToken()` | Burn: signature, explorerUrl | RPC (createBurnInstruction) |
| `account-service.ts` | `closeEmptyAccounts()` | Closed: count, rentReclaimedSol, signatures | RPC (createCloseAccountInstruction) |

---

## Portfolio Balance Sources

### Token Holdings

| Source | Function | What it returns |
|--------|----------|-----------------|
| `jupiter-client.ts` | `jupiterHoldings(address)` | SOL native balance + all SPL token accounts with amounts, decimals, frozen status, ATA flag |
| `jupiter-client.ts` | `jupiterGetPrices(mints)` | Real-time USD price per token mint |
| `jupiter-client.ts` | `jupiterShield(mints)` | Security warnings per token (severity: info/warning/critical) |
| `jupiter-client.ts` | `jupiterSearchTokens(query)` | Token metadata: name, symbol, icon, decimals, tags |

**Token resolution**: `resolveToken(symbolOrMint)` from `token-registry.ts` — resolves symbol or mint → full metadata (chain: well-known → file cache → Jupiter API). `resolveTokens(queries)` for batch.

**Portfolio value**: `jupiterHoldings(address)` → extract mints → `jupiterGetPrices(mints)` → multiply balances × prices.

### Open Positions (Locked Value)

| Domain | Source | Function | Data |
|--------|--------|----------|------|
| **Perps** | `perps-client.ts` | `perpsGetPositions(wallet)` | Open leveraged positions: side, leverage, sizeUsd, entryPrice, markPrice, PnL, liquidationPrice, TP/SL |
| **Perps** | `perps-client.ts` | (included above) | Pending limit orders: side, sizeUsd, triggerPrice |
| **Predictions** | `prediction-service.ts` | `getPositions(address)` | YES/NO contracts: contracts count, totalCostUsd, valueUsd, pnlUsd, claimable flag |
| **Lending** | `lend-service.ts` | `getLendPositions(address)` | Deposited tokens: shares, underlyingAssets, underlyingBalance |
| **Lending** | `lend-service.ts` | `getLendEarnings(address, positions)` | Accrued earnings per position |
| **DCA** | `order-service.ts` | `listDcaOrders(wallet)` | Active DCA orders: inAmountPerCycle, inDeposited, inUsed, outReceived |
| **Limits** | `order-service.ts` | `listLimitOrders(wallet)` | Pending trigger orders: makingAmount, takingAmount, remainingAmounts, status |
| **Staking** | `stake-service.ts` | `getStakeAccounts(wallet)` | Staked SOL: balance, status, validator, claimable MEV tips |
| **Invites** | `send-service.ts` | `getPendingInvites(address)` | Tokens locked in unclaimed send invites |
| **Studio** | `studio-service.ts` | `studioGetFees(mint)` | Unclaimed DBC trading fees (for token creators). Uses `studioGetPoolAddress(mint)` internally to resolve mint → pool address |

### Market Data

| Domain | Source | Function | Data |
|--------|--------|----------|------|
| **Perps** | `perps-client.ts` | `perpsGetMarkets()` | SOL/BTC/ETH: price, 24h change, high/low, volume |
| **Tokens** | `jupiter-client.ts` | `jupiterGetTrendingTokens()` | Trending tokens with price, volume, buy/sell stats |
| **Lending** | `lend-service.ts` | `getLendRates()` | APY per token (supply + rewards), TVL, total supply |
| **Predictions** | `prediction-service.ts` | `listEvents()` / `getMarket()` | Events with YES/NO prices, volume, status |

---

---

## Value Formats & Decimals per Protocol

Understanding what format each API returns is critical for UI display. Some return atomic (raw on-chain integers), some return human-readable, some return USD strings.

### Swap (Ultra API)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `order.inAmount` / `order.outAmount` | **Atomic** (string) | `"1000000000"` = 1 SOL | Divide by `10^decimals` → `tokenAmountToUi()` |
| `order.priceImpactPct` | **Already %** (string) | `"0.01"` = 0.01% | Display as-is, do NOT multiply by 100 |
| `order.slippageBps` | **Basis points** (number) | `50` = 0.5% | Divide by 100 for % |
| `execute.inputAmountResult` / `outputAmountResult` | **Atomic** (string) | Same as above | `tokenAmountToUi()` |

### Perps API (`perps-api.jup.ag/v2`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `position.sizeUsd` | **USD string** | `"10.98"` | Parse to number, display as `$10.98` |
| `position.entryPriceUsd` / `markPriceUsd` | **USD string** | `"86.74"` | Display as `$86.74` |
| `position.leverage` | **String** | `"1.09"` | Display as `1.09x` |
| `position.pnlAfterFeesUsd` | **USD string** | `"-0.29"` | Display as `−$0.29` |
| `position.pnlAfterFeesPct` | **% string** | `"-0.29"` = -0.29% | Display as-is with % |
| `trade.price` / `trade.size` / `trade.fee` | **USD string** | `"86.74"` | Parse to number |
| `trade.pnl` | **USD string or null** | `"5.00"` or `null` | null = open (no realized PnL yet) |
| `market.price` / `volume` | **USD string** | `"86.74"` | Parse to number |
| Collateral `inputTokenAmount` | **Atomic** (string) | `"10000000"` = 10 USDC | Based on input token decimals |

### Predictions API (`/prediction/v1`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `market.pricing.buyYesPriceUsd` | **Micro-USD** (number) | `650000` = $0.65 | Jupiter CLI divides by 1,000,000 |
| `market.pricing.volume` | **Micro-USD** (number) | `50000000000` = $50,000 | Divide by 1,000,000 |
| `position.totalCostUsd` / `valueUsd` / `pnlUsd` | **Micro-USD** (number) | `6500000` = $6.50 | Divide by 1,000,000 |
| `position.contracts` | **Integer** (number or string) | `10` | Display as-is |
| `depositAmount` (input to create order) | **Micro-USD** (integer) | `10000000` = $10 USDC | `amountUsdc * 1_000_000` |
| `history.avgFillPriceUsd` | **Micro-USD** (string) | `"650000"` = $0.65 | Parse then ÷ 1,000,000 |
| `history.realizedPnl` | **Micro-USD or null** (string) | `"500000"` = $0.50 | null = no realized PnL |

**VERIFIED from OpenAPI YAML**: Position fields (`totalCostUsd`, `valueUsd`, `pnlUsd`, `avgFillPriceUsd`) are explicitly documented as "micro USD (u128 as string)" — divide by 1,000,000. Pricing fields (`buyYesPriceUsd`, `buyNoPriceUsd`) lack explicit unit docs in YAML but Jupiter CLI treats them as micro-USD via `NumberConverter.fromMicroUsd()`. Our `prediction-service.ts` currently passes through raw values without converting — UI must handle this conversion.

**VERIFIED from OpenAPI YAML**: Perps REST API (`perps-api.jup.ag/v2`) returns **already-converted USD strings** (not atomic, not micro-USD). Jupiter CLI parses them as `Number(position.sizeUsd)` without any division. This is different from on-chain program accounts which use atomic USDC (6 decimals).

### DCA / Recurring API (`/recurring/v1`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `inAmount` (create param) | **Atomic** (integer) | `50000000` = 50 USDC (6 dec) | Total deposit, per-cycle = inAmount / numberOfOrders |
| `order.inAmountPerCycle` | **Atomic** (string) | `"10000000"` = 10 USDC | Divide by `10^inputDecimals` |
| `order.inDeposited` / `inUsed` / `outReceived` | **Atomic** (string) | `"50000000"` | Divide by respective token decimals |
| `interval` | **Seconds** (integer) | `86400` = 1 day | Map: 60=min, 3600=hr, 86400=day, 604800=wk, 2592000=mo |

### Limit Orders / Trigger V1 (`/trigger/v1`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `params.makingAmount` / `takingAmount` | **Atomic** (string) | `"100000000"` = 100 USDC | Divide by `10^decimals` |
| `order.remainingMakingAmount` | **Atomic** (string) | `"50000000"` | Divide by `10^inputDecimals` |

### Lend Earn (`/lend/v1/earn`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `token.supplyRate` / `rewardsRate` / `totalRate` | **Fractional** (string or number) | `"0.045"` = 4.5% APY | Multiply by 100 for % display |
| `token.totalAssets` / `totalSupply` | **Atomic** (string) | `"1000000000"` | Divide by `10^token.decimals` |
| `position.shares` / `underlyingAssets` | **Atomic** (string) | `"500000"` | Divide by `10^token.decimals` |
| `earnings` | **Atomic** (number) | `24800` | Divide by `10^token.asset.decimals` |

### Staking (native `@solana/web3.js`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| All SOL amounts | **Already converted to SOL** (number) | `1.5` | Display as-is (`lamportsToSol` already applied) |
| `claimableMevSol` | **SOL** (number) | `0.002` | Display as-is |

### Send (Jupiter Send)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `amount` (API param) | **Atomic** (string) | `"1000000000"` = 1 SOL | Our code converts UI→atomic before sending |
| `invite.amount` | **Atomic** (string) | `"1000000000"` | Divide by token decimals |

### Holdings (Ultra API)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `holdings.amount` | **Lamports** (string) | `"1500000000"` = 1.5 SOL | Divide by 10^9 |
| `holdings.uiAmount` | **SOL** (number) | `1.5` | Display as-is |
| `token.amount` | **Atomic** (string) | `"100000000"` | Divide by `token.decimals` |
| `token.uiAmount` | **Human-readable** (number) | `100.0` | Display as-is |

### Price API (`/price/v3`)

| Field | Format | Example | To display |
|-------|--------|---------|------------|
| `price` | **USD string** | `"150.25"` | Parse to number, display as `$150.25` |

### Well-Known Token Decimals (from `constants.ts`)

| Token | Decimals | 1 unit in atomic |
|-------|----------|-----------------|
| SOL | 9 | 1,000,000,000 |
| USDC | 6 | 1,000,000 |
| USDT | 6 | 1,000,000 |
| JUP | 6 | 1,000,000 |
| BONK | 5 | 100,000 |
| mSOL / jitoSOL / bSOL / JTO | 9 | 1,000,000,000 |
| ETH / wBTC / RNDR | 8 | 100,000,000 |
| PYTH | 6 | 1,000,000 |
| WEN | 5 | 100,000 |
| JLP | 6 | 1,000,000 |

### How to get decimals for ANY token

Decimals are NOT hardcoded — they are dynamic per token. Only 15 well-known tokens have hardcoded decimals in `constants.ts`. For all others, decimals come from the API response itself.

**Where each protocol provides decimals:**

| Protocol | Where decimals come from | Field |
|----------|------------------------|-------|
| **Holdings** (Ultra API) | Each token account in response | `token[mint][].decimals` (number) |
| **Token search** (Tokens V2) | Search result | `token.decimals` (number) |
| **Token resolve** (token-registry.ts) | `resolveToken(symbol)` returns full metadata | `TokenMetadata.decimals` |
| **Lend Earn** | Token list response | `LendToken.decimals` (jlToken decimals), `LendToken.asset.decimals` (underlying) — these can differ |
| **DCA orders** | NOT in order response — must resolve via `resolveToken(inputMint)` | Need separate lookup |
| **Limit orders** | NOT in order response — must resolve via `resolveToken(inputMint)` | Need separate lookup |
| **Perps** | Hardcoded in `PERPS_ASSETS` — only SOL(9), BTC(8), ETH(8), USDC(6) | `perps-client.ts` constant |
| **Predictions** | All values in micro-USD (fixed 6 decimals, ÷1,000,000) | No token decimals needed |
| **Staking** | Always SOL (9 decimals, already converted to SOL in service) | No conversion needed |
| **Send** | Resolved via `resolveToken(mint)` before API call | `TokenMetadata.decimals` |

**Resolution chain for unknown tokens** (`token-registry.ts`):
1. Check `constants.ts` well-known list (instant, offline) — 15 tokens
2. Check file cache `~/.config/echoclaw/solana-token-cache.json` (24h TTL)
3. Call Jupiter Token API `GET /tokens/v2/search?query=` — returns `decimals` in response
4. If all fail → `undefined` (token not found)

**Critical rule**: Never assume decimals. Always resolve first, then convert. The only safe hardcoded values are in `constants.ts` and `PERPS_ASSETS`.

### Conversion helpers (from `validation.ts`)

| Function | Purpose |
|----------|---------|
| `tokenAmountToUi(rawAmount, decimals)` | Atomic → human: `Number(BigInt(raw)) / 10^decimals` |
| `uiToTokenAmount(uiAmount, decimals)` | Human → atomic: `BigInt(Math.round(ui * 10^decimals))` |
| `lamportsToSol(lamports)` | Lamports → SOL: `Number(lamports) / LAMPORTS_PER_SOL` |
| `solToLamports(sol)` | SOL → lamports: `BigInt(Math.round(sol * LAMPORTS_PER_SOL))` |

---

## API Key Requirements

Jupiter API key (`echoclaw config set-jupiter-key <key>`, free from [portal.jup.ag](https://portal.jup.ag)).

| Feature | Without key (`lite-api.jup.ag`) | With key (`api.jup.ag`) |
|---------|-------------------------------|------------------------|
| **Swap** (Ultra order/execute) | Works (lower rate limits) | Works (higher rate limits) |
| **Token search/trending/price** | Works | Works |
| **Holdings / Shield** | Works | Works |
| **DCA** (Recurring API) | Works | Works |
| **Limit orders** (Trigger V1) | Works | Works |
| **Lend Earn** (deposit/withdraw/rates/positions/earnings) | Works | Works |
| **Predictions** (events/orders/positions/history) | Works | Works |
| **Send** (invite/clawback) | Works | Works |
| **Spot history** (Datapi) | Works | Works |
| **Perps** (`perps-api.jup.ag/v2`) | Works (separate host, key passed but not required) | Works |
| **Studio** (token creation, fees, claim) | **BLOCKED — returns 404** | **Required** |

**Summary**: Only Studio requires a key. Everything else works on `lite-api.jup.ag` without a key. With a key, all requests go to `api.jup.ag` which has higher rate limits (free tier: 60 req/min).

---

## Utility Files (no portfolio data)

| File | Role |
|------|------|
| `connection.ts` | Solana RPC connection singleton (lazy-init from config) |
| `constants.ts` | Well-known token mints: SOL, USDC, USDT, JUP, BONK, mSOL, jitoSOL, bSOL, ETH, wBTC, PYTH, JTO, WEN, RNDR, JLP |
| `token-registry.ts` | Token resolution chain: well-known → file cache → Jupiter Token API v2 |
| `token-cache.ts` | File-based token metadata cache with 24h TTL, atomic writes |
| `validation.ts` | Address validation, amount parsing (SOL/SPL), explorer URL builder, address shortener |
| `tx.ts` | Transaction primitives: deserialize, sign (multi-signer), send, confirm with polling, retry logic |

---

## UI/UX Dashboard Recipe

```
1. WALLET OVERVIEW
   jupiterHoldings(address) + jupiterGetPrices(mints)
   → token list sorted by USD value
   → jupiterShield(mints) for risk badges

2. OPEN POSITIONS panel
   perpsGetPositions(wallet)     → leveraged trades with live PnL
   getPositions(address)         → prediction contracts with PnL
   getLendPositions(address)     → lending deposits
   getLendEarnings(address, pos) → accrued interest
   listDcaOrders(wallet)         → active DCA schedules
   listLimitOrders(wallet)       → pending trigger orders
   getStakeAccounts(wallet)      → staked SOL + MEV
   getPendingInvites(address)    → locked send invites

3. TRANSACTION HISTORY tabs
   [Spot]        jupiterGetSpotHistory(params)  → swaps with P&L
   [Perps]       perpsGetTrades(params)         → leveraged trades with realized PnL
   [Predictions] getPredictHistory(address)     → prediction trades with realized PnL

4. MARKET DATA sidebar
   perpsGetMarkets()              → SOL/BTC/ETH live prices
   jupiterGetTrendingTokens()     → trending tokens
   getLendRates()                 → lending APYs
   listEvents()                   → prediction events
```
