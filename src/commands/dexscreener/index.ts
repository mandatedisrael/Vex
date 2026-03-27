import { Command } from "commander";
import { createSearchSubcommand } from "./search.js";
import { createPairsSubcommand } from "./pairs.js";
import { createTokenSubcommand } from "./token.js";
import { createTokenPairsSubcommand } from "./token-pairs.js";
import { createProfilesSubcommand } from "./profiles.js";
import { createBoostsSubcommand } from "./boosts.js";
import { createCommunityTakeoversSubcommand } from "./community-takeovers.js";
import { createAdsSubcommand } from "./ads.js";
import { createOrdersSubcommand } from "./orders.js";
import { createTrendingSubcommand } from "./trending.js";
import { createStreamSubcommand } from "./stream.js";

export function createDexScreenerCommand(): Command {
  const dexscreener = new Command("dexscreener")
    .description("Multi-chain DEX analytics via DexScreener")
    .exitOverride();

  dexscreener.addCommand(createSearchSubcommand());
  dexscreener.addCommand(createPairsSubcommand());
  dexscreener.addCommand(createTokenSubcommand());
  dexscreener.addCommand(createTokenPairsSubcommand());
  dexscreener.addCommand(createProfilesSubcommand());
  dexscreener.addCommand(createBoostsSubcommand());
  dexscreener.addCommand(createCommunityTakeoversSubcommand());
  dexscreener.addCommand(createAdsSubcommand());
  dexscreener.addCommand(createOrdersSubcommand());
  dexscreener.addCommand(createTrendingSubcommand());
  dexscreener.addCommand(createStreamSubcommand());

  return dexscreener;
}
