/**
 * Slop.money (0G Network) protocol handlers — on-chain bonding curve operations.
 *
 * All handlers call contracts directly via viem (factory, token, registry, feeCollector).
 * Quote math from @tools/slop/quote.js. Validation from @commands/slop/helpers.js.
 */

import { randomBytes } from "node:crypto";
import { isAddress, getAddress, parseUnits, formatUnits, decodeEventLog, type Address, type Hex } from "viem";
import { getPublicClient } from "@tools/wallet/client.js";
import { getSigningClient } from "@tools/wallet/signingClient.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import { loadConfig } from "@config/store.js";
import { SLOP_FACTORY_ABI } from "@tools/slop/abi/factory.js";
import { SLOP_TOKEN_ABI } from "@tools/slop/abi/token.js";
import { SLOP_REGISTRY_ABI } from "@tools/slop/abi/registry.js";
import { SLOP_FEE_COLLECTOR_ABI } from "@tools/slop/abi/feeCollector.js";
import {
  calculateTokensOut,
  calculateOgOut,
  calculatePartialFill,
  calculateSpotPrice,
  calculateGraduationProgress,
  applySlippage,
} from "@tools/slop/quote.js";
import {
  validateOfficialToken,
  checkNotGraduated,
  checkTradingEnabled,
  getTokenState,
  parseUnitsSafe,
  validateUserSalt,
} from "@commands/slop/helpers.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler } from "../../types.js";

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
function requireTokenAddr(p: Record<string, unknown>): Address | ToolResult {
  const raw = str(p, "token");
  if (!raw) return fail("Missing required: token");
  if (!isAddress(raw)) return fail(`Invalid address: ${raw}`);
  return getAddress(raw);
}

// ── Handler map ──────────────────────────────────────────────────

export const SLOP_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Token ──────────────────────────────────────────────────────

  "slop.token.create": async (p) => {
    const name = str(p, "name"), symbol = str(p, "symbol");
    if (!name || !symbol) return fail("Missing required: name, symbol");

    const wallet = requireEvmWallet();
    const cfg = loadConfig();

    let userSalt: Hex;
    const saltRaw = str(p, "userSalt");
    if (saltRaw) {
      userSalt = validateUserSalt(saltRaw);
    } else {
      userSalt = `0x${randomBytes(32).toString("hex")}` as Hex;
    }

    const walletClient = getSigningClient(wallet.privateKey as Hex);
    const publicClient = getPublicClient();

    const txHash = await walletClient.writeContract({
      address: cfg.slop.factory,
      abi: SLOP_FACTORY_ABI,
      functionName: "createToken",
      args: [
        name,
        symbol,
        str(p, "description") || "",
        str(p, "imageUrl") || "",
        str(p, "twitter") || "",
        str(p, "telegram") || "",
        str(p, "website") || "",
        userSalt,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let tokenAddress: Address | undefined;
    let tokenId: bigint | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== cfg.slop.factory.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: SLOP_FACTORY_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "TokenCreated") {
          tokenAddress = decoded.args.tokenAddress as Address;
          tokenId = decoded.args.tokenId as bigint;
          break;
        }
      } catch { /* not TokenCreated */ }
    }

    if (!tokenAddress) return fail("Failed to decode TokenCreated event from receipt");

    return ok({ txHash, tokenAddress, tokenId: tokenId?.toString(), name, symbol });
  },

  "slop.token.info": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [name, symbol, metadata, creator, creationTime, state, tradeInfo, [price, priceSource]] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "name" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "metadata" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "creator" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "creationTime" }),
      getTokenState(addr),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "tradeInfo" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "getCurrentPrice" }),
    ]);

    const graduationProgress = calculateGraduationProgress(state.tokenReserves, state.virtualTokenReserves, state.curveSupply);

    return ok({
      token: addr, name, symbol, creator,
      creationTime: creationTime.toString(),
      isGraduated: state.isGraduated,
      price: formatUnits(price, 18),
      priceSource: priceSource === 0 ? "bonding" : "pool",
      graduationProgressPct: (Number(graduationProgress) / 100).toFixed(2),
      reserves: {
        og: state.ogReserves.toString(),
        token: state.tokenReserves.toString(),
        k: state.k.toString(),
      },
      fees: { buyBps: Number(state.buyFeeBps), sellBps: Number(state.sellFeeBps) },
      tradeInfo: {
        totalVolume: tradeInfo[0].toString(),
        totalTransactions: tradeInfo[1].toString(),
        buyCount: tradeInfo[2].toString(),
        sellCount: tradeInfo[3].toString(),
        uniqueTraders: tradeInfo[4].toString(),
      },
      metadata: { description: metadata[0], imageUrl: metadata[1], twitter: metadata[2], telegram: metadata[3], website: metadata[4] },
    });
  },

  "slop.tokens.mine": async (p) => {
    const cfg = loadConfig();
    const client = getPublicClient();

    let creatorAddr: Address;
    const raw = str(p, "creator");
    if (raw) {
      if (!isAddress(raw)) return fail(`Invalid address: ${raw}`);
      creatorAddr = getAddress(raw);
    } else {
      const wallet = requireEvmWallet();
      creatorAddr = wallet.address as Address;
    }

    const tokenAddresses = await client.readContract({
      address: cfg.slop.tokenRegistry,
      abi: SLOP_REGISTRY_ABI,
      functionName: "getCreatorTokens",
      args: [creatorAddr],
    });

    if (tokenAddresses.length === 0) {
      return ok({ creator: creatorAddr, tokens: [], count: 0 });
    }

    const tokenInfos = await client.readContract({
      address: cfg.slop.tokenRegistry,
      abi: SLOP_REGISTRY_ABI,
      functionName: "getTokensInfo",
      args: [tokenAddresses as Address[]],
    });

    const tokens = tokenAddresses.map((addr, i) => ({
      address: addr,
      name: tokenInfos[i].name,
      symbol: tokenInfos[i].symbol,
      createdAt: tokenInfos[i].createdAt.toString(),
      isGraduated: tokenInfos[i].isGraduated,
    }));

    return ok({ creator: creatorAddr, count: tokens.length, tokens });
  },

  // ── Trade ──────────────────────────────────────────────────────

  "slop.trade.buy": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;
    const amountOgRaw = str(p, "amountOg");
    if (!amountOgRaw) return fail("Missing required: amountOg");

    await validateOfficialToken(addr);
    await checkNotGraduated(addr);
    await checkTradingEnabled(addr);

    const slippageBps = num(p, "slippageBps") ?? 50;
    const ogAmountWei = parseUnitsSafe(amountOgRaw, 18, "amountOg");
    if (ogAmountWei <= 0n) return fail("Amount must be > 0");

    const state = await getTokenState(addr);
    const client = getPublicClient();

    const quote = calculatePartialFill(
      state.ogReserves, state.tokenReserves, state.virtualTokenReserves,
      state.curveSupply, ogAmountWei, state.buyFeeBps,
    );

    const minTokensOut = applySlippage(quote.tokensOut, BigInt(slippageBps));
    const symbol = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" });

    if (p.dryRun === true) {
      return ok({
        dryRun: true, token: addr, symbol,
        amountOg: amountOgRaw,
        tokensOut: formatUnits(quote.tokensOut, 18),
        minTokensOut: formatUnits(minTokensOut, 18),
        fee: formatUnits(quote.feeUsed, 18),
        refund: formatUnits(quote.refund, 18),
        hitCap: quote.hitCap,
        slippageBps,
      });
    }

    const wallet = requireEvmWallet();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "buyWithSlippage",
      args: [minTokensOut],
      value: ogAmountWei,
    });

    return {
      success: true,
      output: JSON.stringify({ txHash, token: addr, symbol, amountOg: amountOgRaw, tokensOut: formatUnits(quote.tokensOut, 18), hitCap: quote.hitCap }, null, 2),
      data: { txHash, _tradeCapture: { type: "swap", chain: "0g", status: "executed", inputToken: "0G", outputToken: symbol, outputTokenAddress: addr, inputAmount: ogAmountWei.toString(), outputAmount: quote.tokensOut.toString(), signature: txHash, walletAddress: wallet.address, tradeSide: "buy", instrumentKey: `0g:${addr}`, meta: { dex: "slop", action: "buy", hitCap: quote.hitCap } } },
    };
  },

  "slop.trade.sell": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;
    const amountTokensRaw = str(p, "amountTokens");
    if (!amountTokensRaw) return fail("Missing required: amountTokens");

    await validateOfficialToken(addr);
    await checkNotGraduated(addr);
    await checkTradingEnabled(addr);

    const slippageBps = num(p, "slippageBps") ?? 50;
    const tokenAmountWei = parseUnitsSafe(amountTokensRaw, 18, "amountTokens");
    if (tokenAmountWei <= 0n) return fail("Amount must be > 0");

    const state = await getTokenState(addr);
    const client = getPublicClient();

    const ogOutGross = calculateOgOut(state.k, state.ogReserves, state.tokenReserves, tokenAmountWei);
    const fee = (ogOutGross * state.sellFeeBps) / 10000n;
    const ogOutNet = ogOutGross - fee;
    const minOgOut = applySlippage(ogOutNet, BigInt(slippageBps));

    const symbol = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" });

    if (p.dryRun === true) {
      return ok({
        dryRun: true, token: addr, symbol,
        amountTokens: amountTokensRaw,
        ogOutNet: formatUnits(ogOutNet, 18),
        minOgOut: formatUnits(minOgOut, 18),
        fee: formatUnits(fee, 18),
        slippageBps,
      });
    }

    const wallet = requireEvmWallet();

    // Check balance
    const balance = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "balanceOf", args: [wallet.address as Address] });
    if (balance < tokenAmountWei) return fail(`Insufficient balance: ${formatUnits(balance, 18)} ${symbol} (need ${amountTokensRaw})`);

    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "sellWithSlippage",
      args: [tokenAmountWei, minOgOut],
    });

    return {
      success: true,
      output: JSON.stringify({ txHash, token: addr, symbol, amountTokens: amountTokensRaw, ogOutNet: formatUnits(ogOutNet, 18) }, null, 2),
      data: { txHash, _tradeCapture: { type: "swap", chain: "0g", status: "executed", inputToken: symbol, inputTokenAddress: addr, outputToken: "0G", inputAmount: tokenAmountWei.toString(), outputAmount: ogOutNet.toString(), signature: txHash, walletAddress: wallet.address, tradeSide: "sell", instrumentKey: `0g:${addr}`, meta: { dex: "slop", action: "sell" } } },
    };
  },

  // ── View ───────────────────────────────────────────────────────

  "slop.price": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [[price, priceSource], symbol] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "getCurrentPrice" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
    ]);

    return ok({ token: addr, symbol, price: formatUnits(price, 18), source: priceSource === 0 ? "bonding" : "pool" });
  },

  "slop.curve": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();
    const state = await getTokenState(addr);
    const symbol = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" });

    const graduationProgress = calculateGraduationProgress(state.tokenReserves, state.virtualTokenReserves, state.curveSupply);
    const tokensSold = state.virtualTokenReserves > state.tokenReserves ? state.virtualTokenReserves - state.tokenReserves : 0n;

    return ok({
      token: addr, symbol, isGraduated: state.isGraduated,
      graduationProgressPct: (Number(graduationProgress) / 100).toFixed(2),
      reserves: {
        og: state.ogReserves.toString(), token: state.tokenReserves.toString(),
        virtualOg: state.virtualOgReserves.toString(), virtualToken: state.virtualTokenReserves.toString(),
        k: state.k.toString(),
      },
      curveSupply: state.curveSupply.toString(),
      tokensSold: tokensSold.toString(),
      fees: { buyBps: Number(state.buyFeeBps), sellBps: Number(state.sellFeeBps) },
    });
  },

  // ── Fees ───────────────────────────────────────────────────────

  "slop.fees.stats": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const cfg = loadConfig();
    const client = getPublicClient();

    const [feeStats, symbol] = await Promise.all([
      client.readContract({ address: cfg.slop.feeCollector, abi: SLOP_FEE_COLLECTOR_ABI, functionName: "getTokenFeeStats", args: [addr] }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
    ]);

    const [totalCreator, totalPlatform, pendingCreator, pendingPlatform, volume] = feeStats;

    return ok({
      token: addr, symbol,
      totalCreatorFees: formatUnits(totalCreator, 18),
      totalPlatformFees: formatUnits(totalPlatform, 18),
      pendingCreatorFees: formatUnits(pendingCreator, 18),
      pendingPlatformFees: formatUnits(pendingPlatform, 18),
      totalVolume: formatUnits(volume, 18),
    });
  },

  "slop.fees.claimCreator": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const wallet = requireEvmWallet();
    const cfg = loadConfig();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: cfg.slop.feeCollector,
      abi: SLOP_FEE_COLLECTOR_ABI,
      functionName: "withdrawCreatorFees",
      args: [addr],
    });

    return { success: true, output: JSON.stringify({ txHash, token: addr, action: "claimCreatorFees" }, null, 2), data: { txHash, _tradeCapture: { type: "reward", chain: "0g", status: "executed", walletAddress: wallet.address, signature: txHash, instrumentKey: `0g:${addr}`, meta: { action: "claimCreatorFees", token: addr } } } };
  },

  "slop.fees.lpPending": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [isGraduated, symbol] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
    ]);

    if (!isGraduated) {
      return ok({ token: addr, symbol, isGraduated: false, pendingW0G: "0", pendingToken: "0", note: "Token not graduated — no LP fees yet" });
    }

    const [pendingW0G, pendingToken] = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "getPendingLPFees" });

    return ok({ token: addr, symbol, isGraduated: true, pendingW0G: formatUnits(pendingW0G, 18), pendingToken: formatUnits(pendingToken, 18) });
  },

  "slop.fees.lpCollect": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const wallet = requireEvmWallet();
    const recipientRaw = str(p, "recipient");
    const recipient = recipientRaw && isAddress(recipientRaw) ? getAddress(recipientRaw) : wallet.address as Address;

    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "collectLPFees",
      args: [recipient],
    });

    return { success: true, output: JSON.stringify({ txHash, token: addr, recipient, action: "collectLPFees" }, null, 2), data: { txHash, _tradeCapture: { type: "reward", chain: "0g", status: "executed", walletAddress: wallet.address, signature: txHash, instrumentKey: `0g:${addr}`, meta: { action: "collectLPFees", token: addr } } } };
  },

  // ── Reward ─────────────────────────────────────────────────────

  "slop.reward.pending": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [pendingReward, totalReward, symbol, isGraduated] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "pendingCreatorReward" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "CREATOR_GRADUATION_REWARD" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
    ]);

    return ok({ token: addr, symbol, isGraduated, pendingReward: formatUnits(pendingReward, 18), totalReward: formatUnits(totalReward, 18) });
  },

  "slop.reward.claim": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const wallet = requireEvmWallet();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "claimCreatorReward",
    });

    return { success: true, output: JSON.stringify({ txHash, token: addr, action: "claimCreatorReward" }, null, 2), data: { txHash, _tradeCapture: { type: "reward", chain: "0g", status: "executed", walletAddress: wallet.address, signature: txHash, instrumentKey: `0g:${addr}`, meta: { action: "claimCreatorReward", token: addr } } } };
  },
};
