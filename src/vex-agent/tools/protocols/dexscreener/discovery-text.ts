/**
 * DexScreener retrieval-only chain enumeration.
 *
 * DexScreener indexes pairs across many chains; this is the top-coverage
 * subset by relevance for retrieval, used as the structured `chains` field
 * on each DexScreener manifest's `discovery` metadata.
 */

export const DEXSCREENER_CHAINS: readonly string[] = [
  "Ethereum", "Solana", "BNB Chain", "BSC", "Base", "Arbitrum",
  "Polygon", "Avalanche", "Optimism", "Linea", "Sonic", "Berachain",
  "Robinhood",
];
