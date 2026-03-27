# Polymarket Market Data Reference

Orderbook, pricing, price history, tick sizes, fee rates. All read-only, no auth.

## Commands

```bash
echoclaw polymarket orderbook <token-id> --json
echoclaw polymarket price <token-id> --side buy|sell --json  # Not yet CLI — use orderbook
echoclaw polymarket history <token-id> [--interval 1h|6h|1d|1w|1m|all] [--fidelity <min>] --json

# Real-time market stream (WebSocket — long-running)
echoclaw polymarket stream-market <assetId1> [assetId2...] [--level 1|2|3] [--custom-features] --json
```

## Orderbook structure

- `bids`: buy orders sorted by price descending
- `asks`: sell orders sorted by price ascending
- `last_trade_price`: most recent execution price
- `tick_size`: minimum price increment (e.g., 0.01)
- `min_order_size`: minimum order size
- `neg_risk`: whether negative risk is enabled

## Price history

Returns `{ history: [{ t: unix_timestamp, p: price }] }`. Intervals: `1h`, `6h`, `1d`, `1w`, `1m`, `all`. Fidelity in minutes (default 1).

## Real-time market stream

`stream-market` connects to the Polymarket CLOB WebSocket and emits JSONL events:
- `book` — full orderbook snapshot (on subscribe + after trades)
- `price_change` — delta update to specific price levels
- `last_trade_price` — trade execution with price, size, side
- `tick_size_change` — minimum tick size updated
- `best_bid_ask` — best bid/ask update (requires `--custom-features`)
- `new_market` — new market created (requires `--custom-features`)
- `market_resolved` — market resolved with winner (requires `--custom-features`)

Ping/pong every 10 seconds. Auto-reconnect with exponential backoff. Stop with SIGINT/SIGTERM.

## Batch endpoints (programmatic)

Available in `PolyClobClient` for agent use (not yet CLI-exposed):
- `getOrderBooks(tokenIds[])` — batch orderbooks
- `getBatchPrices(tokenIds[], sides[])` — batch prices
- `getBatchMidpoints(tokenIds[])` — batch midpoints
- `getBatchSpreads(tokenIds[])` — batch spreads
- `getBatchLastTradesPrices(tokenIds[])` — batch last trades (max 500)
- `getOrderScoring(orderId)` — check if order is scoring for rewards
