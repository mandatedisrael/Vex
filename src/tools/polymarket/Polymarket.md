# Polymarket Module Map — Prediction Markets on Polygon (EVM)

This document maps every `.ts` file in `src/tools/polymarket/` and `src/commands/polymarket/` to the data it provides for prediction market trading, portfolio tracking, market research, and real-time streaming.

**Chain**: Polygon (chainId 137)
**Collateral**: USDC.e (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`, 6 decimals)
**Auth**: L1 (EIP-712 wallet signature) → L2 (HMAC-SHA256 API key)

---

## What Polymarket Does

Polymarket is the world's largest prediction market. Users buy/sell YES/NO outcome shares for events across politics, sports, crypto, culture, economics, tech, weather, and more. Prices represent probability (0.01–0.99). Shares resolve to $1 if correct, $0 if wrong.

**5 API surfaces**:
1. **Gamma API** — market discovery, events, tags, search, profiles, sports, comments
2. **CLOB API** — orderbook, pricing, trading (order placement/cancellation), rewards, WebSocket
3. **Data API** — positions, activity, trades, leaderboard, holders, open interest
4. **Bridge API** — deposit/withdraw across chains (EVM/Solana/BTC)
5. **Relayer API** — gasless transaction submission

---

## Base URLs

| Service | URL | Auth |
|---------|-----|------|
| Gamma | `https://gamma-api.polymarket.com` | None |
| CLOB | `https://clob.polymarket.com` | Market data: none. Trading: L2 HMAC headers |
| CLOB WS Market | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | None |
| CLOB WS User | `wss://ws-subscriptions-clob.polymarket.com/ws/user` | API credentials in subscribe msg |
| Data | `https://data-api.polymarket.com` | None |
| Bridge | `https://bridge.polymarket.com` | None |
| Relayer | `https://relayer-v2.polymarket.com` | Builder or Relayer API keys |

---

## File Map

### Core (`src/tools/polymarket/`)

| File | Role |
|------|------|
| `types.ts` | Shared types: `PolyEvent`, `PolyMarket`, `PolyTag`, `PolyProfile` |
| `constants.ts` | URLs, chain config, contract addresses (CTF Exchange, NegRisk), USDC.e, timeouts, env var names |
| `errors.ts` | `mapPolyTransportError()` + `mapPolyApiError()` — HTTP→domain error mapping |
| `auth.ts` | HMAC-SHA256 request signing (`node:crypto`), L2 header builder, credential loading from env |
| `evm-utils.ts` | Polygon viem clients, spender validation, USDC.e approval (with USDT-style reset) |

### Gamma (`src/tools/polymarket/gamma/`)

| File | Role |
|------|------|
| `client.ts` | `PolyGammaClient` — 25 endpoints: events, markets, tags, series, comments, profiles, sports, search |
| `types.ts` | `GammaEvent`, `GammaMarket`, `GammaTag`, `GammaSeries`, `GammaComment`, `GammaProfile`, etc. |
| `validation.ts` | Runtime validators for all Gamma response shapes |

### CLOB (`src/tools/polymarket/clob/`)

| File | Role |
|------|------|
| `client.ts` | `PolyClobClient` — 30+ endpoints: orderbook, pricing (single+batch), trading, orders, trades, heartbeat, rewards |
| `types.ts` | `OrderBookSummary`, `ClobOrder`, `SendOrderRequest/Response`, `OpenOrder`, `CancelResponse`, `ClobTrade`, `PriceHistory`, `BookRequest`, `LastTradePrice`, `OrderScoringResponse` |
| `validation.ts` | Runtime validators for all CLOB responses incl. batch endpoints |
| `signing.ts` | EIP-712 order signing for CTF Exchange + NegRisk Exchange via viem |
| `ws-market.ts` | `PolyMarketStream` — public WS: orderbook, price changes, trades, tick size, best bid/ask, new markets, resolution |
| `ws-user.ts` | `PolyUserStream` — authenticated WS: order placement/update/cancellation, trade match/confirm |

### Data (`src/tools/polymarket/data/`)

| File | Role |
|------|------|
| `client.ts` | `PolyDataClient` — 13 endpoints: positions, closed, activity, trades, value, traded, holders, OI, live volume, leaderboard, builder leaderboard, builder volume, market positions, accounting snapshot |
| `types.ts` | `DataPosition`, `DataClosedPosition`, `DataActivity`, `DataTrade`, `DataHolder`, `DataLeaderboardEntry`, `DataBuilderEntry`, `DataBuilderVolumeEntry`, `DataMarketPositionV1`, etc. |
| `validation.ts` | Runtime validators for all Data API responses |

### Bridge (`src/tools/polymarket/bridge/`)

| File | Role |
|------|------|
| `client.ts` | `PolyBridgeClient` — 5 endpoints: supported-assets, deposit, withdraw, quote, status |
| `types.ts` | `BridgeSupportedAsset`, `BridgeDepositResponse`, `BridgeQuoteRequest/Response`, `BridgeTransaction` |
| `validation.ts` | Runtime validators for bridge responses |

### Relayer (`src/tools/polymarket/relayer/`)

| File | Role |
|------|------|
| `client.ts` | `PolyRelayerClient` — 7 endpoints: submit, transaction, transactions, nonce, relay-payload, deployed, api-keys |
| `types.ts` | `RelayerSubmitRequest/Response`, `RelayerTransaction`, `RelayerApiKey` |
| `validation.ts` | Runtime validators for relayer responses |

### Commands (`src/commands/polymarket/`)

| File | Role |
|------|------|
| `index.ts` | Commander registration: 19 subcommands |
| `helpers.ts` | Shared formatters, event/market display |
| `setup.ts` | `polymarket setup` — auto-generate API key (L1 sign → derive creds → save .env) |
| `events.ts` | `polymarket events` / `event` / `search` — browse and search events |
| `market.ts` | `polymarket market` / `orderbook` / `history` — single market detail, orderbook, price history |
| `trade.ts` | `polymarket buy` / `sell` — order placement with EIP-712 signing |
| `positions.ts` | `polymarket positions` / `orders` / `profile` — user data |
| `cancel.ts` | `polymarket cancel` / `cancel-all` / `cancel-market` — order cancellation |
| `leaderboard.ts` | `polymarket leaderboard` / `activity` — rankings + user activity |
| `stream.ts` | `polymarket stream-market` / `stream-user` — real-time WS streams |

---

## API Endpoints

### Gamma API (25 endpoints)

| Function | Endpoint | Category |
|----------|----------|----------|
| `listEvents(params?)` | `GET /events` | Events |
| `getEvent(id)` | `GET /events/{id}` | Events |
| `getEventBySlug(slug)` | `GET /events/slug/{slug}` | Events |
| `getEventTags(id)` | `GET /events/{id}/tags` | Events |
| `listMarkets(params?)` | `GET /markets` | Markets |
| `getMarket(id)` | `GET /markets/{id}` | Markets |
| `getMarketBySlug(slug)` | `GET /markets/slug/{slug}` | Markets |
| `getMarketTags(id)` | `GET /markets/{id}/tags` | Markets |
| `search(query, opts?)` | `GET /public-search` | Search |
| `listTags(opts?)` | `GET /tags` | Tags |
| `getTag(id)` | `GET /tags/{id}` | Tags |
| `getTagBySlug(slug)` | `GET /tags/slug/{slug}` | Tags |
| `getRelatedTags(id)` | `GET /tags/{id}/related-tags` | Tags |
| `getRelatedTagsBySlug(slug)` | `GET /tags/slug/{slug}/related-tags` | Tags |
| `getTagsRelatedToTag(id)` | `GET /tags/{id}/related-tags/tags` | Tags |
| `getTagsRelatedToTagBySlug(slug)` | `GET /tags/slug/{slug}/related-tags/tags` | Tags |
| `listSeries(opts?)` | `GET /series` | Series |
| `getSeries(id)` | `GET /series/{id}` | Series |
| `listComments(opts?)` | `GET /comments` | Comments |
| `getComment(id)` | `GET /comments/{id}` | Comments |
| `getCommentsByUser(address)` | `GET /comments/user_address/{addr}` | Comments |
| `getPublicProfile(address)` | `GET /public-profile` | Profiles |
| `getSportsMetadata()` | `GET /sports` | Sports |
| `getSportsMarketTypes()` | `GET /sports/market-types` | Sports |
| `listTeams(opts?)` | `GET /teams` | Sports |

### CLOB API — Market Data (public, 15+ endpoints)

| Function | Endpoint |
|----------|----------|
| `getOrderBook(tokenId)` | `GET /book` |
| `getOrderBooks(requests[])` | `POST /books` |
| `getPrice(tokenId, side)` | `GET /price` |
| `getBatchPrices(ids, sides)` | `GET /prices` |
| `getBatchPricesPost(requests[])` | `POST /prices` |
| `getMidpoint(tokenId)` | `GET /midpoint` |
| `getBatchMidpoints(ids)` | `GET /midpoints` |
| `getBatchMidpointsPost(requests[])` | `POST /midpoints` |
| `getSpread(tokenId)` | `GET /spread` |
| `getBatchSpreads(requests[])` | `POST /spreads` |
| `getLastTradePrice(tokenId)` | `GET /last-trade-price` |
| `getBatchLastTradesPrices(ids)` | `GET /last-trades-prices` |
| `getBatchLastTradesPricesPost(requests[])` | `POST /last-trades-prices` |
| `getPriceHistory(market, opts?)` | `GET /prices-history` |
| `getTickSize(tokenId)` | `GET /tick-size` |
| `getFeeRate(tokenId)` | `GET /fee-rate` |
| `getServerTime()` | `GET /time` |

### CLOB API — Trading (authenticated, 10 endpoints)

| Function | Endpoint | Method |
|----------|----------|--------|
| `postOrder(order)` | `/order` | POST |
| `postOrders(orders[])` | `/orders` | POST (max 15) |
| `cancelOrder(orderId)` | `/order` | DELETE |
| `cancelOrders(orderIds[])` | `/orders` | DELETE (max 3000) |
| `cancelAll()` | `/cancel-all` | DELETE |
| `cancelMarketOrders(market, assetId)` | `/cancel-market-orders` | DELETE |
| `getOrders(opts?)` | `/orders` | GET |
| `getOrder(orderId)` | `/order/{orderID}` | GET |
| `getTrades(opts?)` | `/trades` | GET |
| `sendHeartbeat()` | `/heartbeats` | POST |
| `getOrderScoring(orderId)` | `/order-scoring` | GET |

### Data API (13 endpoints)

| Function | Endpoint |
|----------|----------|
| `getPositions(params)` | `GET /positions` |
| `getClosedPositions(user, opts?)` | `GET /closed-positions` |
| `getActivity(user, opts?)` | `GET /activity` |
| `getTrades(opts)` | `GET /trades` |
| `getValue(user)` | `GET /value` |
| `getTraded(user)` | `GET /traded` |
| `getHolders(market, opts?)` | `GET /holders` |
| `getOpenInterest(market?)` | `GET /oi` |
| `getLiveVolume(eventId)` | `GET /live-volume` |
| `getMarketPositions(market, opts?)` | `GET /v1/market-positions` |
| `getLeaderboard(opts?)` | `GET /v1/leaderboard` |
| `getBuilderLeaderboard(opts?)` | `GET /v1/builders/leaderboard` |
| `getBuilderVolume(opts?)` | `GET /v1/builders/volume` |
| `getAccountingSnapshotUrl(user)` | `GET /v1/accounting/snapshot` (URL builder) |

### Bridge API (5 endpoints)

| Function | Endpoint |
|----------|----------|
| `getSupportedAssets()` | `GET /supported-assets` |
| `createDeposit(address)` | `POST /deposit` |
| `createWithdraw(params)` | `POST /withdraw` |
| `getQuote(params)` | `POST /quote` |
| `getStatus(address)` | `GET /status/{address}` |

### Relayer API (7 endpoints)

| Function | Endpoint |
|----------|----------|
| `submitTransaction(params)` | `POST /submit` |
| `getTransaction(id)` | `GET /transaction` |
| `getTransactions(headers)` | `GET /transactions` |
| `getNonce(address, type)` | `GET /nonce` |
| `getRelayPayload(address, type)` | `GET /relay-payload` |
| `isDeployed(proxyAddress)` | `GET /deployed` |
| `getApiKeys(headers)` | `GET /relayer/api/keys` |

---

## WebSocket Channels

### Market Channel (public)

```
wss://ws-subscriptions-clob.polymarket.com/ws/market
```

Subscribe with asset IDs. Receives:

| Event | Description |
|-------|-------------|
| `book` | Full orderbook snapshot (bids + asks) |
| `price_change` | Delta update to price levels (size=0 means level removed) |
| `last_trade_price` | Trade execution: price, size, side, fee_rate_bps |
| `tick_size_change` | Market tick size updated |
| `best_bid_ask` | Best bid/ask + spread (requires `custom_feature_enabled`) |
| `new_market` | New market created (requires `custom_feature_enabled`) |
| `market_resolved` | Market resolved with winner (requires `custom_feature_enabled`) |

**Protocol**: PING every 10s, server replies PONG. Auto-reconnect with backoff.

### User Channel (authenticated)

```
wss://ws-subscriptions-clob.polymarket.com/ws/user
```

Subscribe with CLOB API credentials. Receives:

| Event | Description |
|-------|-------------|
| `order` | Order placed/updated/cancelled (type: PLACEMENT/UPDATE/CANCELLATION) |
| `trade` | Trade matched/mined/confirmed/failed (trader_side: TAKER/MAKER) |

---

## Portfolio Data Sources

### Holdings & Positions

| Source | Function | Returns |
|--------|----------|---------|
| `data/client.ts` | `getPositions(params)` | Open positions: size, avgPrice, currentValue, cashPnl, percentPnl, realizedPnl, redeemable, mergeable |
| `data/client.ts` | `getClosedPositions(user)` | Closed: avgPrice, totalBought, realizedPnl, timestamp |
| `data/client.ts` | `getValue(user)` | Total portfolio value in USD |
| `data/client.ts` | `getTraded(user)` | Total markets traded count |
| `clob/client.ts` | `getOrders(opts?)` | Open orders: size, price, status, order_type |

### Transaction History

| Source | Function | Returns |
|--------|----------|---------|
| `data/client.ts` | `getActivity(user, opts?)` | All activity: TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION, MAKER_REBATE |
| `data/client.ts` | `getTrades(opts)` | Trades: side, size, price, timestamp, outcome, transactionHash |
| `clob/client.ts` | `getTrades(opts?)` | CLOB trades: fee_rate_bps, status, match_time, trader_side |

### Market Research

| Source | Function | Returns |
|--------|----------|---------|
| `gamma/client.ts` | `listEvents(params?)` | Events: title, volume, liquidity, openInterest, markets[] |
| `gamma/client.ts` | `search(query)` | Cross-entity search: events + tags + profiles |
| `clob/client.ts` | `getOrderBook(tokenId)` | Full orderbook: bids, asks, last_trade_price, tick_size |
| `clob/client.ts` | `getPriceHistory(market)` | Price time-series: { t, p }[] |
| `data/client.ts` | `getHolders(market)` | Top holders per outcome token |
| `data/client.ts` | `getOpenInterest(market)` | OI per market |
| `data/client.ts` | `getLiveVolume(eventId)` | Live trading volume |

### Leaderboard & Analytics

| Source | Function | Returns |
|--------|----------|---------|
| `data/client.ts` | `getLeaderboard(opts?)` | Rankings by PnL/volume across categories (OVERALL, POLITICS, SPORTS, CRYPTO, etc.) |
| `data/client.ts` | `getBuilderLeaderboard(opts?)` | Builder rankings by volume + active users |
| `data/client.ts` | `getBuilderVolume(opts?)` | Daily builder volume time-series |
| `gamma/client.ts` | `getPublicProfile(address)` | Public profile: name, pseudonym, bio, xUsername, verified |

---

## Value Formats

### Amounts

All USDC amounts use **fixed-math with 6 decimals** (USDC.e standard).

| Field | Format | Example | Display |
|-------|--------|---------|---------|
| `makerAmount` / `takerAmount` | String, 6 dec fixed | `"100000000"` = 100 USDC | Divide by 10^6 |
| `size` (Data API positions/trades) | Number, human-readable | `100.5` = 100.5 shares | Display as-is |
| `price` (CLOB) | String or number, 0-1 | `"0.65"` = 65% probability | Display as cents or percentage |
| `cashPnl` / `realizedPnl` | Number, USD | `12.50` | Display as `$12.50` |
| `percentPnl` | Number, already % | `15.3` = 15.3% | Display with % suffix |
| `volume` (Gamma Event) | Number, USD | `1234567` | Display as `$1.23M` |
| `liquidityNum` (Gamma Market) | Number, USD | `50000` | Display as `$50K` |
| `base_fee` (fee rate) | Integer, basis points | `30` = 0.3% | Divide by 100 for % |

### Prices

- `outcomePrices`: JSON string `"[\"0.65\",\"0.35\"]"` — parse with `JSON.parse()`
- `outcomes`: JSON string `"[\"Yes\",\"No\"]"` — parse with `JSON.parse()`
- `clobTokenIds`: JSON string `"[\"token_id_yes\",\"token_id_no\"]"` — YES is index 0, NO is index 1

### Timestamps

| Field | Format |
|-------|--------|
| `createdAt` / `updatedAt` (Gamma) | ISO 8601 `"2024-01-24T12:00:00Z"` |
| `match_time` / `last_update` (CLOB) | Unix timestamp string `"1700000000"` |
| `timestamp` (Data activity/trades) | Unix timestamp integer |
| `timestamp` (WS events) | Unix timestamp ms string `"1757908892351"` |

---

## Authentication

### L1 (Wallet Signature) → L2 (API Key)

```
1. Sign EIP-712 ClobAuth message with wallet private key
2. POST /auth/api-key or GET /auth/derive-api-key → { apiKey, secret, passphrase }
3. Use credentials for L2 HMAC-SHA256 request signing
```

### L2 Headers (Trading Endpoints)

| Header | Value |
|--------|-------|
| `POLY_API_KEY` | API key UUID |
| `POLY_ADDRESS` | Polygon signer address |
| `POLY_SIGNATURE` | HMAC-SHA256(timestamp + method + path + body, secret) |
| `POLY_PASSPHRASE` | API passphrase |
| `POLY_TIMESTAMP` | Unix timestamp (seconds) |

### Signature Types

| Type | Value | Description |
|------|-------|-------------|
| EOA | `0` | Standard wallet (MetaMask) |
| POLY_PROXY | `1` | Magic Link exported key |
| GNOSIS_SAFE | `2` | Gnosis Safe multisig (most common) |

### Auto-Setup

`echoclaw polymarket setup --yes` does everything automatically:
1. Signs L1 EIP-712 message with wallet
2. Derives API credentials
3. Saves to `~/.config/echoclaw/.env`

---

## Contracts (Polygon)

| Contract | Address | Purpose |
|----------|---------|---------|
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` | Standard binary markets |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` | Multi-outcome capital-efficient markets |
| Conditional Tokens | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` | CTF framework |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | Collateral (6 decimals) |

---

## Error Handling

| HTTP | Error Code | Retryable | Description |
|------|-----------|-----------|-------------|
| 429 | `POLYMARKET_RATE_LIMITED` | Yes | Rate limit exceeded |
| 401 | `POLYMARKET_AUTH_FAILED` | No | Auth failed — run `setup --yes` |
| 404 | `POLYMARKET_MARKET_NOT_FOUND` | No | Market/event not found |
| 503 | `POLYMARKET_API_ERROR` | Yes | Service unavailable (trading may be disabled) |
| 5xx | `POLYMARKET_API_ERROR` | Yes | Server error |
| 400 (banned/closed) | `POLYMARKET_ORDER_FAILED` | No | Address banned or closed-only mode |
| — | `POLYMARKET_NOT_CONFIGURED` | No | API key missing — auto-fix: `setup --yes` |
| — | `POLYMARKET_TIMEOUT` | Yes | Request timed out |

---

## CLI Commands (19 subcommands)

```
polymarket setup --yes --json

polymarket events [--tag <slug>] [--active] [--featured] [--limit <n>] --json
polymarket event <id> --json
polymarket search <query> --json

polymarket market <conditionId> --json
polymarket orderbook <tokenId> --json
polymarket history <tokenId> [--interval 1h|6h|1d|1w|1m|all] [--fidelity <min>] --json

polymarket buy <conditionId> --outcome yes|no --amount <usdc> --price <0-1>
  [--type GTC|FOK|GTD] [--dry-run] --yes --json
polymarket sell <conditionId> --outcome yes|no --amount <shares>
  [--type GTC|FOK|GTD] [--dry-run] --yes --json

polymarket positions [--market <conditionId>] --json
polymarket orders [--market <conditionId>] --json
polymarket profile <address> --json

polymarket cancel <orderId> --yes --json
polymarket cancel-all --yes --json
polymarket cancel-market <conditionId> <assetId> --yes --json

polymarket leaderboard [--category OVERALL|POLITICS|SPORTS|CRYPTO|CULTURE] [--period DAY|WEEK|MONTH|ALL] --json
polymarket activity <address> [--type TRADE|REDEEM|REWARD] --json

polymarket stream-market <assetId1> [assetId2...] [--level 1|2|3] [--custom-features] --json
polymarket stream-user [--markets <conditionId1> <conditionId2>] --json
```

**`--dry-run`**: Preview order without submitting.
**`--yes`**: Required for all mutations.
**`stream-*`**: Long-running WS processes outputting JSONL. Stop with SIGINT/SIGTERM.

---

## Order Flow

### Buy/Sell

```
1. resolveMarket(conditionId) → clobTokenIds, negRisk, tickSize
2. resolveTokenId(outcome, clobTokenIds) → YES or NO token ID
3. getFeeRate(tokenId) → base_fee in bps
4. buildClobOrder({ maker, signer, tokenId, makerAmount, takerAmount, side, feeRateBps })
5. [--yes check]
6. signClobOrder(privateKey, order, negRisk) → EIP-712 signature
7. postOrder({ order: { ...order, signature }, owner, orderType })
   → { success, orderID, status: live|matched|delayed }
```

### Cancel

```
cancelOrder(orderId) → { canceled: [...], not_canceled: {...} }
cancelAll() → cancels everything
cancelMarketOrders(market, assetId) → cancels per-market
```

### Heartbeat

`sendHeartbeat()` — must be sent regularly for automated systems. If heartbeats stop, all open orders are auto-cancelled.

---

## Bridge Flow

```
1. getSupportedAssets() → chains + tokens + minCheckoutUsd
2. createDeposit(polymarketAddress) → { evm, svm, btc } deposit addresses
3. Send funds to the appropriate address
4. getStatus(depositAddress) → track: DEPOSIT_DETECTED → PROCESSING → COMPLETED

For withdrawal:
1. createWithdraw({ address, toChainId, toTokenAddress, recipientAddr })
   → { evm, svm, btc } withdrawal addresses
2. Send USDC.e to the withdrawal address
3. getStatus(withdrawAddress) → track status
```

---

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| General | 15,000 req / 10s |
| Gamma general | 4,000 req / 10s |
| Gamma /events | 500 req / 10s |
| Gamma /markets | 300 req / 10s |
| Data general | 1,000 req / 10s |
| Data /positions, /closed-positions | 150 req / 10s |
| CLOB general | 9,000 req / 10s |
| CLOB /book | 1,500 req / 10s |
| CLOB POST /order (burst) | 3,500 req / 10s |
| CLOB POST /order (sustained) | 36,000 req / 10min |
| CLOB DELETE /cancel-all (burst) | 250 req / 10s |
| Bridge / Relayer /submit | 25 req / 1min |

---

## Trading Agent Integration

```
1. SETUP (one-time)
   polymarket setup --yes --json → auto-generate API key

2. DISCOVERY
   polymarket events --active --featured --json → browse events
   polymarket search "bitcoin" --json → find specific markets
   polymarket market <conditionId> --json → market details + outcomes + prices

3. ANALYSIS
   polymarket orderbook <tokenId> --json → depth, spread, tick size
   polymarket history <tokenId> --interval 1d --json → price chart
   polymarket leaderboard --category CRYPTO --json → top traders

4. TRADE
   polymarket buy <conditionId> --outcome yes --amount 10 --price 0.65 --dry-run --json → preview
   polymarket buy <conditionId> --outcome yes --amount 10 --price 0.65 --yes --json → execute

5. MONITOR
   polymarket positions --json → open positions with live PnL
   polymarket orders --json → open orders
   polymarket stream-market <assetId> --json → real-time price feed
   polymarket stream-user --json → real-time order/trade updates

6. EXIT
   polymarket sell <conditionId> --outcome yes --amount 10 --yes --json
   polymarket cancel-all --yes --json
```
