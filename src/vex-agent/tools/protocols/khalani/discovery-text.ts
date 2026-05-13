/**
 * Khalani retrieval-only chain enumeration.
 *
 * Feeds the structured `chains` field on each Khalani manifest's `discovery`
 * metadata. Not interpolated into `embeddingText` — the agent-style passages
 * name only the top 5–8 chains; the full 40+ chain list lives here so the
 * lexical scorer can recall rare chain names when an agent queries by chain
 * (e.g. "bridge to monad", "send tokens to katana", "transfer on lisk").
 */

export const KHALANI_CHAINS: readonly string[] = [
  "Abstract", "Arbitrum", "Avalanche", "Base", "Berachain", "Blast",
  "BNB Chain", "BSC", "BOB", "Cronos", "Ethereum",
  "Flow", "Gnosis", "HyperEVM", "Injective", "Jovay", "Ink", "Katana",
  "Lens", "Linea", "Lisk", "Mantle", "Mode", "Monad",
  "Neon", "Optimism", "Plasma", "Polygon", "Redstone", "Scroll", "Sei",
  "Solana", "Soneium", "Sonic", "Sophon", "Story",
  "Tron", "Unichain", "World Chain", "Zilliqa",
  "zkSync", "Zora",
];
