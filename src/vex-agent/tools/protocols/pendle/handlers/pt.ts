/**
 * Pendle PT handlers — quote (read) + buy / sell / redeem (mutating).
 *
 * Quote hits Convert to preview a route and records the prequote (swap for a
 * buy/early-exit sell, redeem for a matured PT). Every mutating path RE-FETCHES
 * Convert, then runs the fund-safety extractor (`../calldata.ts`, LOCKED G2#1)
 * before signing: Router pin, sender/value bind, EXACT approval-set bind, and
 * calldata intent bind (selector + decoded receiver == wallet + market/YT ==
 * quoted). Nothing is signed unless every check passes. Redeem has an
 * API-independent `redeemPyToSy` fallback for a matured position when Convert is
 * unavailable.
 *
 * Upstream error text NEVER reaches the model — only bounded, code-keyed detail.
 */

import { formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";

import { getPendleClient } from "@tools/pendle/client.js";
import {
  PENDLE_CHAIN_ID,
  PENDLE_NATIVE_TOKEN,
  PENDLE_ROUTER,
  PENDLE_ERC20_ABI,
} from "@tools/pendle/constants.js";
import { PENDLE_CHAIN_SLUG, resolvePendleChainId } from "@tools/pendle/chains.js";
import { getPendleEvmClients, getPendlePublicClient } from "@tools/pendle/evm-client.js";
import { ensurePendleAllowanceExact } from "@tools/pendle/erc20.js";
import type { PendleAsset, PendleConvertResponse } from "@tools/pendle/types.js";

import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError, ErrorCodes } from "../../../../../errors.js";
import logger from "@utils/logger.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

import { resolveMarketByPt, buildAssetMap, priceUsdFor } from "../market-lookup.js";
import { selectSafeRoute, type PendleAction, type PendleTxIntent } from "../calldata.js";
import { buildRedeemPyToSyPlan } from "../redeem-fallback.js";

const DEFAULT_SLIPPAGE_BPS = 50;

function isNativeInput(input: string): boolean {
  const lower = input.trim().toLowerCase();
  return lower === "native" || lower === "eth" || lower === PENDLE_NATIVE_TOKEN.toLowerCase();
}

function slippageFraction(bps: number | undefined): number {
  const b = bps !== undefined && bps >= 0 ? bps : DEFAULT_SLIPPAGE_BPS;
  return Math.min(b, 5000) / 10_000;
}

function failureDetail(toolId: string, err: unknown): string {
  logger.warn("pendle.handler.error", {
    toolId,
    code: err instanceof VexError ? err.code : "UNEXPECTED",
    error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
  });
  if (err instanceof VexError) return err.hint ? `${err.code}: ${err.hint}` : err.code;
  return "unexpected error";
}

function requireEthereum(chain: string): void {
  if (resolvePendleChainId(chain) !== PENDLE_CHAIN_ID) {
    throw new VexError(ErrorCodes.PENDLE_API_ERROR, `Pendle is Ethereum-only; unsupported chain "${chain}".`);
  }
}

interface InputToken {
  address: Address;
  isNative: boolean;
  decimals: number;
}

/**
 * Resolve the input token leg. Native ETH is REJECTED for the mutating Pendle
 * paths (this wave): the shared prequote gate canonicalizes native to a
 * different sentinel than Pendle's Convert API, which would make a native buy
 * fail the quote↔execute identity match. Users wanting ETH exposure pass WETH.
 * Decimals are read on-chain.
 */
async function resolveInputToken(raw: string): Promise<InputToken> {
  if (isNativeInput(raw)) {
    throw new VexError(
      ErrorCodes.PENDLE_TOKEN_NOT_FOUND,
      "Pendle trades require an ERC-20 input token — native ETH is not supported here.",
      "Pass WETH (0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) for ETH exposure.",
    );
  }
  let address: Address;
  try {
    address = getAddress(raw);
  } catch {
    throw new VexError(ErrorCodes.PENDLE_TOKEN_NOT_FOUND, `Pendle input token "${raw}" is not a valid address or native ETH.`);
  }
  const client = getPendlePublicClient();
  let decimals: number;
  try {
    decimals = Number(await client.readContract({ address, abi: PENDLE_ERC20_ABI, functionName: "decimals" }));
  } catch {
    throw new VexError(ErrorCodes.PENDLE_TOKEN_NOT_FOUND, `Cannot read decimals for ${address} — not an ERC-20 on Ethereum.`);
  }
  return { address, isNative: false, decimals };
}

function requirePtAddress(raw: string, label: string): Address {
  try {
    return getAddress(raw);
  } catch {
    throw new VexError(ErrorCodes.PENDLE_TOKEN_NOT_FOUND, `Pendle ${label} "${raw}" is not a valid address.`);
  }
}

function humanAmount(wei: string | bigint, decimals: number | null): number {
  const n = Number(formatUnits(BigInt(wei), decimals ?? 18));
  return Number.isFinite(n) ? n : 0;
}

/** USD value of a leg from the Pendle asset map, with a best-effort fallback. */
function legUsd(assetMap: Map<string, PendleAsset>, address: string, human: number): number | null {
  const price = priceUsdFor(assetMap, address);
  if (price === null) return null;
  const usd = human * price;
  return Number.isFinite(usd) ? usd : null;
}

// ── Quote ────────────────────────────────────────────────────────────

async function pendlePtQuote(p: Record<string, unknown>, context: ProtocolExecutionContext): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) {
    return fail("Missing required: chain, tokenIn, tokenOut, amountIn");
  }
  try {
    requireEthereum(chain);
    const receiver = resolveSelectedAddress(context.walletResolution, context.walletPolicy, "eip155");
    const tokenIn = await resolveInputToken(tokenInRaw);
    const tokenOut = requirePtAddressOrToken(tokenOutRaw);
    const amountWei = parseUnits(amountInRaw, tokenIn.decimals);
    const slippage = slippageFraction(num(p, "slippageBps"));

    const client = getPendleClient();
    const response = await client.convert({
      receiver,
      input: { token: tokenIn.address, amount: amountWei.toString() },
      outputToken: tokenOut,
      slippage,
    });
    if (!response || response.routes.length === 0) {
      return fail("Pendle returned no route for this trade.");
    }
    const best = response.routes[0]!;
    const action = response.action === "redeem-py" ? "redeem" : "swap";

    // Which leg is the PT? Buy → PT is tokenOut; sell/redeem → PT is tokenIn.
    const ptIsOut = await resolveMarketByPt(tokenOut) !== null;
    const ptAddress = ptIsOut ? tokenOut : tokenIn.address;
    const market = await resolveMarketByPt(ptAddress);
    const direction: "buy" | "sell" | "redeem" = action === "redeem" ? "redeem" : ptIsOut ? "buy" : "sell";

    const assetMap = await buildAssetMap();
    const outAmount = best.outputs[0]?.amount ?? "0";
    const outDecimals = assetMap.get(tokenOut.toLowerCase())?.decimals ?? null;

    // Echo EXACTLY the fields the recorder + extractPendleQuote validate. `receiver`
    // is the resolved wallet (self); the redeem identity re-derives it identically.
    return ok({
      action,
      direction,
      chainId: PENDLE_CHAIN_ID,
      tokenIn: { address: tokenIn.address, isNative: tokenIn.isNative },
      tokenOut: { address: tokenOut },
      pt: ptAddress,
      yt: market?.yt ?? null,
      market: market?.address ?? null,
      receiver,
      expiry: market?.expiry ?? null,
      liquidityUsd: market?.details.liquidity ?? null,
      priceImpact: best.data.priceImpact,
      amountIn: amountInRaw,
      amountOut: humanAmount(outAmount, outDecimals).toString(),
      aggregator: best.data.aggregatorType,
      slippageBps: num(p, "slippageBps") ?? DEFAULT_SLIPPAGE_BPS,
    });
  } catch (err) {
    return fail(`Pendle quote unavailable (${failureDetail("pendle.pt.quote", err)})`);
  }
}

function requirePtAddressOrToken(raw: string): Address {
  try {
    return getAddress(raw);
  } catch {
    throw new VexError(ErrorCodes.PENDLE_TOKEN_NOT_FOUND, `Pendle token "${raw}" is not a valid address.`);
  }
}

// ── Buy / Sell (token↔PT swap) ───────────────────────────────────────

async function executePendleSwap(
  p: Record<string, unknown>,
  side: "buy" | "sell",
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) {
    return fail("Missing required: chain, tokenIn, tokenOut, amountIn");
  }
  try {
    requireEthereum(chain);
    const tokenIn = await resolveInputToken(tokenInRaw);
    const tokenOut = requirePtAddressOrToken(tokenOutRaw);
    const amountWei = parseUnits(amountInRaw, tokenIn.decimals);
    const slippage = slippageFraction(num(p, "slippageBps"));

    // PT + canonical market — buy: PT is tokenOut; sell: PT is tokenIn.
    const ptAddress = side === "buy" ? tokenOut : tokenIn.address;
    const market = await resolveMarketByPt(ptAddress);
    if (!market || !market.address) {
      return fail("No active Pendle market for this PT — check pendle.yields.");
    }
    const expectedMarket = getAddress(market.address);

    if (p.dryRun === true) {
      const response = await getPendleClient().convert({
        receiver: PENDLE_ROUTER, // placeholder — dry-run never signs
        input: { token: tokenIn.address, amount: amountWei.toString() },
        outputToken: tokenOut,
        slippage,
      });
      const best = response?.routes[0];
      return ok({ dryRun: true, side, market: expectedMarket, aggregator: best?.data.aggregatorType ?? null, priceImpact: best?.data.priceImpact ?? null });
    }

    // Signer AFTER dryRun so a preview never decrypts a key.
    let signer: ChainWallet;
    try {
      signer = resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155");
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");
    const wallet = getAddress(signer.address);

    const response = await getPendleClient().convert({
      receiver: wallet,
      input: { token: tokenIn.address, amount: amountWei.toString() },
      outputToken: tokenOut,
      slippage,
    });
    if (!response) return fail("Pendle returned no route for this trade.");
    if (response.action !== "swap") {
      return fail("Pendle did not return a swap route — a matured PT can only be redeemed (use pendle.pt.redeem).");
    }

    const intent: PendleTxIntent = {
      action: side as PendleAction,
      wallet,
      inputToken: tokenIn.address,
      inputAmountWei: amountWei,
      isNative: tokenIn.isNative,
      expectedMarket,
      ptAddress: getAddress(ptAddress),
      // Sell: bind the decoded TokenOutput.tokenOut to the quoted payment token.
      // (A buy's output PT is implied by the market — no output tuple to bind.)
      ...(side === "sell" ? { expectedOutputToken: tokenOut } : {}),
    };
    const route = selectSafeRoute(intent, response);

    // Approve EXACTLY the required input token (native needs none). Spender is the
    // pinned Router (implicit in Convert's spender-less requiredApprovals).
    const { publicClient, walletClient } = getPendleEvmClients(signer.privateKey as Hex);
    if (!tokenIn.isNative) {
      await ensurePendleAllowanceExact(publicClient, walletClient, tokenIn.address, PENDLE_ROUTER, amountWei);
    }

    const value = tokenIn.isNative ? amountWei : 0n;
    const txHash = await walletClient.sendTransaction({
      account: walletClient.account,
      chain: walletClient.chain,
      to: getAddress(route.tx.to),
      data: route.tx.data as Hex,
      value,
    });

    // Exact USD valuation from Pendle prices (valuationSource "pendle").
    const assetMap = await buildAssetMap();
    const outAmount = route.outputs[0]?.amount ?? "0";
    const outDecimals = assetMap.get(tokenOut.toLowerCase())?.decimals ?? null;
    const inHuman = humanAmount(amountWei, tokenIn.decimals);
    const outHuman = humanAmount(outAmount, outDecimals);
    const inUsd = legUsd(assetMap, tokenIn.address, inHuman);
    const outUsd = legUsd(assetMap, tokenOut, outHuman);
    const inputValueUsd = inUsd ?? outUsd ?? 0;
    const outputValueUsd = outUsd ?? inUsd ?? 0;

    logger.info("pendle.pt.swap.executed", { side, market: expectedMarket, aggregator: route.data.aggregatorType });

    return {
      success: true,
      output: JSON.stringify({ txHash, side, market: expectedMarket, tokenIn: tokenIn.address, tokenOut, amountIn: amountInRaw, amountOut: outHuman.toString() }, null, 2),
      data: {
        txHash,
        _tradeCapture: {
          type: "swap",
          chain: PENDLE_CHAIN_SLUG, // resolves selective balance sync to chain 1
          status: "executed",
          inputToken: tokenIn.isNative ? "ETH" : tokenIn.address,
          outputToken: tokenOut,
          inputTokenAddress: tokenIn.address,
          outputTokenAddress: tokenOut,
          // RAW base-unit strings (Codex fix): the spot lot projector BigInt()s
          // these — human decimals would throw / corrupt lot quantities. The
          // human-readable amounts live only in the model-facing output above.
          inputAmount: amountWei.toString(),
          outputAmount: outAmount,
          inputValueUsd: String(inputValueUsd),
          outputValueUsd: String(outputValueUsd),
          valuationSource: "pendle",
          signature: txHash,
          walletAddress: wallet,
          tradeSide: side,
          instrumentKey: `${PENDLE_CHAIN_SLUG}:${ptAddress.toLowerCase()}`,
          settlementAssetKey: side === "buy" ? (tokenIn.isNative ? "ETH" : tokenIn.address) : tokenOut,
          meta: {
            protocol: "pendle",
            side,
            pendle: {
              marketAddress: market.address,
              ptAddress,
              ytAddress: market.yt,
              syAddress: market.sy,
              underlyingAsset: market.underlyingAsset,
              expiry: market.expiry,
              ptSymbol: assetMap.get(ptAddress.toLowerCase())?.symbol ?? null,
              ptDecimals: assetMap.get(ptAddress.toLowerCase())?.decimals ?? null,
            },
          },
        },
      },
    };
  } catch (err) {
    return fail(`Pendle ${side} failed (${failureDetail(`pendle.pt.${side}`, err)})`);
  }
}

// ── Redeem (matured PT → accounting asset) ───────────────────────────

async function executePendleRedeem(p: Record<string, unknown>, context: ProtocolExecutionContext): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !amountInRaw) return fail("Missing required: chain, tokenIn (PT), amountIn");
  try {
    requireEthereum(chain);
    const ptAddress = requirePtAddress(tokenInRaw, "PT");
    const market = await resolveMarketByPt(ptAddress);
    if (!market || !market.yt || !market.underlyingAsset) {
      return fail("No active Pendle market for this PT — cannot resolve YT/underlying for redeem.");
    }
    const expectedYt = getAddress(market.yt);
    const outputToken = getAddress(market.underlyingAsset);
    const assetMapPre = await buildAssetMap();
    const ptDecimals = assetMapPre.get(ptAddress.toLowerCase())?.decimals ?? 18;
    const amountWei = parseUnits(amountInRaw, ptDecimals);

    if (p.dryRun === true) {
      return ok({ dryRun: true, action: "redeem", pt: ptAddress, yt: expectedYt, outputToken });
    }

    let signer: ChainWallet;
    try {
      signer = resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155");
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");
    const wallet = getAddress(signer.address);
    const { publicClient, walletClient } = getPendleEvmClients(signer.privateKey as Hex);
    const slippage = slippageFraction(num(p, "slippageBps"));

    let txHash: Hex;
    let outHuman = 0;
    /** RAW base-unit output amount for the capture ("0" when unknown — fallback). */
    let outAmountRaw = "0";
    let usedFallback = false;
    let outUsd: number | null = null;

    // Primary path: Convert (action redeem-py) + full fund-safety validation.
    let response: PendleConvertResponse | null = null;
    try {
      response = await getPendleClient().convert({
        receiver: wallet,
        input: { token: ptAddress, amount: amountWei.toString() },
        outputToken,
        slippage,
      });
    } catch (err) {
      logger.warn("pendle.redeem.convert_failed_fallback", { code: err instanceof VexError ? err.code : "UNEXPECTED" });
    }

    if (response && response.action === "redeem-py") {
      const intent: PendleTxIntent = {
        action: "redeem",
        wallet,
        inputToken: ptAddress,
        inputAmountWei: amountWei,
        isNative: false,
        expectedYt,
        ptAddress,
        // Bind the decoded TokenOutput.tokenOut to the quoted accounting asset.
        expectedOutputToken: outputToken,
      };
      const route = selectSafeRoute(intent, response);
      // Approve EXACTLY the required set (Convert asks YT + PT), each to the Router.
      for (const approval of response.requiredApprovals) {
        await ensurePendleAllowanceExact(publicClient, walletClient, getAddress(approval.token), PENDLE_ROUTER, BigInt(approval.amount));
      }
      txHash = await walletClient.sendTransaction({
        account: walletClient.account,
        chain: walletClient.chain,
        to: getAddress(route.tx.to),
        data: route.tx.data as Hex,
        value: 0n,
      });
      const assetMap = await buildAssetMap();
      outAmountRaw = route.outputs[0]?.amount ?? "0";
      const outDecimals = assetMap.get(outputToken.toLowerCase())?.decimals ?? null;
      outHuman = humanAmount(outAmountRaw, outDecimals);
      outUsd = legUsd(assetMap, outputToken, outHuman);
    } else {
      // API-independent fallback (matured PT only): redeemPyToSy on the pinned Router.
      usedFallback = true;
      const plan = buildRedeemPyToSyPlan({ receiver: wallet, yt: expectedYt, netPyIn: amountWei, slippage });
      await ensurePendleAllowanceExact(publicClient, walletClient, ptAddress, PENDLE_ROUTER, amountWei);
      txHash = await walletClient.sendTransaction({
        account: walletClient.account,
        chain: walletClient.chain,
        to: plan.to,
        data: plan.data,
        value: 0n,
      });
    }

    // Valuation — PT redeems ~1:1 to its accounting value; use price.acc for the PT.
    const ptAcc = assetMapPre.get(ptAddress.toLowerCase())?.priceAcc ?? assetMapPre.get(ptAddress.toLowerCase())?.priceUsd ?? null;
    const inHuman = humanAmount(amountWei, ptDecimals);
    const inputValueUsd = ptAcc !== null ? inHuman * ptAcc : (outUsd ?? 0);
    const outputValueUsd = outUsd ?? inputValueUsd;

    logger.info("pendle.pt.redeem.executed", { pt: ptAddress, fallback: usedFallback });

    return {
      success: true,
      output: JSON.stringify({ txHash, action: "redeem", pt: ptAddress, fallback: usedFallback, amountIn: amountInRaw }, null, 2),
      data: {
        txHash,
        _tradeCapture: {
          type: "swap",
          chain: PENDLE_CHAIN_SLUG,
          status: "closed",
          inputToken: ptAddress,
          outputToken,
          inputTokenAddress: ptAddress,
          outputTokenAddress: outputToken,
          // RAW base-unit strings (Codex fix) — the spot projector BigInt()s these.
          inputAmount: amountWei.toString(),
          outputAmount: outAmountRaw,
          inputValueUsd: String(inputValueUsd),
          outputValueUsd: String(outputValueUsd),
          valuationSource: "pendle",
          signature: txHash,
          walletAddress: wallet,
          tradeSide: "sell",
          instrumentKey: `${PENDLE_CHAIN_SLUG}:${ptAddress.toLowerCase()}`,
          settlementAssetKey: outputToken,
          meta: {
            protocol: "pendle",
            side: "redeem",
            usedFallback,
            pendle: {
              marketAddress: market.address,
              ptAddress,
              ytAddress: market.yt,
              syAddress: market.sy,
              underlyingAsset: market.underlyingAsset,
              expiry: market.expiry,
              ptSymbol: assetMapPre.get(ptAddress.toLowerCase())?.symbol ?? null,
              ptDecimals,
            },
          },
        },
      },
    };
  } catch (err) {
    return fail(`Pendle redeem failed (${failureDetail("pendle.pt.redeem", err)})`);
  }
}

export const PENDLE_PT_HANDLERS: Record<string, ProtocolHandler> = {
  "pendle.pt.quote": (p, ctx) => pendlePtQuote(p, ctx),
  "pendle.pt.buy": (p, ctx) => executePendleSwap(p, "buy", ctx),
  "pendle.pt.sell": (p, ctx) => executePendleSwap(p, "sell", ctx),
  "pendle.pt.redeem": (p, ctx) => executePendleRedeem(p, ctx),
};
