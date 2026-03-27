# Polymarket Trading Reference

Order placement, cancellation, heartbeat, rewards. Requires CLOB API key.

## Setup

```bash
echoclaw polymarket setup --yes --json
```
Auto-generates API key by signing with EVM wallet. Saves to `~/.config/echoclaw/.env`. One-click, zero manual copy.

## Buy/Sell

```bash
# Buy YES shares for 10 USDC at 50 cents each
echoclaw polymarket buy <condition-id> --outcome yes --amount 10 --price 0.5 --dry-run --json
echoclaw polymarket buy <condition-id> --outcome yes --amount 10 --price 0.5 --yes --json

# Sell 20 NO shares
echoclaw polymarket sell <condition-id> --outcome no --amount 20 --yes --json

# Order types: GTC (default), FOK (fill-or-kill), GTD (good-till-date)
echoclaw polymarket buy <id> --outcome yes --amount 5 --type FOK --yes --json
```

## Cancel

```bash
echoclaw polymarket cancel <orderId> --yes --json
echoclaw polymarket cancel-all --yes --json
echoclaw polymarket cancel-market <condition-id> <asset-id> --yes --json
```

## Order management

```bash
echoclaw polymarket orders [--market <condition-id>] --json
```

## Real-time user stream

```bash
echoclaw polymarket stream-user [--markets <conditionId1> <conditionId2>] --json
```

Authenticated WebSocket emitting JSONL events:
- `order` — order placed/updated/cancelled (type: PLACEMENT/UPDATE/CANCELLATION)
- `trade` — trade matched/mined/confirmed/failed (trader_side: TAKER/MAKER)

Requires CLOB API credentials. Ping/pong every 10s. Auto-reconnect. Stop with SIGINT/SIGTERM.

## Fee structure

Base fee: ~30 bps (0.3%). Varies by token. Check via `polymarket market <id>` (shows `makerBaseFee`/`takerBaseFee`).
