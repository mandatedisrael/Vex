# KyberSwap EVM Reference

This module is the authoritative guide for `echoclaw kyberswap *` — multi-chain EVM DeFi via KyberSwap Aggregator, Token API, Limit Orders, and ZaaS (Zap liquidity).

## Scope

- Token swap across 18 EVM chains via DEX aggregator (400+ DEXs)
- Token search and honeypot/fee-on-transfer safety checks
- Gasless limit orders (EIP-712 signed, off-chain relay, on-chain settlement)
- Concentrated liquidity provisioning (Zap In/Out/Migrate)
- Pool discovery via DexScreener integration

## Supported chains

| Chain | Slug | ID | Swap | LO | Zap |
|---|---|---|---|---|---|
| Ethereum | `ethereum` | 1 | Y | Y | Y |
| BSC | `bsc` | 56 | Y | Y | Y |
| Arbitrum | `arbitrum` | 42161 | Y | Y | Y |
| Polygon | `polygon` | 137 | Y | Y | Y |
| Optimism | `optimism` | 10 | Y | Y | Y |
| Avalanche | `avalanche` | 43114 | Y | Y | Y |
| Base | `base` | 8453 | Y | Y | Y |
| Linea | `linea` | 59144 | Y | Y | Y |
| Mantle | `mantle` | 5000 | Y | Y | - |
| Sonic | `sonic` | 146 | Y | Y | Y |
| Berachain | `berachain` | 80094 | Y | Y | Y |
| Ronin | `ronin` | 2020 | Y | Y | Y |
| Unichain | `unichain` | 130 | Y | Y | - |
| HyperEVM | `hyperevm` | 999 | Y | Y | - |
| Plasma | `plasma` | 9745 | Y | Y | - |
| Etherlink | `etherlink` | 42793 | Y | Y | - |
| Monad | `monad` | 143 | Y | Y | - |
| MegaETH | `megaeth` | 4326 | Y | Y | - |
| Scroll | `scroll` | 534352 | - | - | Y |
| zkSync | `zksync` | 324 | - | - | Y |

Chain aliases: `eth`, `arb`, `base`, `op`, `poly`/`matic`, `bsc`, `avax`, `linea`, `mantle`, `sonic`, `bera`, `ronin`, `zk`/`era`→zksync

## Core commands

```bash
# Chain discovery
echoclaw kyberswap chains --json

# Token search and safety
echoclaw kyberswap tokens search <query> --chain <chain> [--whitelisted] [--limit <n>] --json
echoclaw kyberswap tokens check <address> --chain <chain> --json

# Swap (exact-input only, no swap buy)
echoclaw kyberswap swap quote <tokenIn> <tokenOut> --chain <chain> --amount-in <amount> --json
echoclaw kyberswap swap sell <tokenIn> <tokenOut> --chain <chain> --amount-in <amount> [--slippage-bps <bps>] [--recipient <addr>] [--permit <hex>] [--approve-exact] --dry-run --json
echoclaw kyberswap swap sell <tokenIn> <tokenOut> --chain <chain> --amount-in <amount> [--slippage-bps <bps>] [--permit <hex>] --yes --json

# Limit orders (gasless creation)
echoclaw kyberswap limit-order create --chain <chain> --maker-asset <token> --taker-asset <token> --making-amount <amount> --taking-amount <amount> --expires <duration> --dry-run --json
echoclaw kyberswap limit-order create ... --yes --json
echoclaw kyberswap limit-order list --chain <chain> [--status active|filled|cancelled|expired] --json
echoclaw kyberswap limit-order cancel <orderId> --chain <chain> --yes --json
echoclaw kyberswap limit-order hard-cancel <orderId> --chain <chain> --yes --json
echoclaw kyberswap limit-order fill <orderId> --chain <chain> --taking-amount <amount> --threshold <amount> [--dry-run] --yes --json

# Liquidity (ZaaS)
echoclaw kyberswap zap search <token> --chain <chain> [--limit <n>] --json
echoclaw kyberswap zap in --chain <chain> --dex <dex> --pool <addr> --token-in <token> --amount-in <amount> --tick-lower <tick> --tick-upper <tick> [--position <id>] [--slippage-bps <bps>] --dry-run --json
echoclaw kyberswap zap in ... --yes --json
echoclaw kyberswap zap out --chain <chain> --dex <dex> --pool <addr> --position <id> --token-out <token> [--liquidity <amount>] --yes --json
echoclaw kyberswap zap migrate --chain <chain> --dex-from <dex> --dex-to <dex> --pool-from <addr> --pool-to <addr> --position <id> [--tick-lower <tick>] [--tick-upper <tick>] --yes --json
```

## Token resolution

- Hex address: used as-is
- `native` or `ETH`: mapped to `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`
- Symbol (e.g. `USDC`): auto-resolved via Token API search (whitelisted tokens first)

## Execution model

- All read commands (`chains`, `tokens search/check`, `swap quote`, `limit-order list`, `zap search`) are safe and idempotent
- All write commands require `--yes`; without it, exit with `CONFIRMATION_REQUIRED`
- `--dry-run` shows preview/quote without wallet access
- `--json` routes UI to stderr, structured output to stdout (global flag)
- Default slippage: 50 bps (0.5%) for swap, 100 bps (1%) for zap
- Expiry format: `30m`, `1h`, `7d`

## Agent-safe flows

### Swap:
1. `echoclaw wallet ensure --json`
2. `echoclaw kyberswap tokens search USDC --chain ethereum --json` (if symbol, not address)
3. `echoclaw kyberswap swap quote ETH USDC --chain ethereum --amount-in 0.1 --json`
4. `echoclaw kyberswap swap sell ETH USDC --chain ethereum --amount-in 0.1 --yes --json`

### Limit order:
1. `echoclaw wallet ensure --json`
2. `echoclaw kyberswap tokens search USDC --chain polygon --json`
3. `echoclaw kyberswap limit-order create --chain polygon --maker-asset 0x... --taker-asset 0x... --making-amount 100 --taking-amount 0.003 --expires 1h --dry-run --json`
4. `echoclaw kyberswap limit-order create ... --yes --json`
5. `echoclaw kyberswap limit-order list --chain polygon --json`

### Zap liquidity:
1. `echoclaw wallet ensure --json`
2. `echoclaw kyberswap zap search USDC --chain arbitrum --json` (find best pools)
3. `echoclaw kyberswap zap in --chain arbitrum --dex DEX_UNISWAPV3 --pool 0x... --token-in 0xEeee... --amount-in 0.5 --tick-lower -887220 --tick-upper 887220 --dry-run --json`
4. `echoclaw kyberswap zap in ... --yes --json`

## ZaaS DEX IDs

Common values: `DEX_UNISWAPV3`, `DEX_UNISWAPV2`, `DEX_UNISWAPV4`, `DEX_PANCAKESWAPV3`, `DEX_PANCAKESWAPV2`, `DEX_SUSHISWAPV3`, `DEX_SUSHISWAPV2`, `DEX_AERODROME_CL`, `DEX_AERODROME_BASIC`, `DEX_CURVE`, `DEX_BALANCER`, `DEX_CAMELOTV3`, `DEX_VELODROME_SLIPSTREAM`

## Contracts

- MetaAggregationRouterV2: `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` (all chains)
- DSLOProtocol: `0xcab2FA2eeab7065B45CBcF6E3936dDE2506b4f6C` (all LO chains)
- KSZapRouterPosition: `0x0e97c887b61ccd952a53578b04763e7134429e05` (all ZaaS chains)

## Fee structure

- **Swap (Aggregator)**: Free — no protocol fee
- **Limit Orders**: 0.01% (Super Stable) to 1% (Super High Volatility) per fill
- **Zap (ZaaS)**: 0.01% (Stable) to 0.25% (Exotic) by pair type

## Success examples

Swap quote:
```json
{
  "success": true,
  "chain": "ethereum", "chainId": 1,
  "tokenIn": "0xEeee...", "tokenOut": "0xA0b8...",
  "amountIn": "100000000000000000", "amountOut": "200000000",
  "amountInUsd": "200.00", "amountOutUsd": "200.00",
  "routerAddress": "0x6131...", "routeID": "abc123"
}
```

Swap execute:
```json
{
  "success": true,
  "txHash": "0xdef...",
  "chain": "ethereum", "chainId": 1,
  "amountIn": "100000000000000000", "amountOut": "200000000"
}
```

Limit order create:
```json
{
  "success": true,
  "orderId": 12345,
  "chain": "polygon", "chainId": 137,
  "makerAsset": "0x2791...", "takerAsset": "0x1BFD..."
}
```

## Error codes

- `KYBER_API_ERROR` — generic API error
- `KYBER_TIMEOUT` — request timeout
- `KYBER_RATE_LIMITED` — too many requests (retryable)
- `KYBER_UNSUPPORTED_CHAIN` — chain not supported
- `KYBER_ROUTE_NOT_FOUND` — no swap route found
- `KYBER_TOKEN_NOT_FOUND` — token not found on chain
- `KYBER_AMOUNT_TOO_LARGE` — amountIn exceeds maximum
- `KYBER_FEE_EXCEEDS_AMOUNT` — fee configuration error
- `KYBER_HONEYPOT_CHECK_FAILED` — safety check failed
- `KYBER_LO_*` — limit order specific errors
- `KYBER_ZAP_*` — ZaaS specific errors
- `CONFIRMATION_REQUIRED` — add `--yes` to execute

## Overlap — what NOT to use KyberSwap for

- **0G chain swaps** → use `jaine swap` (KyberSwap does not support 0G)
- **0G LP management** → use `jaine lp` (KyberSwap ZaaS does not support 0G)
- **Solana swaps** → use `solana swap` (Jupiter)
- **Cross-chain bridge** → use `khalani bridge`
- **Token analytics** (price charts, volume, trending) → use `dexscreener`
- **Cross-chain token discovery** → use `khalani tokens search`
- **Token search for EVM trading** (need address for swap) → use `kyberswap tokens search`
