# DexScreener Module Map — Multi-Chain DEX Analytics, Trending & Real-Time Streams

This document maps every `.ts` file in `src/tools/dexscreener/` and `src/commands/dexscreener/` to the data it provides for token research, pair analytics, trending signals, community takeovers, and real-time WebSocket streaming.

**Base URL**: `https://api.dexscreener.com`
**Auth**: None required (open API)
**Rate limits**: 60 req/min (profiles, boosts, CTO, ads, orders), 300 req/min (search, pairs, tokens, token-pairs)

---

## What DexScreener Does

DexScreener is a multi-chain DEX analytics platform. It automatically tracks every token listed on any DEX with at least one transaction. The API provides:

- **Pair/token data**: price, volume, liquidity, transactions, FDV, market cap across all chains
- **Token profiles**: trending projects with descriptions, icons, social links
- **Token boosts**: promoted tokens with boost amounts (paid visibility)
- **Community takeovers (CTO)**: tokens where community has reclaimed control — strong trading signal
- **Ads**: paid promotional placements with impressions and duration
- **Orders**: verification of paid promotional orders per token
- **Real-time WebSocket**: streaming updates for profiles, boosts, CTOs, and ads

All read-only. No wallet, signing, or API key needed.

---

## File Map

### Core (`src/tools/dexscreener/`)

| File | Role |
|------|------|
| `client.ts` | `DexScreenerClient` — 10 REST methods, singleton via `getDexScreenerClient()` |
| `types.ts` | All TypeScript interfaces: `DexPair`, `DexTokenProfile`, `DexBoost`, `DexCommunityTakeover`, `DexAd`, `DexOrder`, `DexTrendingItem`, WS types |
| `validation.ts` | Runtime validators for all API response shapes + WS handshake parsers |
| `errors.ts` | `mapDexScreenerError()` + `mapTransportError()` — HTTP status to typed `EchoError` |
| `ws-client.ts` | `DexScreenerStream` — EventEmitter WebSocket client with auto-reconnect (5 channels) |

### Commands (`src/commands/dexscreener/`)

| File | Role |
|------|------|
| `index.ts` | Commander registration: 11 subcommands |
| `helpers.ts` | Shared formatters: `formatPairRow()`, `PAIR_COLUMNS`, compact number/price/change formatting |
| `search.ts` | `dexscreener search <query>` — cross-chain pair search |
| `pairs.ts` | `dexscreener pairs <chain> <pairId>` — pair details |
| `token.ts` | `dexscreener token <chain> <addresses>` — token data (max 30) |
| `token-pairs.ts` | `dexscreener token-pairs <chain> <address>` — all pools for token |
| `profiles.ts` | `dexscreener profiles` — latest trending profiles |
| `boosts.ts` | `dexscreener boosts [--top]` — latest or top boosted tokens |
| `community-takeovers.ts` | `dexscreener cto` — latest community takeovers |
| `ads.ts` | `dexscreener ads` — latest ads |
| `orders.ts` | `dexscreener orders <chain> <address>` — paid order verification |
| `trending.ts` | `dexscreener trending [--limit]` — unified profiles+boosts view |
| `stream.ts` | `dexscreener stream <type>` — real-time WS (5 channels) |

---

## API Endpoints (10 REST + 5 WS)

### REST

| Function | Endpoint | Rate Limit |
|----------|----------|------------|
| `client.search(query)` | `GET /latest/dex/search?q={query}` | 300/min |
| `client.getPairs(chainId, pairId)` | `GET /latest/dex/pairs/{chainId}/{pairId}` | 300/min |
| `client.getTokens(chainId, addresses)` | `GET /tokens/v1/{chainId}/{addresses}` | 300/min |
| `client.getTokenPairs(chainId, address)` | `GET /token-pairs/v1/{chainId}/{address}` | 300/min |
| `client.getProfiles()` | `GET /token-profiles/latest/v1` | 60/min |
| `client.getBoosts()` | `GET /token-boosts/latest/v1` | 60/min |
| `client.getTopBoosts()` | `GET /token-boosts/top/v1` | 60/min |
| `client.getCommunityTakeovers()` | `GET /community-takeovers/latest/v1` | 60/min |
| `client.getAds()` | `GET /ads/latest/v1` | 60/min |
| `client.getOrders(chainId, address)` | `GET /orders/v1/{chainId}/{address}` | 60/min |

### WebSocket (real-time streaming)

| Channel | WS Path | Data Type |
|---------|---------|-----------|
| `profiles` | `wss://api.dexscreener.com/token-profiles/latest/v1` | `DexTokenProfile` |
| `boosts` | `wss://api.dexscreener.com/token-boosts/latest/v1` | `DexBoost` |
| `boosts-top` | `wss://api.dexscreener.com/token-boosts/top/v1` | `DexBoost` |
| `community-takeovers` | `wss://api.dexscreener.com/community-takeovers/latest/v1` | `DexCommunityTakeover` |
| `ads` | `wss://api.dexscreener.com/ads/latest/v1` | `DexAd` |

**WS protocol**: First message is handshake `{ limit: number, data: T[] }` (initial snapshot). Subsequent messages are individual updates. Auto-reconnect with exponential backoff (1s→30s) + jitter.

---

## Portfolio & Trading Data Sources

### Token/Pair Research

| Source | Function | Returns | Useful for |
|--------|----------|---------|------------|
| `client.ts` | `search(query)` | Pairs: price, volume, liquidity, txns, FDV, marketCap, priceChange | Token discovery, price lookup |
| `client.ts` | `getTokens(chain, addresses)` | Full pair data for up to 30 tokens at once | Batch token info, portfolio pricing |
| `client.ts` | `getTokenPairs(chain, address)` | All DEX pools for a single token | Find best liquidity, pool selection for Zap |
| `client.ts` | `getPairs(chain, pairId)` | Single pair details | Specific pool monitoring |

### Trending & Signals

| Source | Function | Returns | Useful for |
|--------|----------|---------|------------|
| `client.ts` | `getProfiles()` | Token profiles: icon, description, social links | Project research, trending discovery |
| `client.ts` | `getBoosts()` / `getTopBoosts()` | Boosted tokens: amounts, descriptions | Paid promotion detection, attention signals |
| `client.ts` | `getCommunityTakeovers()` | CTO events: chainId, tokenAddress, claimDate, links | **Trading alpha** — community reclaiming abandoned tokens often precedes price action |
| `client.ts` | `getAds()` | Ads: type, duration, impressions | Promotional activity monitoring |
| `trending.ts` | `trending` command | Merged profiles+boosts, deduplicated, ranked by boost | Unified "what's hot" view |

### Verification

| Source | Function | Returns | Useful for |
|--------|----------|---------|------------|
| `client.ts` | `getOrders(chain, address)` | Paid orders: type, status, paymentTimestamp | Check if token paid for promotion (legitimacy signal) |

### Real-Time Feeds

| Source | Channel | Returns | Useful for |
|--------|---------|---------|------------|
| `ws-client.ts` | `profiles` | Live profile updates | Track new trending tokens |
| `ws-client.ts` | `boosts` | Live boost events | Detect new promotion activity |
| `ws-client.ts` | `boosts-top` | Top boosts changes | Monitor highest-promoted tokens |
| `ws-client.ts` | `community-takeovers` | Live CTO events | **Real-time CTO trading signals** |
| `ws-client.ts` | `ads` | Live ad placements | Track promotional spend |

---

## Data Types

### DexPair (core schema)

```typescript
{
  chainId: string;           // "solana", "ethereum", "bsc", etc.
  dexId: string;             // "raydium", "uniswap", etc.
  url: string;               // DexScreener URL
  pairAddress: string;       // Pool contract address
  labels: string[] | null;   // ["v2"], ["v3"], etc.
  baseToken: { address, name, symbol };
  quoteToken: { address, name, symbol }; // nullable fields
  priceNative: string;       // Price in quote token
  priceUsd: string | null;   // USD price
  txns: { h24: { buys, sells }, m5: {...}, h1: {...}, h6: {...} };
  volume: { h24: number, h6: number, h1: number, m5: number };
  priceChange: { h24: number, h6: number, h1: number, m5: number } | null;
  liquidity: { usd: number | null, base: number, quote: number } | null;
  fdv: number | null;        // Fully diluted valuation
  marketCap: number | null;  // Market cap (uses circulating supply if available)
  pairCreatedAt: number | null; // Unix timestamp ms
  info: { imageUrl, websites[], socials[] } | null;
  boosts: { active: number } | null;
}
```

### DexTokenProfile

```typescript
{
  url: string;               // DexScreener profile URL
  chainId: string;
  tokenAddress: string;
  icon: string;              // Token icon URL
  header: string | null;     // Header image URL
  description: string | null;
  links: Array<{ type, label, url }> | null;
}
```

### DexBoost

```typescript
{
  url: string;
  chainId: string;
  tokenAddress: string;
  amount: number;            // Current boost amount
  totalAmount: number;       // Total boost amount
  icon: string | null;
  header: string | null;
  description: string | null;
  links: Array<{ type, label, url }> | null;
}
```

### DexCommunityTakeover

```typescript
{
  url: string;
  chainId: string;
  tokenAddress: string;
  icon: string;
  header: string | null;
  description: string | null;
  links: Array<{ type, label, url }> | null;
  claimDate: string;         // ISO 8601 date-time
}
```

### DexAd

```typescript
{
  url: string;
  chainId: string;
  tokenAddress: string;
  date: string;              // ISO 8601 date-time
  type: string;              // "tokenAd", "trendingBarAd", etc.
  durationHours: number | null;
  impressions: number | null;
}
```

### DexOrder

```typescript
{
  type: "tokenProfile" | "communityTakeover" | "tokenAd" | "trendingBarAd";
  status: "processing" | "cancelled" | "on-hold" | "approved" | "rejected";
  paymentTimestamp: number;  // Unix timestamp seconds
}
```

---

## Value Formats

| Field | Format | Example | Display |
|-------|--------|---------|---------|
| `priceUsd` | String, USD | `"152.34"` | `$152.34` |
| `priceNative` | String, quote token | `"1.0"` | Native denomination |
| `volume.h24` | Number, USD | `1234567.89` | `$1.23M` |
| `liquidity.usd` | Number, USD | `5678901.23` | `$5.68M` |
| `fdv` / `marketCap` | Number, USD | `89000000000` | `$89.00B` |
| `priceChange.h24` | **Already percentage** | `2.5` = 2.5% | Display as `+2.50%` — do NOT multiply by 100 |
| `txns.h24.buys` / `sells` | Integer | `1234` | Transaction count |
| `pairCreatedAt` | Unix timestamp **ms** | `1672531200000` | `new Date(value)` |
| `paymentTimestamp` | Unix timestamp **seconds** | `1700000000` | `new Date(value * 1000)` |
| `boost.amount` / `totalAmount` | Number | `500` | Boost units |
| `claimDate` | ISO 8601 string | `"2024-06-15T12:00:00Z"` | Date display |

---

## Chain Identifiers

DexScreener uses string chain IDs. Common values:

| Chain | ID | Chain | ID |
|-------|-----|-------|-----|
| Solana | `solana` | Ethereum | `ethereum` |
| BSC | `bsc` | Arbitrum | `arbitrum` |
| Base | `base` | Optimism | `optimism` |
| Polygon | `polygon` | Avalanche | `avalanche` |
| Linea | `linea` | Sonic | `sonic` |
| Berachain | `berachain` | Ronin | `ronin` |
| Scroll | `scroll` | zkSync | `zksync` |

DexScreener does **NOT** support 0G Network. For 0G DEX analytics use Jaine Subgraph.

---

## Error Handling

| HTTP | Error Code | Retryable | Hint |
|------|-----------|-----------|------|
| 429 | `DEXSCREENER_RATE_LIMITED` | Yes | 60/min or 300/min depending on endpoint |
| 404 | `DEXSCREENER_NOT_FOUND` | No | Check chainId and address |
| 5xx | `DEXSCREENER_API_ERROR` | Yes | Server error, retry later |
| Timeout | `DEXSCREENER_TIMEOUT` | Yes | Request timed out |
| Parse fail | `DEXSCREENER_INVALID_RESPONSE` | No | Unexpected response shape |

---

## WebSocket Client (`ws-client.ts`)

### Architecture

- `DexScreenerStream` extends `EventEmitter`
- Uses native Node 22+ `WebSocket` (no external dependency)
- Auto-reconnect with exponential backoff: 1s initial, 2x multiplier, 30s max, 20% jitter
- Graceful shutdown via `disconnect()`

### Events

| Event | Payload | When |
|-------|---------|------|
| `connected` | — | WebSocket connection established |
| `handshake` | `{ limit, data: T[] }` | First message: initial snapshot |
| `update` | `T` | Every subsequent message: incremental update |
| `disconnected` | `reason: string` | Connection lost (auto-reconnect follows) |
| `error` | `Error` | WebSocket error |

### Usage

```typescript
const stream = new DexScreenerStream({ channel: "community-takeovers" });
stream.on("handshake", (data) => { /* initial snapshot */ });
stream.on("update", (item) => { /* real-time CTO event */ });
stream.connect();
// ...later:
stream.disconnect();
```

---

## CLI Commands (11 subcommands)

```
dexscreener search <query>
dexscreener pairs <chainId> <pairId>
dexscreener token <chainId> <tokenAddresses>
dexscreener token-pairs <chainId> <tokenAddress>
dexscreener profiles
dexscreener boosts [--top]
dexscreener cto
dexscreener ads
dexscreener orders <chainId> <tokenAddress>
dexscreener trending [--limit <n>]
dexscreener stream <type>
```

**Stream types**: `profiles`, `boosts`, `boosts-top`, `community-takeovers`, `ads`

**Headless mode** (`ECHOCLAW_HEADLESS=1`): All commands output structured JSON via `writeJsonSuccess()`.
**`stream`**: Long-running foreground process. First line = handshake snapshot. Subsequent lines = incremental updates. Stop with SIGINT/SIGTERM.

---

## Trending Command (composite)

`dexscreener trending` merges data from two endpoints in parallel:
1. `getProfiles()` — trending token profiles
2. `getBoosts()` — boosted tokens

Merge logic:
- Key by `chainId:tokenAddress`
- Boosts set `boostAmount`/`boostTotalAmount`
- Profiles set `hasProfile=true` and fill missing icon/description/links
- Sort by `boostTotalAmount` descending, then `hasProfile` presence
- Deduplicated output

---

## FDV and Market Cap Calculation

DexScreener formula:
```
FDV = (total supply - burned supply) * price
```

Market cap = FDV in most cases. Exception: if token has self-reported circulating supply (via Enhanced Token Info or CoinGecko), market cap uses circulating supply instead.

---

## Trading Agent Integration

For a trading agent, DexScreener provides the research layer:

```
1. DISCOVERY
   search <query> --json           → find tokens/pairs by name/symbol/address
   trending --json                  → what's hot (profiles + boosts)
   cto --json                       → community takeover signals (alpha)

2. ANALYSIS
   token <chain> <address> --json  → price, volume, liquidity, FDV, txns
   token-pairs <chain> <addr> --json → all pools, find best liquidity
   orders <chain> <addr> --json    → check if token paid for promotion

3. REAL-TIME MONITORING
   stream community-takeovers --json → live CTO feed (strongest signal)
   stream boosts --json              → live boost activity
   stream profiles --json            → new trending projects

4. EXECUTE (via other modules)
   → Solana tokens: echoclaw solana swap ...
   → EVM tokens: echoclaw kyberswap swap sell ...
   → Cross-chain: echoclaw khalani bridge ...
```
