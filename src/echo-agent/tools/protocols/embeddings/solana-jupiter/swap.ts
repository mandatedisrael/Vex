/**
 * Retrieval metadata for Solana / Jupiter swap tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `solana-jupiter/manifests/swap.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { SOLANA_CHAINS } from "../../solana-jupiter/discovery-text.js";

export const SOLANA_SWAP_DISCOVERY = {
  "solana.swap.quote": {
    embeddingText: embeddingText(
      `Preview a Solana SPL token swap — get the output amount, route, price impact, and slippage before executing. ` +
      `Use this when the user wants to know the best price for a sol swap, simulate a trade, check the rate before swapping, or compare swap output. ` +
      `Example queries: how much usdc for 1 sol, preview swap on sol, best route for bonk to usdc, check rate before swapping spl, simulate solana trade. ` +
      `Read-only — does not execute.`,
    ),
    chains: SOLANA_CHAINS,
  },

  "solana.swap.execute": {
    embeddingText: embeddingText(
      `Swap any SPL token on Solana — SOL, USDC, JUP, BONK, memecoins or any mint — using Jupiter's aggregator across 400+ DEXes with MEV protection. ` +
      `Use this when the user wants to swap on solana, buy a sol memecoin, sell an spl token, trade sol to usdc, ape into a solana coin, or get the best route on solana. ` +
      `Example queries: swap sol to usdc, buy bonk with sol, sell jup, ape into this sol memecoin, trade spl tokens, best swap on sol. ` +
      `Routes through Metis, JupiterZ RFQ, Dflow and OKX.`,
    ),
    chains: SOLANA_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 2;
if (Object.keys(SOLANA_SWAP_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `SOLANA_SWAP_DISCOVERY has ${Object.keys(SOLANA_SWAP_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
