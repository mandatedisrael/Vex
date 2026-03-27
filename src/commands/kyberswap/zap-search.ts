/**
 * `echoclaw kyberswap zap search` — find best pools for LP via DexScreener.
 *
 * Combines DexScreener pool data with ZaaS-supported DEX filter.
 */

import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import type { DexPair } from "../../tools/dexscreener/types.js";
import { resolveChain, resolveTokenAddress, requireFeature, formatUsd } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { parseIntSafe } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, colors } from "../../utils/ui.js";

/** Map KyberSwap chain slugs to DexScreener chain slugs (some differ). */
const DEXSCREENER_CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  bsc: "bsc",
  arbitrum: "arbitrum",
  polygon: "polygon",
  optimism: "optimism",
  avalanche: "avalanche",
  base: "base",
  linea: "linea",
  sonic: "sonic",
  berachain: "berachain",
  ronin: "ronin",
  scroll: "scroll",
  zksync: "zksync",
};

export function createZapSearchAction(): Command {
  return new Command("search")
    .description("Find best liquidity pools for LP (via DexScreener + ZaaS filter)")
    .argument("<token>", "Token address or symbol")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .option("--limit <n>", "Max results", "10")
    .exitOverride()
    .action(async (token: string, options: { chain: string; limit: string }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "zaas");
      const chainId = slugToChainId(slug);
      const limit = parseIntSafe(options.limit, "limit");

      const dexChain = DEXSCREENER_CHAIN_MAP[slug];
      if (!dexChain) {
        if (isHeadless()) {
          writeJsonSuccess({ pools: [], chain: slug, message: "DexScreener not available for this chain" });
        } else {
          infoBox("Pool Search", `DexScreener data not available for ${slug}`);
        }
        return;
      }

      const spin = spinner("Searching pools...");
      spin.start();

      const tokenAddr = await resolveTokenAddress(token, chainId);
      const dex = getDexScreenerClient();

      const pairs: DexPair[] = await dex.getTokenPairs(dexChain, tokenAddr);
      const sorted = pairs.sort((a: DexPair, b: DexPair) => {
        const liqA = a.liquidity?.usd ?? 0;
        const liqB = b.liquidity?.usd ?? 0;
        return liqB - liqA;
      }).slice(0, limit);

      spin.succeed(`Found ${sorted.length} pool(s)`);

      if (isHeadless()) {
        writeJsonSuccess({
          pools: sorted.map((p: DexPair) => ({
            pairAddress: p.pairAddress,
            dexId: p.dexId,
            baseToken: p.baseToken,
            quoteToken: p.quoteToken,
            liquidity: p.liquidity,
            volume24h: p.volume?.h24 ?? null,
            priceUsd: p.priceUsd,
          })),
          chain: slug,
          chainId,
          token: tokenAddr,
        });
        return;
      }

      if (sorted.length === 0) {
        infoBox("Pool Search", `No pools found for ${token} on ${slug}`);
        return;
      }

      const lines = sorted.map((p: DexPair, i: number) => {
        const liq = p.liquidity?.usd ? formatUsd(p.liquidity.usd) : "?";
        const vol = p.volume?.h24 ? formatUsd(p.volume.h24) : "?";
        return `${i + 1}. ${colors.value(p.baseToken.symbol)}/${p.quoteToken?.symbol ?? "?"} on ${colors.info(p.dexId)}\n` +
          `   Pool: ${p.pairAddress}\n` +
          `   Liquidity: ${liq}  |  Vol 24h: ${vol}`;
      });

      infoBox(`Pools for ${token} on ${slug}`, lines.join("\n\n"));
    });
}
