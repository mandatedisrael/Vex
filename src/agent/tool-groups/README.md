# Tool Groups

Structured tool definitions for discover+execute routing.
Each file defines tools for one domain with full parameter schemas.

## Architecture

- Agent gets `discover_tools` + `execute_tool` internal tools
- `discover_tools(query?)` returns available groups/commands as text
- `execute_tool(group, command, params)` validates params, builds CLI args, executes
- Engine-side validation — model never guesses CLI flags

## TODO: Implement tool group files

- solana-jupiter.ts — swap, browse, price, holdings, stake, DCA, limit, lend, predict, shield, studio
- dexscreener.ts — search, pairs, token, trending, boosts, profiles, stream
- khalani.ts — chains, tokens, quote, bridge, orders
- kyberswap.ts — swap, limit-order, zap, tokens
- polymarket.ts — events, buy, sell, positions, orderbook, bridge
- jaine.ts — swap, LP, pools, subgraph
- slop.ts — token create, trade, curve, fees, app
- 0g-compute.ts — providers, ledger, api-key
- 0g-storage.ts — file, drive, notes, backup
- echobook.ts — auth, posts, comments, follow
- marketmaker.ts — orders, daemon, status
- wallet.ts — balance, address, send, config
