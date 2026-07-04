/**
 * Retrieval metadata for DexScreener trending / attention / narrative tools.
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
  "dexscreener.profiles.recent": {
    embeddingText: embeddingText(
      `Get RECENTLY UPDATED token profiles on DEX Screener — projects that just refreshed their description, socials, or branding, each with an updatedAt timestamp and a community-takeover (cto) flag. ` +
      `Use this when the user wants the freshest profile activity, who just updated their listing, or a change feed of project metadata rather than the plain latest-profiles list. Live but undocumented API surface — may change. ` +
      `Example queries: recently updated profiles, who just refreshed their listing, latest profile changes, fresh project updates, recent metadata updates.`,
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
  "dexscreener.attention": {
    embeddingText: embeddingText(
      `Merged ATTENTION signal — combines token-profiles and paid boosts into one ranked, deduplicated list, sorted by boost spend then profile presence. This is a synthetic "who's buying visibility" view, NOT the official trending narratives feed. ` +
      `Use this when the user wants to see which specific tokens are getting paid promotion and attention right now across chains. ` +
      `Example queries: what tokens are getting attention, who's being promoted and profiled, boosted tokens with profiles, paid attention leaders, most-promoted coins right now.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
  "dexscreener.trending": {
    embeddingText: embeddingText(
      `Official DEX Screener TRENDING NARRATIVES feed — the trending themes/categories/metas (e.g. AI, dogs, cats, "knockoff legends"), each with aggregate market cap, liquidity, 24h volume, token count, and market-cap change windows. Returns NARRATIVES, not individual tokens; drill into one with dexscreener.meta. Live but undocumented API surface — may change. ` +
      `Use this when the user asks what themes or narratives are hot in crypto right now, which meta is pumping, or wants the market-wide trending categories. ` +
      `Example queries: what's trending in crypto, hot narratives right now, trending metas, which theme is pumping, top crypto narratives, what meta is hot.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
  "dexscreener.meta": {
    embeddingText: embeddingText(
      `Drill into ONE trending narrative/meta by its slug (from dexscreener.trending, e.g. "knockoff-legends") — returns the narrative's aggregate market cap, liquidity, volume, token count, plus the DEX pairs indexed under it. Live but undocumented API surface — may change. ` +
      `Use this when the user picks a theme from dexscreener.trending and wants the tokens/pairs inside it. The slug is a NARRATIVE slug, never a chain slug. ` +
      `Example queries: show tokens in the ai narrative, what's in the dog meta, pairs for this trending theme, drill into knockoff legends, tokens in this narrative.`,
    ),
    chains: DEXSCREENER_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 8;
if (Object.keys(DEXSCREENER_TRENDING_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `DEXSCREENER_TRENDING_DISCOVERY has ${Object.keys(DEXSCREENER_TRENDING_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
