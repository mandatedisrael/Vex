import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import type { TableColumn } from "../../utils/ui.js";

const CTO_COLUMNS: TableColumn[] = [
  { header: "Chain", width: 12 },
  { header: "Address", width: 20 },
  { header: "Claimed", width: 22 },
  { header: "Description", width: 40 },
];

export function createCommunityTakeoversSubcommand(): Command {
  return new Command("cto")
    .description("Get latest community takeovers (CTO signals)")
    .action(async () => {
      const client = getDexScreenerClient();
      const takeovers = await client.getCommunityTakeovers();

      if (isHeadless()) {
        writeJsonSuccess({ takeovers, count: takeovers.length });
        return;
      }

      if (takeovers.length === 0) {
        process.stderr.write("No community takeovers found\n");
        return;
      }

      process.stderr.write(colors.info(`Latest ${takeovers.length} community takeovers\n\n`));

      const rows = takeovers.slice(0, 30).map(cto => [
        cto.chainId,
        cto.tokenAddress.slice(0, 18) + "...",
        new Date(cto.claimDate).toLocaleDateString(),
        (cto.description ?? "-").slice(0, 38),
      ]);

      printTable(CTO_COLUMNS, rows);
    });
}
