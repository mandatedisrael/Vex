/**
 * Action-named internal tool aliases (Stage 8a read-only + Stage 8b mutating).
 *
 * These present the model with an obvious, action-named menu that routes to
 * existing protocol tools. They are ADDITIVE — the underlying protocol tools
 * stay reachable via discover_tools / execute_tool.
 *
 *   swap_quote   → family router: EVM → kyberswap.swap.quote, Solana → solana.swap.quote
 *   token_check  → kyberswap.tokens.check   (EVM honeypot / fee-on-transfer)
 *   bridge_status→ khalani.orders.get (with id) / khalani.orders.list (without)
 *   bridge_quote → khalani.quote.get        (read-only bridge preview)
 *   swap         → MUTATING family router (Stage 8b): EVM → kyberswap.swap.buy /
 *                  kyberswap.swap.sell, Solana → solana.swap.execute
 *   bridge       → MUTATING router (Stage 8c): → khalani.bridge (cross-chain)
 *
 * The four 8a aliases are non-mutating, so dispatching them through
 * `executeProtocolTool` fires no approval gate. `swap` (8b) and `bridge` (8c)
 * ARE mutating: each is dispatched through a DEDICATED dispatcher branch
 * (`mutating-aliases.ts`) that resolves the target and calls `executeProtocolTool`
 * directly — letting that function SOLELY own the ordering (prequote gate →
 * approval gate → capture). A mutating alias MUST NOT travel through the
 * dispatcher's internal mutating-approval gate (that would enqueue approval
 * BEFORE the prequote gate). `bridge` REQUIRES a fresh `bridge_quote` first — the
 * bridge prequote (kind 'bridge', verdict always 'unknown') seeds the gate.
 *
 * `swap_quote` routes to the kyber/solana quote toolIds that already record a
 * Stage-6c prequote via the hook in `executeProtocolTool` — calling a quote
 * before a swap naturally seeds the Stage-7 execute gate. No prequote wiring
 * lives here.
 *
 * NOTE: `swap_quote` / `swap` are deliberately NOT `requiresEnv`-gated. They
 * are routers spanning both families; the Solana target's `JUPITER_API_KEY`
 * requirement is enforced downstream by `executeProtocolTool`
 * (manifest.requiresEnv) only when a Solana route is actually taken — gating the
 * whole alias on a Solana-only env var would wrongly hide the EVM path.
 */

import type { ToolDef } from "../types.js";

export const ACTION_ALIAS_TOOLS: readonly ToolDef[] = [
  {
    name: "swap_quote",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "read",
    description:
      "Preview a token swap WITHOUT executing — best route, expected output, price impact, and (EVM) token-safety legs. Auto-routes by chain: any EVM chain (ethereum, base, arbitrum, …) → KyberSwap aggregator across 400+ DEXs; chain \"solana\" → Jupiter. Resolve token addresses via token_find first. `amount` is the HUMAN decimal of tokenIn (e.g. \"1.5\", not wei/lamports). Call this BEFORE any swap: a fresh matching quote is what unlocks execution.",
    parameters: {
      type: "object",
      properties: {
        chain: {
          type: "string",
          description:
            "Chain to swap on. Any EVM slug/alias (ethereum, eth, base, arbitrum, arb, polygon, …) routes to KyberSwap; the literal \"solana\" routes to Jupiter.",
        },
        tokenIn: {
          type: "string",
          description: "Input token — contract address (EVM) / mint (Solana), or a symbol the provider can resolve.",
        },
        tokenOut: {
          type: "string",
          description: "Output token — contract address (EVM) / mint (Solana), or a symbol the provider can resolve.",
        },
        amount: {
          type: "string",
          description: "Amount of tokenIn to swap, in HUMAN decimal units (e.g. \"1.5\"). Not wei/lamports.",
        },
        slippageBps: {
          type: "number",
          description: "Optional slippage tolerance in basis points (50 = 0.5%).",
        },
      },
      required: ["chain", "tokenIn", "tokenOut", "amount"],
    },
  },
  {
    name: "swap",
    kind: "internal",
    mutating: true,
    // Mirrors the TARGET swap-execute manifests (kyberswap.swap.sell/buy,
    // solana.swap.execute are all mutating). At context pressure barrier+ the
    // dispatcher hard-denies the alias before the router resolves — conservative
    // and equivalent to denying the mutating target directly.
    pressureSafety: "mutating",
    // SAME actionKind the target swap manifests carry (user_wallet_broadcast) —
    // do NOT invent one. Used as the dispatcher fallback stamp; on dispatch the
    // result already carries the target's actionKind from executeProtocolTool.
    actionKind: "user_wallet_broadcast",
    description:
      "Execute a REAL on-chain token swap (spends funds, broadcasts a signed transaction). Auto-routes by chain: any EVM chain (ethereum, base, arbitrum, …) → KyberSwap; chain \"solana\" → Jupiter. REQUIRES a fresh matching swap_quote FIRST — the execute gate blocks a swap that has no fresh quote for these exact params, so always preview with swap_quote before calling this. `amount` is the HUMAN decimal of tokenIn (e.g. \"1.5\", not wei/lamports). `side` (\"sell\"/\"buy\") is EVM-only; it tags the trade for portfolio tracking and does not apply to Solana. Resolve token addresses via token_find first.",
    parameters: {
      type: "object",
      properties: {
        chain: {
          type: "string",
          description:
            "Chain to swap on. Any EVM slug/alias (ethereum, eth, base, arbitrum, arb, polygon, …) routes to KyberSwap; the literal \"solana\" routes to Jupiter.",
        },
        tokenIn: {
          type: "string",
          description: "Input token — contract address (EVM) / mint (Solana), or a symbol the provider can resolve.",
        },
        tokenOut: {
          type: "string",
          description: "Output token — contract address (EVM) / mint (Solana), or a symbol the provider can resolve.",
        },
        amount: {
          type: "string",
          description: "Amount of tokenIn to swap, in HUMAN decimal units (e.g. \"1.5\"). Not wei/lamports.",
        },
        side: {
          type: "string",
          enum: ["sell", "buy"],
          description:
            "EVM-only. \"sell\" (default) routes to kyberswap.swap.sell; \"buy\" routes to kyberswap.swap.buy (opens a portfolio lot on tokenOut). Do not set for Solana swaps.",
        },
        slippageBps: {
          type: "number",
          description: "Optional slippage tolerance in basis points (50 = 0.5%).",
        },
        recipient: {
          type: "string",
          description: "EVM-only. Recipient address for the output token (defaults to the sender). Do not set for Solana swaps.",
        },
      },
      required: ["chain", "tokenIn", "tokenOut", "amount"],
    },
  },
  {
    name: "bridge",
    kind: "internal",
    mutating: true,
    // Mirrors the TARGET khalani.bridge manifest (mutating). At context pressure
    // barrier+ the dispatcher hard-denies the alias before the router resolves —
    // conservative and equivalent to denying the mutating target directly.
    pressureSafety: "mutating",
    // SAME actionKind the target khalani.bridge manifest carries
    // (user_wallet_broadcast) — do NOT invent one. Used as the dispatcher
    // fallback stamp; on dispatch the result already carries the target's
    // actionKind from executeProtocolTool.
    actionKind: "user_wallet_broadcast",
    description:
      "Execute a REAL cross-chain bridge via Khalani (spends funds, signs + broadcasts a deposit on the source chain). REQUIRES a fresh matching bridge_quote FIRST — the execute gate blocks a bridge that has no fresh quote for these exact params, so always preview with bridge_quote before calling this. Resolve fromToken/toToken addresses via token_find first. `amount` is in SMALLEST units (wei/lamports), matching the bridge quote.",
    parameters: {
      type: "object",
      properties: {
        fromChain: { type: "string", description: "Source chain ID or alias." },
        fromToken: { type: "string", description: "Source token address." },
        toChain: { type: "string", description: "Destination chain ID or alias." },
        toToken: { type: "string", description: "Destination token address." },
        amount: { type: "string", description: "Amount in smallest units (wei/lamports)." },
        tradeType: { type: "string", description: "EXACT_INPUT or EXACT_OUTPUT (default: EXACT_INPUT)." },
        fromAddress: { type: "string", description: "Source wallet address override." },
        recipient: { type: "string", description: "Destination recipient override (defaults to your dest-chain wallet)." },
        refundTo: { type: "string", description: "Refund address override (defaults to fromAddress)." },
        referrer: { type: "string", description: "EVM referrer address for fee sharing." },
        referrerFeeBps: { type: "string", description: "Referrer fee in basis points (0-9999)." },
        filler: { type: "string", description: "Restrict quotes to a specific filler." },
        // NOTE: routeId / depositMethod are intentionally NOT exposed. They are
        // EXECUTE-ONLY (the bridge quote has no counterpart), so they can never be
        // bound to a quote — the bridge auto-selects the best route. The execute
        // gate fail-closes (block "unbindable_param") if they reach khalani.bridge
        // via the direct execute_tool path, so dropping them here is the menu half
        // of a defense-in-depth pair (8c security fix).
      },
      required: ["fromChain", "fromToken", "toChain", "toToken", "amount"],
    },
  },
  {
    name: "token_check",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "read",
    description:
      "Safety-check an EVM token before trading it: detects honeypots and fee-on-transfer (tax) tokens via KyberSwap. Pass the chain and the token contract `address` (resolve it with token_find first). Read-only.",
    parameters: {
      type: "object",
      properties: {
        chain: { type: "string", description: "EVM chain slug or alias (ethereum, base, arbitrum, …)." },
        address: { type: "string", description: "Token contract address to inspect." },
      },
      required: ["chain", "address"],
    },
  },
  {
    name: "bridge_status",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "read",
    description:
      "Check cross-chain bridge order status via Khalani. Pass `orderId` to fetch one order's full lifecycle; omit it to list your recent bridge orders (with optional filters/pagination). Read-only.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "Khalani order ID. Provide to fetch a single order; omit to list your orders.",
        },
        address: { type: "string", description: "List mode: wallet address (optional — uses your configured wallet)." },
        wallet: { type: "string", description: "List mode: wallet family — eip155 or solana." },
        limit: { type: "number", description: "List mode: max results." },
        cursor: { type: "number", description: "List mode: pagination cursor for the next page." },
        fromChain: { type: "string", description: "List mode: source chain filter (ID or alias)." },
        toChain: { type: "string", description: "List mode: destination chain filter (ID or alias)." },
        orderIds: { type: "string", description: "List mode: comma-separated order IDs to filter." },
        txHashSearch: { type: "string", description: "List mode: search by transaction hash." },
      },
    },
  },
  {
    name: "bridge_quote",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "read",
    description:
      "Preview a cross-chain bridge WITHOUT executing — routes, pricing, fees, and ETA via Khalani. Resolve fromToken/toToken addresses via token_find first. `amount` is in SMALLEST units (wei/lamports), matching the underlying bridge quote. Read-only.",
    parameters: {
      type: "object",
      properties: {
        fromChain: { type: "string", description: "Source chain ID or alias." },
        fromToken: { type: "string", description: "Source token address." },
        toChain: { type: "string", description: "Destination chain ID or alias." },
        toToken: { type: "string", description: "Destination token address." },
        amount: { type: "string", description: "Amount in smallest units (wei/lamports)." },
        tradeType: { type: "string", description: "EXACT_INPUT or EXACT_OUTPUT (default: EXACT_INPUT)." },
        fromAddress: { type: "string", description: "Source wallet address override." },
        recipient: { type: "string", description: "Destination recipient override." },
        refundTo: { type: "string", description: "Refund address override (defaults to fromAddress)." },
        referrer: { type: "string", description: "EVM referrer address for fee sharing." },
        referrerFeeBps: { type: "string", description: "Referrer fee in basis points (0-9999)." },
        filler: { type: "string", description: "Restrict quotes to a specific filler." },
      },
      required: ["fromChain", "fromToken", "toChain", "toToken", "amount"],
    },
  },
];
