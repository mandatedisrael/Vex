import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import type { TableColumn } from "../../utils/ui.js";

const AD_COLUMNS: TableColumn[] = [
  { header: "Chain", width: 12 },
  { header: "Address", width: 20 },
  { header: "Type", width: 16 },
  { header: "Duration", width: 10 },
  { header: "Impressions", width: 14 },
  { header: "Date", width: 22 },
];

export function createAdsSubcommand(): Command {
  return new Command("ads")
    .description("Get latest DexScreener ads")
    .action(async () => {
      const client = getDexScreenerClient();
      const ads = await client.getAds();

      if (isHeadless()) {
        writeJsonSuccess({ ads, count: ads.length });
        return;
      }

      if (ads.length === 0) {
        process.stderr.write("No ads found\n");
        return;
      }

      process.stderr.write(colors.info(`Latest ${ads.length} ads\n\n`));

      const rows = ads.slice(0, 30).map(ad => [
        ad.chainId,
        ad.tokenAddress.slice(0, 18) + "...",
        ad.type,
        ad.durationHours != null ? `${ad.durationHours}h` : "-",
        ad.impressions != null ? String(ad.impressions) : "-",
        new Date(ad.date).toLocaleDateString(),
      ]);

      printTable(AD_COLUMNS, rows);
    });
}
