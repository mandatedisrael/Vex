/**
 * Retrieval metadata for DexScreener trending tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `dexscreener/manifests/trending.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { DEXSCREENER_CHAINS } from "../../dexscreener/discovery-text.js";

export const DEXSCREENER_TRENDING_DISCOVERY = {
  "dexscreener.profiles": {
    embeddingText: embeddingText(
      `Get the latest token profiles on DEX Screener — newly listed projects with descriptions, websites, socials. ` +
      `Use this when the user wants to find newly visible tokens, browse fresh project listings, or discover what's new in the ecosystem with full descriptions and links. ` +
      `Example queries: latest token profiles, find new project listings, what just got listed, browse newest crypto projects, fresh memecoin profiles, recently visible tokens.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
  "dexscreener.boosts": {
    embeddingText: embeddingText(
      `Get the latest tokens that received paid boosts on DEX Screener across all chains — Ethereum, Solana, BNB, Base, Arbitrum and others. ` +
      `Use this when the user wants to see who's spending on visibility, find newly promoted tokens, track marketing activity in crypto, watch for paid attention signals on memecoins, or follow recent boost flow. ` +
      `Example queries: latest boosted tokens, what's being promoted, recent paid boosts, new memecoin boosts, who's buying visibility, fresh boost activity, who's paying for promo.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
  "dexscreener.boosts.top": {
    embeddingText: embeddingText(
      `Tokens with the most active boosts on DEX Screener, ranked by total boost amount — heaviest paid attention spend right now. ` +
      `Use this when the user wants the top-promoted tokens, the highest paid visibility, or the most-boosted projects ordered by spend. ` +
      `Example queries: top boosted tokens, most promoted coins, highest paid visibility, biggest boost spenders, top promo tokens by amount.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
  "dexscreener.communityTakeovers": {
    embeddingText: embeddingText(
      `Get the latest community takeover (CTO) events on DEX Screener — tokens where the community has reclaimed control. ` +
      `Use this when the user wants to find CTO opportunities, track community-run memecoins, watch for takeover signals (often precedes price action), or browse renewed-attention coins. ` +
      `Example queries: latest cto events, community takeover tokens, recent ctos, community-controlled memecoins, takeover signals, community reclaimed coins.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
  "dexscreener.trending": {
    embeddingText: embeddingText(
      `Get a unified ranked feed of trending tokens across all chains — Ethereum, Solana, BNB, Base, Arbitrum, Polygon and others — combining boosts, profiles, and other attention signals. ` +
      `Use this when the user wants to see what's hot in crypto right now market-wide, what tokens are gaining attention, what's being promoted, or what's pumping across chains. ` +
      `Example queries: what's trending in crypto, hot new tokens, top promoted coins, what's pumping right now, fresh launches getting attention, trending memecoins.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 5;
if (Object.keys(DEXSCREENER_TRENDING_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `DEXSCREENER_TRENDING_DISCOVERY has ${Object.keys(DEXSCREENER_TRENDING_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
