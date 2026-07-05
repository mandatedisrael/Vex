/**
 * Action-named READ-ONLY alias handlers (Stage 8a).
 *
 * Each handler validates its (untrusted) args with Zod at the boundary,
 * translates them into the TARGET protocol tool's exact param names, and
 * dispatches via `executeProtocolTool`. Because every target is non-mutating,
 * no approval gate fires. `swap_quote` is a family ROUTER (EVM vs Solana); the
 * other three are pass-through / mode selectors.
 *
 * Param translation is the whole point — the alias presents ONE clean
 * LLM-facing shape and maps to whatever the underlying manifest calls things:
 *
 *   swap_quote (EVM)    { chain, tokenIn, tokenOut, amount, slippageBps? }
 *                       → kyberswap.swap.quote { chain, tokenIn, tokenOut, amountIn: amount, slippageBps? }
 *   swap_quote (Solana) → solana.swap.quote   { inputToken: tokenIn, outputToken: tokenOut, amount: Number(amount), slippageBps? }
 *   token_check         { chain, address }      → kyberswap.tokens.check (same keys)
 *   bridge_status (id)  { orderId }              → khalani.orders.get { orderId }
 *   bridge_status (list)→ khalani.orders.list (pass through list filters)
 *   bridge_quote        → khalani.quote.get (same keys)
 *
 * Units: kyber/jupiter swap `amount` is HUMAN decimal (e.g. "1.5"); khalani
 * bridge `amount` is SMALLEST units (wei/lamports). The alias schemas document
 * this and translation preserves it (no unit conversion happens here).
 */

import { z } from "zod";

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { fail } from "./types.js";
import { executeProtocolTool } from "../protocols/runtime.js";
import { classifySwapFamily, isEvmSwapTokenInput } from "./swap-family.js";
import { resolveBridgeVenue } from "@tools/relay/bridge-venue.js";
import {
  isFallbackEligibleQuoteCategory,
  resolveUniswapFallbackChainKey,
} from "@tools/uniswap/venue-router.js";
import logger from "@utils/logger.js";

// ── Shared dispatch context projection ───────────────────────────────
//
// The read-only aliases need the same execution-context slice the Khalani
// read aliases pass (no `contextUsageBand` — these are never mutating, so the
// protocol-runtime pressure guard is a no-op for them; mirrors
// internal/khalani.ts).

function protocolContext(context: InternalToolContext): Parameters<typeof executeProtocolTool>[1] {
  return {
    sessionPermission: context.sessionPermission,
    approved: context.approved,
    sessionId: context.sessionId,
    walletResolution: context.walletResolution,
    walletPolicy: context.walletPolicy,
  };
}

// ── swap_quote — EVM/Solana family router ────────────────────────────
//
// The family classifier (`classifySwapFamily`) is shared with the Stage 8b
// MUTATING `swap` alias router (`tools/mutating-aliases.ts`) so the read-only
// quote and the execute can never disagree on which family a chain maps to.

const SwapQuoteArgs = z.object({
  chain: z.string().min(1, { message: "chain is required" }),
  tokenIn: z.string().min(1, { message: "tokenIn is required" }),
  tokenOut: z.string().min(1, { message: "tokenOut is required" }),
  amount: z.string().min(1, { message: "amount is required (human decimal string)" }),
  slippageBps: z.number().int().nonnegative().optional(),
});

type SwapQuoteArgs = z.infer<typeof SwapQuoteArgs>;

export async function handleSwapQuote(
  args: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = SwapQuoteArgs.safeParse(args);
  if (!parsed.success) {
    return fail(`swap_quote: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const a: SwapQuoteArgs = parsed.data;

  const family = classifySwapFamily(a.chain);
  if (family.kind === "unknown") {
    return fail(
      `swap_quote: cannot determine swap family for chain "${a.chain}". ` +
        `Use a supported EVM chain (e.g. ethereum, base, arbitrum) or "solana".`,
    );
  }

  if (family.kind === "solana") {
    // Solana quote manifest types `amount` as a NUMBER (human decimal) — coerce
    // the unified string here so the protocol-runtime type check passes.
    const amount = Number(a.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(`swap_quote: amount "${a.amount}" is not a positive number.`);
    }
    const params: Record<string, unknown> = {
      inputToken: a.tokenIn,
      outputToken: a.tokenOut,
      amount,
      ...(a.slippageBps !== undefined ? { slippageBps: a.slippageBps } : {}),
    };
    return executeProtocolTool({ toolId: "solana.swap.quote", params }, protocolContext(context));
  }

  // EVM → the VENUE ROUTER's primary venue (KyberSwap where supported, Uniswap on
  // Robinhood Chain / as an all-EVM fallback). Both quote handlers resolve tokens
  // strictly (address-only), so DEX symbol search is disabled to avoid
  // wrong-contract matches (e.g. "USDC" → axlUSDC). Reject a bare symbol here.
  if (!isEvmSwapTokenInput(a.tokenIn) || !isEvmSwapTokenInput(a.tokenOut)) {
    return fail(
      "swap_quote: EVM tokens must be a contract address — resolve the symbol " +
        "with token_find first, or pass native ETH/native. (Symbol resolution " +
        "via the DEX is disabled to avoid wrong-contract matches.)",
    );
  }

  // amount → amountIn (both human decimal strings). Route quote to the SAME venue
  // the `swap` execute alias uses (shared classifier), so the prequote gate's
  // venue-bound match-hash collides between the quote and the execute.
  const buildParams = (chain: string): Record<string, unknown> => ({
    chain,
    tokenIn: a.tokenIn,
    tokenOut: a.tokenOut,
    amountIn: a.amount,
    ...(a.slippageBps !== undefined ? { slippageBps: a.slippageBps } : {}),
  });

  const primaryToolId = family.venue === "uniswap" ? "uniswap.swap.quote" : "kyberswap.swap.quote";
  const primary = await executeProtocolTool(
    { toolId: primaryToolId, params: buildParams(family.chain) },
    protocolContext(context),
  );

  // Runtime Kyber→Uniswap QUOTE fallback (LOCKED Wave-2 #3). ONLY when KyberSwap
  // was the primary venue AND its quote FAILED with a transport/API/route error
  // AND a verified Uniswap deployment exists for the chain. A honeypot/token-
  // safety verdict is surfaced on a SUCCESSFUL quote (never a throw), so it can
  // never reach this branch — the fallback can never launder a safety block. The
  // Uniswap quote records provider "uniswap", so the venue-bound prequote identity
  // binds a later execute to Uniswap automatically (a KyberSwap execute would
  // hash to a different identity and fail the gate). Policy (eligible categories +
  // fallback availability) lives in the single venue-router module.
  if (primary.success || family.venue !== "kyberswap") return primary;
  if (!isFallbackEligibleQuoteCategory(runtimeFailureCategory(primary.output))) return primary;
  const fallbackChain = resolveUniswapFallbackChainKey(a.chain);
  if (fallbackChain === undefined) return primary;
  logger.info("swap_quote.venue_fallback", {
    fromVenue: "kyberswap",
    toVenue: "uniswap",
    chain: fallbackChain,
  });
  return executeProtocolTool(
    { toolId: "uniswap.swap.quote", params: buildParams(fallbackChain) },
    protocolContext(context),
  );
}

/**
 * Extract the coarse runtime error category the protocol runtime embeds in a
 * THROWN handler failure's output (`"<toolId> failed (<category>): <message>"`;
 * see protocols/runtime/errors.ts). Returns "" when the output is not a
 * thrown-failure summary — e.g. a returned validation `fail(...)` carries no
 * category — so a non-transport failure is never treated as fallback-eligible.
 */
function runtimeFailureCategory(output: string): string {
  return /\bfailed \(([a-z_]+)\):/.exec(output)?.[1] ?? "";
}

// ── token_check — EVM honeypot / fee-on-transfer ─────────────────────

const TokenCheckArgs = z.object({
  chain: z.string().min(1, { message: "chain is required" }),
  address: z.string().min(1, { message: "address is required" }),
});

export async function handleTokenCheck(
  args: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = TokenCheckArgs.safeParse(args);
  if (!parsed.success) {
    return fail(`token_check: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const { chain, address } = parsed.data;
  return executeProtocolTool(
    { toolId: "kyberswap.tokens.check", params: { chain, address } },
    protocolContext(context),
  );
}

// ── bridge_status — order get (by id) / orders list ──────────────────

const BridgeStatusArgs = z.object({
  orderId: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  wallet: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.number().int().nonnegative().optional(),
  fromChain: z.string().min(1).optional(),
  toChain: z.string().min(1).optional(),
  orderIds: z.string().min(1).optional(),
  txHashSearch: z.string().min(1).optional(),
});

export async function handleBridgeStatus(
  args: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = BridgeStatusArgs.safeParse(args);
  if (!parsed.success) {
    return fail(`bridge_status: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const a = parsed.data;

  if (a.orderId !== undefined) {
    return executeProtocolTool(
      { toolId: "khalani.orders.get", params: { orderId: a.orderId } },
      protocolContext(context),
    );
  }

  // List mode — forward only the list filters that were provided.
  const params: Record<string, unknown> = {};
  if (a.address !== undefined) params.address = a.address;
  if (a.wallet !== undefined) params.wallet = a.wallet;
  if (a.limit !== undefined) params.limit = a.limit;
  if (a.cursor !== undefined) params.cursor = a.cursor;
  if (a.fromChain !== undefined) params.fromChain = a.fromChain;
  if (a.toChain !== undefined) params.toChain = a.toChain;
  if (a.orderIds !== undefined) params.orderIds = a.orderIds;
  if (a.txHashSearch !== undefined) params.txHashSearch = a.txHashSearch;
  return executeProtocolTool({ toolId: "khalani.orders.list", params }, protocolContext(context));
}

// ── bridge_quote — read-only cross-chain bridge preview ──────────────

const BridgeQuoteArgs = z.object({
  fromChain: z.string().min(1, { message: "fromChain is required" }),
  fromToken: z.string().min(1, { message: "fromToken is required" }),
  toChain: z.string().min(1, { message: "toChain is required" }),
  toToken: z.string().min(1, { message: "toToken is required" }),
  amount: z.string().min(1, { message: "amount is required (smallest units)" }),
  tradeType: z.string().min(1).optional(),
  fromAddress: z.string().min(1).optional(),
  recipient: z.string().min(1).optional(),
  refundTo: z.string().min(1).optional(),
  referrer: z.string().min(1).optional(),
  referrerFeeBps: z.string().min(1).optional(),
  filler: z.string().min(1).optional(),
  slippageBps: z.string().min(1).optional(),
});

export async function handleBridgeQuote(
  args: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = BridgeQuoteArgs.safeParse(args);
  if (!parsed.success) {
    return fail(`bridge_quote: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const a = parsed.data;

  // Route the quote to the SAME venue the `bridge` execute alias uses (Relay when
  // either side is Robinhood Chain, else Khalani), so the venue-bound bridge
  // prequote gate collides between the quote and the execute.
  if (resolveBridgeVenue(a.fromChain, a.toChain) === "relay") {
    const params: Record<string, unknown> = {
      fromChain: a.fromChain,
      fromToken: a.fromToken,
      toChain: a.toChain,
      toToken: a.toToken,
      amount: a.amount,
    };
    if (a.tradeType !== undefined) params.tradeType = a.tradeType;
    if (a.recipient !== undefined) params.recipient = a.recipient;
    if (a.refundTo !== undefined) params.refundTo = a.refundTo;
    if (a.slippageBps !== undefined) params.slippageBps = a.slippageBps;
    return executeProtocolTool({ toolId: "relay.quote.get", params }, protocolContext(context));
  }

  const params: Record<string, unknown> = {
    fromChain: a.fromChain,
    fromToken: a.fromToken,
    toChain: a.toChain,
    toToken: a.toToken,
    amount: a.amount,
  };
  if (a.tradeType !== undefined) params.tradeType = a.tradeType;
  if (a.fromAddress !== undefined) params.fromAddress = a.fromAddress;
  if (a.recipient !== undefined) params.recipient = a.recipient;
  if (a.refundTo !== undefined) params.refundTo = a.refundTo;
  if (a.referrer !== undefined) params.referrer = a.referrer;
  if (a.referrerFeeBps !== undefined) params.referrerFeeBps = a.referrerFeeBps;
  if (a.filler !== undefined) params.filler = a.filler;
  return executeProtocolTool({ toolId: "khalani.quote.get", params }, protocolContext(context));
}
