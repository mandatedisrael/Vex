/**
 * Prequote registries + freshness window (Stage 6c/7/8c).
 *
 * The quote-tool registry (`PREQUOTE_QUOTE_TOOLS`) names which quote tools record
 * a prequote on success and how; the execute-gate registry (`EXECUTE_GATE_TOOLS`)
 * names which execute tools are subject to the quote-before-transaction gate and
 * which prequote `kind` each must match. `PREQUOTE_MAX_AGE_MS` is the shared
 * freshness window. Pure data + types — no IO.
 */

import type { PrequoteFamily } from "@vex-agent/db/repos/swap-prequotes.js";

// ── Quote-tool registry ──────────────────────────────────────────────────

/**
 * Quote tools that record a prequote on success. The two swap quotes record
 * `kind: "swap"` (Stage 6c); the Khalani bridge quote records `kind: "bridge"`
 * (Stage 8c). A `swap` entry pins its family up front; the `bridge` entry
 * derives the source family per-call from `fromChain` (the source leg can be EVM
 * or Solana), so its `family` is resolved inside the recorder, not here.
 *
 * `khalani.quote.get` is the BRIDGE quote (cross-chain), and is used ONLY for
 * bridges (the read alias `bridge_quote` is its only other caller) — recording
 * it as `kind: "bridge"` never mis-records a non-bridge quote.
 */
type PrequoteQuoteRegistration =
  | { readonly kind: "swap"; readonly family: PrequoteFamily; readonly provider: string }
  | { readonly kind: "bridge"; readonly provider: string };

export const PREQUOTE_QUOTE_TOOLS: Record<string, PrequoteQuoteRegistration> = {
  "kyberswap.swap.quote": { kind: "swap", family: "eip155", provider: "kyberswap" },
  "uniswap.swap.quote": { kind: "swap", family: "eip155", provider: "uniswap" },
  "solana.swap.quote": { kind: "swap", family: "solana", provider: "jupiter" },
  "khalani.quote.get": { kind: "bridge", provider: "khalani" },
  "relay.quote.get": { kind: "bridge", provider: "relay" },
};

/**
 * Prequote freshness window. Honeypot / audit status is stable minute-to-minute,
 * but a restricted-mode approval pause can sit for minutes before the execute
 * call lands, so the window must comfortably outlive a human approval without
 * letting a stale safety preview authorize an execute indefinitely. Tunable.
 */
export const PREQUOTE_MAX_AGE_MS = 15 * 60_000;

// ── Execute-gate registry ─────────────────────────────────────────────────

/**
 * EXECUTE tools subject to the prequote gate, keyed by toolId. Each entry names
 * the prequote `kind` it must match (Stage 8c made this kind-aware): the three
 * swap executes match a fresh `swap` prequote; the Khalani bridge execute
 * matches a fresh `bridge` prequote. A swap entry pins its `family` (used to
 * resolve the signer + branch the identity builder); the bridge entry derives
 * its families per-call inside `buildBridgeIdentity`. `send` and every other tool
 * pass through untouched.
 */
export type ExecuteGateRegistration =
  | { readonly kind: "swap"; readonly family: PrequoteFamily; readonly provider: string }
  | { readonly kind: "bridge"; readonly provider: string };

export const EXECUTE_GATE_TOOLS: Record<string, ExecuteGateRegistration> = {
  "kyberswap.swap.sell": { kind: "swap", family: "eip155", provider: "kyberswap" },
  "kyberswap.swap.buy": { kind: "swap", family: "eip155", provider: "kyberswap" },
  "uniswap.swap.sell": { kind: "swap", family: "eip155", provider: "uniswap" },
  "uniswap.swap.buy": { kind: "swap", family: "eip155", provider: "uniswap" },
  "solana.swap.execute": { kind: "swap", family: "solana", provider: "jupiter" },
  "khalani.bridge": { kind: "bridge", provider: "khalani" },
  "relay.bridge": { kind: "bridge", provider: "relay" },
};
