/**
 * Retrieval metadata for KyberSwap zap tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `kyberswap/manifests/zap.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_ZAP_CHAINS } from "../../kyberswap/discovery-text.js";

export const KYBERSWAP_ZAP_DISCOVERY = {
  "kyberswap.zap.in": {
    embeddingText: embeddingText(
      `Add liquidity to a Uniswap V3, PancakeSwap V3, Aerodrome, QuickSwap or Kodiak pool on Ethereum, Base, Arbitrum, Polygon, BNB Chain and other EVM chains — supply just one token, the rest is handled. ` +
      `Use this when the user wants to provide liquidity, become an LP, open a liquidity position, earn fees from a pool, zap into LP with one asset, or LP into a concentrated range. ` +
      `Example queries: add liquidity to usdc/eth on base, become lp on uniswap, zap into pool, provide liquidity with just usdc, open lp position, lp on arbitrum.`,
    ),
    aliases: ["zap in", "add liquidity", "LP position", "provide liquidity"],
    exampleIntents: ["add liquidity with one token", "zap into LP on base", "create concentrated liquidity position"],
    preferredFor: ["add liquidity", "zap in", "create LP position", "increase LP position"],
    chains: KYBER_ZAP_CHAINS,
  },

  "kyberswap.zap.out": {
    embeddingText: embeddingText(
      `Remove liquidity from an LP position on Ethereum, Base, Arbitrum and other EVM chains — convert the LP back to one chosen output token in one click. ` +
      `Use this when the user wants to exit an LP position, close their liquidity, withdraw to a single token, collect LP fees, or get out of a pool. ` +
      `Example queries: remove liquidity to usdc on base, exit my lp position, withdraw from pool, close my lp, take fees and exit, get out of uniswap pool.`,
    ),
    aliases: ["zap out", "remove liquidity", "withdraw LP", "collect fees"],
    exampleIntents: ["remove liquidity to USDC", "zap out LP position", "withdraw concentrated liquidity"],
    preferredFor: ["remove liquidity", "zap out", "close LP position", "withdraw LP"],
    chains: KYBER_ZAP_CHAINS,
  },

  "kyberswap.zap.migrate": {
    embeddingText: embeddingText(
      `Migrate an LP position from one pool or DEX to another in a single transaction on EVM chains. ` +
      `Use this when the user wants to move their LP between pools, switch DEXes, rebalance into a new range, or follow liquidity from one venue to another. ` +
      `Example queries: move my lp from uniswap to pancake, migrate position to another pool, switch dex for my lp, rebalance my concentrated range, change pool for my liquidity.`,
    ),
    aliases: ["zap migrate", "migrate LP", "move liquidity", "rebalance liquidity"],
    exampleIntents: ["migrate LP to another pool", "move liquidity position", "rebalance concentrated liquidity"],
    preferredFor: ["migrate liquidity", "move LP", "rebalance LP position"],
    chains: KYBER_ZAP_CHAINS,
  },

  "kyberswap.zap.list": {
    embeddingText: embeddingText(
      `List which DEX protocols support zap-in, zap-out, or zap-migrate on a given EVM chain — Uniswap V3, PancakeSwap V3, Aerodrome, QuickSwap, Kodiak, and others. ` +
      `Use this when the user wants to know which DEXes the zap tools work with on a chain, what protocols support one-click LP, or which liquidity venues are available before zapping in. ` +
      `Example queries: what dexes can I zap into on polygon, list zap protocols on base, supported lp dexes on arbitrum, where can I add liquidity with kyber zap.`,
    ),
    aliases: ["zap dex list", "DEX ids", "supported zap protocols", "ZaaS dexes"],
    exampleIntents: ["list zap DEX ids", "what DEX ids can I use for zap", "supported liquidity protocols"],
    chains: KYBER_ZAP_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 4;
if (Object.keys(KYBERSWAP_ZAP_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `KYBERSWAP_ZAP_DISCOVERY has ${Object.keys(KYBERSWAP_ZAP_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
