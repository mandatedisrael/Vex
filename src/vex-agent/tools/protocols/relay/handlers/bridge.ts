/**
 * Relay bridge handlers — quote.get (read) + bridge (mutating).
 *
 * Relay is a KEYLESS cross-chain bridge and the ONLY route to/from Robinhood
 * Chain (Khalani does not cover 4663). The quote returns signable steps; the
 * bridge signs them in order (see `@tools/relay/execute`) and polls to a terminal
 * state. Capture mirrors khalani.bridge's audit shape (type "bridge").
 */

import { getRelayClient, getCachedRelayChains } from "@tools/relay/client.js";
import { resolveRelayChainId, toRelayCurrency } from "@tools/relay/chains.js";
import { executeRelayBridge } from "@tools/relay/execute.js";
import type { RelayChain, RelayQuoteRequest, RelayQuoteResponse } from "@tools/relay/types.js";

import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError, ErrorCodes } from "../../../../../errors.js";
import logger from "@utils/logger.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import { str, ok, fail } from "../../handler-helpers.js";

interface RelayLegs {
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType: "EXACT_INPUT" | "EXACT_OUTPUT";
}

/** Distinct tx chainIds per step (for the gate's shape validation + display). */
function stepSummaries(quote: RelayQuoteResponse): Array<{ id: string; kind: string; chainIds: number[] }> {
  return quote.steps.map((step) => {
    const chainIds = new Set<number>();
    for (const item of step.items) {
      if (item.data) chainIds.add(item.data.chainId);
    }
    return { id: step.id, kind: step.kind, chainIds: [...chainIds] };
  });
}

function firstRequestId(quote: RelayQuoteResponse): string | null {
  for (const step of quote.steps) {
    if (step.requestId) return step.requestId;
  }
  return null;
}

async function resolveLegs(
  params: Record<string, unknown>,
  chains: readonly RelayChain[],
): Promise<RelayLegs> {
  const fromChain = str(params, "fromChain"), toChain = str(params, "toChain");
  const fromToken = str(params, "fromToken"), toToken = str(params, "toToken");
  const amount = str(params, "amount");
  if (!fromChain || !toChain || !fromToken || !toToken || !amount) {
    throw new VexError(ErrorCodes.AGENT_VALIDATION_ERROR, "Missing required: fromChain, fromToken, toChain, toToken, amount");
  }
  const tradeTypeRaw = str(params, "tradeType");
  return {
    originChainId: resolveRelayChainId(fromChain, chains),
    destinationChainId: resolveRelayChainId(toChain, chains),
    originCurrency: toRelayCurrency(fromToken),
    destinationCurrency: toRelayCurrency(toToken),
    amount,
    tradeType: tradeTypeRaw === "EXACT_OUTPUT" ? "EXACT_OUTPUT" : "EXACT_INPUT",
  };
}

function buildRequest(legs: RelayLegs, user: string, params: Record<string, unknown>): RelayQuoteRequest {
  const recipient = str(params, "recipient") || user;
  const refundTo = str(params, "refundTo") || user;
  const slippage = str(params, "slippageBps");
  return {
    user,
    recipient,
    refundTo,
    originChainId: legs.originChainId,
    destinationChainId: legs.destinationChainId,
    originCurrency: legs.originCurrency,
    destinationCurrency: legs.destinationCurrency,
    amount: legs.amount,
    tradeType: legs.tradeType,
    ...(slippage ? { slippageTolerance: slippage } : {}),
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function relayQuoteGet(
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const chains = await getCachedRelayChains();
  let legs: RelayLegs;
  try {
    legs = await resolveLegs(params, chains);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  let user: string;
  try {
    user = resolveSelectedAddress(context.walletResolution, context.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }

  const quote = await getRelayClient().getQuote(buildRequest(legs, user, params));
  if (quote.steps.length === 0) return fail("Relay returned no steps for this route.");

  // result.data carries the structural fields the prequote recorder re-validates
  // (provider + origin/destination + step kinds/chainIds).
  return ok({
    provider: "relay",
    originChainId: legs.originChainId,
    destinationChainId: legs.destinationChainId,
    fromToken: legs.originCurrency,
    toToken: legs.destinationCurrency,
    amount: legs.amount,
    tradeType: legs.tradeType,
    steps: stepSummaries(quote),
    fees: quote.fees ?? null,
    details: quote.details ?? null,
    requestId: firstRequestId(quote),
  });
}

async function relayBridge(
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const chains = await getCachedRelayChains();
  let legs: RelayLegs;
  try {
    legs = await resolveLegs(params, chains);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  // Preview address (read) — the real signer resolves AFTER the dryRun gate.
  let previewUser: string;
  try {
    previewUser = resolveSelectedAddress(context.walletResolution, context.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }

  const quote = await getRelayClient().getQuote(buildRequest(legs, previewUser, params));
  if (quote.steps.length === 0) return fail("Relay returned no steps for this route.");

  if (params.dryRun === true) {
    return ok({
      dryRun: true,
      originChainId: legs.originChainId,
      destinationChainId: legs.destinationChainId,
      steps: stepSummaries(quote),
      fees: quote.fees ?? null,
    });
  }

  let signer: ChainWallet;
  try {
    signer = resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");

  const result = await executeRelayBridge({
    quote,
    signer,
    originChainId: legs.originChainId,
    destinationChainId: legs.destinationChainId,
  });

  const captureStatus =
    result.finalStatus === "success"
      ? "executed"
      : result.finalStatus === "failure" || result.finalStatus === "refund"
        ? "failed"
        : "pending";

  logger.info("relay.bridge.completed", {
    originChainId: legs.originChainId,
    destinationChainId: legs.destinationChainId,
    finalStatus: result.finalStatus,
  });

  return {
    success: true,
    output: JSON.stringify({
      success: true,
      requestId: result.requestId,
      status: result.finalStatus,
      txHashes: result.txHashes,
      fromChain: legs.originChainId,
      toChain: legs.destinationChainId,
    }, null, 2),
    data: {
      requestId: result.requestId,
      status: result.finalStatus,
      txHashes: result.txHashes,
      _tradeCapture: {
        type: "bridge",
        chain: String(legs.originChainId),
        status: captureStatus,
        inputToken: legs.originCurrency,
        inputTokenAddress: legs.originCurrency,
        inputAmount: legs.amount,
        outputToken: legs.destinationCurrency,
        outputTokenAddress: legs.destinationCurrency,
        signature: result.txHashes[0] ?? "",
        walletAddress: signer.address,
        meta: {
          provider: "relay",
          sourceChain: String(legs.originChainId),
          destChain: String(legs.destinationChainId),
          requestId: result.requestId,
          finalStatus: result.finalStatus,
        },
      },
    },
  };
}

export const RELAY_BRIDGE_HANDLERS: Record<string, ProtocolHandler> = {
  "relay.quote.get": (p, ctx) => relayQuoteGet(p, ctx),
  "relay.bridge": (p, ctx) => relayBridge(p, ctx),
};
