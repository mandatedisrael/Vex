/**
 * Benchmark resolution — chain-level analytic benchmark asset.
 *
 * benchmarkAssetKey is set on activity ONLY when the swap's native-leg
 * is actually present (benchmark-native PnL is computable).
 * Otherwise null — benchmark-native PnL not available for that trade.
 */

const CHAIN_BENCHMARKS: Record<string, string> = {
  solana: "SOL",
  ethereum: "ETH",
  polygon: "MATIC",
  arbitrum: "ETH",
  optimism: "ETH",
  base: "ETH",
  bsc: "BNB",
};

/**
 * Get the chain-level benchmark asset key.
 * Returns null if chain is unknown.
 */
export function resolveChainBenchmark(chain: string): string | null {
  return CHAIN_BENCHMARKS[chain] ?? null;
}
