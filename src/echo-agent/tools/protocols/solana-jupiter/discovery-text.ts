/**
 * Solana / Jupiter retrieval-only chain enumerations.
 *
 * Feed the structured `chains` field on each Solana / Jupiter manifest's
 * `discovery` metadata. Not interpolated into `embeddingText` — the
 * agent-style passages mention Solana in prose by name; the enumeration
 * lives here so the lexical scorer can recall the chain name when an
 * agent queries by chain (e.g. "swap on solana", "earn on sol",
 * "prediction markets on solana").
 *
 * Single-chain protocol surface — every Solana / Jupiter manifest in
 * this batch shares this one host chain.
 */

/**
 * Host chain for every Solana / Jupiter tool surface (core, swap, lend,
 * predict). Single-element list kept as `readonly string[]` for parity
 * with the multi-chain protocol enumerations.
 */
export const SOLANA_CHAINS: readonly string[] = ["Solana"];
