/**
 * Mutating protocol-alias routers (Stage 8b).
 *
 * A MUTATING action-named alias (`swap`, `bridge`) resolves to a TARGET
 * protocol toolId + translated params, then is dispatched DIRECTLY through
 * `executeProtocolTool` by the dispatcher's dedicated branch. This is the whole
 * point of the dedicated path: a mutating alias must NOT travel through the
 * dispatcher's internal mutating-approval gate (`routeInternalTool`), because
 * that gate would enqueue approval BEFORE `executeProtocolTool`'s Stage-7
 * prequote gate runs. `executeProtocolTool` is the single chokepoint and SOLELY
 * owns the ordering: prequote gate → approval gate → capture.
 *
 * Each router:
 *   - validates the (untrusted) alias args with Zod at the boundary,
 *   - classifies the swap family (shared with the read-only `swap_quote` alias
 *     via `classifySwapFamily` so quote and execute can never disagree),
 *   - translates to the target's EXACT param names (verified against the
 *     kyberswap / solana swap manifests),
 *   - THROWS `MutatingAliasRouteError` on an un-routable request (unknown
 *     family, Solana + EVM-only `side`). The dispatcher turns the throw into a
 *     bounded failure ToolResult — it never dispatches a guessed target.
 *
 * `side` is EVM-only (KyberSwap buy/sell lots); Jupiter execution has no buy/sell
 * distinction, so a `side` on a Solana swap is REJECTED explicitly rather than
 * silently ignored (Codex: "reject it rather than imply it changes Jupiter
 * execution").
 *
 * Units: `amount` is the HUMAN decimal of `tokenIn` (e.g. "1.5"), matching the
 * kyber `amountIn` string and the Jupiter `amount` number — translation
 * preserves the value, it does not convert units.
 */

import { z } from "zod";

import { classifySwapFamily, isEvmSwapTokenInput } from "./internal/swap-family.js";
import { resolveBridgeVenue } from "@tools/relay/bridge-venue.js";

/** A resolved target for a mutating protocol-alias. */
export interface ResolvedAliasTarget {
  readonly toolId: string;
  readonly params: Record<string, unknown>;
}

/**
 * Thrown by a router when the alias cannot be routed to a concrete target
 * (unknown family, Solana + EVM-only `side`, invalid args). Carries a bounded,
 * agent-facing message — never raw provider/DB text. The dispatcher returns it
 * as a failed ToolResult; the predicate `dispatchTargetIsMutating` swallows it
 * and falls back to the registry mutating flag (the throw is a validation
 * signal, not a side-effect classification signal).
 */
export class MutatingAliasRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutatingAliasRouteError";
  }
}

/** Router signature: validated-or-raw args → resolved target, or throw. */
export type MutatingAliasRouter = (args: Record<string, unknown>) => ResolvedAliasTarget;

// ── swap — EVM (KyberSwap buy/sell) / Solana (Jupiter execute) router ──────

/**
 * `swap` alias args. `side` is EVM-only (KyberSwap lot direction); `recipient`
 * is EVM-only (the Jupiter execute manifest has no recipient param). Both are
 * optional. `amount` is a HUMAN decimal string for both families.
 */
const SwapArgs = z.object({
  chain: z.string().min(1, { message: "chain is required" }),
  tokenIn: z.string().min(1, { message: "tokenIn is required" }),
  tokenOut: z.string().min(1, { message: "tokenOut is required" }),
  amount: z.string().min(1, { message: "amount is required (human decimal string)" }),
  side: z.enum(["sell", "buy"]).optional(),
  slippageBps: z.number().int().nonnegative().optional(),
  recipient: z.string().min(1).optional(),
});

type SwapArgs = z.infer<typeof SwapArgs>;

/**
 * Resolve the `swap` alias to a concrete swap EXECUTE toolId + translated
 * params. EVM → kyberswap.swap.buy (`side === "buy"`) / kyberswap.swap.sell
 * (default); Solana → solana.swap.execute. Throws `MutatingAliasRouteError` on
 * invalid args, an unknown family, or a Solana request carrying `side`.
 */
function routeSwap(args: Record<string, unknown>): ResolvedAliasTarget {
  const parsed = SwapArgs.safeParse(args);
  if (!parsed.success) {
    // Prefix each issue with its field path so a missing required field names
    // the offending key (Zod's default "expected string, received undefined"
    // message omits it).
    throw new MutatingAliasRouteError(
      `swap: ${parsed.error.issues
        .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ")}`,
    );
  }
  const a: SwapArgs = parsed.data;

  const family = classifySwapFamily(a.chain);
  if (family.kind === "unknown") {
    throw new MutatingAliasRouteError(
      `swap: cannot determine swap family for chain "${a.chain}". ` +
        `Use a supported EVM chain (e.g. ethereum, base, arbitrum) or "solana".`,
    );
  }

  if (family.kind === "solana") {
    // `side` is an EVM-only (KyberSwap) concept. Jupiter execution has no
    // buy/sell distinction — reject explicitly rather than imply `side`
    // changes Jupiter behavior. `recipient` is likewise EVM-only here (the
    // Jupiter execute manifest has no recipient param), so reject it too.
    if (a.side !== undefined) {
      throw new MutatingAliasRouteError(
        `swap: "side" is EVM-only and does not apply to a Solana (Jupiter) swap. ` +
          `Omit "side" for chain "solana".`,
      );
    }
    if (a.recipient !== undefined) {
      throw new MutatingAliasRouteError(
        `swap: "recipient" is not supported for a Solana (Jupiter) swap. Omit it for chain "solana".`,
      );
    }
    // Jupiter execute manifest types `amount` as a NUMBER (human decimal).
    const amount = Number(a.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new MutatingAliasRouteError(`swap: amount "${a.amount}" is not a positive number.`);
    }
    const params: Record<string, unknown> = {
      inputToken: a.tokenIn,
      outputToken: a.tokenOut,
      amount,
      ...(a.slippageBps !== undefined ? { slippageBps: a.slippageBps } : {}),
    };
    return { toolId: "solana.swap.execute", params };
  }

  // EVM tokens MUST be a contract address or native — the execute handler
  // resolves strictly (resolveTokenMetadataStrict), so a bare symbol would only
  // fail deeper inside with a less-clear error. Reject it EARLY with the same
  // doctrine message the quote alias uses (symmetry: a symbol is never DEX-
  // resolved on the EVM path; use token_find first).
  if (!isEvmSwapTokenInput(a.tokenIn) || !isEvmSwapTokenInput(a.tokenOut)) {
    throw new MutatingAliasRouteError(
      "swap: EVM tokens must be a contract address — resolve the symbol with " +
        "token_find first, or pass native ETH/native.",
    );
  }

  // EVM → the VENUE ROUTER's primary venue (KyberSwap where supported, Uniswap on
  // Robinhood Chain / as an all-EVM fallback). `side === "buy"` → buy (opens a lot
  // on tokenOut); "sell"/default → sell. amount → amountIn (both human decimal).
  // Both venues share the same execute param shape (chain, tokenIn, tokenOut,
  // amountIn, slippageBps?, recipient?), verified against their manifests.
  const isBuy = a.side === "buy";
  const toolId =
    family.venue === "uniswap"
      ? isBuy
        ? "uniswap.swap.buy"
        : "uniswap.swap.sell"
      : isBuy
        ? "kyberswap.swap.buy"
        : "kyberswap.swap.sell";
  const params: Record<string, unknown> = {
    chain: family.chain,
    tokenIn: a.tokenIn,
    tokenOut: a.tokenOut,
    amountIn: a.amount,
    ...(a.slippageBps !== undefined ? { slippageBps: a.slippageBps } : {}),
    ...(a.recipient !== undefined ? { recipient: a.recipient } : {}),
  };
  return { toolId, params };
}

// ── bridge — Khalani cross-chain bridge EXECUTE router ─────────────────────

/**
 * `bridge` alias args. Mirrors the read-only `bridge_quote` shape (Stage 8a) so
 * the agent presents ONE bridge surface: preview with `bridge_quote`, execute
 * with `bridge`. Translation is a pass-through to `khalani.bridge`'s EXACT param
 * keys (verified against the khalani manifest:
 * fromChain/fromToken/toChain/toToken/amount + the optional overrides). `dryRun`
 * is intentionally NOT accepted — the alias is the real broadcast; a dry run is
 * reached via `execute_tool({ toolId:"khalani.bridge", params:{ dryRun:true }})`.
 * The EXECUTE-ONLY `routeId`/`depositMethod` knobs are ALSO not accepted (8c
 * security fix): the quote can never bind them, so the bridge auto-selects the
 * best route and the execute gate fail-closes them on the direct path.
 *
 * Units: `amount` is in SMALLEST units (wei/lamports), matching the khalani
 * bridge manifest — translation preserves the value, it does not convert.
 */
// `routeId` / `depositMethod` are deliberately ABSENT (8c security fix). They are
// EXECUTE-ONLY khalani.bridge knobs with NO counterpart in the bridge quote, so
// they can never be bound to a quote — the bridge auto-selects the best route.
// `.strict()` REJECTS them (and any other unknown key) at the alias boundary so
// the agent cannot smuggle them through the menu; the execute gate independently
// fail-closes them on the direct execute_tool path.
const BridgeArgs = z
  .object({
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
    // Relay-only slippage (bps string). Ignored on the Khalani path.
    slippageBps: z.string().min(1).optional(),
  })
  .strict();

type BridgeArgs = z.infer<typeof BridgeArgs>;

/**
 * Resolve the `bridge` alias to `khalani.bridge` OR `relay.bridge` + translated
 * params, per the bridge VENUE ROUTER (Relay whenever either side is Robinhood
 * Chain, which Khalani doesn't cover; Khalani primary otherwise). Throws
 * `MutatingAliasRouteError` on invalid args. The dedicated dispatcher branch
 * routes the result through `executeProtocolTool`, which runs the bridge prequote
 * gate (kind 'bridge', venue-bound) → approval gate → capture.
 */
function routeBridge(args: Record<string, unknown>): ResolvedAliasTarget {
  const parsed = BridgeArgs.safeParse(args);
  if (!parsed.success) {
    throw new MutatingAliasRouteError(
      `bridge: ${parsed.error.issues
        .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ")}`,
    );
  }
  const a: BridgeArgs = parsed.data;

  if (resolveBridgeVenue(a.fromChain, a.toChain) === "relay") {
    // Relay params — no referrer/fee/filler/fromAddress surface (Khalani-only).
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
    return { toolId: "relay.bridge", params };
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
  // routeId / depositMethod are NOT forwarded — they are absent from BridgeArgs
  // (.strict() rejects them). See the BridgeArgs schema note (8c security fix).
  return { toolId: "khalani.bridge", params };
}

// ── Registry ──────────────────────────────────────────────────────────────

/**
 * Registry of MUTATING protocol-alias routers, keyed by the alias tool name.
 * The dispatcher's dedicated branch uses these keys to recognise a mutating
 * alias and to resolve its TARGET toolId + params EARLY (so pressure-deny and
 * mission auto-retry-unsafe classification can use the target manifest).
 *
 * `registry-completeness.test.ts` reads these keys to (a) exclude the aliases
 * from the `INTERNAL_TOOL_LOADERS` symmetry check (they dispatch via the
 * dedicated branch, NOT a loader) and (b) assert each key is a registered
 * `kind: "internal"` ToolDef, so the exclusion can never hide an orphan.
 */
export const MUTATING_PROTOCOL_ALIAS_ROUTERS: Readonly<Record<string, MutatingAliasRouter>> = {
  swap: routeSwap,
  bridge: routeBridge,
};

/** True iff `name` is a registered mutating protocol-alias (dedicated dispatch). */
export function isMutatingProtocolAlias(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MUTATING_PROTOCOL_ALIAS_ROUTERS, name);
}
