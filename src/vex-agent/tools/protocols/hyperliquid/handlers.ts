import { Decimal } from "decimal.js";
import type { Address, Hex } from "viem";

import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import type { HyperliquidExchangeClient, PerpOpenPreflightInput } from "@tools/hyperliquid/exchange.js";
import { HyperliquidInfoClient } from "@tools/hyperliquid/info.js";
import {
  ARBITRUM_NATIVE_USDC_ADDRESS,
  ARBITRUM_ONE_CHAIN_ID,
  HYPERLIQUID_BRIDGE2_MAINNET_ADDRESS,
  resolveHyperliquidNetwork,
} from "@tools/hyperliquid/constants.js";
import {
  executeHyperliquidBridge2Deposit,
  getHyperliquidBridge2DepositClients,
  parseHyperliquidBridge2DepositAmount,
} from "@tools/hyperliquid/deposit.js";
import { parseDecimalString } from "@tools/hyperliquid/validation.js";
import type { DecimalString, HyperliquidExchangeResult, HyperliquidLimitOrder, HyperliquidTimeInForce, HyperliquidTriggerOrder } from "@tools/hyperliquid/types.js";
import type { ProtocolExecutionContext, ProtocolHandler } from "../types.js";
import type { ToolResult } from "../../types.js";
import { buildPositionProtectionSnapshot, type PositionProtectionSnapshot } from "./protection-snapshot.js";
import { selectPerpOpenPath } from "./open-path.js";
import { hyperliquidPolicySchema } from "../../../../lib/hyperliquid-policy.js";
import { createHyperliquidSessionPolicyProposal } from "@vex-agent/db/repos/hyperliquid-policies.js";
import { hyperliquidRiskProposalBus } from "@vex-agent/engine/events/hyperliquid-risk-bus.js";
import { hyperliquidBuilderConsentBus } from "@vex-agent/engine/events/hyperliquid-builder-bus.js";
import { hyperliquidWorkspaceRequestBus, type HyperliquidWorkspaceMode } from "@vex-agent/engine/events/hyperliquid-workspace-bus.js";
import { resolveHlWorkspaceMode } from "../../../../lib/hyperliquid-workspace-mode.js";
import logger from "@utils/logger.js";

const TIME_IN_FORCE: ReadonlySet<HyperliquidTimeInForce> = new Set(["Gtc", "Ioc", "Alo", "FrontendMarket"]);

export const HYPERLIQUID_HANDLERS: Record<string, ProtocolHandler> = {
  "hyperliquid.perp.markets": async () => { const info = infoClient(); const [meta, contexts] = await Promise.all([info.meta(), info.metaAndAssetCtxs()]); return ok({ meta, contexts }); },
  "hyperliquid.perp.positions": async (_params, context) => withReadAddress(context, async (address) => {
    const info = infoClient(); const [state, orders, contexts] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address), info.metaAndAssetCtxs()]);
    const positionViews = positions(state).map((position) => ({ position, protection: buildPositionProtectionSnapshot(state, orders, string(position, "coin") ?? "") }));
    const single = positionViews.length === 1 ? positionViews[0] : undefined;
    const coin = string(single?.position, "coin");
    const signedSize = string(single?.position, "szi");
    const markPx = coin === undefined ? undefined : markForCoin(contexts, coin);
    const display = coin !== undefined && signedSize !== undefined && markPx !== undefined
      ? {
          namespace: "hyperliquid" as const,
          kind: "position_summary" as const,
          coin,
          side: new Decimal(signedSize).gte(0) ? "long" as const : "short" as const,
          size: new Decimal(signedSize).abs().toFixed(),
          markPx,
          protectionState: single?.protection.state,
        }
      : undefined;
    return ok({ address, positions: positionViews, ...(display === undefined ? {} : { _displayBlock: display }) });
  }),
  "hyperliquid.perp.orders": async (_params, context) => withReadAddress(context, async (address) => ok({ address, orders: await infoClient().frontendOpenOrders(address) })),
  "hyperliquid.perp.fills": async (params, context) => withReadAddress(context, async (address) => { const info = infoClient(); const startTime = number(params, "startTime"); return ok({ address, fills: startTime === undefined ? await info.userFills(address) : await info.userFillsByTime(address, startTime) }); }),
  "hyperliquid.perp.funding": async (_params, context) => withReadAddress(context, async (address) => ok({ address, funding: await infoClient().userFunding(address) })),
  "hyperliquid.account.overview": async (_params, context) => withReadAddress(context, async (address) => ok({ address, account: await infoClient().clearinghouseState(address) })),
  "hyperliquid.spot.markets": async () => { const info = infoClient(); const [meta, contexts] = await Promise.all([info.spotMeta(), info.spotMetaAndAssetCtxs()]); return ok({ meta, contexts }); },
  "hyperliquid.spot.balances": async (_params, context) => withReadAddress(context, async (address) => ok({ address, balances: await infoClient().spotClearinghouseState(address) })),
  "hyperliquid.market.book": async (params) => ok({ coin: requiredString(params, "coin"), book: await infoClient().l2Book(requiredString(params, "coin")) }),
  "hyperliquid.risk.proposeSetup": proposeRiskSetup,
  "hyperliquid.perp.open": openPerp,
  "hyperliquid.perp.close": closePerp,
  "hyperliquid.perp.setTpsl": setTpsl,
  "hyperliquid.perp.modifyOrder": modifyOrder,
  "hyperliquid.perp.cancelOrders": cancelOrders,
  "hyperliquid.perp.setLeverage": setLeverage,
  "hyperliquid.perp.adjustMargin": adjustMargin,
  "hyperliquid.perp.twap": twap,
  "hyperliquid.spot.trade": spotTrade,
  "hyperliquid.deposit": deposit,
  "hyperliquid.transfer.usdClass": usdClassTransfer,
  "hyperliquid.withdraw": withdraw,
  "hyperliquid.transfer.send": send,
  "hyperliquid.vault.overview": vaultOverview,
  "hyperliquid.vault.transfer": vaultTransfer,
  "hyperliquid.staking.overview": stakingOverview,
  "hyperliquid.staking.delegate": stakingDelegate,
  "hyperliquid.staking.transfer": stakingTransfer,
  "hyperliquid.rewards.claim": claimRewards,
  "hyperliquid.builder.approveFee": approveBuilderFee,
  "hyperliquid.workspace.enter": async (_params, context) => requestHyperliquidWorkspaceMode("hypervexing", context),
  "hyperliquid.workspace.exit": async (_params, context) => requestHyperliquidWorkspaceMode("normal", context),
};

/** Shared idempotent mode request used by protocol compatibility and the direct internal tool. */
export function requestHyperliquidWorkspaceMode(
  mode: HyperliquidWorkspaceMode,
  context: ProtocolExecutionContext,
): ToolResult {
  if (context.sessionId === undefined) {
    return fail("Hypervexing workspace requests require an active session.");
  }
  const event = { sessionId: context.sessionId, mode, requestedBy: "agent" as const };
  const alreadyActive = resolveHlWorkspaceMode(context.sessionId) === mode;
  if (!alreadyActive) hyperliquidWorkspaceRequestBus.emit(event);
  return ok({
    workspaceMode: { mode: event.mode, requestedBy: event.requestedBy },
    alreadyActive,
    _displayBlock: {
      namespace: "hyperliquid",
      kind: "workspace_mode_request",
      mode: event.mode,
      requestedBy: event.requestedBy,
      alreadyActive,
    },
  });
}

async function proposeRiskSetup(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  if (context.sessionId === undefined) return fail("Hyperliquid risk setup requires an active session.");
  if (context.hyperliquidPolicy?.kind !== "available") {
    return fail("Hyperliquid risk setup is unavailable until the user acknowledges the Hyperliquid risk disclosure.");
  }
  const coin = requiredString(params, "coin");
  const { HyperliquidMetaCache } = await import("@tools/hyperliquid/meta-cache.js");
  const asset = (await new HyperliquidMetaCache(infoClient()).get()).perpsByCoin.get(coin);
  if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const leverageCapDefault = requiredNumber(params, "leverageCapDefault");
  if (!Number.isInteger(leverageCapDefault) || leverageCapDefault > asset.maxLeverage) {
    return fail(`Proposed leverage must be a whole number no greater than ${asset.maxLeverage}x for ${coin}.`);
  }
  const policy = hyperliquidPolicySchema.parse({
    ...context.hyperliquidPolicy.snapshot.policy,
    leverageCapDefault,
    perOrderNotionalPct: requiredNumber(params, "perOrderNotionalPct"),
    totalNotionalPct: requiredNumber(params, "totalNotionalPct"),
  });
  const walletAddress = await signingAddress(context);
  const proposal = await createHyperliquidSessionPolicyProposal({
    sessionId: context.sessionId,
    walletAddress,
    coin,
    policy,
    proposedBy: "agent",
  });
  const displayProposal = {
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    coin: proposal.coin,
    policy: proposal.policy,
    proposedBy: proposal.proposedBy,
    status: proposal.status,
    confirmedAt: proposal.confirmedAt,
    expiresAt: proposal.expiresAt,
    createdAt: proposal.createdAt,
  };
  hyperliquidRiskProposalBus.emit({ sessionId: proposal.sessionId, proposalId: proposal.proposalId });
  return ok({
    proposal: displayProposal,
    _displayBlock: { namespace: "hyperliquid", kind: "risk_proposal", proposal: displayProposal },
  });
}

async function openPerp(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const side = longShort(params); const price = decimal(params, "price"); const size = decimal(params, "size");
  const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context);
  const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const leverage = requiredNumber(params, "leverage");
  const marginMode = requiredString(params, "marginMode");
  if (marginMode !== "isolated" && marginMode !== "cross") return fail("marginMode must be isolated or cross.");
  const entry: HyperliquidLimitOrder = { a: asset.asset, b: side === "long", p: price, s: size, r: false, t: { limit: { tif: "Gtc" } }, ...(cloid(params) ? { c: cloid(params) } : {}) };
  const stopPrice = optionalDecimal(params, "slPrice");
  const mustProtect = context.hyperliquidPolicy?.kind === "available" && context.hyperliquidPolicy.snapshot.policy.requireStopLoss;
  let result: HyperliquidExchangeResult;
  let orderExchange: HyperliquidExchangeClient | undefined;
  const openPath = selectPerpOpenPath(mustProtect, stopPrice !== undefined);
  const usedStop = openPath === "normalTpsl";
  let stop: HyperliquidTriggerOrder | undefined;
  let takeProfit: HyperliquidTriggerOrder | undefined;
  if (usedStop) {
    if (stopPrice === undefined) return fail("A stop-loss is required by the resolved Hyperliquid policy.");
    stop = { a: asset.asset, b: side !== "long", p: stopPrice, s: size, r: true, t: { trigger: { isMarket: true, triggerPx: stopPrice, tpsl: "sl" } } };
    const tpPrice = optionalDecimal(params, "tpPrice");
    takeProfit = tpPrice === undefined ? undefined : { a: asset.asset, b: side !== "long", p: tpPrice, s: size, r: true, t: { trigger: { isMarket: true, triggerPx: tpPrice, tpsl: "tp" } } };
  } else {
    if (mustProtect) return fail("A stop-loss is required by the resolved Hyperliquid policy.");
  }
  const openExecution = await preflightConfigureAndSubmitPerpOpen(
    exchange,
    { asset: asset.asset, leverage, marginMode, preflight: { entry, leverage, ...(stop === undefined ? {} : { stopLoss: stop }), ...(takeProfit === undefined ? {} : { takeProfit }) } },
    async () => {
      // Builder allowance work starts only after the complete bundle has passed
      // local validation and leverage setup. An invalid entry signs nothing.
      orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
      return stop === undefined
        ? orderExchange.openPosition({ entry })
        : orderExchange.openWithStopLoss({ entry, stopLoss: stop, ...(takeProfit === undefined ? {} : { takeProfit }) });
    },
  );
  if (openExecution.phase === "leverage_setup") {
    return exchangeResult(openExecution.result, {
      coin,
      side,
      phase: "leverage_setup",
      _tradeCapture: await capturePerp(info, address, coin, context, false),
    });
  }
  result = openExecution.result;
  if (orderExchange === undefined) throw new Error("Perp entry submission completed without an order client.");
  const compensation = usedStop && stopPrice !== undefined ? await compensateRejectedStop(result, orderExchange, info, address, asset.asset, coin, stopPrice) : { steps: [] as string[], unprotected: false };
  const rejectedChildWasCompensated = result.kind === "orders"
    && result.statuses[1]?.kind === "rejected"
    && (result.statuses[0]?.kind === "accepted_filled" || result.statuses[0]?.kind === "partially_filled")
    && !compensation.unprotected;
  const consolidation = rejectedChildWasCompensated
    ? { state: "complete" as const, steps: [] as string[] }
    : usedStop && stopPrice !== undefined && !compensation.unprotected
      ? await consolidateConfirmedOpen(result, orderExchange, info, address, asset.asset, coin, stopPrice)
      : { state: "not_needed" as const, steps: [] as string[] };
  const unprotectedByChoice = !usedStop;
  const containmentFailed = compensation.unprotected || consolidation.state === "pending";
  const capture = await capturePerpSafely(info, address, coin, context, false, containmentFailed || unprotectedByChoice, {
    synchronousConsolidation: consolidation.state,
    ...(containmentFailed ? { protectionState: compensation.unprotected ? "unprotected" : "unknown" } : {}),
  });
  return exchangeResult(result, {
    coin,
    side,
    usedStop,
    compensation: [...compensation.steps, ...consolidation.steps],
    ...(containmentFailed ? {
      protectionState: compensation.unprotected ? "unprotected" : "unknown",
      actionableError: "Entry may be filled while stop-loss protection is unknown or incomplete. Verify the position and run perp.setTpsl before any other Hyperliquid action.",
    } : {}),
    _tradeCapture: capture,
  }, containmentFailed);
}

export async function applyOpenLeverage(
  exchange: Pick<HyperliquidExchangeClient, "updateLeverage">,
  asset: number,
  leverage: number,
  marginMode: string,
): Promise<HyperliquidExchangeResult> {
  if (marginMode !== "isolated" && marginMode !== "cross") {
    return { kind: "batch_error", message: "marginMode must be isolated or cross.", raw: null };
  }
  return exchange.updateLeverage({ asset, leverage, isCross: marginMode === "cross" });
}

/**
 * Preserve the open action's side-effect ordering in one testable boundary:
 * exact order validation first, then the advertised leverage/margin setup,
 * and only then the signed entry submission (including builder allowance work).
 */
export async function preflightConfigureAndSubmitPerpOpen(
  exchange: Pick<HyperliquidExchangeClient, "preflightPerpOpen" | "updateLeverage">,
  input: {
    readonly asset: number;
    readonly leverage: number;
    readonly marginMode: string;
    readonly preflight: PerpOpenPreflightInput;
  },
  submit: () => Promise<HyperliquidExchangeResult>,
): Promise<{ readonly phase: "leverage_setup" | "entry"; readonly result: HyperliquidExchangeResult }> {
  await exchange.preflightPerpOpen(input.preflight);
  const leverageResult = await applyOpenLeverage(exchange, input.asset, input.leverage, input.marginMode);
  if (!exchangeOk(leverageResult)) return { phase: "leverage_setup", result: leverageResult };
  return { phase: "entry", result: await submit() };
}

export async function consolidateConfirmedOpen(
  result: HyperliquidExchangeResult,
  exchange: OpenCompensationExchange,
  info: OpenCompensationInfo,
  address: string,
  asset: number,
  coin: string,
  stopPrice: DecimalString,
): Promise<{ readonly state: "not_needed" | "complete" | "pending"; readonly steps: string[] }> {
  if (result.kind !== "orders") return { state: "not_needed", steps: [] };
  const entry = result.statuses[0];
  const child = result.statuses[1];
  if (entry?.kind !== "accepted_filled" && entry?.kind !== "partially_filled") {
    return { state: "not_needed", steps: [] };
  }
  if (child?.kind !== "accepted_resting" || child.oid === undefined) {
    return { state: "pending", steps: ["filled entry stop child could not be identified for consolidation"] };
  }
  try {
    const [state, orders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]);
    const snapshot = buildPositionProtectionSnapshot(state, orders, coin);
    if (new Decimal(snapshot.positionSize).isZero()) return { state: "not_needed", steps: [] };
    const replacement = await exchange.setPositionTpsl({
      a: asset,
      b: new Decimal(snapshot.positionSize).lt(0),
      p: stopPrice,
      s: absolutePositionSize(snapshot.positionSize),
      r: true,
      t: { trigger: { isMarket: true, triggerPx: stopPrice, tpsl: "sl" } },
    });
    if (!exchangeOk(replacement)) return { state: "pending", steps: ["full-position stop placement failed"] };
    const [placedState, placedOrders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]);
    if (buildPositionProtectionSnapshot(placedState, placedOrders, coin).fullPositionStops.length !== 1) {
      return { state: "pending", steps: ["full-position stop was not confirmed before child cancellation"] };
    }
    const cancelled = await exchange.cancel({ cancels: [{ a: asset, o: child.oid }] });
    if (!exchangeOk(cancelled)) return { state: "pending", steps: ["full-position stop placed; fixed-size child cancellation failed"] };
    const [finalState, finalOrders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]);
    return buildPositionProtectionSnapshot(finalState, finalOrders, coin).state === "PROTECTED"
      ? { state: "complete", steps: ["full-position stop confirmed before fixed-size child cancellation"] }
      : { state: "pending", steps: ["post-cancellation protection verification was not PROTECTED"] };
  } catch (cause) {
    logger.warn("hyperliquid.post_submit_containment_failed", { step: "open_stop_consolidation", cause });
    return { state: "pending", steps: ["live protection verification failed during full-position stop consolidation"] };
  }
}

async function closePerp(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context);
  const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
  const result = await orderExchange.closePosition({ asset: asset.asset, side: buySell(params), size: decimal(params, "size"), markPrice: decimal(params, "markPrice"), slippageBps: requiredNumber(params, "slippageBps"), ...(cloid(params) ? { cloid: cloid(params) } : {}) });
  return exchangeResult(result, { coin, _tradeCapture: await capturePerp(info, address, coin, context, true) });
}

async function setTpsl(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context);
  const [state, orders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]);
  const snapshot = buildPositionProtectionSnapshot(state, orders, coin); if (new Decimal(snapshot.positionSize).isZero()) return fail("Cannot set a full-position stop when no position is open.");
  const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
  const price = decimal(params, "slPrice"); const replacement = await orderExchange.setPositionTpsl({ a: asset.asset, b: new Decimal(snapshot.positionSize).lt(0), p: price, s: absolutePositionSize(snapshot.positionSize), r: true, t: { trigger: { isMarket: true, triggerPx: price, tpsl: "sl" } } });
  let consolidation = { staleStopsCancelled: false, consolidationPending: !exchangeOk(replacement) };
  let containmentFailed = !exchangeOk(replacement);
  try {
    consolidation = await cancelStaleStopsAfterReplacement(replacement, orderExchange, asset.asset, snapshot);
  } catch (cause) {
    logger.warn("hyperliquid.post_submit_containment_failed", { step: "set_tpsl_stale_stop_cancellation", cause });
    containmentFailed = true;
    consolidation = { staleStopsCancelled: false, consolidationPending: true };
  }
  let failureMeta: Record<string, unknown> = {};
  if (consolidation.consolidationPending) {
    try {
      failureMeta = await consolidationFailureMeta(`hyperliquid:perp:${coin}:${address}`);
    } catch (cause) {
      logger.warn("hyperliquid.post_submit_containment_failed", { step: "set_tpsl_failure_metadata", cause });
      containmentFailed = true;
    }
  }
  const capture = await capturePerpSafely(info, address, coin, context, false, containmentFailed || consolidation.consolidationPending, {
    ...failureMeta,
    ...(containmentFailed || consolidation.consolidationPending ? { protectionState: "unknown" } : {}),
  });
  return exchangeResult(replacement, {
    coin,
    staleStopsCancelled: consolidation.staleStopsCancelled,
    consolidationPending: consolidation.consolidationPending,
    ...(containmentFailed || consolidation.consolidationPending ? {
      protectionState: "unknown",
      actionableError: "Stop-loss replacement outcome is not fully verified. Verify the position and run perp.setTpsl before any other Hyperliquid action.",
    } : {}),
    _tradeCapture: capture,
  }, containmentFailed || consolidation.consolidationPending);
}

export async function cancelStaleStopsAfterReplacement(
  replacement: HyperliquidExchangeResult,
  exchange: Pick<HyperliquidExchangeClient, "cancel">,
  asset: number,
  snapshot: PositionProtectionSnapshot,
): Promise<{ readonly staleStopsCancelled: boolean; readonly consolidationPending: boolean }> {
  if (!exchangeOk(replacement)) return { staleStopsCancelled: false, consolidationPending: false };
  const staleStops = [...snapshot.fullPositionStops, ...snapshot.fixedSizeStops];
  if (staleStops.length === 0) return { staleStopsCancelled: true, consolidationPending: false };
  const cancellation = await exchange.cancel({ cancels: staleStops.map((stop) => ({ a: asset, o: stop.oid })) });
  const staleStopsCancelled = exchangeOk(cancellation);
  return { staleStopsCancelled, consolidationPending: !staleStopsCancelled };
}

async function modifyOrder(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
  const result = await orderExchange.modify({ oid: requiredNumber(params, "oid"), order: { a: asset.asset, b: buySell(params) === "buy", p: decimal(params, "price"), s: decimal(params, "size"), r: requiredBoolean(params, "reduceOnly"), t: { limit: { tif: "Gtc" } } } });
  return exchangeResult(result, { coin, _tradeCapture: await capturePerp(info, address, coin, context, false) });
}

async function cancelOrders(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const result = await exchange.cancel({ cancels: [{ a: asset.asset, o: requiredNumber(params, "oid") }] });
  return exchangeResult(result, { coin, _tradeCapture: await capturePerp(info, address, coin, context, false) });
}

async function setLeverage(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const result = await exchange.updateLeverage({ asset: asset.asset, leverage: requiredNumber(params, "leverage"), isCross: requiredString(params, "marginMode") === "cross" });
  return exchangeResult(result, { coin, _tradeCapture: await capturePerp(info, address, coin, context, false) });
}

async function adjustMargin(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const result = await exchange.updateIsolatedMargin({ asset: asset.asset, isBuy: longShort(params) === "long", ntli: requiredNumber(params, "ntli") });
  return exchangeResult(result, { coin, _tradeCapture: await capturePerp(info, address, coin, context, false) });
}

async function twap(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const coin = requiredString(params, "coin"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).perpsByCoin.get(coin); if (!asset) return fail(`Unknown Hyperliquid Core market "${coin}".`);
  const orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
  const result = await orderExchange.twapOrder({ twap: { a: asset.asset, b: buySell(params) === "buy", s: decimal(params, "size"), r: false, m: requiredNumber(params, "minutes"), t: params.randomize === true } });
  return exchangeResult(result, { coin, _tradeCapture: await capturePerp(info, address, coin, context, false) });
}

async function spotTrade(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const market = requiredString(params, "market"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).spotByName.get(market); if (!asset) return fail(`Unknown Hyperliquid spot market "${market}".`);
  const tif = requiredString(params, "timeInForce") as HyperliquidTimeInForce; if (!TIME_IN_FORCE.has(tif)) return fail("timeInForce must be Gtc, Ioc, Alo, or FrontendMarket.");
  const price = decimal(params, "price"); const size = decimal(params, "size"); const side = buySell(params);
  const orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
  const result = await orderExchange.spotOrder({ order: { a: asset.asset, b: side === "buy", p: price, s: size, r: false, t: { limit: { tif } } } });
  const capture = { type: "swap", chain: "hyperliquid", status: exchangeOk(result) ? "executed" : "failed", walletAddress: address, tradeSide: side, positionKey: `hyperliquid:spot:${market}:${address}`, instrumentKey: `hyperliquid:spot:${market}`, inputTokenAddress: "USDC", outputTokenAddress: market, inputAmount: size, outputAmount: size, inputValueUsd: new Decimal(price).mul(size).toFixed(), unitPriceUsd: price, valuationSource: "hyperliquid_order", meta: { market } };
  return exchangeResult(result, { market, _tradeCapture: capture });
}

async function deposit(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const network = resolveHyperliquidNetwork();
  if (network !== "mainnet") {
    return fail("hyperliquid.deposit is mainnet-only. The testnet Bridge2 deposit address is intentionally unsupported.");
  }
  const amountUsd = decimal(params, "amountUsd");
  // Validate the irreversible floor before resolving a signing key or opening
  // an RPC client. The executor repeats this invariant at its public boundary.
  parseHyperliquidBridge2DepositAmount(amountUsd);

  const wallet = await import("../../internal/wallet/resolve.js");
  let signer: ChainWallet;
  try {
    signer = wallet.resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155");
  } catch (error) {
    return wallet.walletScopeErrorToResult(error);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");

  const { txHash } = await executeHyperliquidBridge2Deposit(
    { network, amountUsd, owner: signer.address },
    getHyperliquidBridge2DepositClients(signer.privateKey),
  );
  return ok({
    amountUsd,
    txHash,
    chainId: ARBITRUM_ONE_CHAIN_ID,
    token: ARBITRUM_NATIVE_USDC_ADDRESS,
    bridge: HYPERLIQUID_BRIDGE2_MAINNET_ADDRESS,
    creditExpected: "less than 1 minute",
    verifyWith: "hyperliquid.account.overview",
    _tradeCapture: hyperliquidDepositCapture(signer.address, amountUsd, txHash),
  });
}

async function usdClassTransfer(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const toPerp = requiredBoolean(params, "toPerp");
  const result = await exchange.usdClassTransfer({ amount, toPerp });
  return exchangeResult(result, { amount, toPerp, _tradeCapture: auditCapture("account", result, address, { action: "usdClassTransfer", toPerp, amount }) });
}

async function withdraw(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const destination = addressParam(params, "destination");
  const result = await exchange.withdraw3({ destination, amount });
  return exchangeResult(result, { amount, recipient: destination, _tradeCapture: auditCapture("transfer", result, address, { action: "withdraw3", destination, amount }) });
}

async function send(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const destination = addressParam(params, "destination"); const assetType = requiredString(params, "assetType");
  const result = assetType === "usd"
    ? await exchange.usdSend({ destination, amount })
    : assetType === "spot"
      ? await exchange.spotSend({ destination, token: requiredString(params, "token"), amount })
      : (() => { throw new Error("assetType must be usd or spot"); })();
  return exchangeResult(result, { amount, recipient: destination, assetType, _tradeCapture: auditCapture("transfer", result, address, { action: `${assetType}Send`, destination, amount, ...(assetType === "spot" ? { token: requiredString(params, "token") } : {}) }) });
}

async function vaultOverview(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  return withReadAddress(context, async (address) => ok({ address, vaults: await infoClient().userVaultEquities(address) }));
}

async function vaultTransfer(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const isDeposit = requiredBoolean(params, "isDeposit"); const vaultAddress = addressParam(params, "vaultAddress");
  const result = await exchange.vaultTransfer({ vaultAddress, isDeposit, usd: usdMicros(amount) });
  return exchangeResult(result, { amount, vaultAddress, isDeposit, _tradeCapture: auditCapture("lp", result, address, { action: "vaultTransfer", vaultAddress, isDeposit, amount }) });
}

async function stakingOverview(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  return withReadAddress(context, async (address) => ok({ address, staking: await infoClient().delegatorSummary(address) }));
}

async function stakingDelegate(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const validator = addressParam(params, "validator"); const wei = safeWireInteger(requiredString(params, "amountWei")); const isUndelegate = requiredBoolean(params, "isUndelegate");
  const result = await exchange.tokenDelegate({ validator, wei, isUndelegate });
  return exchangeResult(result, { validator, amountWei: String(wei), isUndelegate, _tradeCapture: auditCapture("stake", result, address, { action: "tokenDelegate", validator, wei: String(wei), isUndelegate }) });
}

async function stakingTransfer(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const wei = safeWireInteger(requiredString(params, "amountWei")); const direction = requiredString(params, "direction");
  const result = direction === "deposit" ? await exchange.cDeposit({ wei }) : direction === "withdraw" ? await exchange.cWithdraw({ wei }) : (() => { throw new Error("direction must be deposit or withdraw"); })();
  return exchangeResult(result, { direction, amountWei: String(wei), _tradeCapture: auditCapture("stake", result, address, { action: `c${direction}`, wei: String(wei) }) });
}

async function claimRewards(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const result = await exchange.claimRewards();
  return exchangeResult(result, { _tradeCapture: auditCapture("reward", result, address, { action: "claimRewards" }) });
}

async function approveBuilderFee(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const builder = configuredBuilderAddress();
  if (builder === null) return fail("Builder fee configuration is unavailable; orders will continue without a builder fee.");
  const { info, exchange } = await signingClients(context); const address = await signingAddress(context);
  // The prior submit may have reached HyperCore even if transport/response
  // parsing failed locally. Re-check the venue allowance before submitting a
  // second signed approval so a retry is idempotent whenever HL confirms it.
  try {
    const maximum = await info.maxBuilderFee(address, builder);
    if (isBuilderFeeAllowanceConfirmed(maximum)) {
      rememberBuilderFeeAllowance(context.sessionId, address, builder);
      hyperliquidBuilderConsentBus.emit("0.025%");
      const alreadyApproved: HyperliquidExchangeResult = {
        kind: "orders",
        statuses: [],
        raw: { status: "already_approved" },
      };
      return exchangeResult(alreadyApproved, {
        builder,
        maxFeeRate: "0.025%",
        alreadyApproved: true,
        _tradeCapture: auditCapture("account", alreadyApproved, address, {
          action: "approveBuilderFee",
          builder,
          maxFeeRate: "0.025%",
          alreadyApproved: true,
        }),
      });
    }
  } catch {
    // An unavailable read must not turn a user-requested ordinary mutation
    // into a false success. Submit once and let HyperCore decide.
  }
  const result = await exchange.approveBuilderFee({ builder, maxFeeRate: "0.025%" });
  if (exchangeOk(result)) {
    // An accepted user-signed response is not itself proof that the allowance
    // has become readable. Keep UI state and future builder attachment tied
    // to the venue's `maxBuilderFee` answer, never a local optimistic flag.
    try {
      if (isBuilderFeeAllowanceConfirmed(await info.maxBuilderFee(address, builder))) {
        rememberBuilderFeeAllowance(context.sessionId, address, builder);
        hyperliquidBuilderConsentBus.emit("0.025%");
      }
    } catch {
      // The signed action still has its truthful exchange result. A later
      // order's background check will learn the venue state without blocking.
    }
  }
  return exchangeResult(result, { builder, maxFeeRate: "0.025%", _tradeCapture: auditCapture("account", result, address, { action: "approveBuilderFee", builder, maxFeeRate: "0.025%" }) });
}

async function signingClients(context: ProtocolExecutionContext) {
  const [{ HyperliquidExchangeClient }, { HyperliquidMetaCache }, { HyperliquidSigner }, { hyperliquidRuntimeNonceAllocator }, { resolveHyperliquidNetwork }, { resolveSigningWallet }] = await Promise.all([
    import("@tools/hyperliquid/exchange.js"), import("@tools/hyperliquid/meta-cache.js"), import("@tools/hyperliquid/signer.js"), import("@tools/hyperliquid/nonce.js"), import("@tools/hyperliquid/constants.js"), import("../../internal/wallet/resolve.js"),
  ]);
  const network = resolveHyperliquidNetwork(); const info = new HyperliquidInfoClient({ network }); const meta = new HyperliquidMetaCache(info);
  const signer = new HyperliquidSigner({ network, nonceAllocator: hyperliquidRuntimeNonceAllocator, resolveWallet: () => { const wallet = resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155"); if (wallet.family !== "eip155") throw new Error("Resolved wallet family mismatch."); return { address: wallet.address as `0x${string}`, privateKey: wallet.privateKey as Hex }; } });
  return { info, meta, exchange: new HyperliquidExchangeClient({ signer, metaCache: meta, network, infoClient: info }) };
}

/**
 * Builder fees are optional attribution, never an execution dependency. A
 * bounded, short-lived per-session+wallet cache avoids awaiting `maxBuilderFee` on the
 * order path, while the in-flight map coalesces one venue check/approval.
 */
const BUILDER_ALLOWANCE_CACHE_LIMIT = 128;
const BUILDER_ALLOWANCE_CACHE_TTL_MS = 60_000;
const builderAllowanceByScope = new Map<string, number>();
const builderAllowanceInFlightByScope = new Map<string, Promise<void>>();

export function builderForOrders(
  info: HyperliquidInfoClient,
  exchange: Pick<HyperliquidExchangeClient, "approveBuilderFee">,
  user: string,
  context: Pick<ProtocolExecutionContext, "sessionId" | "hyperliquidPolicy">,
): { readonly b: Address; readonly f: 25 } | undefined {
  const builder = configuredBuilderAddress();
  // A Hyperliquid mutation can only reach this handler after the main-owned
  // first-entry acknowledgement gate. That acknowledgement is the user's
  // builder-fee disclosure/consent; a separate model-triggered confirmation
  // would contradict the product decision and leave otherwise-valid orders
  // unnecessarily untagged.
  if (builder === null || context.sessionId === undefined) return undefined;
  const scope = builderAllowanceScope(context.sessionId, user, builder);
  if (context.hyperliquidPolicy?.kind === "available" && context.hyperliquidPolicy.snapshot.policy.builderFeeConsent.kind === "approved") {
    rememberBuilderFeeAllowanceScope(scope);
    return { b: builder, f: 25 };
  }
  const confirmedAt = builderAllowanceByScope.get(scope);
  if (confirmedAt !== undefined && Date.now() - confirmedAt <= BUILDER_ALLOWANCE_CACHE_TTL_MS) {
    return { b: builder, f: 25 };
  }
  if (confirmedAt !== undefined) builderAllowanceByScope.delete(scope);
  scheduleBuilderFeeAllowanceCheck(info, exchange, user, builder, scope, context.sessionId);
  // Do not await a public-info read or a user-signed allowance action here.
  // The current order remains fully valid without a builder field; a later
  // order attaches it only after the venue confirms the allowance.
  return undefined;
}

function scheduleBuilderFeeAllowanceCheck(
  info: Pick<HyperliquidInfoClient, "maxBuilderFee">,
  exchange: Pick<HyperliquidExchangeClient, "approveBuilderFee">,
  user: string,
  builder: Address,
  scope: string,
  sessionId: string,
): void {
  if (builderAllowanceInFlightByScope.has(scope)) return;
  const attempt = (async () => {
    if (isBuilderFeeAllowanceConfirmed(await info.maxBuilderFee(user, builder))) {
      rememberBuilderFeeAllowanceScope(scope);
      hyperliquidBuilderConsentBus.emit("0.025%");
      return;
    }
    const { createExecutionIntent, completeExecutionIntent } = await import("@vex-agent/db/repos/executions.js");
    const intentId = await createExecutionIntent(
      "hyperliquid.builder.approveFee", "hyperliquid", sessionId,
      { builder, maxFeeRate: "0.025%", source: "background_builder_allowance" },
    );
    if (intentId <= 0) throw new Error("builder fee durable intent insert returned no execution id");
    const approval = await exchange.approveBuilderFee({ builder, maxFeeRate: "0.025%" });
    await completeExecutionIntent(
      intentId,
      { builder, maxFeeRate: "0.025%", exchange: approval.kind },
      exchangeOk(approval),
      auditCapture("account", approval, user, { action: "approveBuilderFee", builder, maxFeeRate: "0.025%", source: "background_builder_allowance" }),
      {},
      0,
    );
    if (!exchangeOk(approval)) return;
    // Approval submission can race venue indexing; only the follow-up read is
    // authority to attach `{ b, f:25 }` to a future order.
    if (isBuilderFeeAllowanceConfirmed(await info.maxBuilderFee(user, builder))) {
      rememberBuilderFeeAllowanceScope(scope);
      hyperliquidBuilderConsentBus.emit("0.025%");
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      builderAllowanceInFlightByScope.delete(scope);
    });
  builderAllowanceInFlightByScope.set(scope, attempt);
}

function isBuilderFeeAllowanceConfirmed(maximum: unknown): maximum is number {
  return typeof maximum === "number" && Number.isSafeInteger(maximum) && maximum >= 25;
}

function builderAllowanceScope(sessionId: string, user: string, builder: Address): string {
  return `${sessionId}:${user.toLowerCase()}:${builder.toLowerCase()}`;
}

function rememberBuilderFeeAllowance(
  sessionId: string | undefined,
  user: string,
  builder: Address,
): void {
  if (sessionId === undefined) return;
  rememberBuilderFeeAllowanceScope(builderAllowanceScope(sessionId, user, builder));
}

function rememberBuilderFeeAllowanceScope(scope: string): void {
  if (!builderAllowanceByScope.has(scope) && builderAllowanceByScope.size >= BUILDER_ALLOWANCE_CACHE_LIMIT) {
    const oldest = builderAllowanceByScope.keys().next().value;
    if (oldest !== undefined) builderAllowanceByScope.delete(oldest);
  }
  builderAllowanceByScope.set(scope, Date.now());
}

/** Isolate global allowance memo state across unit tests. */
export function resetBuilderFeeAllowanceMemoForTests(): void {
  builderAllowanceByScope.clear();
  builderAllowanceInFlightByScope.clear();
}

function configuredBuilderAddress(): Address | null {
  const raw = process.env["VEX_HYPERLIQUID_BUILDER_ADDRESS"]?.trim();
  return raw !== undefined && /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw as Address : null;
}

export function auditCapture(type: "account" | "transfer" | "lp" | "stake" | "reward", result: HyperliquidExchangeResult, walletAddress: string, meta: Record<string, unknown>): Record<string, unknown> {
  return { type, chain: "hyperliquid", status: exchangeOk(result) ? "executed" : "failed", walletAddress, valuationSource: "none", meta };
}

/** Audit-only funding row: the on-chain Arbitrum transfer credits this sender's Hyperliquid account. */
export function hyperliquidDepositCapture(
  walletAddress: string,
  amountUsd: DecimalString,
  txHash: Hex,
): Record<string, unknown> {
  return {
    type: "transfer",
    chain: "arbitrum",
    status: "executed",
    walletAddress,
    inputTokenAddress: ARBITRUM_NATIVE_USDC_ADDRESS,
    inputAmount: amountUsd,
    outputTokenAddress: ARBITRUM_NATIVE_USDC_ADDRESS,
    outputAmount: amountUsd,
    signature: txHash,
    valuationSource: "none",
    meta: {
      action: "bridge2Deposit",
      bridgeAddress: HYPERLIQUID_BRIDGE2_MAINNET_ADDRESS,
      creditedTo: walletAddress,
    },
  };
}

function addressParam(params: Record<string, unknown>, key: string): Address {
  const value = requiredString(params, key);
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${key} must be an EVM address`);
  return value as Address;
}

function usdMicros(amount: DecimalString): number {
  const micros = new Decimal(amount).mul(1_000_000);
  if (!micros.isInteger() || micros.lte(0)) throw new Error("amount must have no more than six decimal places.");
  return safeWireInteger(micros.toFixed(0));
}

function safeWireInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Expected a canonical positive integer amount.");
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds Hyperliquid's safe integer wire limit.");
  return Number(parsed);
}

function infoClient(): HyperliquidInfoClient { return new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }); }
async function signingAddress(context: ProtocolExecutionContext): Promise<string> { return (await import("../../internal/wallet/resolve.js")).resolveSelectedAddress(context.walletResolution, context.walletPolicy, "eip155"); }
export interface OpenCompensationExchange {
  cancel(input: { readonly cancels: readonly { readonly a: number; readonly o: number }[] }): Promise<HyperliquidExchangeResult>;
  setPositionTpsl(order: HyperliquidTriggerOrder): Promise<HyperliquidExchangeResult>;
}

export interface OpenCompensationInfo {
  clearinghouseState(user: string): Promise<unknown>;
  frontendOpenOrders(user: string): Promise<unknown>;
}

export async function compensateRejectedStop(result: HyperliquidExchangeResult, exchange: OpenCompensationExchange, info: OpenCompensationInfo, address: string, asset: number, coin: string, stopPrice: DecimalString): Promise<{ steps: string[]; unprotected: boolean }> {
  if (result.kind !== "orders" || result.statuses[1]?.kind !== "rejected") return { steps: [], unprotected: false };
  const entry = result.statuses[0]; const steps = ["atomic stop-loss child rejected"];
  try {
    if (entry?.kind === "accepted_resting" && entry.oid !== undefined) { const cancelled = await exchange.cancel({ cancels: [{ a: asset, o: entry.oid }] }); steps.push(exchangeOk(cancelled) ? "resting entry cancelled" : "resting entry cancellation failed"); return { steps, unprotected: !exchangeOk(cancelled) }; }
    if (entry?.kind !== "accepted_filled" && entry?.kind !== "partially_filled") return { steps, unprotected: false };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const [state, orders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]);
      const snapshot = buildPositionProtectionSnapshot(state, orders, coin);
      const full = await exchange.setPositionTpsl({ a: asset, b: new Decimal(snapshot.positionSize).lt(0), p: stopPrice, s: absolutePositionSize(snapshot.positionSize), r: true, t: { trigger: { isMarket: true, triggerPx: stopPrice, tpsl: "sl" } } });
      steps.push(exchangeOk(full) ? `full-position stop placed on retry ${attempt}` : `full-position stop retry ${attempt} failed`);
      if (!exchangeOk(full)) continue;
      const [verifiedState, verifiedOrders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]);
      if (buildPositionProtectionSnapshot(verifiedState, verifiedOrders, coin).state === "PROTECTED") return { steps, unprotected: false };
      steps.push(`full-position stop retry ${attempt} was not visible in live protection state`);
    }
  } catch (cause) {
    logger.warn("hyperliquid.post_submit_containment_failed", { step: "rejected_stop_compensation", cause });
    steps.push("live recovery state could not be verified");
  }
  steps.push("UNPROTECTED: immediately propose a reduce-only close"); return { steps, unprotected: true };
}
function absolutePositionSize(positionSize: string): DecimalString {
  return parseDecimalString(new Decimal(positionSize).abs().toFixed());
}
async function capturePerp(info: HyperliquidInfoClient, address: string, coin: string, context: ProtocolExecutionContext, closedWhenFlat: boolean, forceUnprotected = false, extraMeta: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const [state, orders] = await Promise.all([info.clearinghouseState(address), info.frontendOpenOrders(address)]); const snapshot = buildPositionProtectionSnapshot(state, orders, coin); const position = positions(state).find((candidate) => string(candidate, "coin") === coin); const active = !new Decimal(snapshot.positionSize).isZero(); const value = positive(string(position, "positionValue")); const entry = positive(string(position, "entryPx"));
  return { type: "perps", chain: "hyperliquid", status: active ? "open" : closedWhenFlat ? "closed" : "pending", walletAddress: address, positionKey: `hyperliquid:perp:${coin}:${address}`, instrumentKey: `hyperliquid:perp:${coin}`, ...(value ? { inputValueUsd: value } : {}), ...(entry ? { unitPriceUsd: entry } : {}), valuationSource: value ? "hyperliquid_clearinghouse" : "none", settlementAssetKey: "USDC", meta: { coin, contracts: new Decimal(snapshot.positionSize).abs().toFixed(), entryPx: snapshot.entryPx, liquidationPx: snapshot.liquidationPx, protectionState: forceUnprotected ? "unprotected_by_user_choice" : snapshot.state, ...(context.hyperliquidPolicy?.kind === "available" ? { policyVersion: context.hyperliquidPolicy.snapshot.version, policyProvenance: context.hyperliquidPolicy.snapshot.provenance } : {}), ...extraMeta } };
}
export async function capturePerpSafely(info: HyperliquidInfoClient, address: string, coin: string, context: ProtocolExecutionContext, closedWhenFlat: boolean, forceUnprotected = false, extraMeta: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    return await capturePerp(info, address, coin, context, closedWhenFlat, forceUnprotected, extraMeta);
  } catch (cause) {
    logger.warn("hyperliquid.post_submit_containment_failed", { step: "perp_capture", cause });
    return {
      type: "perps", chain: "hyperliquid", status: "pending", walletAddress: address,
      positionKey: `hyperliquid:perp:${coin}:${address}`, instrumentKey: `hyperliquid:perp:${coin}`,
      valuationSource: "none", settlementAssetKey: "USDC",
      meta: { coin, contracts: "0", protectionState: extraMeta["protectionState"] ?? (forceUnprotected ? "unprotected" : "unknown"), captureState: "live_state_unavailable", ...extraMeta },
    };
  }
}
async function consolidationFailureMeta(positionKey: string): Promise<Record<string, unknown>> {
  const { getByPositionKey } = await import("@vex-agent/db/repos/open-positions.js");
  const position = await getByPositionKey(positionKey);
  const previous = typeof position?.data.consolidationFailureCount === "number" ? position.data.consolidationFailureCount : 0;
  const consolidationFailureCount = previous + 1;
  return {
    consolidationFailureCount,
    ...(consolidationFailureCount >= 2 ? { protectionEscalation: "UNPROTECTED" } : {}),
  };
}
function exchangeResult(result: HyperliquidExchangeResult, data: Record<string, unknown>, forceFailure = false) {
  const success = exchangeOk(result) && !forceFailure;
  const coin = string(data, "coin") ?? string(data, "market");
  const side = string(data, "side");
  const capture = record(data["_tradeCapture"]);
  const captureMeta = record(capture?.["meta"]);
  const protectionState = string(captureMeta, "protectionState");
  const display = coin === undefined ? undefined : {
    namespace: "hyperliquid" as const,
    kind: "order_receipt" as const,
    coin,
    side: side === "long" || side === "short" || side === "buy" || side === "sell" ? side : null,
    status: forceFailure ? "unprotected" as const : success ? "accepted" as const : result.kind === "orders" && result.statuses.some((status) => status.kind === "partially_filled") ? "partial" as const : "rejected" as const,
    protectionState: protectionState === "FLAT" || protectionState === "OPENING" || protectionState === "CONSOLIDATING" || protectionState === "PROTECTED" || protectionState === "PARTIAL" || protectionState === "UNPROTECTED" || protectionState === "unprotected_by_user_choice" ? protectionState : null,
  };
  const response = {
    success,
    exchange: result.kind,
    ...data,
    ...(display === undefined ? {} : { _displayBlock: display }),
  };
  return { success, output: JSON.stringify(response), data: response };
}
function exchangeOk(result: HyperliquidExchangeResult): boolean { return result.kind === "orders" && result.statuses.every((status) => status.kind !== "rejected"); }
async function withReadAddress(context: ProtocolExecutionContext, fn: (address: string) => Promise<{ success: boolean; output: string; data: Record<string, unknown> }>) { const wallet = await import("../../internal/wallet/resolve.js"); try { return await fn(wallet.resolveSelectedAddressForRead(context.walletResolution, context.walletPolicy, "eip155")); } catch (error) { return wallet.walletScopeErrorToResult(error); } }
function ok(data: Record<string, unknown>) { return { success: true, output: JSON.stringify(data), data }; }
function fail(output: string) { return { success: false, output }; }
function requiredString(params: Record<string, unknown>, key: string): string { const value = params[key]; if (typeof value !== "string" || value === "") throw new Error(`Missing ${key}`); return value; }
function string(params: Record<string, unknown> | null | undefined, key: string): string | undefined { return typeof params?.[key] === "string" ? params[key] as string : undefined; }
function number(params: Record<string, unknown>, key: string): number | undefined { return typeof params[key] === "number" ? params[key] : undefined; }
function requiredNumber(params: Record<string, unknown>, key: string): number { const value = number(params, key); if (value === undefined) throw new Error(`Missing ${key}`); return value; }
function requiredBoolean(params: Record<string, unknown>, key: string): boolean { if (typeof params[key] !== "boolean") throw new Error(`Missing ${key}`); return params[key] as boolean; }
function decimal(params: Record<string, unknown>, key: string): DecimalString { return parseDecimalString(requiredString(params, key)); }
function optionalDecimal(params: Record<string, unknown>, key: string): DecimalString | undefined { const value = string(params, key); return value === undefined ? undefined : parseDecimalString(value); }
function buySell(params: Record<string, unknown>): "buy" | "sell" { const value = requiredString(params, "side"); if (value !== "buy" && value !== "sell") throw new Error("side must be buy or sell"); return value; }
function longShort(params: Record<string, unknown>): "long" | "short" { const value = requiredString(params, "side"); if (value !== "long" && value !== "short") throw new Error("side must be long or short"); return value; }
function cloid(params: Record<string, unknown>): `0x${string}` | undefined { const value = string(params, "cloid"); return value && /^0x[0-9a-fA-F]{32}$/.test(value) ? value as `0x${string}` : undefined; }
function positions(state: unknown): Record<string, unknown>[] { const root = record(state); const values = Array.isArray(root?.assetPositions) ? root.assetPositions : []; return values.map((item) => record(record(item)?.position) ?? record(item)).filter((item): item is Record<string, unknown> => item !== null); }
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function markForCoin(response: unknown, coin: string): DecimalString | undefined {
  if (!Array.isArray(response) || response.length < 2) return undefined;
  const meta = record(response[0]);
  const contexts = Array.isArray(response[1]) ? response[1] : [];
  const universe = Array.isArray(meta?.["universe"]) ? meta["universe"] : [];
  const index = universe.findIndex((entry) => string(record(entry), "name") === coin);
  if (index < 0) return undefined;
  const context = record(contexts[index]);
  const value = string(context, "markPx");
  return value === undefined ? undefined : parseDecimalString(value);
}
function positive(value: string | undefined): string | undefined { return value && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : undefined; }
