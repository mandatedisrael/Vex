/**
 * Retrieval metadata for KyberSwap limit-order tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `kyberswap/manifests/limit-order.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_LIMIT_ORDER_CHAINS } from "../../kyberswap/discovery-text.js";

export const KYBERSWAP_LIMIT_ORDER_DISCOVERY = {
  "kyberswap.limitOrder.list": {
    embeddingText: embeddingText(
      `List a wallet's KyberSwap limit orders on an EVM chain — see active orders, filled orders, cancelled orders, and expired orders. ` +
      `Use this when the user wants to see their open limit orders, check order history, see what's been filled, or review pending sells and buys. ` +
      `Example queries: show my limit orders, list my open orders on base, what's my order history, check my pending sells, see filled orders, status of my limit orders.`,
    ),
    aliases: ["list orders", "maker orders", "order status", "open orders"],
    exampleIntents: ["show active limit orders", "list my maker orders", "limit order status"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.activeMakingAmount": {
    embeddingText: embeddingText(
      `Check how much of a token a wallet has locked in open KyberSwap limit orders on an EVM chain. ` +
      `Use this when the user wants to know how much is locked up in pending orders, plan how much to spend on the next order, or check exposure before placing more orders. ` +
      `Example queries: how much usdc is locked in my orders, what's my open order exposure for eth, total locked in pending limit orders, how much can I still order, exposure check before new order.`,
    ),
    aliases: ["active making amount", "locked amount", "allowance planning", "makerAsset exposure"],
    exampleIntents: ["check allowance needed for limit order", "active making amount for USDC", "locked open order amount"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.create": {
    embeddingText: embeddingText(
      `Place a gasless limit order on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism and other EVM chains — sell or buy a token only when it hits a target price, with no upfront gas cost. ` +
      `Use this when the user wants to set a target price, sell when price hits X, buy a dip, take profit at a level, or place a limit sell or limit buy. ` +
      `Example queries: sell eth at 5000, place limit order to buy pepe at 0.0001, target price order, take profit at 4k, gasless limit sell, buy the dip at 1900. ` +
      `Order is signed off-chain and fills when price is hit.`,
    ),
    aliases: ["create limit order", "place limit order", "gasless order", "EIP712 order"],
    exampleIntents: ["place limit order on polygon", "create gasless order", "sell USDC for ETH at target price"],
    preferredFor: ["create limit order", "place order", "target price trade"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.cancel": {
    embeddingText: embeddingText(
      `Cancel a single KyberSwap limit order without paying gas — fast, cost-free cancel by order ID. Cancellation lapses within ~5 minutes. ` +
      `Use this when the user wants to cancel one specific order at no cost, drop a single pending sell or buy, or kill one order without spending gas. ` +
      `Example queries: cancel my limit order 12345, gasless cancel one order, drop my limit sell on eth, cancel this pending order, no-gas cancel, kill order 555.`,
    ),
    aliases: ["cancel order", "gasless cancel", "cancel limit order"],
    exampleIntents: ["cancel my limit order", "gasless cancel order id", "cancel maker order"],
    preferredFor: ["gasless cancel", "cancel one order"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.hardCancel": {
    embeddingText: embeddingText(
      `Cancel one KyberSwap limit order immediately on-chain, with gas — guaranteed instant invalidation. ` +
      `Use this when the user wants to cancel one order right now and is willing to pay gas, force a cancel that won't wait for the gasless lapse window, or invalidate one order at the contract level. ` +
      `Example queries: cancel order now, hard cancel my limit order on chain, kill order immediately, force cancel with gas, cancel right away.`,
    ),
    aliases: ["hard cancel", "on-chain cancel", "immediate cancel", "gas cancel"],
    exampleIntents: ["hard cancel order now", "cancel order on chain", "immediate limit order cancel"],
    preferredFor: ["immediate cancel", "hard cancel", "on-chain cancellation"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.pairs": {
    embeddingText: embeddingText(
      `List token pairs that can be filled as a KyberSwap limit order taker on an EVM chain. ` +
      `Use this when the user wants to know which markets are available for filling orders, what pairs they can take orders against, or what taker opportunities exist on a chain. ` +
      `Example queries: what pairs can I fill on base, supported limit order markets, available taker pairs on arbitrum, list orderbook pairs, fillable markets.`,
    ),
    aliases: ["supported pairs", "limit order pairs", "order markets", "makerAsset takerAsset"],
    exampleIntents: ["list limit order pairs", "supported order markets", "what pairs can be filled"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.takerOrders": {
    embeddingText: embeddingText(
      `Find open KyberSwap limit orders on an EVM chain that can be filled by a taker — sorted by best rate. ` +
      `Use this when the user wants to find orders to fill, look for arbitrage opportunities, browse the limit order book, or find above-market rates as a counterparty. ` +
      `Example queries: find orders to fill on base, browse the limit order book, what taker orders exist on arbitrum, best rate orders to take, look for limit order arb.`,
    ),
    aliases: ["open orders", "taker orders", "orders to fill", "best rate orderbook"],
    exampleIntents: ["find open orders to fill", "query taker orders", "limit order orderbook"],
    preferredFor: ["find fillable orders", "taker orderbook", "best rate limit orders"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.fill": {
    embeddingText: embeddingText(
      `Fill one KyberSwap limit order as a taker — single on-chain execution against a specific maker order. ` +
      `Use this when the user wants to take one specific order, execute against a maker, or fill one opportunity they found. ` +
      `Example queries: fill order 12345 on base, take this maker order, execute order fill, take the limit order, accept this single order.`,
    ),
    aliases: ["fill order", "take order", "taker fill", "operator signature", "threshold amount"],
    exampleIntents: ["fill limit order", "take maker order", "execute order fill on chain"],
    preferredFor: ["fill single order", "taker execution"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.batchFill": {
    embeddingText: embeddingText(
      `Fill multiple KyberSwap limit orders as a taker in one on-chain transaction — gas-efficient batch execution. ` +
      `Use this when the user wants to fill many orders at once, batch take maker orders for gas savings, or execute several arb opportunities in one tx. ` +
      `Example queries: batch fill orders, take many limit orders at once, fill multiple orders on base, batch execute taker orders, multi-fill in one transaction.`,
    ),
    aliases: ["batch fill", "fill multiple orders", "batch orders", "multi order fill"],
    exampleIntents: ["batch fill limit orders", "fill multiple orders", "execute many taker orders"],
    preferredFor: ["batch fill", "multiple order fill"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },

  "kyberswap.limitOrder.cancelAll": {
    embeddingText: embeddingText(
      `Cancel every open KyberSwap limit order on an EVM chain in one transaction. ` +
      `Use this when the user wants to wipe all their orders, panic-cancel everything, clear the slate, do an emergency cleanup of pending orders, or invalidate the entire open book at once. ` +
      `Example queries: cancel all my orders, kill all limit orders, panic close everything, clear my open orders on base, wipe all pending sells, mass cancel.`,
    ),
    aliases: ["cancel all orders", "increase nonce", "invalidate orders", "emergency cancel"],
    exampleIntents: ["cancel all limit orders", "invalidate every open order", "emergency cancel all maker orders"],
    preferredFor: ["cancel all", "invalidate all orders", "emergency cleanup"],
    chains: KYBER_LIMIT_ORDER_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 10;
if (Object.keys(KYBERSWAP_LIMIT_ORDER_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `KYBERSWAP_LIMIT_ORDER_DISCOVERY has ${Object.keys(KYBERSWAP_LIMIT_ORDER_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
