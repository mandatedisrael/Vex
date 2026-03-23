# DexScreener Reference

This module is the authoritative guide for `echoclaw dexscreener *` — multi-chain DEX analytics, token research, trending data, and real-time streaming.

## Scope

- DEX pair search across all chains
- Token and pair data (price, volume, liquidity, transactions)
- Token profiles (trending projects)
- Token boosts (promoted tokens)
- Paid order verification
- Unified trending view (profiles + boosts)
- Real-time WebSocket streaming

## Core commands

```bash
echoclaw dexscreener search <query> --json
echoclaw dexscreener pairs <chainId> <pairId> --json
echoclaw dexscreener token <chainId> <tokenAddresses> --json
echoclaw dexscreener token-pairs <chainId> <tokenAddress> --json
echoclaw dexscreener profiles --json
echoclaw dexscreener boosts [--top] --json
echoclaw dexscreener orders <chainId> <tokenAddress> --json
echoclaw dexscreener trending [--limit <n>] --json
echoclaw dexscreener stream <type> --json
```

## Command details

### search

Search DEX pairs across all chains by token name, symbol, pair address, or token address.

```bash
echoclaw dexscreener search "SOL/USDC" --json
echoclaw dexscreener search "PEPE" --json
echoclaw dexscreener search "0xdAC17F958D2ee523a2206206994597C13D831ec7" --json
```

### pairs

Get detailed pair data by chain and pair contract address.

```bash
echoclaw dexscreener pairs solana JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN --json
echoclaw dexscreener pairs ethereum 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640 --json
```

### token

Get all pair data for one or more tokens. Accepts comma-separated addresses (max 30).

```bash
echoclaw dexscreener token solana So11111111111111111111111111111111111111112 --json
echoclaw dexscreener token ethereum 0xdAC17F958D2ee523a2206206994597C13D831ec7,0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --json
```

### token-pairs

Get all trading pools/pairs for a specific token on a given chain.

```bash
echoclaw dexscreener token-pairs solana JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN --json
```

### profiles

Get latest trending token profiles. No arguments.

```bash
echoclaw dexscreener profiles --json
```

### boosts

Get latest boosted tokens. Use `--top` for the most actively boosted.

```bash
echoclaw dexscreener boosts --json
echoclaw dexscreener boosts --top --json
```

### orders

Check if a token has paid promotional orders on DexScreener.

```bash
echoclaw dexscreener orders solana A55XjvzRU4KtR3Lrys8PpLZQvPojPqvnv5bJVHMYy3Jv --json
```

### trending

Unified "what's hot" view combining profiles + boosts. Fetches both in parallel, deduplicates, ranks by boost amount.

```bash
echoclaw dexscreener trending --json
echoclaw dexscreener trending --limit 20 --json
```

### stream

Real-time WebSocket stream. Type must be: `profiles`, `boosts`, or `boosts-top`. Long-running foreground command outputting JSONL. First line is handshake (initial snapshot), then incremental updates. Stop with SIGINT/SIGTERM.

```bash
echoclaw dexscreener stream profiles --json
echoclaw dexscreener stream boosts --json
echoclaw dexscreener stream boosts-top --json
```

## Chain identifiers

DexScreener uses string chain IDs. Common values:
- `solana` — Solana
- `ethereum` — Ethereum mainnet
- `bsc` — BNB Smart Chain
- `arbitrum` — Arbitrum One
- `base` — Base
- `optimism` — Optimism
- `polygon` — Polygon
- `avalanche` — Avalanche

**Important (as of 2026-03-22):** DexScreener does **NOT** support the 0G network. You will not find 0G tokens or pairs on DexScreener. For 0G DEX analytics (pools, volume, TVL, OHLCV, swaps) use **Jaine Subgraph** (`references/0g/jaine-subgraph.md`) instead.

## Execution model

- **priceChange values are ALREADY percentages.** `2.5` means 2.5%. Do NOT multiply by 100. Display the value as-is with a % suffix.
- All commands are read-only (no wallet, no signing, no mutations)
- No API key required
- Rate limits: 60 req/min for profiles/boosts/orders, 300 req/min for search/pairs/tokens
- `stream` is a long-running foreground process using WebSocket

## Agent-safe flow

1. `echoclaw dexscreener search <query> --json` — find tokens/pairs
2. `echoclaw dexscreener token <chainId> <address> --json` — get detailed data
3. `echoclaw dexscreener token-pairs <chainId> <address> --json` — find all pools
4. `echoclaw dexscreener trending --json` — check what's hot
5. Use results to inform trading decisions via Jupiter (Solana), Jaine (0G), or Khalani (cross-chain)

## Success examples

Search:

```json
{
  "success": true,
  "pairs": [
    {
      "chainId": "solana",
      "dexId": "raydium",
      "pairAddress": "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
      "baseToken": {"address": "So1...", "name": "Wrapped SOL", "symbol": "SOL"},
      "quoteToken": {"address": "EPj...", "name": "USD Coin", "symbol": "USDC"},
      "priceUsd": "152.34",
      "volume": {"h24": 1234567.89},
      "liquidity": {"usd": 5678901.23}
    }
  ],
  "count": 1
}
```

Trending:

```json
{
  "success": true,
  "items": [
    {
      "chainId": "solana",
      "tokenAddress": "ABC...",
      "boostAmount": 500,
      "boostTotalAmount": 1200,
      "hasProfile": true,
      "description": "A trending token"
    }
  ],
  "count": 1
}
```

## Error codes

- `DEXSCREENER_API_ERROR` — general API error
- `DEXSCREENER_RATE_LIMITED` — rate limit exceeded (retryable)
- `DEXSCREENER_TIMEOUT` — request timed out (retryable)
- `DEXSCREENER_INVALID_RESPONSE` — unexpected response shape
- `DEXSCREENER_NOT_FOUND` — chain/token/pair not found
