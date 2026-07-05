/**
 * Deterministic match-hash over a swap/bridge trade identity (Stage 6c/7/8c/9).
 *
 * The hash is computed IDENTICALLY at record-time and gate-time so the digests
 * collide. This module owns the canonical identity shapes, the per-field
 * canonicalization (address case, amount normalization), and the fixed-order
 * hash material.
 *
 * VENUE-BOUND scheme (LOCKED Wave-2 correction #4): `provider`/venue IS part of
 * the identity — it is the LAST field of both the swap and the bridge hash
 * material. On EVM the provider does NOT derive from `family` (kyberswap and
 * uniswap are both eip155; khalani and relay both bridge), so binding it is what
 * stops a kyberswap quote from authorizing a uniswap execute (or a khalani quote
 * a relay execute) for the same tokens/amount.
 */

import { createHash } from "node:crypto";

import type { PrequoteFamily } from "@vex-agent/db/repos/swap-prequotes.js";

// ── Match-hash ────────────────────────────────────────────────────────────

/**
 * Swap trade identity (Stage 6c/7). `kind: "swap"` is the discriminant tag —
 * Stage 8c made `PrequoteMatchInput` a union so a swap identity and a bridge
 * identity with otherwise-similar values can never collide in the hash.
 *
 * The execute-only money/safety leg (`recipient`/`approveExact`/`slippageBps`)
 * is bound too (Stage 9 security fix). `recipient` (where the output lands) and
 * `approveExact` (allowance behavior) are EVM-execute-only — the swap QUOTE has
 * no such params — so the recorder DEFAULTS them to the executor's omitted-value
 * defaults (recipient → the resolved selected wallet, i.e. output-to-self;
 * approveExact → false). A quote then authorizes an execute ONLY when the
 * execute uses those same defaulted values; an execute that SETS a different
 * recipient/approveExact produces a different digest → the gate blocks. Solana
 * has neither concept (recipient=self, approveExact=false are constants there),
 * so they never affect Solana matching — uniform and inert. `slippageBps` IS in
 * both the quote and the execute params (both families), so binding it stops a
 * 50bps quote from authorizing a 10000bps execute.
 */
export interface SwapMatchInput {
  readonly kind: "swap";
  readonly sessionId: string;
  readonly family: PrequoteFamily;
  /**
   * VENUE binding (LOCKED Wave-2 correction #4). The quoting venue/provider
   * (e.g. "kyberswap" | "uniswap" | "jupiter") is bound into the hash so a
   * KyberSwap quote can NEVER authorize a Uniswap execute for the same
   * tokens/amount (and vice-versa). Unlike Solana, an EVM `provider` does NOT
   * derive from `family` (kyber and uniswap are both eip155), so it must be an
   * explicit identity dimension. The recorder pins it from the quote-tool
   * registration; the gate pins it from the execute-tool registration.
   */
  readonly provider: string;
  /** EVM numeric chainId; null/undefined for Solana (single chain in scope). */
  readonly chainId: number | null | undefined;
  readonly walletAddress: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** Human decimal amount the quote was computed for. */
  readonly amount: string;
  /**
   * Output recipient. Defaulted to the resolved selected wallet (output-to-self)
   * when the execute omits it — mirrors `executeKyberSwap`'s
   * `str(p,"recipient") || signer.address`. Canonicalized per family (EVM
   * lowercase / Solana case-preserve). Solana = the selected wallet (constant).
   */
  readonly recipient: string;
  /**
   * Token-allowance behavior (EVM). `true` iff the execute set `approveExact`;
   * the executor's default when omitted is `false`. Canonicalized to "1"/"0" in
   * the hash. Solana = false (constant — no allowance concept).
   */
  readonly approveExact: boolean;
  /**
   * Slippage tolerance in basis points, taken from the QUOTE params (recorder)
   * and the EXECUTE params (gate). A number canonicalizes to its integer string;
   * omitted/null → the stable sentinel "" so a quote-omitted and an
   * execute-omitted slippage collide, while a 50bps quote and a 10000bps execute
   * diverge → block.
   */
  readonly slippageBps: string;
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
  /**
   * VENUE binding (LOCKED Wave-2 correction #4). The bridge provider (e.g.
   * "khalani" | "relay") is bound into the hash so a Khalani quote can never
   * authorize a Relay execute for the same route (and vice-versa). Relay gets
   * its OWN bridge identity path — it does NOT reuse Khalani's.
   */
  readonly provider: string;
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
 * record-time and gate-time. The quoting `provider`/venue IS bound (LOCKED
 * Wave-2 #4) as the LAST material field. Exported so the gate reuses the EXACT
 * function.
 *
 * Stage 8c: the material is prefixed with the `kind` discriminant tag and then
 * the kind-specific fields in a FIXED order, so a swap and a bridge with
 * otherwise-similar values produce different digests (Codex requirement #4).
 * Wave-2c appends the venue `provider` last on both kinds.
 *   - swap   : ["swap", sessionId, family, chainId|"", wallet, tokenIn, tokenOut,
 *               amount, recipient, approveExact, slippageBps, provider]
 *   - bridge : ["bridge", sessionId, sourceFamily, destFamily, fromChainId,
 *               toChainId, sourceWallet, recipient, fromToken, toToken, amount,
 *               tradeType, refundTo, referrer, referrerFeeBps, filler, provider]
 * EVM addresses/tokens lowercase; Solana mints case-preserved; amount via
 * `canonAmount`.
 *
 * Stage 9 swap tail (FIXED order, appended after `amount`): `recipient`
 * (family-canonical address — where the output lands), `approveExact` (stable
 * "1"/"0" allowance token), and `slippageBps` (integer string, or "" when
 * omitted). The recorder defaults `recipient`/`approveExact` to the executor's
 * omitted-value defaults (self / false) since the quote can't carry them, so a
 * quote↔execute that both omit them collide; an execute that redirects the
 * output or flips approveExact, or quotes 50bps then executes 10000bps,
 * diverges → block.
 *
 * Bridge: the source family canonicalizes `sourceWallet`/`fromToken`/`refundTo`;
 * the dest family canonicalizes `recipient`/`toToken` (derived from each chain
 * id). The money/fee tail (FIXED order, appended after `tradeType`): `refundTo`
 * (source-family address), `referrer` (EVM → lowercase), the already-canonical
 * `referrerFeeBps` integer string, and `filler` (opaque provider name,
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
    // Stage 9 tail (FIXED order): recipient (family-canonical address),
    // approveExact (stable "1"/"0"), slippageBps (integer string or "").
    canonAddress(input.family, input.recipient),
    input.approveExact ? "1" : "0",
    input.slippageBps,
    // Wave-2c venue binding (LOCKED #4): the quoting provider/venue, so a
    // kyber quote and a uniswap quote for the same identity hash differently.
    input.provider.trim().toLowerCase(),
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
    // Wave-2c venue binding (LOCKED #4): the bridge provider/venue, so a khalani
    // quote and a relay quote for the same route hash differently.
    input.provider.trim().toLowerCase(),
  ].join(" ");
}
