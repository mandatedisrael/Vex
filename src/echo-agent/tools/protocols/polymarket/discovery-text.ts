/**
 * Polymarket retrieval-only chain enumerations.
 *
 * Feed the structured `chains` field on each Polymarket manifest's `discovery`
 * metadata. Not interpolated into `embeddingText` — the agent-style passages
 * mention Polygon (or the relevant bridge chain) in prose by name; the full
 * enumeration lives here so the lexical scorer can recall chain names when
 * an agent queries by chain (e.g. "withdraw to base from polymarket",
 * "deposit btc into polymarket", "polymarket on polygon").
 *
 * Two sets are exported: the host chain Polymarket itself runs on (every
 * CLOB / data / gamma / rewards manifest), and the wider bridge support set
 * (every bridge manifest).
 */

/**
 * Host chain for Polymarket's CLOB, data, gamma, and rewards surfaces.
 *
 * Three aliases give chain-lane recall on "polygon", "matic", and the
 * explicit "Polygon POS" string the API uses.
 */
export const POLYMARKET_CHAINS: readonly string[] = [
  "Polygon", "Polygon POS", "Matic",
];

/**
 * Bridge inbound / outbound chains whose address shape the current bridge
 * runtime preserves (`evm` / `svm` / `btc` per
 * `src/tools/polymarket/bridge/validation.ts`).
 *
 * Sourced from https://docs.polymarket.com/trading/bridge/supported-assets,
 * filtered against the validator: Tron / TRX / TVM is intentionally
 * excluded because `validateDepositResponse` drops the `tvm` field, so
 * advertising Tron here would route an agent to a tool that can't return
 * a usable address. Adding Tron is a follow-up that requires extending
 * the deposit response type plus the validator.
 *
 * Avalanche is intentionally excluded — no current doc evidence as of
 * 2026-04-28.
 */
export const POLYMARKET_BRIDGE_CHAINS: readonly string[] = [
  "Polygon", "Polygon POS", "Matic",
  "Ethereum", "Solana", "Base", "Arbitrum",
  "BNB Chain", "BSC", "BNB Smart Chain",
  "Optimism", "Bitcoin", "BTC",
  "HyperEVM", "Abstract", "Monad", "Ethereal", "Katana", "Lighter",
];
