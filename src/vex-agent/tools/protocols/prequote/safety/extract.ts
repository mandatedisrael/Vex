/**
 * Verdict computation + extraction (untrusted result.data → trusted prequote
 * fields). The quote result payload (`ToolResult.data`) is UNTRUSTED here: it is
 * re-validated with Zod at this boundary. We deliberately do NOT import the
 * handler-local `QuoteSafetyLeg` type from kyberswap/handlers/swap.ts (it is not
 * exported); we structurally re-validate instead.
 *
 * NEVER persist or log raw provider/HTTP/DB/error text — only bounded structural
 * labels.
 */

import { z } from "zod";

import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import type { SafetyVerdict } from "@vex-agent/db/repos/swap-prequotes.js";

// ── Verdict computation ───────────────────────────────────────────────────

type LegVerdict = "pass" | "fail" | "unknown";

/** Worst-leg aggregation: any fail → fail; else any unknown → unknown; else pass. */
function aggregateVerdict(legs: readonly LegVerdict[]): SafetyVerdict {
  if (legs.includes("fail")) return "fail";
  if (legs.includes("unknown")) return "unknown";
  return "pass";
}

// EVM safety legs — structural re-validation of the kyberswap quote safety
// block (we do NOT import the handler-local QuoteSafetyLeg type).
const EvmNativeLegSchema = z.object({ native: z.literal(true) });
const EvmAuditLegSchema = z.object({
  isHoneypot: z.boolean(),
  isFOT: z.boolean(),
  tax: z.number(),
});
const EvmCheckFailedLegSchema = z.object({
  checkFailed: z.literal(true),
  reason: z.string(),
});
const EvmLegSchema = z.union([
  EvmNativeLegSchema,
  EvmAuditLegSchema,
  EvmCheckFailedLegSchema,
]);
const EvmSafetySchema = z.object({
  tokenIn: EvmLegSchema,
  tokenOut: EvmLegSchema,
});
type EvmLeg = z.infer<typeof EvmLegSchema>;

/** Bounded reason class — only the four literals the handler emits survive. */
const EVM_CHECK_FAILED_REASONS = new Set([
  "timeout",
  "rate_limited",
  "kyber_error",
  "unavailable",
]);

interface LegVerdictDetail {
  readonly verdict: LegVerdict;
  readonly detail: Record<string, unknown>;
}

/**
 * Per-leg EVM verdict + bounded detail. Mirrors the ONE hard-abort in
 * `executeKyberSwap`: a CONFIRMED honeypot (`isHoneypot === true`) → fail. Per
 * owner doctrine that is the ONLY hard safety block for a swap — fee-on-transfer
 * / high tax is NOT a fail (the model decides on fee-bearing tokens, even in
 * full-autonomous + full-agent modes). The bounded detail STILL discloses
 * `{ isHoneypot, isFOT, tax }` so the model/human can see the fee-on-transfer in
 * the quote output (the verdict softens, the disclosure does not). A checkFailed
 * or malformed leg is fail-closed → unknown. Native does not worsen the verdict
 * (treated as pass at the leg level; aggregation ignores it anyway).
 */
function evmLegVerdict(leg: EvmLeg): LegVerdictDetail {
  if ("native" in leg) {
    return { verdict: "pass", detail: { native: true } };
  }
  if ("checkFailed" in leg) {
    // Defense-in-depth: only surface a bounded reason class, never raw text.
    const reason = EVM_CHECK_FAILED_REASONS.has(leg.reason) ? leg.reason : "unavailable";
    return { verdict: "unknown", detail: { checkFailed: true, reason } };
  }
  return {
    verdict: leg.isHoneypot ? "fail" : "pass",
    detail: { isHoneypot: leg.isHoneypot, isFOT: leg.isFOT, tax: leg.tax },
  };
}

// Solana token metadata + safety block — structural re-validation of the
// Jupiter quote summary fields we need.
const SolanaTokenMetadataSchema = z.object({
  address: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
});
const SolanaTokenSafetySchema = z.object({
  isSus: z.boolean().nullish(),
  mintAuthorityDisabled: z.boolean().nullish(),
  freezeAuthorityDisabled: z.boolean().nullish(),
  topHoldersPercentage: z.number().nullish(),
});
const SolanaQuoteSchema = z.object({
  inputToken: SolanaTokenMetadataSchema,
  outputToken: SolanaTokenMetadataSchema,
  safety: z
    .object({
      inputToken: SolanaTokenSafetySchema.optional(),
      outputToken: SolanaTokenSafetySchema.optional(),
    })
    .optional(),
  slippageBps: z.number().nullish(),
});
type SolanaTokenSafety = z.infer<typeof SolanaTokenSafetySchema>;

function isNativeSolanaMint(mint: string): boolean {
  // Jupiter audits wSOL and returns isSus:false; treat the native sentinel as
  // a no-audit-needed leg regardless of whether a safety entry is present.
  return mint === SOL_MINT;
}

/**
 * Per-leg Solana verdict + bounded detail. A present entry with `isSus === true`
 * → fail; `isSus === false` → pass. A native (SOL/wSOL) leg never worsens the
 * verdict. An ABSENT entry for a non-native mint is fail-closed → unknown (no
 * audit data). `isSus` null/undefined on a present non-native entry is also
 * treated as "no verdict signal" → unknown (fail-closed).
 */
function solanaLegVerdict(
  mint: string,
  safety: SolanaTokenSafety | undefined,
): LegVerdictDetail {
  if (isNativeSolanaMint(mint)) {
    return { verdict: "pass", detail: { native: true } };
  }
  if (!safety || safety.isSus == null) {
    return { verdict: "unknown", detail: { auditPresent: false } };
  }
  const detail: Record<string, unknown> = { isSus: safety.isSus };
  if (safety.mintAuthorityDisabled != null) detail.mintAuthorityDisabled = safety.mintAuthorityDisabled;
  if (safety.freezeAuthorityDisabled != null) detail.freezeAuthorityDisabled = safety.freezeAuthorityDisabled;
  if (safety.topHoldersPercentage != null) detail.topHoldersPercentage = safety.topHoldersPercentage;
  return { verdict: safety.isSus ? "fail" : "pass", detail };
}

// ── Extraction (untrusted result.data → trusted prequote fields) ───────────

export interface ExtractedQuote {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly chainId: number | null;
  readonly amount: string;
  readonly slippageBps: number | null;
  readonly verdict: SafetyVerdict;
  readonly safetyDetail: Record<string, unknown>;
}

// EVM quote result (kyberswap.swap.quote) — token addresses + chainId + safety.
const EvmQuoteResultSchema = z.object({
  chainId: z.number(),
  tokenIn: z.object({ address: z.string() }),
  tokenOut: z.object({ address: z.string() }),
  safety: EvmSafetySchema,
});

function extractEvm(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  const parsed = EvmQuoteResultSchema.safeParse(data);
  if (!parsed.success) return null;
  const amountRaw = params.amountIn;
  if (typeof amountRaw !== "string" || amountRaw.trim() === "") return null;
  const slippage = typeof params.slippageBps === "number" ? params.slippageBps : null;

  const inLeg = evmLegVerdict(parsed.data.safety.tokenIn);
  const outLeg = evmLegVerdict(parsed.data.safety.tokenOut);
  return {
    tokenIn: parsed.data.tokenIn.address,
    tokenOut: parsed.data.tokenOut.address,
    chainId: parsed.data.chainId,
    amount: amountRaw,
    slippageBps: slippage,
    verdict: aggregateVerdict([inLeg.verdict, outLeg.verdict]),
    safetyDetail: { tokenIn: inLeg.detail, tokenOut: outLeg.detail },
  };
}

function extractSolana(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  const parsed = SolanaQuoteSchema.safeParse(data);
  if (!parsed.success) return null;
  const amountRaw = params.amount;
  // Solana params.amount is a human number; accept number or numeric string.
  const amount =
    typeof amountRaw === "number" && Number.isFinite(amountRaw)
      ? String(amountRaw)
      : typeof amountRaw === "string" && amountRaw.trim() !== ""
        ? amountRaw
        : null;
  if (amount === null) return null;

  // Slippage: prefer the quote's echoed value, else the request param.
  const slippage =
    typeof parsed.data.slippageBps === "number"
      ? parsed.data.slippageBps
      : typeof params.slippageBps === "number"
        ? params.slippageBps
        : null;

  const inMint = parsed.data.inputToken.address;
  const outMint = parsed.data.outputToken.address;
  const inLeg = solanaLegVerdict(inMint, parsed.data.safety?.inputToken);
  const outLeg = solanaLegVerdict(outMint, parsed.data.safety?.outputToken);
  return {
    tokenIn: inMint,
    tokenOut: outMint,
    chainId: null,
    amount,
    slippageBps: slippage,
    verdict: aggregateVerdict([inLeg.verdict, outLeg.verdict]),
    safetyDetail: { inputToken: inLeg.detail, outputToken: outLeg.detail },
  };
}

// ── Uniswap quote result (uniswap.swap.quote) — factory/liquidity/FoT signals ──
//
// Uniswap has no honeypot oracle, so on chains without one Vex derives its own
// conservative signals at quote time (see @tools/uniswap/safety). Verdict map
// (LOCKED #5 — doctrine unchanged; unknown = allowed-with-approval-warning):
//   - factory check failed        → unknown (never pass without confirmation),
//   - factory not allowlisted      → fail (integrity: a spoofed pool),
//   - factory ok + liquidity ≥ min + not FoT → pass,
//   - otherwise                    → unknown.
const UniswapFactorySchema = z.union([
  z.object({ checked: z.literal(true), allowlisted: z.boolean() }),
  z.object({ checkFailed: z.literal(true) }),
]);
const UniswapLiquiditySchema = z.union([
  z.object({ checked: z.literal(true), usd: z.number().nullable(), aboveThreshold: z.boolean() }),
  z.object({ checkFailed: z.literal(true), reason: z.string() }),
]);
const UniswapSafetySchema = z.object({
  factory: UniswapFactorySchema,
  liquidity: UniswapLiquiditySchema,
  fot: z.object({ suspected: z.boolean() }),
});
const UniswapQuoteResultSchema = z.object({
  chainId: z.number(),
  tokenIn: z.object({ address: z.string() }),
  tokenOut: z.object({ address: z.string() }),
  safety: UniswapSafetySchema,
});

function extractUniswap(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  const parsed = UniswapQuoteResultSchema.safeParse(data);
  if (!parsed.success) return null;
  const amountRaw = params.amountIn;
  if (typeof amountRaw !== "string" || amountRaw.trim() === "") return null;
  const slippage = typeof params.slippageBps === "number" ? params.slippageBps : null;

  const { factory, liquidity, fot } = parsed.data.safety;
  let verdict: SafetyVerdict;
  if ("checkFailed" in factory) {
    verdict = "unknown";
  } else if (!factory.allowlisted) {
    verdict = "fail";
  } else {
    const liquidityOk = "checked" in liquidity && liquidity.aboveThreshold;
    verdict = liquidityOk && !fot.suspected ? "pass" : "unknown";
  }

  return {
    tokenIn: parsed.data.tokenIn.address,
    tokenOut: parsed.data.tokenOut.address,
    chainId: parsed.data.chainId,
    amount: amountRaw,
    slippageBps: slippage,
    verdict,
    safetyDetail: { factory, liquidity, fot },
  };
}

/**
 * Validate + extract the prequote fields for a quote tool. Returns `null` when
 * the result payload does not structurally validate (recording is then
 * skipped). Exported for focused unit tests.
 */
export function extractQuote(
  toolId: string,
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  if (toolId === "kyberswap.swap.quote") return extractEvm(params, data);
  if (toolId === "uniswap.swap.quote") return extractUniswap(params, data);
  if (toolId === "solana.swap.quote") return extractSolana(params, data);
  return null;
}
