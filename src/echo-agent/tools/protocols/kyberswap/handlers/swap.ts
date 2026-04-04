/**
 * KyberSwap swap + chain + token handlers.
 *
 * Shared executeKyberSwap() is used by both swap.sell and swap.buy.
 */

import { getKyberAggregatorClient } from "@tools/kyberswap/aggregator/client.js";
import { getKyberTokenApiClient } from "@tools/kyberswap/token-api/client.js";
import { getKyberCommonClient } from "@tools/kyberswap/common/client.js";
import { getKyberChains, resolveChainSlug, slugToChainId } from "@tools/kyberswap/chains.js";
import {
  getKyberEvmClients,
  ensureKyberAllowance,
  sendKyberTransaction,
  verifyRouterAddress,
} from "@tools/kyberswap/evm-utils.js";
import { META_AGGREGATION_ROUTER_V2, NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveTokenMetadata, resolveTokenMetadataStrict, requireFeature, resolveChainWithId } from "@tools/kyberswap/helpers.js";
import logger from "@utils/logger.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";

import { parseUnits, formatUnits, getAddress, type Address, type Hex } from "viem";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

// ── Shared swap execution (sell + buy use same routing, differ in trade_side) ──

async function executeKyberSwap(p: Record<string, unknown>, side: "buy" | "sell"): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

  const slug = resolveChainSlug(chain);
  requireFeature(slug, "aggregator");
  const chainId = slugToChainId(slug);
  const wallet = requireEvmWallet();
  // Strict: address-only for mutating swaps — symbols rejected
  const tokenIn = await resolveTokenMetadataStrict(tokenInRaw, chainId);
  const tokenOut = await resolveTokenMetadataStrict(tokenOutRaw, chainId);

  // Token safety gate — check honeypot + FoT/tax for non-native tokens (R8)
  if (!tokenIn.isNative) {
    const inCheck = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, tokenIn.address);
    if (inCheck.isHoneypot) return fail(`Token ${tokenIn.symbol} (${tokenIn.address}) flagged as honeypot. Aborting swap.`);
    if (inCheck.isFOT && inCheck.tax > 50) return fail(`Token ${tokenIn.symbol} has ${inCheck.tax}% fee-on-transfer tax — likely a scam. Aborting.`);
    if (inCheck.isFOT && inCheck.tax > 0) logger.warn("kyberswap.swap.fot_warning", { token: tokenIn.symbol, address: tokenIn.address, tax: inCheck.tax });
  }
  if (!tokenOut.isNative) {
    const outCheck = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, tokenOut.address);
    if (outCheck.isHoneypot) return fail(`Token ${tokenOut.symbol} (${tokenOut.address}) flagged as honeypot. Aborting swap.`);
    if (outCheck.isFOT && outCheck.tax > 50) return fail(`Token ${tokenOut.symbol} has ${outCheck.tax}% fee-on-transfer tax — likely a scam. Aborting.`);
    if (outCheck.isFOT && outCheck.tax > 0) logger.warn("kyberswap.swap.fot_warning", { token: tokenOut.symbol, address: tokenOut.address, tax: outCheck.tax });
  }
  const amountIn = parseUnits(amountInRaw, tokenIn.decimals);

  const routeResp = await getKyberAggregatorClient().getRoute(slug, {
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amountIn: amountIn.toString(),
  });
  const { routeSummary, routerAddress } = routeResp.data;
  verifyRouterAddress(routerAddress, META_AGGREGATION_ROUTER_V2);

  if (p.dryRun === true) {
    return ok({ dryRun: true, side, chain: slug, routeSummary, routerAddress });
  }

  const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
  if (tokenIn.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    await ensureKyberAllowance(publicClient, walletClient, tokenIn.address, routerAddress, amountIn, p.approveExact === true);
  }

  const slippage = num(p, "slippageBps") ?? 50;
  const buildResp = await getKyberAggregatorClient().buildRoute(slug, {
    routeSummary,
    sender: wallet.address,
    recipient: (str(p, "recipient") || wallet.address) as Address,
    slippageTolerance: slippage,
  });

  const txHash = await sendKyberTransaction(publicClient, walletClient, {
    to: getAddress(buildResp.data.routerAddress),
    data: buildResp.data.data as Hex,
    value: BigInt(buildResp.data.transactionValue),
  });

  const inputIsNative = tokenIn.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const outputIsNative = tokenOut.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const hasNativeLeg = inputIsNative || outputIsNative;

  // Benchmark: only when native token is one leg
  const { resolveChainBenchmark } = await import("@echo-agent/sync/benchmark.js");
  const benchmarkAssetKey = hasNativeLeg ? resolveChainBenchmark(slug) : undefined;

  return {
    success: true,
    output: JSON.stringify({ txHash, side, chain: slug, tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amountIn: buildResp.data.amountIn, amountOut: buildResp.data.amountOut, amountInUsd: buildResp.data.amountInUsd, amountOutUsd: buildResp.data.amountOutUsd }, null, 2),
    data: { txHash, _tradeCapture: {
      type: "swap", chain: slug, status: "executed",
      inputToken: tokenIn.symbol, outputToken: tokenOut.symbol,
      inputTokenAddress: tokenIn.address, outputTokenAddress: tokenOut.address,
      inputAmount: buildResp.data.amountIn, outputAmount: buildResp.data.amountOut,
      signature: txHash, walletAddress: wallet.address, tradeSide: side,
      instrumentKey: `${slug}:${side === "buy" ? tokenOut.address : tokenIn.address}`,
      inputValueUsd: buildResp.data.amountInUsd, outputValueUsd: buildResp.data.amountOutUsd,
      feeValueUsd: buildResp.data.gasUsd, valuationSource: "kyberswap_exact",
      benchmarkAssetKey: benchmarkAssetKey ?? undefined,
      settlementAssetKey: side === "buy" ? tokenIn.symbol : tokenOut.symbol,
      inputValueNative: inputIsNative ? formatUnits(amountIn, tokenIn.decimals) : undefined,
      outputValueNative: outputIsNative ? formatUnits(BigInt(buildResp.data.amountOut), tokenOut.decimals) : undefined,
      meta: { dex: "kyberswap", side },
    } },
  };
}

// ── Handler map ──────────────────────────────────────────────────

export const SWAP_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Chains ───────────────────────────────────────────────────────
  "kyberswap.chains": async () => ok(getKyberChains()),
  "kyberswap.chains.supported": async () => ok(await getKyberCommonClient().getSupportedChains()),

  // ── Tokens ───────────────────────────────────────────────────────
  "kyberswap.tokens.search": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { chainId } = resolveChainWithId(chain);
    const tokens = await getKyberTokenApiClient().searchTokens(String(chainId), {
      name: str(p, "query") || undefined,
      isWhitelisted: p.whitelisted === true ? true : undefined,
      pageSize: num(p, "limit"),
    });
    return ok({ chain, chainId, count: tokens.length, tokens });
  },
  "kyberswap.tokens.check": async (p) => {
    const chain = str(p, "chain"), address = str(p, "address");
    if (!chain || !address) return fail("Missing required: chain, address");
    const { chainId } = resolveChainWithId(chain);
    const info = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, address);
    return ok({ chain, chainId, address, ...info });
  },

  // ── Swap ─────────────────────────────────────────────────────────
  "kyberswap.swap.quote": async (p) => {
    const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
    if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "aggregator");
    const chainId = slugToChainId(slug);
    const tokenIn = await resolveTokenMetadata(tokenInRaw, chainId);
    const tokenOut = await resolveTokenMetadata(tokenOutRaw, chainId);
    const amountIn = parseUnits(amountInRaw, tokenIn.decimals).toString();

    const response = await getKyberAggregatorClient().getRoute(slug, {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
    });

    return ok({
      chain: slug, chainId,
      tokenIn: { address: tokenIn.address, symbol: tokenIn.symbol, decimals: tokenIn.decimals },
      tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, decimals: tokenOut.decimals },
      routeSummary: response.data.routeSummary,
      routerAddress: response.data.routerAddress,
    });
  },

  "kyberswap.swap.sell": (p) => executeKyberSwap(p, "sell"),
  "kyberswap.swap.buy": (p) => executeKyberSwap(p, "buy"),
};
