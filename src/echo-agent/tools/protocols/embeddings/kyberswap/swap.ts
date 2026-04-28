/**
 * Retrieval metadata for KyberSwap swap tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `kyberswap/manifests/swap.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_SWAP_CHAINS } from "../../kyberswap/discovery-text.js";

export const KYBERSWAP_SWAP_DISCOVERY = {
  "kyberswap.swap.quote": {
    embeddingText: embeddingText(
      `Preview a token swap on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism, Avalanche and other EVM chains — get the output amount, route, gas cost, price impact, and slippage before executing. ` +
      `Use this when the user wants to know the best price, check the rate before swapping, simulate a trade, or compare what they'd get for a swap. ` +
      `Example queries: how much usdc do I get for 1 eth on base, best price for swap, preview trade, what would I get for selling pepe, check the rate on bnb. ` +
      `Read-only — does not execute.`,
    ),
    aliases: ["swap quote", "route preview", "best route", "price impact", "slippage preview", "RFQ liquidity"],
    exampleIntents: ["quote swap on bnb", "best route USDC to ETH on base", "preview token swap"],
    preferredFor: ["swap quote", "route preview", "read only swap", "price impact"],
    chains: KYBER_SWAP_CHAINS,
  },

  "kyberswap.swap.sell": {
    embeddingText: embeddingText(
      `Sell a token on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism, Avalanche and other EVM chains — routes through 400+ DEXes for the best price. ` +
      `Use this when the user wants to sell a coin, dump a holding, exit a position, swap out of a token, get out of a memecoin, or trade one token for another with the input fixed. ` +
      `Example queries: sell eth for usdc on base, swap pepe to usdc, dump my doge, exit my shitcoin position, swap out of bnb, get rid of this token.`,
    ),
    aliases: ["sell token", "swap out", "exit position", "reduce position"],
    exampleIntents: ["sell ETH for USDC on arbitrum", "swap token on bnb", "exit token position on base"],
    preferredFor: ["sell token", "exit position", "reduce position", "exact input swap"],
    chains: KYBER_SWAP_CHAINS,
  },

  "kyberswap.swap.buy": {
    embeddingText: embeddingText(
      `Buy a token on Ethereum, Base, Arbitrum, BNB Chain, Polygon and other EVM chains using stablecoins or another asset as input — routes through 400+ DEXes for the best price. ` +
      `Use this when the user wants to buy a coin, ape into a memecoin, get into a position, acquire a token, swap stables into something, or open a spot position. ` +
      `Example queries: buy eth with usdc on base, ape into pepe, get me bnb, buy this memecoin with usdt, open a spot position in arb, acquire some link.`,
    ),
    aliases: ["buy token", "acquire token", "swap into token"],
    exampleIntents: ["buy ETH with USDC on base", "buy token on bnb", "swap stablecoin into token"],
    preferredFor: ["buy token", "acquire token", "open spot position", "exact input swap"],
    chains: KYBER_SWAP_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 3;
if (Object.keys(KYBERSWAP_SWAP_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `KYBERSWAP_SWAP_DISCOVERY has ${Object.keys(KYBERSWAP_SWAP_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
