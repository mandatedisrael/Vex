/**
 * Instrument key parser — shared typed helper for extracting components
 * from canonical instrumentKey patterns used across the projection pipeline.
 *
 * Patterns:
 *   solana:{mint}                    → spot (Solana)
 *   solana:predict:{marketId}:{side} → prediction (Jupiter)
 *   polymarket:{conditionId}:{outcome} → prediction (Polymarket)
 *   {slug}:{address}                 → spot (KyberSwap on EVM)
 *   {slug}:lp:{pool}                → lp (KyberSwap zap)
 *   {slug}:lo:{maker}:{taker}       → limit_order (KyberSwap)
 */

export interface ParsedInstrumentKey {
  chain: string;
  tokenAddress?: string;
  marketId?: string;
  side?: string;
  kind: "spot" | "prediction" | "lp" | "limit_order" | "unknown";
}

export function parseInstrumentKey(key: string): ParsedInstrumentKey {
  const parts = key.split(":");

  // solana:predict:{marketId}:{side}
  if (parts[0] === "solana" && parts[1] === "predict" && parts.length >= 4) {
    return { chain: "solana", marketId: parts[2], side: parts[3], kind: "prediction" };
  }

  // polymarket:{conditionId}:{outcome}
  if (parts[0] === "polymarket" && parts.length >= 3) {
    return { chain: "polygon", marketId: parts[1], side: parts[2], kind: "prediction" };
  }

  // {slug}:lp:{pool}
  if (parts.length >= 3 && parts[1] === "lp") {
    return { chain: parts[0], kind: "lp" };
  }

  // {slug}:lo:{maker}:{taker}
  if (parts.length >= 4 && parts[1] === "lo") {
    return { chain: parts[0], kind: "limit_order" };
  }

  // {chain}:{address} — spot (solana:{mint}, ethereum:{addr}, etc.)
  if (parts.length === 2) {
    return { chain: parts[0], tokenAddress: parts[1], kind: "spot" };
  }

  return { chain: parts[0] ?? "unknown", kind: "unknown" };
}
