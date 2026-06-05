/**
 * Slippage canonicalization for the swap match-hash. Shared by BOTH the record
 * path (reads the QUOTE params) and the gate path (reads the EXECUTE params) so a
 * quote↔execute that both omit slippage collide while differing values diverge.
 * Kept in ONE module so the two sides can never drift.
 */

/**
 * Canonicalize a slippage value for the swap match-hash. A finite number → its
 * integer string (so `50` and `"50"`-derived `50` collide); null/undefined →
 * the stable sentinel "" (a quote-omitted and an execute-omitted slippage
 * collide; a 50bps quote and a 10000bps execute diverge → the gate blocks).
 * A non-integer/non-finite number is floored to its integer string defensively
 * (the providers treat slippage as an integer bps value).
 */
export function canonSlippageBps(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Math.trunc(value));
}

/**
 * Read `slippageBps` from a tool's PARAMS for the swap match-hash. Both swap
 * quotes (kyber/jupiter) and both EVM executes type slippageBps as a number;
 * anything non-numeric (absent / wrong type) is treated as omitted (null) so the
 * canonicalizer maps it to the stable "" sentinel. Bound from params on BOTH
 * sides (recorder reads the quote params, gate reads the execute params) so a
 * quote↔execute that both omit slippage collide while differing values diverge.
 */
export function readParamSlippageBps(params: Record<string, unknown>): number | null {
  const raw = params.slippageBps;
  return typeof raw === "number" ? raw : null;
}
