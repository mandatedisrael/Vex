/**
 * Swap prequote recording (Stage 6c).
 *
 * For a SUCCESSFUL swap QUOTE this module computes:
 *   1. a deterministic match-hash over the trade identity (reused verbatim by
 *      the Stage-7 execute gate so record-time and gate-time hashes collide),
 *   2. a fail-closed 3-state token-safety verdict (`pass` | `fail` | `unknown`),
 *   3. a bounded, structural-only `safetyDetail` payload,
 * then records a `swap_prequotes` row. Recording is best-effort: any failure is
 * swallowed (logged structurally) so it never alters the quote's ToolResult. A
 * missing prequote is safe — the Stage-7 gate fails closed.
 *
 * The quote result payload (`ToolResult.data`) is UNTRUSTED here: it is
 * re-validated with Zod at this boundary. We deliberately do NOT import the
 * handler-local `QuoteSafetyLeg` type from kyberswap/handlers/swap.ts (it is
 * not exported); we structurally re-validate instead.
 *
 * NEVER persist raw provider/HTTP/error text — only bounded structural labels.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ChainFamily } from "@tools/khalani/types.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import { resolveSelectedAddress } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError } from "../../../errors.js";
import logger from "@utils/logger.js";

import type { ProtocolExecutionContext } from "./types.js";
import * as prequoteRepo from "@vex-agent/db/repos/swap-prequotes.js";
import type {
  CreatePrequoteInput,
  PrequoteFamily,
  SafetyVerdict,
} from "@vex-agent/db/repos/swap-prequotes.js";

// ── Quote-tool registry ──────────────────────────────────────────────────

/**
 * Quote tools that record a prequote on success. Stage 6c records only
 * `kind: "swap"`; the schema allows `bridge` for Stage 8 forward-compat but
 * this map intentionally has no bridge entries yet.
 */
export const PREQUOTE_QUOTE_TOOLS: Record<
  string,
  { family: PrequoteFamily; provider: string; kind: "swap" }
> = {
  "kyberswap.swap.quote": { family: "eip155", provider: "kyberswap", kind: "swap" },
  "solana.swap.quote": { family: "solana", provider: "jupiter", kind: "swap" },
};

/**
 * Prequote freshness window. Honeypot / audit status is stable minute-to-minute,
 * but a restricted-mode approval pause can sit for minutes before the execute
 * call lands, so the window must comfortably outlive a human approval without
 * letting a stale safety preview authorize an execute indefinitely. Tunable.
 */
export const PREQUOTE_MAX_AGE_MS = 15 * 60_000;

// ── Match-hash ────────────────────────────────────────────────────────────

export interface PrequoteMatchInput {
  readonly sessionId: string;
  readonly family: PrequoteFamily;
  /** EVM numeric chainId; null/undefined for Solana (single chain in scope). */
  readonly chainId: number | null | undefined;
  readonly walletAddress: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** Human decimal amount the quote was computed for. */
  readonly amount: string;
}

/**
 * Canonicalize an address/mint for the match-hash. EVM addresses are
 * case-insensitive → lowercase; Solana base58 mints/addresses are
 * case-SENSITIVE → preserved as-is (after trim).
 */
function canonAddress(family: PrequoteFamily, value: string): string {
  const trimmed = value.trim();
  return family === "eip155" ? trimmed.toLowerCase() : trimmed;
}

/**
 * Canonicalize a human decimal amount so `"1.0"`, `"1"`, `"1.00"`, `"01"` and
 * `" 1 "` all hash identically. Strips sign-less leading/trailing zeros around
 * a single decimal point. Non-numeric input falls back to the trimmed string so
 * the hash is still deterministic (the recorder only ever passes amounts the
 * quote already accepted).
 */
function canonAmount(raw: string): string {
  const trimmed = raw.trim();
  // Plain decimal (optional sign, digits, optional fraction). Anything exotic
  // (scientific notation, units) falls through to the trimmed literal.
  if (!/^[+-]?\d*\.?\d+$/.test(trimmed) && !/^[+-]?\d+\.?\d*$/.test(trimmed)) {
    return trimmed;
  }
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [intPartRaw = "", fracPartRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw.replace(/^0+/, "") || "0";
  const fracPart = fracPartRaw.replace(/0+$/, "");
  const body = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  // Zero is always positive-canonical so "-0" and "0" collide.
  return negative && body !== "0" ? `-${body}` : body;
}

/**
 * Deterministic sha256-hex match-hash over the trade identity. Identical at
 * record-time and Stage-7 gate-time. Slippage and provider are deliberately
 * EXCLUDED (slippage tweaks must not invalidate the safety preview; provider
 * derives from family). Exported so Stage 7 reuses the EXACT function.
 */
export function computePrequoteMatchHash(input: PrequoteMatchInput): string {
  const chainIdOrEmpty =
    input.family === "eip155" && input.chainId != null ? String(input.chainId) : "";
  const material = [
    input.sessionId,
    input.family,
    chainIdOrEmpty,
    canonAddress(input.family, input.walletAddress),
    canonAddress(input.family, input.tokenIn),
    canonAddress(input.family, input.tokenOut),
    canonAmount(input.amount),
  ].join(" ");
  return createHash("sha256").update(material).digest("hex");
}

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
 * Per-leg EVM verdict + bounded detail. Mirrors the hard-abort in
 * `executeKyberSwap`: honeypot OR (FoT && tax > 50) → fail. FoT with tax <= 50
 * is info-only (NOT a fail — the model decides on fee-bearing tokens). A
 * checkFailed or malformed leg is fail-closed → unknown. Native does not worsen
 * the verdict (treated as pass at the leg level; aggregation ignores it anyway).
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
  const isHardFail = leg.isHoneypot || (leg.isFOT && leg.tax > 50);
  return {
    verdict: isHardFail ? "fail" : "pass",
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

interface ExtractedQuote {
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
  if (toolId === "solana.swap.quote") return extractSolana(params, data);
  return null;
}

// ── Recorder ──────────────────────────────────────────────────────────────

function familyToChainFamily(family: PrequoteFamily): ChainFamily {
  // PrequoteFamily and ChainFamily share the same inhabitants; keep them
  // separate types but bridge here at the single call site.
  return family;
}

/**
 * Record a prequote from a successful quote. Best-effort: resolves the would-be
 * signing address (skips on a wallet-scope throw — never fabricates an
 * address), validates + extracts the quote, computes the match-hash + verdict,
 * and writes the row. Never throws to the caller; structural logs only.
 */
export async function recordPrequoteFromQuote(
  toolId: string,
  params: Record<string, unknown>,
  resultData: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<void> {
  const registered = PREQUOTE_QUOTE_TOOLS[toolId];
  if (!registered) return;

  const sessionId = context.sessionId;
  if (!sessionId) {
    logger.warn("protocol.prequote.skipped", { toolId, reason: "no_session" });
    return;
  }

  // Resolve the SELECTED address (never decrypts a key). A wallet-scope throw
  // (no wallet selected for this family) is a valid skip — fail-closed, never
  // fabricate.
  let walletAddress: string;
  try {
    walletAddress = resolveSelectedAddress(
      context.walletResolution,
      context.walletPolicy,
      familyToChainFamily(registered.family),
    );
  } catch (err) {
    const reason = err instanceof VexError ? err.code : "wallet_unresolved";
    logger.warn("protocol.prequote.skipped", { toolId, reason });
    return;
  }

  const extracted = extractQuote(toolId, params, resultData);
  if (!extracted) {
    logger.warn("protocol.prequote.skipped", { toolId, reason: "shape_invalid" });
    return;
  }

  const matchHash = computePrequoteMatchHash({
    sessionId,
    family: registered.family,
    chainId: extracted.chainId,
    walletAddress,
    tokenIn: extracted.tokenIn,
    tokenOut: extracted.tokenOut,
    amount: extracted.amount,
  });

  const now = Date.now();
  const input: CreatePrequoteInput = {
    prequoteId: `prequote-${randomUUID()}`,
    sessionId,
    matchHash,
    kind: registered.kind,
    family: registered.family,
    provider: registered.provider,
    chainId: extracted.chainId,
    walletAddress,
    tokenIn: extracted.tokenIn,
    tokenOut: extracted.tokenOut,
    amount: extracted.amount,
    slippageBps: extracted.slippageBps,
    safetyVerdict: extracted.verdict,
    safetyDetail: extracted.safetyDetail,
    routeRef: null,
    expiresAt: new Date(now + PREQUOTE_MAX_AGE_MS).toISOString(),
  };

  // Best-effort write: the DB call is the only remaining throw site, so it is
  // wrapped here to honour the "never throws to the caller" contract above
  // (the runtime caller also guards, but the module owns its own contract).
  // Only a bounded structural reason is logged — never raw provider/DB text.
  try {
    await prequoteRepo.create(input);
  } catch (err) {
    const reason =
      err instanceof VexError
        ? err.code
        : err instanceof Error
          ? err.constructor.name
          : "write_failed";
    logger.warn("protocol.prequote.skipped", { toolId, reason });
    return;
  }
  logger.info("protocol.prequote.recorded", {
    toolId,
    family: registered.family,
    verdict: extracted.verdict,
  });
}
