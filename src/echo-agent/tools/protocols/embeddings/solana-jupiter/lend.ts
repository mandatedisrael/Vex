/**
 * Retrieval metadata for Solana / Jupiter lend tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `solana-jupiter/manifests/lend.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { SOLANA_CHAINS } from "../../solana-jupiter/discovery-text.js";

export const SOLANA_LEND_DISCOVERY = {
  "solana.lend.rates": {
    embeddingText: embeddingText(
      `Get Jupiter Lend Earn vault yield rates on Solana — APY (supply plus rewards), TVL, total supply per token. ` +
      `Use this when the user wants to compare lending APYs, find yield opportunities on solana, check earn rates on usdc or sol, or look at vault TVL before depositing. ` +
      `Example queries: best lending apy on solana, rates for usdc earn, jupiter lend yields, where can I earn yield on sol, check tvl for jupiter vaults, sol earn rates.`,
    ),
    chains: SOLANA_CHAINS,
  },

  "solana.lend.positions": {
    embeddingText: embeddingText(
      `Get a wallet's open Jupiter Lend Earn positions on Solana — supplied assets, balances, accrued earnings, rewards. ` +
      `Use this when the user wants to see what they have lent, check yield earned so far, review their solana lending portfolio, or audit their earn positions. ` +
      `Example queries: my lend positions on solana, what have I deposited, my jupiter earn balance, check accrued yield, review my lending, sol earn portfolio.`,
    ),
    chains: SOLANA_CHAINS,
  },

  "solana.lend.deposit": {
    embeddingText: embeddingText(
      `Deposit SPL tokens into Jupiter Lend Earn vaults on Solana to earn yield. ` +
      `Use this when the user wants to earn yield on idle stables or sol, deposit into lending, supply assets, put usdc to work, or get a passive return on solana holdings. ` +
      `Example queries: deposit usdc to earn, lend my sol, supply assets for yield, put usdc to work on solana, earn on stables, start lending on solana.`,
    ),
    chains: SOLANA_CHAINS,
  },

  "solana.lend.withdraw": {
    embeddingText: embeddingText(
      `Withdraw SPL tokens from Jupiter Lend Earn vaults on Solana. ` +
      `Use this when the user wants to exit a lending position, take out their supplied assets, claim their earned yield by withdrawing, or pull funds from earn. ` +
      `Example queries: withdraw my usdc from lend, exit lending position on solana, take out my deposit, redeem my earn shares, pull funds from jupiter lend, stop lending.`,
    ),
    chains: SOLANA_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 4;
if (Object.keys(SOLANA_LEND_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `SOLANA_LEND_DISCOVERY has ${Object.keys(SOLANA_LEND_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
