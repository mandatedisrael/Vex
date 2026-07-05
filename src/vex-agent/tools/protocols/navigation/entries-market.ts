import type { ProtocolNamespaceNavigation } from "./types.js";

export const MARKET_PROTOCOL_NAVIGATION: readonly ProtocolNamespaceNavigation[] = [
  {
    namespace: "khalani",
    advertised: true,
    groupId: "cross-chain",
    groupLabel: "Cross-chain",
    summary: "Cross-chain bridge, token resolver, balances, quotes, and order tracking across EVM + Solana chains.",
    whenToUse:
      "Use when the task crosses chains or needs a canonical multi-chain token resolver, wallet balances, bridge quote, or bridge execution flow.",
    preferInstead:
      "Use `kyberswap` for EVM-only swaps/limit orders and `solana` for Solana-only swaps.",
    exampleQueries: [
      'discover_tools(query="token search", namespace="khalani")',
      'discover_tools(query="bridge quote", namespace="khalani")',
      'discover_tools(query="cross-chain order status", namespace="khalani")',
    ],
    aliases: ["bridge", "cross chain", "hyperstream", "multi chain token resolver"],
    discoveryHints: [
      "bridge quote",
      "cross-chain transfer",
      "token resolver",
      "balances across chains",
      "bridge order status",
    ],
    facets: [
      {
        label: "Chains and token resolution",
        summary: "List supported chains and resolve/search token metadata before any multi-chain or EVM mutation.",
        toolPrefixes: ["khalani.chains", "khalani.tokens"],
        hints: ["supported chains", "token search", "token autocomplete", "wallet balances"],
      },
      {
        label: "Bridge quotes and orders",
        summary: "Quote/execute cross-chain transfers and inspect bridge order lifecycle.",
        toolPrefixes: ["khalani.quote", "khalani.orders", "khalani.bridge"],
        hints: ["bridge quote", "bridge usdc", "order status", "cross-chain bridge"],
      },
    ],
  },
  {
    namespace: "relay",
    advertised: true,
    groupId: "cross-chain",
    groupLabel: "Cross-chain",
    summary: "Keyless cross-chain bridge (Relay) — the ONLY bridge to/from Robinhood Chain (4663); also bridges across its wider chain registry.",
    whenToUse:
      "Use to bridge funds to or from Robinhood Chain (Khalani does not cover 4663): bridge ETH/USDG/VIRTUAL in to fund trading, or bridge back out, then swap on-chain via uniswap.",
    preferInstead:
      "Use `khalani` for bridges between its supported chains; use `relay` whenever either side is Robinhood Chain (or Khalani lacks the route).",
    exampleQueries: [
      'discover_tools(query="bridge to robinhood", namespace="relay")',
      'discover_tools(query="bridge quote relay", namespace="relay")',
      'discover_tools(query="bridge out of robinhood", namespace="relay")',
    ],
    aliases: ["relay", "bridge to robinhood", "bridge from robinhood", "fund robinhood"],
    discoveryHints: ["bridge to robinhood", "bridge from robinhood", "relay bridge quote", "fund robinhood wallet"],
    facets: [
      {
        label: "Bridge quotes and execution",
        summary: "Quote/execute keyless cross-chain bridges to and from Robinhood Chain and Relay's other chains.",
        toolPrefixes: ["relay.quote", "relay.bridge"],
        hints: ["bridge quote", "bridge to robinhood", "bridge eth", "cross-chain transfer"],
      },
    ],
  },
  {
    namespace: "kyberswap",
    advertised: true,
    groupId: "evm-trading",
    groupLabel: "EVM Trading",
    summary: "EVM-only swaps, limit orders, zap liquidity, and token safety checks across KyberSwap routes.",
    whenToUse:
      "Use when the user wants EVM execution on an existing chain: swap, place/fill/cancel limit orders, zap into liquidity, or run honeypot/FOT checks.",
    preferInstead:
      "Use `khalani` to resolve cross-chain token addresses first, `solana` for Solana trading, and `dexscreener` for read-only research.",
    exampleQueries: [
      'discover_tools(query="swap on base", namespace="kyberswap")',
      'discover_tools(query="limit order", namespace="kyberswap")',
      'discover_tools(query="zap liquidity", namespace="kyberswap")',
    ],
    aliases: ["kyber", "evm swap", "limit order", "zap liquidity"],
    discoveryHints: ["swap on ethereum", "limit order", "fill order", "zap liquidity", "honeypot check"],
    facets: [
      {
        label: "Chains and token safety",
        summary: "Inspect supported chains, search token metadata, and run honeypot/FOT safety checks.",
        toolPrefixes: ["kyberswap.chains", "kyberswap.tokens"],
        hints: ["supported evm chains", "token search", "honeypot", "fee on transfer"],
      },
      {
        label: "Swaps",
        summary: "Quote or execute routed swaps on EVM chains after token resolution.",
        toolPrefixes: ["kyberswap.swap"],
        hints: ["swap quote", "sell token", "buy token", "route build"],
      },
      {
        label: "Limit orders",
        summary: "Create, list, cancel, hard-cancel, or fill gasless limit orders.",
        toolPrefixes: ["kyberswap.limitOrder"],
        hints: ["limit order", "cancel order", "fill order", "active making amount"],
      },
      {
        label: "Zaps and LP",
        summary: "Search pools and zap in/out/migrate concentrated-liquidity positions.",
        toolPrefixes: ["kyberswap.zap"],
        hints: ["zap liquidity", "lp position", "migrate lp", "pool search"],
      },
    ],
  },
  {
    namespace: "uniswap",
    advertised: true,
    groupId: "evm-trading",
    groupLabel: "EVM Trading",
    summary: "Keyless on-chain Uniswap V2/V3 swaps (best route). The ONLY venue on Robinhood Chain (4663) — where $VEX and Virtuals agent tokens trade against VIRTUAL — and an all-EVM fallback for KyberSwap.",
    whenToUse:
      "Use for swaps on Robinhood Chain (the only venue there — quote/sell/buy against VIRTUAL/ETH), or as a fallback on any EVM chain when KyberSwap is unavailable. Pass token contract ADDRESSES (no symbol search).",
    preferInstead:
      "Prefer `kyberswap` on the chains it supports (aggregated pricing + token safety flags); use `uniswap` on Robinhood Chain or when Kyber lacks the chain/route.",
    exampleQueries: [
      'discover_tools(query="swap on robinhood", namespace="uniswap")',
      'discover_tools(query="uniswap quote", namespace="uniswap")',
      'discover_tools(query="buy vex with virtual", namespace="uniswap")',
    ],
    aliases: ["uniswap", "robinhood swap", "v2 v3 swap", "uniswap fallback"],
    discoveryHints: ["swap on robinhood", "uniswap quote", "buy on robinhood", "sell on robinhood", "virtual to vex"],
    facets: [
      {
        label: "Swaps",
        summary: "Quote or execute best-route V2/V3 swaps after resolving token addresses.",
        toolPrefixes: ["uniswap.swap"],
        hints: ["swap quote", "sell token", "buy token", "robinhood swap", "best route v2 v3"],
      },
    ],
  },
  {
    namespace: "solana",
    advertised: true,
    groupId: "solana",
    groupLabel: "Solana",
    summary: "Jupiter-backed Solana surface for token search, prices, swaps, lending, and prediction markets.",
    whenToUse:
      "Use when the task is Solana-only: resolve mints, fetch Jupiter prices, swap on Solana, inspect lend positions, or trade Jupiter prediction markets.",
    preferInstead:
      "Use `polymarket` for Polygon prediction markets, `khalani` for cross-chain bridging, and `kyberswap` for EVM-only execution.",
    exampleQueries: [
      'discover_tools(query="solana token search", namespace="solana")',
      'discover_tools(query="swap on solana", namespace="solana")',
      'discover_tools(query="solana prediction markets", namespace="solana")',
    ],
    aliases: ["jupiter", "solana swap", "solana lending", "solana prediction"],
    discoveryHints: ["token mint search", "solana swap", "jupiter price", "lend rates", "prediction market"],
    facets: [
      {
        label: "Core token and price lookup",
        summary: "Search Solana mints and fetch prices/trending token metadata.",
        toolPrefixes: ["solana.prices", "solana.tokens"],
        hints: ["token search", "token mint", "trending tokens", "price lookup"],
      },
      {
        label: "Swaps and lending",
        summary: "Quote/execute swaps and inspect deposit/withdraw lend positions.",
        toolPrefixes: ["solana.swap", "solana.lend"],
        hints: ["swap quote", "swap execute", "lend rates", "lend positions"],
      },
      {
        label: "Prediction markets",
        summary: "Browse, analyze, and trade Jupiter prediction markets on Solana.",
        toolPrefixes: ["solana.predict"],
        hints: ["prediction market", "buy yes", "sell shares", "market history"],
      },
    ],
  },
  {
    namespace: "polymarket",
    advertised: true,
    groupId: "prediction-markets",
    groupLabel: "Prediction Markets",
    summary: "Polymarket prediction-market surface for discovery, orderbook trading, positions, bridge flows, and rewards.",
    whenToUse:
      "Use when the user wants Polymarket on Polygon: browse markets/events, inspect the orderbook, place/cancel trades, read positions/activity, bridge funds, or inspect rewards.",
    preferInstead:
      "Use `solana` for Jupiter prediction markets and `dexscreener` for non-prediction token research.",
    exampleQueries: [
      'discover_tools(query="prediction market orderbook", namespace="polymarket")',
      'discover_tools(query="polymarket positions", namespace="polymarket")',
      'discover_tools(query="bridge funds to polymarket", namespace="polymarket")',
    ],
    aliases: ["prediction market", "orderbook market", "clob", "gamma", "polymarket"],
    discoveryHints: [
      "prediction market orderbook",
      "yes no market",
      "gamma market discovery",
      "positions and pnl",
      "bridge to polymarket",
      "rewards earnings",
    ],
    facets: [
      {
        label: "Gamma discovery",
        summary: "Browse/search events, markets, tags, comments, profiles, and sports metadata.",
        toolPrefixes: ["polymarket.gamma"],
        hints: ["gamma", "market discovery", "event search", "tag search", "sports metadata"],
      },
      {
        label: "CLOB trading",
        summary: "Read orderbooks/prices and place, cancel, or inspect orders and trades.",
        toolPrefixes: ["polymarket.clob"],
        hints: ["orderbook", "clob", "buy yes", "sell no", "cancel order", "price history"],
      },
      {
        label: "Portfolio and analytics",
        summary: "Read positions, activity, holders, open interest, and leaderboard data.",
        toolPrefixes: ["polymarket.data"],
        hints: ["positions", "activity", "holders", "open interest", "leaderboard", "pnl"],
      },
      {
        label: "Bridge",
        summary: "Inspect supported assets, bridge quote/status, deposit, and withdraw flows.",
        toolPrefixes: ["polymarket.bridge"],
        hints: ["bridge funds", "supported assets", "deposit address", "withdraw quote"],
      },
      {
        label: "Rewards",
        summary: "Inspect market/user rewards, earnings, and percentage snapshots.",
        toolPrefixes: ["polymarket.rewards"],
        hints: ["rewards", "earnings", "active rewards", "user markets"],
      },
    ],
  },
  {
    namespace: "dexscreener",
    advertised: true,
    groupId: "market-research",
    groupLabel: "Market Research",
    summary: "The market-discovery backbone: read-only, multi-chain DEX intelligence — search any token on any chain (chainId filter, including robinhood), resolve token addresses, verify pair liquidity/momentum, and read trending narratives, attention/boost signals, CTO signals, ads, and paid-order verification.",
    whenToUse:
      "Reach for it FIRST on any discovery or research step: search a token on any chain (optionally filtered by chainId such as robinhood, or by minimum liquidity), resolve its address before a trade, and verify the pair's liquidity and momentum. Separate genuine narratives (trending/meta) from paid attention (boost/attention signals), and check profiles, community takeovers, ads, or paid-order verification. Canonical flow: discover → resolve address → verify liquidity → quote.",
    preferInstead:
      "Use `kyberswap`, `solana`, or `khalani` for execution after the discovery step — DexScreener never executes.",
    exampleQueries: [
      'discover_tools(query="trending narratives", namespace="dexscreener")',
      'discover_tools(query="community takeover", namespace="dexscreener")',
      'discover_tools(query="pair liquidity research", namespace="dexscreener")',
    ],
    aliases: ["dex screener", "market research", "trending narratives", "attention signal", "cto"],
    discoveryHints: [
      "token search",
      "pair analytics",
      "trending narratives",
      "attention signal",
      "boosts",
      "community takeover",
      "order verification",
      "ads",
    ],
    facets: [
      {
        label: "Search and pair analytics",
        summary: "Search tokens/pairs (by chain/liquidity) and inspect pair detail or all pools for a token.",
        toolPrefixes: ["dexscreener.search", "dexscreener.pairs", "dexscreener.tokens", "dexscreener.tokenPairs"],
        hints: ["token search", "pair analytics", "price research", "all pools", "liquidity"],
      },
      {
        label: "Trending narratives, attention, and profiles",
        summary: "Browse official trending narratives/themes and their tokens, synthetic attention/boost signals, and token profiles.",
        toolPrefixes: [
          "dexscreener.trending",
          "dexscreener.meta",
          "dexscreener.attention",
          "dexscreener.profiles",
          "dexscreener.profiles.recent",
          "dexscreener.boosts",
          "dexscreener.boosts.top",
        ],
        hints: ["trending narratives", "trending metas", "attention signal", "token profiles", "boosts", "top boosts"],
      },
      {
        label: "Community takeovers and promotion checks",
        summary: "Track CTO signals plus ads and paid-order verification.",
        toolPrefixes: ["dexscreener.communityTakeovers", "dexscreener.orders", "dexscreener.ads"],
        hints: ["community takeover", "cto", "paid orders", "ads", "promotion"],
      },
    ],
  },
] as const;
