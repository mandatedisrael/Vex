/**
 * Solana/Jupiter protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/chains/solana/ services.
 * No CLI spawning. Wallet access via @tools/wallet/multi-auth.
 *
 * Organized by module: core, swap, perps, predict, dca, limit,
 * lend, stake, send, studio, account, history.
 */

import {
  jupiterHoldings,
  jupiterGetPrices,
  jupiterSearchTokens,
  jupiterGetTrendingTokens,
  jupiterShield,
  jupiterGetSpotHistory,
} from "@tools/chains/solana/jupiter-client.js";
import { getSwapQuote, executeSwap } from "@tools/chains/solana/swap-service.js";
import {
  getPerpsMarkets,
  getPerpsPositions,
  getPerpsHistory,
  openPerpsPosition,
  closePerpsPosition,
  closeAllPerpsPositions,
  setPerpsTPSL,
  cancelPerpsLimitOrder,
  updatePerpsLimitOrder,
  cancelPerpsTPSL,
} from "@tools/chains/solana/perps-service.js";
import { perpsUpdateTpsl } from "@tools/chains/solana/perps-client.js";
import {
  listEvents,
  searchEvents,
  getMarket,
  getEvent,
  getPosition as getPredictPosition,
  getPositions as getPredictPositions,
  getPredictHistory,
  createPredictOrder,
  closePosition as closePredictPosition,
  closeAllPositions as closeAllPredictPositions,
  claimPosition,
} from "@tools/chains/solana/prediction-service.js";
import {
  listDcaOrders,
  createDcaOrder,
  cancelDcaOrder,
  listLimitOrders,
  createLimitOrder,
  cancelLimitOrder,
} from "@tools/chains/solana/order-service.js";
import {
  getLendRates,
  getLendPositions,
  getLendEarnings,
  lendDeposit,
  lendWithdraw,
} from "@tools/chains/solana/lend-service.js";
import {
  getStakeAccounts,
  createAndDelegateStake,
  withdrawStake,
  claimMev,
} from "@tools/chains/solana/stake-service.js";
import {
  getPendingInvites,
  craftSend,
  craftClawback,
} from "@tools/chains/solana/send-service.js";
import {
  studioGetFees,
  studioCreateToken,
  studioClaimFees,
  studioGetPoolAddress,
} from "@tools/chains/solana/studio-service.js";
import {
  burnSplToken,
  closeEmptyAccounts,
} from "@tools/chains/solana/account-service.js";
import { requireSolanaWallet } from "@tools/wallet/multi-auth.js";

import type { ToolResult } from "../../types.js";
import type { ProtocolHandler } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}
function walletAddress(p: Record<string, unknown>): string {
  const explicit = str(p, "address");
  if (explicit) return explicit;
  return requireSolanaWallet().address;
}
function walletSecret(): Uint8Array {
  return requireSolanaWallet().secretKey;
}

// ── Handler map ──────────────────────────────────────────────────

export const SOLANA_JUPITER_HANDLERS: Record<string, ProtocolHandler> = {
  // Core
  "solana.holdings": async (p) => ok(await jupiterHoldings(walletAddress(p))),
  "solana.prices": async (p) => {
    const mints = str(p, "mints").split(",").map(s => s.trim()).filter(Boolean);
    if (mints.length === 0) return fail("Missing required parameter: mints");
    const prices = await jupiterGetPrices(mints);
    return ok(Object.fromEntries(prices));
  },
  "solana.tokens.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required parameter: query");
    return ok(await jupiterSearchTokens(q));
  },
  "solana.tokens.trending": async (p) => {
    const category = (str(p, "category") || "toptrending") as any;
    const interval = (str(p, "interval") || "1h") as any;
    const limit = num(p, "limit") ?? 20;
    return ok(await jupiterGetTrendingTokens(category, interval, limit));
  },
  "solana.tokens.shield": async (p) => {
    const mints = str(p, "mints").split(",").map(s => s.trim()).filter(Boolean);
    if (mints.length === 0) return fail("Missing required parameter: mints");
    return ok(await jupiterShield(mints));
  },

  // Swap
  "solana.swap.quote": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amount");
    if (!input || !output || amount == null) return fail("Missing required: inputToken, outputToken, amount");
    const { quote } = await getSwapQuote(input, output, amount, { slippageBps: num(p, "slippageBps") });
    return ok(quote);
  },
  "solana.swap.execute": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amount");
    if (!input || !output || amount == null) return fail("Missing required: inputToken, outputToken, amount");
    const result = await executeSwap(input, output, amount, walletSecret(), { slippageBps: num(p, "slippageBps") });
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "swap", chain: "solana", status: "executed", inputToken: input, outputToken: output, inputAmount: result.inputAmount, outputAmount: result.outputAmount, signature: result.signature, walletAddress: walletAddress(p), instrumentKey: `solana:${output}` } } };
  },

  // Perps
  "solana.perps.markets": async () => ok(await getPerpsMarkets()),
  "solana.perps.positions": async (p) => ok(await getPerpsPositions(walletAddress(p))),
  "solana.perps.history": async (p) => {
    const addr = walletAddress(p);
    return ok(await getPerpsHistory({ walletAddress: addr, asset: str(p, "asset") || undefined, side: str(p, "side") || undefined, limit: num(p, "limit") }));
  },
  "solana.perps.open": async (p) => {
    const asset = str(p, "asset"), side = str(p, "side");
    const amountUsd = num(p, "amountUsd");
    if (!asset || !side || amountUsd == null) return fail("Missing required: asset, side, amountUsd");
    const result = await openPerpsPosition(walletSecret(), { asset, side, amountUsd, inputToken: str(p, "inputToken") || undefined, leverage: num(p, "leverage"), sizeUsd: num(p, "sizeUsd"), tp: num(p, "tp"), sl: num(p, "sl"), limitPrice: num(p, "limitPrice"), slippageBps: num(p, "slippageBps") });
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "perps", chain: "solana", status: "executed", walletAddress: walletAddress(p), tradeSide: side === "long" ? "buy" : "sell", positionKey: result.positionPubkey, instrumentKey: `solana:perps:${asset}`, meta: { asset, side, amountUsd } } } };
  },
  "solana.perps.close": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await closePerpsPosition(walletSecret(), { positionPubkey: pk, receiveToken: str(p, "receiveToken") || undefined, sizeUsd: num(p, "sizeUsd"), slippageBps: num(p, "slippageBps") });
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "perps", chain: "solana", status: "closed", walletAddress: walletAddress(p), positionKey: pk, meta: { positionPubkey: pk } } } };
  },
  "solana.perps.closeAll": async (p) => {
    const sigs = await closeAllPerpsPositions(walletSecret());
    return { success: true, output: JSON.stringify({ signatures: sigs, count: sigs.length }, null, 2), data: { signatures: sigs, count: sigs.length, _tradeCapture: { type: "perps", chain: "solana", status: "closed", walletAddress: walletAddress(p), meta: { action: "closeAll", count: sigs.length } } } };
  },
  "solana.perps.tpsl": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await setPerpsTPSL(walletSecret(), pk, { tp: num(p, "tp"), sl: num(p, "sl"), receiveToken: str(p, "receiveToken") || undefined });
    return ok(result);
  },
  "solana.perps.cancelLimitOrder": async (p) => {
    const pk = str(p, "positionRequestPubkey");
    if (!pk) return fail("Missing required: positionRequestPubkey");
    const sig = await cancelPerpsLimitOrder(walletSecret(), pk);
    return ok({ signature: sig });
  },
  "solana.perps.updateLimitOrder": async (p) => {
    const pk = str(p, "positionRequestPubkey");
    const price = num(p, "triggerPrice");
    if (!pk || price == null) return fail("Missing required: positionRequestPubkey, triggerPrice");
    const sig = await updatePerpsLimitOrder(walletSecret(), pk, price);
    return ok({ signature: sig });
  },
  "solana.perps.cancelTpsl": async (p) => {
    const pk = str(p, "positionRequestPubkey");
    if (!pk) return fail("Missing required: positionRequestPubkey");
    const sig = await cancelPerpsTPSL(walletSecret(), pk);
    return ok({ signature: sig });
  },
  "solana.perps.updateTpsl": async (p) => {
    const pk = str(p, "positionRequestPubkey");
    const price = num(p, "triggerPrice");
    if (!pk || price == null) return fail("Missing required: positionRequestPubkey, triggerPrice");
    const resp = await perpsUpdateTpsl({ positionRequestPubkey: pk, triggerPrice: String(price) });
    // perpsUpdateTpsl returns TpslResponse with serializedTxBase64 — needs sign+execute
    // For now delegate to the service layer pattern
    const { deserializeVersionedTx, signVersionedTx } = await import("@tools/chains/solana/tx.js");
    const { perpsExecute } = await import("@tools/chains/solana/perps-client.js");
    const { Keypair } = await import("@solana/web3.js");
    const keypair = Keypair.fromSecretKey(walletSecret());
    const tx = deserializeVersionedTx(resp.serializedTxBase64);
    signVersionedTx(tx, [keypair]);
    const signedBase64 = Buffer.from(tx.serialize()).toString("base64");
    const execResult = await perpsExecute({ action: "update-tpsl", serializedTxBase64: signedBase64 });
    return ok({ signature: execResult.txid });
  },

  // Predictions
  "solana.predict.events": async (p) => ok(await listEvents(str(p, "category") || undefined, (str(p, "filter") || undefined) as any)),
  "solana.predict.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required: query");
    return ok(await searchEvents(q));
  },
  "solana.predict.market": async (p) => {
    const id = str(p, "marketId");
    if (!id) return fail("Missing required: marketId");
    return ok(await getMarket(id));
  },
  "solana.predict.positions": async (p) => ok(await getPredictPositions(walletAddress(p))),
  "solana.predict.history": async (p) => ok(await getPredictHistory(walletAddress(p), { limit: num(p, "limit"), offset: num(p, "offset") })),
  "solana.predict.buy": async (p) => {
    const marketId = str(p, "marketId"), side = str(p, "side");
    const amount = num(p, "amountUsdc");
    if (!marketId || !side || amount == null) return fail("Missing required: marketId, side, amountUsdc");
    const result = await createPredictOrder(walletSecret(), marketId, side === "yes", amount);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "prediction", chain: "solana", status: "open", walletAddress: walletAddress(p), tradeSide: "buy", positionKey: result.positionPubkey, instrumentKey: `solana:predict:${marketId}:${side}`, meta: { marketId, side } } } };
  },
  "solana.predict.sell": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await closePredictPosition(walletSecret(), pk);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "prediction", chain: "solana", status: "closed", walletAddress: walletAddress(p), tradeSide: "sell", positionKey: pk, meta: { positionPubkey: pk } } } };
  },
  "solana.predict.claim": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await claimPosition(walletSecret(), pk);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "prediction", chain: "solana", status: "claimed", walletAddress: walletAddress(p), positionKey: pk, meta: { positionPubkey: pk } } } };
  },
  "solana.predict.closeAll": async (p) => {
    const results = await closeAllPredictPositions(walletSecret());
    return { success: true, output: JSON.stringify({ results, count: results.length }, null, 2), data: { results, count: results.length, _tradeCapture: { type: "prediction", chain: "solana", status: "closed", walletAddress: walletAddress(p), tradeSide: "sell", meta: { action: "closeAll", count: results.length } } } };
  },
  "solana.predict.event": async (p) => {
    const id = str(p, "eventId");
    if (!id) return fail("Missing required: eventId");
    return ok(await getEvent(id));
  },
  "solana.predict.position": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    return ok(await getPredictPosition(pk));
  },

  // DCA
  "solana.dca.list": async (p) => ok(await listDcaOrders(walletAddress(p))),
  "solana.dca.create": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amountPerCycle"), interval = str(p, "interval"), count = num(p, "numberOfOrders");
    if (!input || !output || amount == null || !interval || count == null) return fail("Missing required: inputToken, outputToken, amountPerCycle, interval, numberOfOrders");
    const result = await createDcaOrder(walletSecret(), input, output, amount, interval as any, count);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "order", chain: "solana", status: "open", walletAddress: walletAddress(p), positionKey: result.orderKey, instrumentKey: `solana:${output}`, meta: { orderType: "dca", interval, numberOfOrders: count } } } };
  },
  "solana.dca.cancel": async (p) => {
    const key = str(p, "orderKey");
    if (!key) return fail("Missing required: orderKey");
    const sig = await cancelDcaOrder(walletSecret(), key);
    return { success: true, output: JSON.stringify({ signature: sig }, null, 2), data: { signature: sig, _tradeCapture: { type: "order", chain: "solana", status: "cancelled", walletAddress: walletAddress(p), positionKey: key, meta: { orderType: "dca" } } } };
  },

  // Limit orders
  "solana.limit.list": async (p) => ok(await listLimitOrders(walletAddress(p))),
  "solana.limit.create": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "inputAmount"), price = num(p, "targetPriceUsd");
    if (!input || !output || amount == null || price == null) return fail("Missing required: inputToken, outputToken, inputAmount, targetPriceUsd");
    const result = await createLimitOrder(walletSecret(), input, output, amount, price);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "order", chain: "solana", status: "open", walletAddress: walletAddress(p), positionKey: result.orderKey, instrumentKey: `solana:${output}`, meta: { orderType: "limit", targetPriceUsd: price } } } };
  },
  "solana.limit.cancel": async (p) => {
    const key = str(p, "orderKey");
    if (!key) return fail("Missing required: orderKey");
    const sig = await cancelLimitOrder(walletSecret(), key);
    return { success: true, output: JSON.stringify({ signature: sig }, null, 2), data: { signature: sig, _tradeCapture: { type: "order", chain: "solana", status: "cancelled", walletAddress: walletAddress(p), positionKey: key, meta: { orderType: "limit" } } } };
  },

  // Lending
  "solana.lend.rates": async () => ok(await getLendRates()),
  "solana.lend.positions": async (p) => {
    const addr = walletAddress(p);
    const positions = await getLendPositions(addr);
    const earnings = positions.length > 0
      ? await getLendEarnings(addr, positions.map(pos => pos.tokenAddress))
      : [];
    return ok({ positions, earnings });
  },
  "solana.lend.deposit": async (p) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    const result = await lendDeposit(walletSecret(), asset, amount);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "lend", chain: "solana", status: "executed", walletAddress: walletAddress(p), inputTokenAddress: asset, inputAmount: amount, meta: { action: "deposit", asset } } } };
  },
  "solana.lend.withdraw": async (p) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    const result = await lendWithdraw(walletSecret(), asset, amount);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "lend", chain: "solana", status: "executed", walletAddress: walletAddress(p), inputTokenAddress: asset, inputAmount: amount, meta: { action: "withdraw", asset } } } };
  },

  // Staking
  "solana.stake.accounts": async (p) => ok(await getStakeAccounts(walletAddress(p))),
  "solana.stake.delegate": async (p) => {
    const amount = num(p, "amountSol");
    if (amount == null) return fail("Missing required: amountSol");
    const result = await createAndDelegateStake(walletSecret(), amount, str(p, "validator") || undefined);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "stake", chain: "solana", status: "executed", walletAddress: walletAddress(p), meta: { action: "delegate" } } } };
  },
  "solana.stake.withdraw": async (p) => {
    const sa = str(p, "stakeAccount");
    if (!sa) return fail("Missing required: stakeAccount");
    const result = await withdrawStake(walletSecret(), sa, num(p, "amountSol"));
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "stake", chain: "solana", status: "executed", walletAddress: walletAddress(p), meta: { action: "withdraw" } } } };
  },
  "solana.stake.claimMev": async (p) => {
    const result = await claimMev(walletSecret(), str(p, "stakeAccount") || undefined);
    return ok(result);
  },

  // Send
  "solana.send.pending": async (p) => ok(await getPendingInvites(walletAddress(p))),
  "solana.send.invite": async (p) => {
    const amount = num(p, "amount");
    if (amount == null) return fail("Missing required: amount");
    const result = await craftSend(walletSecret(), amount, str(p, "mint") || undefined);
    return ok(result);
  },
  "solana.send.clawback": async (p) => {
    const code = str(p, "inviteCode");
    if (!code) return fail("Missing required: inviteCode");
    return ok(await craftClawback(walletSecret(), code));
  },

  // Studio
  "solana.studio.fees": async (p) => {
    const mint = str(p, "mint");
    if (!mint) return fail("Missing required: mint");
    return ok(await studioGetFees(mint));
  },
  "solana.studio.create": async (p) => {
    const name = str(p, "tokenName"), symbol = str(p, "tokenSymbol"), image = str(p, "imagePath");
    const initMcap = num(p, "initialMarketCap"), migMcap = num(p, "migrationMarketCap");
    if (!name || !symbol || !image || initMcap == null || migMcap == null) return fail("Missing required: tokenName, tokenSymbol, imagePath, initialMarketCap, migrationMarketCap");
    const result = await studioCreateToken(walletSecret(), { tokenName: name, tokenSymbol: symbol, imagePath: image, initialMarketCap: initMcap, migrationMarketCap: migMcap, description: str(p, "description") || undefined, website: str(p, "website") || undefined, twitter: str(p, "twitter") || undefined, telegram: str(p, "telegram") || undefined, feeBps: num(p, "feeBps"), isLpLocked: typeof p.isLpLocked === "boolean" ? p.isLpLocked : undefined });
    return ok(result);
  },
  "solana.studio.claimFees": async (p) => {
    const pool = str(p, "poolAddress");
    if (!pool) return fail("Missing required: poolAddress");
    const result = await studioClaimFees(walletSecret(), pool, str(p, "maxAmount") || undefined);
    return ok(result);
  },

  // Account
  "solana.account.burn": async (p) => {
    const mint = str(p, "mint");
    if (!mint) return fail("Missing required: mint");
    const amount = str(p, "amount") ? BigInt(str(p, "amount")) : undefined;
    return ok(await burnSplToken(walletSecret(), mint, amount));
  },
  "solana.account.closeEmpty": async () => ok(await closeEmptyAccounts(walletSecret())),

  // History
  "solana.history.spot": async (p) => {
    const addr = walletAddress(p);
    return ok(await jupiterGetSpotHistory({ address: addr, assetId: str(p, "assetId") || undefined, limit: num(p, "limit"), after: str(p, "after") || undefined, before: str(p, "before") || undefined, offset: str(p, "offset") || undefined }));
  },
};
