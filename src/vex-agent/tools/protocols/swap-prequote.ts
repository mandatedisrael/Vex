/**
 * Swap prequote recording (Stage 6c) + execute-time gate (Stage 7).
 *
 * RECORDER — for a SUCCESSFUL swap QUOTE this module computes:
 *   1. a deterministic match-hash over the trade identity (reused verbatim by
 *      the Stage-7 execute gate so record-time and gate-time hashes collide),
 *   2. a 3-state token-safety verdict (`pass` | `fail` | `unknown`),
 *   3. a bounded, structural-only `safetyDetail` payload,
 * then records a `swap_prequotes` row. Recording is best-effort: any failure is
 * swallowed (logged structurally) so it never alters the quote's ToolResult. A
 * missing prequote is safe — the Stage-7 gate blocks the execute instead.
 *
 * GATE (`evaluateSwapPrequoteGate`) — before a swap EXECUTE broadcasts, this
 * enforces quote-before-transaction. It BLOCKS on (no fresh matching `swap`
 * prequote) OR (a fresh `fail` row); both `pass` AND `unknown` PASS the gate.
 * An allowed `unknown` is surfaced in the restricted-mode approval preview
 * ("safety: UNVERIFIED") and logged in full-auto. The gate is the INVERSE of
 * the recorder: the recorder swallows errors, the gate FAILS CLOSED to BLOCK on
 * any error / missing session / un-gateable token identity.
 *
 * The quote result payload (`ToolResult.data`) is UNTRUSTED here: it is
 * re-validated with Zod at this boundary. We deliberately do NOT import the
 * handler-local `QuoteSafetyLeg` type from kyberswap/handlers/swap.ts (it is
 * not exported); we structurally re-validate instead.
 *
 * NEVER persist or log raw provider/HTTP/DB/error text — only bounded
 * structural labels (recorder) or bounded reason classes (gate).
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAddress } from "viem";

import type { ChainFamily } from "@tools/khalani/types.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import { isNativeTokenInput } from "@tools/kyberswap/helpers.js";
import { NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveChainSlug, slugToChainId } from "@tools/kyberswap/chains.js";
import { requireJupiterResolvedToken } from "@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import { getCachedKhalaniChains, getChainFamily, resolveChainId } from "@tools/khalani/chains.js";
import { resolveSelectedAddress } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import logger from "@utils/logger.js";

import type { ProtocolExecutionContext } from "./types.js";
import * as prequoteRepo from "@vex-agent/db/repos/swap-prequotes.js";
import type {
  CreatePrequoteInput,
  PrequoteFamily,
  PrequoteKind,
  SafetyVerdict,
} from "@vex-agent/db/repos/swap-prequotes.js";

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
  "solana.swap.quote": { kind: "swap", family: "solana", provider: "jupiter" },
  "khalani.quote.get": { kind: "bridge", provider: "khalani" },
};

/**
 * Prequote freshness window. Honeypot / audit status is stable minute-to-minute,
 * but a restricted-mode approval pause can sit for minutes before the execute
 * call lands, so the window must comfortably outlive a human approval without
 * letting a stale safety preview authorize an execute indefinitely. Tunable.
 */
export const PREQUOTE_MAX_AGE_MS = 15 * 60_000;

// ── Match-hash ────────────────────────────────────────────────────────────

/**
 * Swap trade identity (Stage 6c/7). `kind: "swap"` is the discriminant tag —
 * Stage 8c made `PrequoteMatchInput` a union so a swap identity and a bridge
 * identity with otherwise-similar values can never collide in the hash.
 */
export interface SwapMatchInput {
  readonly kind: "swap";
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
 * Cross-chain bridge trade identity (Stage 8c). Computed IDENTICALLY at bridge
 * QUOTE record-time (`khalani.quote.get`) and bridge EXECUTE gate-time
 * (`khalani.bridge`) — both go through the SAME shared builder
 * (`buildBridgeIdentity`) so the digests collide. Chain IDs are normalized to
 * numeric Khalani chain IDs; addresses/tokens are canonicalized per the SOURCE
 * (from*) or DEST (to*) family; `recipient`/`tradeType` carry the bridge
 * handler's defaults.
 *
 * The money/fee leg (`refundTo`/`referrer`/`referrerFeeBps`/`filler`) is bound
 * too (8c security fix): each flows into the Khalani quote request in BOTH the
 * quote (`prepareQuoteRequest`) and the execute (`khalani.bridge`), so leaving
 * any of them out of the identity would let a quote authorize an execute that
 * changes where funds refund / who collects the fee. They carry the SAME
 * defaults `prepareQuoteRequest` applies (see `buildBridgeIdentity`); an omitted
 * field canonicalizes to a STABLE empty token so quote↔execute still collide
 * when both omit it.
 */
export interface BridgeMatchInput {
  readonly kind: "bridge";
  readonly sessionId: string;
  /** Family of the SOURCE chain (where the deposit signs). Canonicalizes from*. */
  readonly sourceFamily: PrequoteFamily;
  /** Family of the DEST chain (where funds land). Canonicalizes the dest leg. */
  readonly destFamily: PrequoteFamily;
  readonly fromChainId: number;
  readonly toChainId: number;
  /** Selected source-family wallet address (the signer). */
  readonly sourceWallet: string;
  /** Destination recipient (defaulted to the dest-family selected wallet). */
  readonly recipient: string;
  readonly fromToken: string;
  readonly toToken: string;
  /** Amount in smallest units (wei/lamports) — bridge amounts are integers. */
  readonly amount: string;
  readonly tradeType: BridgeTradeType;
  /**
   * Refund address — a SOURCE-chain address (canonicalized under the source
   * family). Defaults to `sourceWallet` (mirrors `prepareQuoteRequest`, where an
   * omitted `refundTo` falls back to the resolved `fromAddress`).
   */
  readonly refundTo: string;
  /** EVM referrer address for fee sharing; "" when omitted. */
  readonly referrer: string;
  /** Referrer fee in basis points (canonical integer string 0-9999); "" when omitted. */
  readonly referrerFeeBps: string;
  /** Opaque Khalani filler-provider name (case-preserved, NOT an address); "" when omitted. */
  readonly filler: string;
}

/** Discriminated on `kind` — a swap identity can never collide with a bridge. */
export type PrequoteMatchInput = SwapMatchInput | BridgeMatchInput;

/** Canonical bridge trade direction; mirrors `parseTradeType` in khalani/request. */
export type BridgeTradeType = "EXACT_INPUT" | "EXACT_OUTPUT";

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
 * record-time and gate-time. Slippage and provider are deliberately EXCLUDED
 * (slippage tweaks must not invalidate the safety preview; provider derives
 * from family). Exported so the gate reuses the EXACT function.
 *
 * Stage 8c: the material is prefixed with the `kind` discriminant tag and then
 * the kind-specific fields in a FIXED order, so a swap and a bridge with
 * otherwise-similar values produce different digests (Codex requirement #4).
 *   - swap   : ["swap", sessionId, family, chainId|"", wallet, tokenIn, tokenOut, amount]
 *   - bridge : ["bridge", sessionId, sourceFamily, destFamily, fromChainId,
 *               toChainId, sourceWallet, recipient, fromToken, toToken, amount,
 *               tradeType, refundTo, referrer, referrerFeeBps, filler]
 * EVM addresses/tokens lowercase; Solana mints case-preserved; amount via
 * `canonAmount`. The source family canonicalizes `sourceWallet`/`fromToken`/
 * `refundTo`; the dest family canonicalizes `recipient`/`toToken` (derived from
 * each chain id). The money/fee tail (FIXED order, appended after `tradeType`):
 * `refundTo` (source-family address), `referrer` (EVM → lowercase), the already-
 * canonical `referrerFeeBps` integer string, and `filler` (opaque provider name,
 * case-preserved). Omitted money/fee fields are "" so a quote↔execute that both
 * omit them still collide.
 */
export function computePrequoteMatchHash(input: PrequoteMatchInput): string {
  const material =
    input.kind === "swap"
      ? swapHashMaterial(input)
      : bridgeHashMaterial(input);
  return createHash("sha256").update(material).digest("hex");
}

function swapHashMaterial(input: SwapMatchInput): string {
  const chainIdOrEmpty =
    input.family === "eip155" && input.chainId != null ? String(input.chainId) : "";
  return [
    input.kind,
    input.sessionId,
    input.family,
    chainIdOrEmpty,
    canonAddress(input.family, input.walletAddress),
    canonAddress(input.family, input.tokenIn),
    canonAddress(input.family, input.tokenOut),
    canonAmount(input.amount),
  ].join(" ");
}

function bridgeHashMaterial(input: BridgeMatchInput): string {
  // Source-side fields canonicalize under the SOURCE family; destination-side
  // fields under the DEST family (a Solana mint on the dest leg must keep its
  // case even when the source leg is EVM, and vice-versa). The shared builder
  // passes RAW values + both leg families; the hash owns canonicalization (same
  // ownership split as the swap path).
  return [
    input.kind,
    input.sessionId,
    input.sourceFamily,
    input.destFamily,
    String(input.fromChainId),
    String(input.toChainId),
    canonAddress(input.sourceFamily, input.sourceWallet),
    canonAddress(input.destFamily, input.recipient),
    canonAddress(input.sourceFamily, input.fromToken),
    canonAddress(input.destFamily, input.toToken),
    canonAmount(input.amount),
    input.tradeType,
    // Money/fee tail (8c) — FIXED order: refundTo, referrer, referrerFeeBps,
    // filler. `refundTo` is a SOURCE-chain address (source-family canonical);
    // `referrer` is an EVM address (lowercase); `referrerFeeBps` is already the
    // canonical integer string from the builder; `filler` is an OPAQUE provider
    // name (case-preserved, trim-only — NOT an address, per Khalani docs). Each
    // is "" when omitted/defaulted so an all-omitting quote↔execute collide.
    canonAddress(input.sourceFamily, input.refundTo),
    input.referrer === "" ? "" : canonAddress("eip155", input.referrer),
    input.referrerFeeBps,
    input.filler.trim(),
  ].join(" ");
}

// ── Shared bridge identity builder (record-time AND gate-time) ─────────────
//
// THE crux of Stage 8c: the bridge QUOTE recorder (`khalani.quote.get`) and the
// bridge EXECUTE gate (`khalani.bridge`) MUST compute an IDENTICAL bridge
// identity so their match-hashes collide. Both tools receive the SAME
// alias-translated params (the `bridge_quote` and `bridge` aliases translate to
// the same khalani param keys), so this builder is purely params- + context-
// driven and is the SINGLE source of bridge identity — neither side reimplements
// the field extraction or the defaults.
//
// Defaults (mirror the khalani bridge/quote handlers + `prepareQuoteRequest`):
//   - chain ids   : `resolveChainId(from/toChain, chains)` → numeric Khalani id,
//   - source/dest family: `getChainFamily(chainId, chains)`,
//   - sourceWallet: `resolveSelectedAddress(..., sourceFamily)` (the signer),
//   - recipient   : explicit `params.recipient`, else the dest-family selected
//                   wallet (`resolveSelectedAddress(..., destFamily)`),
//   - tradeType   : "EXACT_OUTPUT" iff params.tradeType === "EXACT_OUTPUT",
//                   else "EXACT_INPUT" (same as `parseTradeType`),
//   - refundTo    : explicit `params.refundTo`, else `sourceWallet` (mirrors
//                   `prepareQuoteRequest`: an omitted refundTo → the resolved
//                   `fromAddress`, which under a session IS the source wallet),
//   - referrer    : explicit `params.referrer`, else "" (EVM address; the hash
//                   lowercases it),
//   - referrerFeeBps: explicit `params.referrerFeeBps` canonicalized via
//                   `canonReferrerFeeBps`, else "",
//   - filler      : explicit `params.filler`, else "" (opaque provider NAME, not
//                   an address — case-preserved by the hash).
//
// Tokens/amount/money-fee fields are passed through (the hash canonicalizes per
// leg family / per field). Any throw (unresolved chain, wallet-scope, invalid
// referrerFeeBps) propagates to the caller: the recorder treats it as a skip,
// the gate treats it as a fail-closed block.

function bridgeStr(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

function parseBridgeTradeType(raw: string): BridgeTradeType {
  return raw === "EXACT_OUTPUT" ? "EXACT_OUTPUT" : "EXACT_INPUT";
}

/**
 * Canonicalize `referrerFeeBps` to the SAME numeric identity the Khalani handler
 * derives. The handler's `parseReferrerFeeBps` does `Number(value)` and requires
 * an integer in [0, 9999]; collapsing the string with the generic amount
 * canonicalizer is unsafe here (it would not merge `"0x64"`/`"1e2"`/`"+100"`
 * into the same integer the handler accepts, producing false-negative gate
 * blocks). We reproduce the handler's parse so quote↔execute collide whenever
 * the handler would treat the fees as equal. Empty/omitted → "" (stable token).
 * An invalid value THROWS — the recorder skips, the gate fails closed (BLOCK),
 * mirroring `parseReferrerFeeBps` rejecting it before any broadcast.
 */
function canonReferrerFeeBps(raw: string): string {
  if (raw === "") return "";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
    throw new VexError(
      ErrorCodes.INVALID_AMOUNT,
      "referrerFeeBps must be an integer between 0 and 9999.",
    );
  }
  return String(parsed);
}

/**
 * Build the canonical bridge identity from the (untrusted) khalani bridge/quote
 * params + execution context. Async: resolves the Khalani chain registry to map
 * chain aliases/ids to numeric ids and to derive each leg's family. Throws on a
 * missing required field, an unresolved chain, or a wallet-scope error.
 */
export async function buildBridgeIdentity(
  sessionId: string,
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<BridgeMatchInput> {
  const fromChain = bridgeStr(params, "fromChain");
  const toChain = bridgeStr(params, "toChain");
  const fromToken = bridgeStr(params, "fromToken");
  const toToken = bridgeStr(params, "toToken");
  const amount = bridgeStr(params, "amount");
  if (!fromChain || !toChain || !fromToken || !toToken || !amount) {
    throw new VexError(ErrorCodes.AGENT_VALIDATION_ERROR, "Bridge identity missing required field.");
  }

  const chains = await getCachedKhalaniChains();
  const fromChainId = resolveChainId(fromChain, chains);
  const toChainId = resolveChainId(toChain, chains);
  const sourceFamily = getChainFamily(fromChainId, chains);
  const destFamily = getChainFamily(toChainId, chains);

  // Source signer = the session's selected wallet for the source family.
  const sourceWallet = resolveSelectedAddress(context.walletResolution, context.walletPolicy, sourceFamily);

  // Recipient default mirrors the bridge handler: explicit recipient honored,
  // else the dest-family selected wallet (fail-closed if neither resolves).
  const explicitRecipient = bridgeStr(params, "recipient");
  const recipient = explicitRecipient !== ""
    ? explicitRecipient
    : resolveSelectedAddress(context.walletResolution, context.walletPolicy, destFamily);

  // Money/fee leg (8c security fix) — bound so a quote cannot authorize an
  // execute that redirects refunds or changes the fee. Defaults mirror
  // `prepareQuoteRequest`: refundTo falls back to the source wallet (== the
  // resolved fromAddress under a session); referrer/referrerFeeBps/filler are
  // absent → "". referrerFeeBps is canonicalized to the handler's numeric
  // identity (throws on an invalid value → recorder skip / gate fail-closed).
  const explicitRefundTo = bridgeStr(params, "refundTo");
  const refundTo = explicitRefundTo !== "" ? explicitRefundTo : sourceWallet;
  const referrer = bridgeStr(params, "referrer");
  const referrerFeeBps = canonReferrerFeeBps(bridgeStr(params, "referrerFeeBps"));
  const filler = bridgeStr(params, "filler");

  return {
    kind: "bridge",
    sessionId,
    sourceFamily,
    destFamily,
    fromChainId,
    toChainId,
    sourceWallet,
    recipient,
    fromToken,
    toToken,
    amount,
    tradeType: parseBridgeTradeType(bridgeStr(params, "tradeType")),
    refundTo,
    referrer,
    referrerFeeBps,
    filler,
  };
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
 * Best-effort `swap_prequotes` write. The DB call is the only throw site left in
 * the recorder, so it is isolated here to honour the "never throws to caller"
 * contract. Only a bounded structural reason is logged — never raw provider/DB
 * text. Returns true on a successful write.
 */
async function writePrequoteRow(toolId: string, input: CreatePrequoteInput): Promise<boolean> {
  try {
    await prequoteRepo.create(input);
    return true;
  } catch (err) {
    const reason =
      err instanceof VexError
        ? err.code
        : err instanceof Error
          ? err.constructor.name
          : "write_failed";
    logger.warn("protocol.prequote.skipped", { toolId, reason });
    return false;
  }
}

/**
 * Record a prequote from a successful quote. Best-effort: resolves the would-be
 * signing address (skips on a wallet-scope throw — never fabricates an address),
 * validates + extracts the quote, computes the match-hash + verdict, and writes
 * the row. Never throws to the caller; structural logs only. Dispatches by the
 * registered `kind`: a `swap` quote records a token-safety verdict; a `bridge`
 * quote always records verdict `unknown` (a Khalani route proves availability,
 * NOT token safety — Codex requirement #3).
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

  if (registered.kind === "bridge") {
    await recordBridgePrequote(toolId, sessionId, registered.provider, params, context);
    return;
  }
  await recordSwapPrequote(toolId, sessionId, registered, params, resultData, context);
}

async function recordSwapPrequote(
  toolId: string,
  sessionId: string,
  registered: { readonly family: PrequoteFamily; readonly provider: string },
  params: Record<string, unknown>,
  resultData: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<void> {
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
    kind: "swap",
    sessionId,
    family: registered.family,
    chainId: extracted.chainId,
    walletAddress,
    tokenIn: extracted.tokenIn,
    tokenOut: extracted.tokenOut,
    amount: extracted.amount,
  });

  const input: CreatePrequoteInput = {
    prequoteId: `prequote-${randomUUID()}`,
    sessionId,
    matchHash,
    kind: "swap",
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
    expiresAt: new Date(Date.now() + PREQUOTE_MAX_AGE_MS).toISOString(),
  };

  if (await writePrequoteRow(toolId, input)) {
    logger.info("protocol.prequote.recorded", {
      toolId,
      family: registered.family,
      verdict: extracted.verdict,
    });
  }
}

/**
 * Bounded structural-only safetyDetail for a bridge prequote. A successful
 * Khalani quote proves route availability, NOT token safety — so the verdict is
 * ALWAYS `unknown` and the detail says exactly that (object shape, no raw text).
 */
const BRIDGE_SAFETY_DETAIL: Record<string, unknown> = {
  bridge: true,
  note: "route-only; no token-safety check",
};

/**
 * Record a bridge prequote from a successful `khalani.quote.get`. The identity
 * comes from the QUOTE params via the SHARED `buildBridgeIdentity` (the same
 * builder the execute gate uses), so quote↔execute hashes collide. Verdict is
 * ALWAYS `unknown`. Best-effort: an identity-build throw (unresolved chain /
 * wallet-scope) is a bounded skip, never a fabricated row.
 */
async function recordBridgePrequote(
  toolId: string,
  sessionId: string,
  provider: string,
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<void> {
  let identity: BridgeMatchInput;
  try {
    identity = await buildBridgeIdentity(sessionId, params, context);
  } catch (err) {
    const reason = err instanceof VexError ? err.code : "bridge_identity_failed";
    logger.warn("protocol.prequote.skipped", { toolId, reason });
    return;
  }

  const matchHash = computePrequoteMatchHash(identity);
  const input: CreatePrequoteInput = {
    prequoteId: `prequote-${randomUUID()}`,
    sessionId,
    matchHash,
    kind: "bridge",
    // Bridge prequote `family` is the SOURCE family (where the signer lives) —
    // mirrors the verdict provider/family pairing the gate reads back by kind.
    family: identity.sourceFamily,
    provider,
    // Bridge rows have two chain ids; only the SOURCE id maps onto the single
    // `chain_id` column (the dest id is part of the match-hash, not a column).
    chainId: identity.fromChainId,
    walletAddress: identity.sourceWallet,
    tokenIn: identity.fromToken,
    tokenOut: identity.toToken,
    amount: identity.amount,
    slippageBps: null,
    safetyVerdict: "unknown",
    safetyDetail: BRIDGE_SAFETY_DETAIL,
    routeRef: null,
    expiresAt: new Date(Date.now() + PREQUOTE_MAX_AGE_MS).toISOString(),
  };

  if (await writePrequoteRow(toolId, input)) {
    logger.info("protocol.prequote.recorded", {
      toolId,
      family: identity.sourceFamily,
      verdict: "unknown",
    });
  }
}

// ── Stage 7 — execute-time prequote gate ────────────────────────────────────
//
// Quote-before-transaction: a swap EXECUTE may broadcast ONLY when a fresh
// matching `swap` prequote exists and that prequote is not a confirmed scam.
// The gate is the INVERSE of the recorder: the recorder swallows its errors
// (a missing prequote is safe), but the gate FAILS CLOSED — any error, a
// missing session, or an un-gateable token identity → BLOCK. The gate runs
// BEFORE the approval gate in `executeProtocolTool`; an allow carries the
// matched verdict to the restricted-mode approval preview (R5).
//
// NEVER leaks raw provider/DB/wallet text — only a bounded structural reason
// class reaches the log and the agent-facing message.

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
  | { readonly kind: "swap"; readonly family: PrequoteFamily }
  | { readonly kind: "bridge" };

export const EXECUTE_GATE_TOOLS: Record<string, ExecuteGateRegistration> = {
  "kyberswap.swap.sell": { kind: "swap", family: "eip155" },
  "kyberswap.swap.buy": { kind: "swap", family: "eip155" },
  "solana.swap.execute": { kind: "swap", family: "solana" },
  "khalani.bridge": { kind: "bridge" },
};

/**
 * Single gate decision. `allow` carries the matched prequote's verdict +
 * id (the verdict rides to the approval preview). `block` carries a BOUNDED
 * structural `reason` (for the log) and an agent-facing `message`. No row
 * contents, addresses, or raw error text appear in either field.
 */
export type GateDecision =
  | { readonly kind: "allow"; readonly verdict: SafetyVerdict; readonly prequoteId: string }
  | { readonly kind: "block"; readonly reason: GateBlockReason; readonly message: string };

/** Bounded reason class for a gate block — never raw provider/DB/wallet text. */
type GateBlockReason =
  | "gate_error"        // any thrown failure (DB / chain parse / resolve) — fail-closed
  | "no_session"        // missing sessionId on the execution context
  | "unresolved_token"  // EVM bare-symbol leg at execute (un-gateable identity)
  | "no_quote"          // no fresh matching prequote for these exact params
  | "safety_fail"       // a fresh prequote flagged the trade as a confirmed scam
  | "unbindable_param"; // bridge execute carries an EXECUTE-ONLY param (routeId /
                        // depositMethod) the quote can never bind — fail-closed

const SWAP_BLOCK_MESSAGES: Record<GateBlockReason, string> = {
  gate_error:
    "Swap blocked: could not verify a fresh quote. Re-run the swap quote and retry.",
  no_session:
    "Swap blocked: could not verify a fresh quote (no session). Re-run the swap quote and retry.",
  unresolved_token:
    "Swap blocked: unresolved execute token — pass the exact token address the quote returned, then retry.",
  no_quote:
    "Swap blocked: no fresh quote for these exact params. Call the swap quote first, then retry.",
  safety_fail:
    "Swap blocked: the quoted token was flagged unsafe (honeypot/scam). Aborting.",
  // Unreachable on the swap path (only the bridge execute carries these params),
  // but the reason map must be total over GateBlockReason.
  unbindable_param:
    "Swap blocked: a parameter cannot be bound to a quote. Remove it and retry.",
};

const BRIDGE_BLOCK_MESSAGES: Record<GateBlockReason, string> = {
  gate_error:
    "Bridge blocked: could not verify a fresh bridge quote. Re-run bridge_quote and retry.",
  no_session:
    "Bridge blocked: could not verify a fresh bridge quote (no session). Re-run bridge_quote and retry.",
  // A bridge execute has no bare-symbol leg (addresses are passed through), so
  // this reason is unreachable on the bridge path; keep a coherent message.
  unresolved_token:
    "Bridge blocked: unresolved bridge token — pass the exact token addresses the quote returned, then retry.",
  no_quote:
    "Bridge blocked: no fresh bridge quote for these exact params. Call bridge_quote first, then retry.",
  safety_fail:
    "Bridge blocked: the quoted route was flagged unsafe. Aborting.",
  unbindable_param:
    "Bridge blocked: routeId/depositMethod cannot be bound to a quote — omit them (the bridge selects the best route) or this execute can't be verified.",
};

function block(reason: GateBlockReason, kind: PrequoteKind): GateDecision {
  const messages = kind === "bridge" ? BRIDGE_BLOCK_MESSAGES : SWAP_BLOCK_MESSAGES;
  return { kind: "block", reason, message: messages[reason] };
}

/** A thrown identity-build error that already names its block reason. */
class GateIdentityError extends Error {
  constructor(readonly gateReason: GateBlockReason) {
    super(gateReason);
    this.name = "GateIdentityError";
  }
}

/** EVM trade identity for the match-hash. `chainId` is the numeric chain id. */
interface GateIdentity {
  readonly family: PrequoteFamily;
  readonly chainId: number | null;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string;
}

/**
 * Canonicalize one EVM execute-leg token to the identity the quote recorded:
 *   - native input ("ETH"/"native"/sentinel) → `NATIVE_TOKEN_ADDRESS` (the hash
 *     lowercases it; the quote recorded the same sentinel),
 *   - a hex address → used verbatim (the hash lowercases it),
 *   - a bare symbol → un-gateable at execute → BLOCK (Kyber execute is strict
 *     address-only anyway; the gate never network-resolves an EVM symbol).
 */
function evmLegIdentity(param: string): string {
  if (isNativeTokenInput(param)) return NATIVE_TOKEN_ADDRESS;
  if (isAddress(param)) return param;
  throw new GateIdentityError("unresolved_token");
}

/** Build the EVM trade identity from validated execute params. Throws on a bare symbol. */
function buildEvmIdentity(params: Record<string, unknown>): GateIdentity {
  const chainParam = typeof params.chain === "string" ? params.chain : "";
  const tokenInParam = typeof params.tokenIn === "string" ? params.tokenIn : "";
  const tokenOutParam = typeof params.tokenOut === "string" ? params.tokenOut : "";
  const amount = typeof params.amountIn === "string" ? params.amountIn : "";
  // resolveChainSlug + slugToChainId are local (no network); an unsupported
  // chain throws a VexError → caught upstream → gate_error block (fail-closed).
  const chainId = slugToChainId(resolveChainSlug(chainParam));
  return {
    family: "eip155",
    chainId,
    tokenIn: evmLegIdentity(tokenInParam),
    tokenOut: evmLegIdentity(tokenOutParam),
    amount,
  };
}

/**
 * Build the Solana trade identity. `inputToken`/`outputToken` are symbol-OR-mint
 * at execute; resolve BOTH to their mint with the SAME resolver
 * `executeJupiterSwap` uses (`requireJupiterResolvedToken`, which returns
 * `.address` = mint) so the gate mint matches the recorded mint. A resolve
 * failure throws → caught upstream → gate_error block.
 */
async function buildSolanaIdentity(params: Record<string, unknown>): Promise<GateIdentity> {
  const inputParam = typeof params.inputToken === "string" ? params.inputToken : "";
  const outputParam = typeof params.outputToken === "string" ? params.outputToken : "";
  const [inToken, outToken] = await Promise.all([
    requireJupiterResolvedToken(inputParam),
    requireJupiterResolvedToken(outputParam),
  ]);
  return {
    family: "solana",
    chainId: null,
    tokenIn: inToken.address,
    tokenOut: outToken.address,
    amount: String(params.amount),
  };
}

/**
 * EXECUTE-ONLY khalani.bridge params the bridge QUOTE (`khalani.quote.get`) has
 * NO counterpart for — they can never be quote-bound, so they can never appear
 * in the prequote identity. `routeId` pins a specific route; `depositMethod`
 * picks the on-chain deposit path. Both materially change the broadcast but are
 * invisible to the quote, so binding them is impossible by construction.
 */
const BRIDGE_UNBINDABLE_PARAMS = ["routeId", "depositMethod"] as const;

/**
 * Fail closed if a bridge EXECUTE carries an unbindable execute-only param. This
 * runs in the gate (the single broadcast chokepoint), so it protects BOTH the
 * `bridge` alias and the direct `execute_tool({ toolId:"khalani.bridge" })`
 * path — even though the alias surface no longer exposes these params. A
 * non-empty value → `GateIdentityError("unbindable_param")` (caught upstream →
 * bounded BLOCK before approval).
 */
function assertBridgeParamsBindable(params: Record<string, unknown>): void {
  for (const key of BRIDGE_UNBINDABLE_PARAMS) {
    if (bridgeStr(params, key) !== "") {
      throw new GateIdentityError("unbindable_param");
    }
  }
}

/**
 * Compute the match-hash + the family label for a gated EXECUTE call. Swap
 * branches on EVM/Solana identity builders (sync EVM, async Solana resolve);
 * bridge uses the SHARED `buildBridgeIdentity` so its hash collides with the
 * recorder's. Throws a `GateIdentityError` / VexError on an un-gateable identity
 * (caught upstream → fail-closed block).
 */
async function computeGateMatch(
  gated: ExecuteGateRegistration,
  sessionId: string,
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<{ matchHash: string; family: PrequoteFamily }> {
  if (gated.kind === "bridge") {
    // Fail closed FIRST on execute-only params the quote can never bind — before
    // building the identity, so an unbindable execute is rejected even if the
    // rest of the identity would otherwise match a recorded quote.
    assertBridgeParamsBindable(params);
    const identity = await buildBridgeIdentity(sessionId, params, context);
    return { matchHash: computePrequoteMatchHash(identity), family: identity.sourceFamily };
  }

  // Resolve the SELECTED address (never decrypts). A wallet-scope throw
  // propagates → caught upstream → gate_error block (never fabricate).
  const walletAddress = resolveSelectedAddress(
    context.walletResolution,
    context.walletPolicy,
    gated.family as ChainFamily,
  );
  const identity =
    gated.family === "eip155" ? buildEvmIdentity(params) : await buildSolanaIdentity(params);
  const matchHash = computePrequoteMatchHash({
    kind: "swap",
    sessionId,
    family: gated.family,
    chainId: identity.chainId,
    walletAddress,
    tokenIn: identity.tokenIn,
    tokenOut: identity.tokenOut,
    amount: identity.amount,
  });
  return { matchHash, family: gated.family };
}

/**
 * Evaluate the execute-time prequote gate for a gated EXECUTE (swap OR bridge).
 * Single decision; fail-closed to BLOCK on ANY failure. Guardrail #1: a fresh
 * `fail` row can never slip through — `existsFreshFailByMatch` (kind-scoped) is
 * checked FIRST (a later `pass`/`unknown` for the same identity cannot override
 * it), and the latest-row `fail` is re-checked as belt-and-suspenders. A bridge
 * prequote is always `unknown`, so the bridge path normally allows via the
 * unknown branch; the fail checks are kept for uniformity.
 */
export async function evaluatePrequoteGate(
  toolId: string,
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<GateDecision> {
  const gated = EXECUTE_GATE_TOOLS[toolId];
  if (!gated) {
    // Defensive: callers only invoke for gated tools. Treat an unexpected tool
    // as a block rather than silently allowing an ungated execute. Default the
    // wording to the swap variant (the swap path is the historical caller).
    return block("gate_error", "swap");
  }
  const gateKind: PrequoteKind = gated.kind;

  try {
    const sessionId = context.sessionId;
    if (!sessionId) return block("no_session", gateKind);

    const { matchHash, family } = await computeGateMatch(gated, sessionId, params, context);

    // Guardrail #1 — a fresh confirmed-scam row dominates everything else.
    if (await prequoteRepo.existsFreshFailByMatch(sessionId, matchHash, gateKind)) {
      return block("safety_fail", gateKind);
    }

    const latest = await prequoteRepo.findLatestFreshByMatch(sessionId, matchHash, gateKind);
    if (!latest) return block("no_quote", gateKind);

    // Belt-and-suspenders: even though existsFreshFail already ruled out a fresh
    // fail, never allow a `fail` latest row (guardrail #1).
    if (latest.safetyVerdict === "fail") return block("safety_fail", gateKind);

    if (latest.safetyVerdict === "unknown") {
      // Surface that an un-audited identity is being allowed (preview/full-auto
      // see it downstream). Prefix only — never the full hash or any address.
      logger.warn("protocol.prequote.gate.unknown_allowed", {
        toolId,
        family,
        matchHashPrefix: matchHash.slice(0, 8),
      });
    }
    return { kind: "allow", verdict: latest.safetyVerdict, prequoteId: latest.prequoteId };
  } catch (err) {
    const reason =
      err instanceof GateIdentityError
        ? err.gateReason
        : ("gate_error" as const);
    // Bounded structural log only — never raw provider/DB/wallet text.
    logger.warn("protocol.prequote.gate.error", {
      toolId,
      reason,
      errorClass:
        err instanceof VexError
          ? err.code
          : err instanceof Error
            ? err.constructor.name
            : "unknown",
    });
    return block(reason, gateKind);
  }
}

/**
 * Back-compat alias — the historical swap-only entry point. Delegates to the
 * kind-aware `evaluatePrequoteGate` (the gated registry now carries the kind).
 * Retained so existing swap callers/tests keep working unchanged.
 */
export async function evaluateSwapPrequoteGate(
  toolId: string,
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<GateDecision> {
  return evaluatePrequoteGate(toolId, params, context);
}
