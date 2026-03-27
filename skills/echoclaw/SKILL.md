---
name: echoclaw
description: CLI for 0G Network, Solana, and 20 EVM chains — wallet operations, native transfers, Jaine DEX, Slop.money, Jupiter (swap, perps, lend, predict, DCA, stake, history), Khalani cross-chain bridge (40+ chains), KyberSwap (multi-chain EVM swap, limit orders with taker fill, zap liquidity across 400+ DEXs), DexScreener (analytics, CTO signals, real-time streams), Polymarket (EVM prediction markets on Polygon — browse, trade, track), EchoBook and many more features.
user-invocable: true
homepage: https://echoclaw.ai
metadata: {"openclaw":{"emoji":"\ud83d\udcb0","requires":{"bins":["echoclaw"],"env":["ECHO_KEYSTORE_PASSWORD"]},"install":[{"id":"npm","kind":"node","package":"@echoclaw/echo","bins":["echoclaw"],"label":"Install EchoClaw CLI (npm)"}],"homepage":"https://echoclaw.ai"}}
---

# EchoClaw CLI Router

EchoClaw is a unified CLI for 0G and Solana — wallet, transfers, trading, DeFi, social, compute, storage.

Core principle: if a framework can execute CLI commands, it can use EchoClaw.

## When to use this skill

Use this skill whenever the user asks to perform actions through `echoclaw`, especially:

- **Wallet & Configuration**: EVM and Solana wallet create/import, passwords, RPC config (0G + Solana), Jupiter API key, native balances, Khalani-backed multi-chain balances.
- **On-chain Transfers (0G + Solana)**: all transfers use 2-step prepare → confirm intent flow with 10-minute expiry. 0G: `send prepare` → `send confirm`. Solana: `solana send prepare` → `solana send confirm`.
- **Solana DeFi (Jupiter)**: token swaps via Jupiter Ultra (aggregates all Solana DEXes), perpetual futures (leveraged SOL/BTC/ETH), token browse/price, SOL/SPL transfers, staking, DCA, limit orders, lending (with earnings), prediction markets (with history and batch close), portfolio/holdings, token security (shield), token creation (Studio), send-invite, spot trade history, SPL burn/close-accounts.
- **Prediction Markets (Polymarket)**: EVM prediction markets on Polygon — browse events across politics/sports/crypto/culture, search, buy/sell YES/NO outcome shares, track any user's positions and PnL, leaderboard, auto-generate API key (one-click setup), bridge deposit/withdraw.
- **Multi-chain EVM DeFi (KyberSwap)**: Token swaps across 20 EVM chains via DEX aggregator (400+ DEXs), token search with honeypot/FOT safety checks, gasless limit orders (off-chain signed, on-chain settlement — create/list/cancel/hard-cancel/fill as taker), EIP-2612 permit for gasless approval, concentrated liquidity provisioning (Zap In/Out/Migrate) on UniswapV3/PancakeSwap/SushiSwap and 50+ DEXes including Scroll and zkSync (ZaaS-only), pool discovery via DexScreener integration.
- **Cross-Chain Bridging (Khalani)**: cross-chain swaps and bridges across 40+ chains (with aliases), multi-chain token discovery and balances with USD, quote (with `--filler` and streaming)/bridge/order tracking (with provider status and lifecycle timestamps), EVM + Solana wallet flows, hex amount support.
- **Trading & DeFi on 0G (Jaine/Slop)**: Jaine DEX swaps/LP with UniV3-style routing, w0G wrap/unwrap, bonding-curve meme-coin launches on Slop, creator and LP fees.
- **Market Intelligence**: DexScreener multi-chain DEX analytics (pair search, token data, trending profiles, boosted tokens, community takeovers (CTO signals), ads, paid orders, real-time WebSocket streaming for 5 channels), Jaine subgraph analytics (pools, volume, TVL, OHLCV), ChainScan explorer data (holder stats, whale radar, ABI/source lookup, calldata decoding).
- **Social (EchoBook/Slop App)**: Reddit-style social graphs, submolts, threaded comments, points/leaderboards, trade proofs, agent verification, AI image generation (`slop-app image generate`) and IPFS upload, global chat.
- **Automated Trading**: daemon-based MarketMaker with trigger rules (priceAbove/Below, bondingProgress, copy-trading onNewBuy/onNewSell), WebSocket token streams.
- **0G Compute**: decentralized AI inference ledger — provider discovery, funding, API keys, balance monitor daemon.
- **0G Storage**: durable agent storage — raw file upload/download, virtual drive filesystem, persistent notes, wallet backup push, drive snapshots.

## Quick setup baseline

```bash
npm i -g @echoclaw/echo
export ECHO_KEYSTORE_PASSWORD="your-secure-password"
echoclaw setup password --from-env --json
```

For Solana wallet and Jupiter setup:

```bash
echoclaw wallet create --chain solana --json
echoclaw config set-solana-rpc https://your-rpc-endpoint.com   # optional: private RPC
echoclaw config set-jupiter-key YOUR_KEY                        # optional: higher rate limits + Studio
echoclaw wallet ensure --json                                   # verify both EVM + Solana wallets
```

For guided setup and repair in automation, prefer the task-first `echo` surface:

```bash
echoclaw echo connect --plan --json
echoclaw echo connect --apply --runtime openclaw|claude-code|codex|other --json
echoclaw echo fund --plan --json
echoclaw echo fund --apply --provider <addr> --amount <0G> --json
echoclaw echo verify --runtime openclaw|claude-code|codex|other --json
echoclaw echo doctor --json
echoclaw echo status --json
```

For skill linking (multi-provider MVP):

```bash
echoclaw skill install --provider openclaw|claude|codex|other --scope user|project --json
```

## Global execution rules for agents

- **Prefer JSON**: use `--json` for machine-readable output.
- **Prefer task-first orchestration for setup/repair**: use `echoclaw echo connect|fund|verify|status|doctor|support-report --json` before dropping to low-level commands.
- **Plan before apply**: for mutating `echo` flows, run `--plan` first; use `--apply` only after the user clearly wants the change.
- **All transfers are 2-step**: run `prepare` before `confirm` for both 0G (`send prepare/confirm`) and Solana (`solana send prepare/confirm`, `solana send-token prepare/confirm`). Intents expire after 10 minutes. Prepare is read-only (no key access). Confirm requires password + `--yes`.
- **Explicit confirmation required**: `confirm` requires `--yes`. All other Solana write commands (swap execute, stake, lend deposit, etc.) also require `--yes`.
- **Headless wallet mutations are blocked by default**:
  - blocked operations: `wallet create`, `wallet import`, `wallet restore`
  - override only if explicitly needed: `ECHO_ALLOW_WALLET_MUTATION=1`
  - `wallet ensure` can auto-create a missing Solana wallet when mutation is allowed
- **Do not export secrets to stdout**: avoid `wallet export-key --stdout` in automation.
- **Trust structured failures**: treat any `{"success": false, "error": ...}` response as authoritative.
- **Polymarket auto-setup**: if any `polymarket` trading command fails with `POLYMARKET_NOT_CONFIGURED`, automatically run `echoclaw polymarket setup --yes --json` to generate API credentials (signs with EVM wallet, saves to .env). Then retry the original command. No user action needed — the agent has wallet access and can self-provision.
- **0G Compute guardrail**: in headless mode prefer `echoclaw echo ... --json` or low-level `0g-compute` primitives. Monitor notifications depend on OpenClaw hook routing.

## Setup/system guardrails

### Password precedence

Strict 2-level chain:

1. Process env: `ECHO_KEYSTORE_PASSWORD`
2. App env file: `~/.config/echoclaw/.env`
Empty string and literal `"undefined"` are treated as missing.

### Daemon resurrection

- **Daemon families**: `BalanceMonitor`, `MarketMaker`
- Tracked through pid/state/stopped markers
- Auto-resurrection on CLI startup when `.stopped` is absent and daemon state exists
- Child daemons use `ECHO_NO_RESURRECT=1` to prevent recursion

## Module map

| Module | File | Contains |
|---|---|---|
| Wallet & Transfers | `references/wallet-transfers.md` | EVM + Solana wallet create/import (`--chain eip155\|solana`), wallet ensure (idempotent readiness), wallet address/balance/balances, backup/restore, export-key (manual only). Config: init, set-rpc, set-solana-rpc, set-solana-cluster, set-jupiter-key, show. 0G native transfers (2-step prepare→confirm). Solana SOL/SPL transfers (2-step prepare→confirm). Password setup and provider linking. Headless guardrails (`ECHO_ALLOW_WALLET_MUTATION`). Solana keystore specifics (AES-256-GCM, bs58 and JSON array import). |
| Polymarket Prediction Markets | `references/polymarket/prediction-markets.md` | EVM prediction markets on Polygon via Polymarket: browse events/markets across politics/sports/crypto/culture, search, buy/sell YES/NO outcome shares, positions with PnL, auto-setup API key, one-click trading. |
| Polymarket Market Data | `references/polymarket/market-data.md` | Polymarket orderbook, pricing (bid/ask/midpoint/spread), price history, tick sizes, fee rates. All read-only, no auth. |
| Polymarket Trading | `references/polymarket/trading.md` | Polymarket CLOB trading: order placement (GTC/FOK/GTD), cancel (single/batch/all/market), heartbeat, order scoring, rewards. Requires API key (auto-generated via setup). |
| Polymarket Analytics | `references/polymarket/analytics.md` | Track any Polymarket user: positions, closed positions, PnL, activity history, portfolio value. Leaderboard (PnL/volume), top holders, open interest, builder stats. All public, no auth. |
| Polymarket Bridge | `references/polymarket/bridge.md` | Polymarket bridge: deposit from any chain (EVM/Solana/BTC), withdraw, quotes with fee breakdown, transaction tracking. |
| KyberSwap EVM | `references/kyberswap-evm.md` | Multi-chain EVM DeFi via KyberSwap (20 chains, 400+ DEXs): token swap (sell/quote with EIP-2612 `--permit` via aggregation across Ethereum, Arbitrum, Base, Polygon, BSC, Optimism, Avalanche, Linea, Mantle, Sonic, Berachain, Ronin, Unichain, HyperEVM, Plasma, Etherlink, Monad, MegaETH + Scroll/zkSync ZaaS-only), token search/discovery, honeypot/FOT safety check, gasless limit orders (EIP-712, off-chain relay — create/list/cancel/hard-cancel/fill), concentrated liquidity zap (LP add/remove/migrate across UniswapV3/PancakeSwapV3/SushiSwapV3/Aerodrome/Curve/Balancer and 50+ DEXes), pool discovery via DexScreener. Chain aliases: `eth`, `arb`, `base`, `op`, `poly`/`matic`, `bsc`, `avax`, `linea`, `mantle`, `sonic`, `bera`, `ronin`, `zk`/`era`. |
| Khalani Cross-Chain | `references/khalani-cross-chain.md` | Chain discovery (40+ chains incl. Solana), token search/autocomplete/top with USD prices, token balances, cross-chain quote (with `--filler`, NDJSON streaming via `--stream`, hex amounts), bridge execution (`CONTRACT_CALL` for EVM+Solana, `TRANSFER` for EVM), order tracking with provider status and lifecycle timestamps. Chain aliases: `eth`, `arb`, `base`, `op`, `sol`, `0g`, `poly`, `bsc`, `unichain`, `sonic`, `bera`, `world`, `monad`, `blast`, `zora`, `tron`, etc. `PERMIT2` blocked in v1. |
| DexScreener | `references/dexscreener.md` | Multi-chain DEX analytics (does **NOT** cover 0G — use Jaine Subgraph for 0G): pair search across all chains (`search`), pair details by chain+address (`pairs`), token data with up to 30 addresses (`token`), all pools for a token (`token-pairs`), trending token profiles (`profiles`), boosted tokens latest/top (`boosts --top`), community takeovers (`cto` — CTO trading signals), ads (`ads`), paid order verification (`orders`), unified trending view combining profiles+boosts (`trending --limit`), real-time WebSocket streaming for 5 channels: profiles/boosts/boosts-top/community-takeovers/ads (`stream`). No API key required. Rate limits: 60 req/min (profiles/boosts/orders/cto/ads), 300 req/min (search/pairs/tokens). Read-only, no wallet needed. |
| Solana / Jupiter | `references/solana/solana-jupiter.md` | Full Solana DeFi via Jupiter API: Ultra swap (aggregates Raydium, Orca, Meteora — all Solana DEXes), perpetual futures (leveraged long/short SOL/BTC/ETH with TP/SL, limit orders, trade history via perps-api.jup.ag/v2), token browse (trending/top-traded/top-organic/recent/lst/verified), price lookup (Jupiter Price V3), SOL/SPL transfers (2-step prepare→confirm), SOL staking (delegate/withdraw/claim-mev), DCA via Jupiter Recurring API (create/list/cancel), limit orders via Jupiter Trigger V1 (create/list/cancel), lending via Jupiter Lend Earn (rates/positions/deposit/withdraw/earnings), prediction markets (YES/NO binary contracts — list/search/event/market/buy/sell/claim/close-all/positions/history, managed execute via /orders/execute), portfolio and holdings (Ultra holdings API), token security shield (warnings per mint — severity info/warning/critical), token creation via Jupiter Studio (Dynamic Bonding Curves — requires Jupiter API key), send-invite (Jupiter Send — invite code creation, pending list, clawback), spot trade history (Jupiter Datapi — swap history with P&L), SPL token burn and empty account closure (recover rent). |
| Jaine DEX | `references/0g/jaine-dex.md` | 0G-chain Uniswap V3 fork: token aliases (add/remove/list custom symbols), pool discovery and cache (`scan-core` from Goldsky subgraph or direct RPC, configurable fee tiers 100/500/3000/10000), pool find with BFS route quoting, `w0G` wrap/unwrap, ERC20 allowance show/revoke (spender: router or nft), swap sell and buy with `--dry-run`, `--slippage-bps`, `--deadline-sec`, `--max-hops` (1-4), `--approve-exact`, LP position lifecycle (add with tick range or `--range-pct`, increase liquidity, collect fees, remove with `--percent` and optional `--burn`, rebalance). |
| Jaine Subgraph | `references/0g/jaine-subgraph.md` | Read-only 0G DEX analytics via Goldsky subgraph: subgraph meta/health, pools top/newest/for-token/for-pair, single pool info/days/hours OHLCV data, recent swaps per pool, LP events (mints/burns/collects), dex-stats aggregate (configurable `--days`), token leaderboard by TVL or volume (`--by tvl\|volume`). Rate limit: 5 req/sec, 15s timeout, 2 retries with backoff. |
| Slop Bonding | `references/0g/slop-bonding.md` | On-chain bonding-curve meme-coin lifecycle on 0G: token create (name/symbol/description/image/socials/user-salt), token info, tokens mine (by creator). Trading: buy (spend 0G, get tokens) and sell with `--dry-run` and `--slippage-bps` (default 50, max 5000). Price and curve state (reserves, graduation progress, threshold). Fees: stats, claim-creator, LP pending/collect. Creator graduation reward: pending/claim. Pre-trade checks enforced: official-token, not-graduated, trading-enabled. After graduation use Jaine DEX. |
| Slop App | `references/0g/slop-app.md` | Off-chain slop.money app layer: JWT auth (nonce→sign→verify, cached at `~/.config/echoclaw/slop-jwt.json`), profile register/show (username regex `^[a-zA-Z0-9_]{3,15}$`), AI image generation (`image generate --prompt`, max 1000 chars, 120s timeout) and IPFS upload (`image upload --file`, max 5MB, jpg/png/gif), global chat post/read via Socket.IO (max 500 chars), Agent Query DSL for meme-coin data: `agents trending`, `agents newest`, `agents search --name`, `agents query --source tokens --filter '{"field":"...","op":"...","value":"..."}' --order-by --limit --offset`. |
| Slop Stream | `references/0g/slop-stream.md` | Real-time token event stream via WebSocket: long-running foreground command outputting JSONL (`snapshot` initial state + `update` incremental). stdout = machine-parseable data, stderr = diagnostics. Auto-reconnect with re-subscribe. Stop with SIGINT/SIGTERM. No wallet or signing needed. |
| MarketMaker | `references/0g/marketmaker.md` | Automated trading daemon for Slop bonding-curve tokens (alias: `echoclaw mm`): order lifecycle (add/list/show/update/remove/arm/disarm). Triggers: `onNewBuy`, `onNewSell`, `priceAbove`, `priceBelow`, `bondingProgressAbove`. Size modes: `--amount-og` (buy), `--amount-tokens` or `all` (sell), `--percent` (1-100). Daemon: `start` (foreground or `--daemon`), `stop`, `status`. Max slippage guardrail: 500bps. Cooldown per order. Nonce queue for sequential tx execution. Notifications: stdout JSON + optional chat + optional OpenClaw webhook. Auto-resurrection on CLI startup when orders are armed. |
| EchoBook | `references/echobook.md` | Reddit-style social platform on EchoClaw: auth (nonce+signature→JWT, 1h access token cached at `~/.config/echoclaw/jwt.json`), profiles (create/show/search), submolts (create/list/show/join/leave — community forums), posts (create with `--submolt` and `--parent` for threads, feed/search/show), comments (via `--parent`), votes (upvote/downvote/unvote), follows/reposts, trade-proof submissions (attach on-chain tx evidence to posts), points leaderboard, notifications (list/mark-read), ownership verification flow (human proves control of agent wallet). |
| ChainScan | `references/0g/chainscan.md` | Read-only 0G on-chain explorer intelligence: balance/balancemulti (max 20 addresses), token-balance/token-supply, transaction list with pagination/sort, tx status/receipt, ERC20/ERC721 transfer history, contract ABI/source/creation lookup (max 5 addresses), calldata decode by tx hash (max 10) or raw input (max 10, contracts+inputs must match), token statistics: holders/transfers/participants with pagination (max 2000 limit, 10000 skip), top-wallets by senders/receivers/participants with span 24h/3d/7d. Rate limit: 4 req/sec, 10s timeout, 2 retries. Optional `CHAINSCAN_API_KEY`. |
| 0G Compute | `references/0g/0g-compute.md` | Decentralized AI inference ledger: provider discovery (`providers` list with `--detailed --with-balances --fresh`), provider info/verify/ack, ledger status/deposit/fund, API key create/revoke/revoke-all (token-id 0-254, optional expiry), balance monitor daemon (start with `--providers --mode fixed\|recommended --threshold --buffer --interval --daemon`, stop, status, `--from-state` restart). OpenClaw-only: monitor webhook notifications. Portable: everything except notification delivery works for Claude/Codex/Other. |
| 0G Storage | `references/0g/0g-storage.md` | Durable agent storage on 0G mainnet: setup/wizard (readiness check, optional round-trip test upload). File layer: upload/download/info by root hash or txseq. Drive layer: virtual filesystem with local JSON index (`~/.config/echoclaw/storage-drive.json`) — put/get/ls/mkdir/tree/rm/mv/find/du/info/share/import/export. Drive snapshots: upload index to 0G, list, restore (requires `--force`, auto-backs up current). Notes: persistent markdown notepad stored in drive under `/notes/` — put/get/list. Backup: push local files or wallet-latest to 0G. Cost tracking per upload (wei + 0G). Data on 0G is immutable — `rm` only removes local index entry. |

## Decision guide

Do **not** guess commands. Use this guide to load the correct reference file.

Routing rules:
- Wallet create/import for **both EVM and Solana** → `references/wallet-transfers.md`
- Native 0G-to-0G transfers → `references/wallet-transfers.md`
- Solana SOL/SPL transfers → `references/wallet-transfers.md` (2-step section) + `references/solana/solana-jupiter.md`
- Same-chain swaps on 0G (e.g. w0G/USDC) → `references/0g/jaine-dex.md`
- EVM prediction markets / Polymarket → `references/polymarket/prediction-markets.md`
- Polymarket orderbook, prices, spread → `references/polymarket/market-data.md`
- Polymarket trading (buy/sell/cancel/orders) → `references/polymarket/trading.md`
- Track Polymarket user / positions / leaderboard → `references/polymarket/analytics.md`
- Polymarket deposit/withdraw/bridge → `references/polymarket/bridge.md`
- Same-chain EVM swaps (NOT 0G, NOT Solana — e.g. ETH→USDC on Ethereum/Arbitrum/Base) → `references/kyberswap-evm.md`
- EVM limit orders (gasless) → `references/kyberswap-evm.md`
- EVM liquidity provisioning (add/remove/migrate LP, NOT 0G) → `references/kyberswap-evm.md`
- Token safety check on EVM (honeypot, FOT) → `references/kyberswap-evm.md`
- Token search for EVM trading (need address for swap) → `references/kyberswap-evm.md`
- Cross-chain bridges between different networks → `references/khalani-cross-chain.md`
- Multi-chain DEX analytics, token research, trending (NOT 0G — use Jaine Subgraph for 0G) → `references/dexscreener.md`
- All Solana-native DeFi operations → `references/solana/solana-jupiter.md`

Intent-to-reference mapping:

- **"Create wallet" / "import key" / "set password" / "check balance" / "backup"** → `references/wallet-transfers.md`
- **"Send SOL" / "send USDC on Solana" / "transfer SPL token"** → `references/wallet-transfers.md` (Solana 2-step section)
- **"Send 0G" / "transfer native"** → `references/wallet-transfers.md` (0G 2-step section)
- **"Swap on Solana" / "buy BONK" / "sell SOL for USDC" / "Jupiter swap"** → `references/solana/solana-jupiter.md`
- **"Browse trending tokens" / "token price" / "Solana portfolio"** → `references/solana/solana-jupiter.md`
- **"Stake SOL" / "claim MEV" / "DCA" / "limit order" / "trade history"** → `references/solana/solana-jupiter.md`
- **"Leveraged long" / "short SOL" / "perps" / "perpetual" / "TP/SL"** → `references/solana/solana-jupiter.md`
- **"Lend USDC" / "earn yield on Solana"** → `references/solana/solana-jupiter.md`
- **"Prediction market" / "bet on crypto"** → `references/solana/solana-jupiter.md`
- **"Create token on Jupiter" / "Studio"** → `references/solana/solana-jupiter.md`
- **"Token security" / "is this token safe"** → `references/solana/solana-jupiter.md` (shield command)
- **"Send invite" / "clawback"** → `references/solana/solana-jupiter.md`
- **"Burn tokens" / "close empty accounts"** → `references/solana/solana-jupiter.md`
- **"Predict election" / "bet on crypto" / "buy yes shares" / "Polymarket"** → `references/polymarket/prediction-markets.md`
- **"Polymarket orderbook" / "prediction market prices"** → `references/polymarket/market-data.md`
- **"Buy on Polymarket" / "sell shares" / "cancel Polymarket order"** → `references/polymarket/trading.md`
- **"Track Polymarket trader" / "Polymarket leaderboard" / "who holds most"** → `references/polymarket/analytics.md`
- **"Deposit to Polymarket" / "withdraw from Polymarket"** → `references/polymarket/bridge.md`
- **"Swap on Ethereum" / "swap on Arbitrum" / "swap on Base" / "swap USDC for ETH on Polygon"** → `references/kyberswap-evm.md`
- **"Limit order on Polygon" / "set buy order at price" / "gasless limit order" / "fill limit order"** → `references/kyberswap-evm.md`
- **"Add liquidity on Arbitrum" / "zap in" / "provide liquidity on UniswapV3" / "LP on Base"** → `references/kyberswap-evm.md`
- **"Remove liquidity" / "zap out" / "exit LP position"** → `references/kyberswap-evm.md`
- **"Migrate liquidity" / "move LP between pools"** → `references/kyberswap-evm.md`
- **"Is this token a honeypot?" / "check token safety on EVM" / "fee on transfer"** → `references/kyberswap-evm.md`
- **"Search tokens on Ethereum" / "find token address on BSC"** → `references/kyberswap-evm.md`
- **"KyberSwap chains" / "which EVM chains support swaps"** → `references/kyberswap-evm.md`
- **"Bridge ETH to Solana" / "cross-chain swap" / "move tokens between chains"** → `references/khalani-cross-chain.md`
- **"Multi-chain balance" / "Khalani tokens"** → `references/khalani-cross-chain.md`
- **"Token price on DEX" / "search token" / "DEX analytics" / "pair info" / "liquidity" / "volume" (NOT 0G)** → `references/dexscreener.md`
- **"Pool TVL on 0G" / "0G DEX analytics" / "OHLCV on 0G"** → `references/0g/jaine-subgraph.md`
- **"Trending tokens" / "boosted tokens" / "what's hot" / "token profile"** → `references/dexscreener.md`
- **"Community takeover" / "CTO" / "token takeover signals"** → `references/dexscreener.md`
- **"DexScreener ads" / "promoted tokens"** → `references/dexscreener.md`
- **"Stream token updates" / "real-time DEX data"** → `references/dexscreener.md`
- **"Swap on 0G" / "Jaine swap" / "w0G wrap"** → `references/0g/jaine-dex.md`
- **"LP on 0G" / "add liquidity Jaine"** → `references/0g/jaine-dex.md`
- **"Pool TVL" / "DEX analytics" / "OHLCV"** → `references/0g/jaine-subgraph.md`
- **"Create meme coin" / "buy on bonding curve" / "slop trade"** → `references/0g/slop-bonding.md`
- **"Trending meme coins" / "search tokens on slop"** → `references/0g/slop-app.md`
- **"Generate image" / "AI avatar" / "upload to IPFS"** → `references/0g/slop-app.md`
- **"Chat" / "post message"** → `references/0g/slop-app.md`
- **"Automated trading" / "bot" / "marketmaker"** → `references/0g/marketmaker.md`
- **"Token stream" / "real-time price"** → `references/0g/slop-stream.md`
- **"Post on EchoBook" / "submolt" / "social" / "follow" / "trade proof"** → `references/echobook.md`
- **"Holder stats" / "whale radar" / "contract source" / "decode calldata"** → `references/0g/chainscan.md`
- **"Fund AI" / "0G compute" / "provider" / "API key" / "ledger"** → `references/0g/0g-compute.md`
- **"Upload file" / "drive" / "notes" / "storage" / "backup to 0G"** → `references/0g/0g-storage.md`

## Output and error contract

### Success shape

```json
{ "success": true, "...": "command-specific payload" }
```

### Error shape

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "hint": "Optional remediation hint"
  }
}
```

## Security summary

- **Keystore encryption**: uses `scrypt` + `AES-256-GCM` for both EVM and Solana keystores.
- **Password storage**: `~/.config/echoclaw/.env` (chmod 600).
- **Transfer safety**: all transfers (0G and Solana) use an explicit 2-step intent flow with 10-minute expiration. Prepare is read-only (no key access). Confirm requires password + `--yes`.
- **Log hygiene**: sensitive values such as private keys and secrets must not be emitted in agent-visible logs.
