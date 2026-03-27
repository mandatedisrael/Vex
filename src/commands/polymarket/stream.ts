/**
 * `echoclaw polymarket stream` — real-time WebSocket streams.
 *
 * market: public orderbook/price/trade stream by asset IDs
 * user: authenticated order/trade events
 */

import { Command } from "commander";
import { PolyMarketStream } from "../../tools/polymarket/clob/ws-market.js";
import { PolyUserStream } from "../../tools/polymarket/clob/ws-user.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeStdout } from "../../utils/output.js";

export function createStreamMarketSubcommand(): Command {
  return new Command("stream-market")
    .description("Real-time market WebSocket (orderbook, prices, trades)")
    .argument("<assetIds...>", "One or more asset/token IDs to subscribe")
    .option("--level <n>", "Subscription level (1, 2, or 3)", "2")
    .option("--custom-features", "Enable best_bid_ask, new_market, market_resolved events")
    .option("--no-initial-dump", "Skip initial orderbook snapshot")
    .exitOverride()
    .action(async (assetIds: string[], options: { level: string; customFeatures?: boolean; initialDump?: boolean }) => {
      const jsonMode = isHeadless();
      const level = (Number(options.level) === 1 || Number(options.level) === 3) ? Number(options.level) as 1 | 3 : 2;

      const stream = new PolyMarketStream({
        assetIds,
        level,
        customFeatureEnabled: options.customFeatures ?? false,
        initialDump: options.initialDump !== false,
      });

      const cleanup = () => { stream.disconnect(); process.exit(0); };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      stream.on("connected", () => {
        if (!jsonMode) process.stderr.write(`Connected to Polymarket market stream (${assetIds.length} assets)\n`);
      });

      for (const eventType of ["book", "price_change", "last_trade_price", "tick_size_change", "best_bid_ask", "new_market", "market_resolved"]) {
        stream.on(eventType, (data: unknown) => {
          if (jsonMode) {
            writeStdout(JSON.stringify(data));
          } else {
            const obj = data as Record<string, unknown>;
            const assetId = typeof obj.asset_id === "string" ? obj.asset_id.slice(0, 12) + "..." : "";
            process.stderr.write(`[${eventType}] ${assetId}\n`);
          }
        });
      }

      stream.on("disconnected", (reason: string) => {
        if (!jsonMode) process.stderr.write(`[DISCONNECTED] ${reason} — reconnecting...\n`);
      });

      stream.on("error", (err: Error) => {
        if (!jsonMode) process.stderr.write(`[ERROR] ${err.message}\n`);
      });

      stream.connect();
      await new Promise<void>(() => {});
    });
}

export function createStreamUserSubcommand(): Command {
  return new Command("stream-user")
    .description("Real-time authenticated user WebSocket (order/trade events)")
    .option("--markets <conditionIds...>", "Filter by market condition IDs")
    .exitOverride()
    .action(async (options: { markets?: string[] }) => {
      const jsonMode = isHeadless();

      const stream = new PolyUserStream({ markets: options.markets });

      const cleanup = () => { stream.disconnect(); process.exit(0); };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      stream.on("connected", () => {
        if (!jsonMode) process.stderr.write("Connected to Polymarket user stream\n");
      });

      for (const eventType of ["order", "trade"]) {
        stream.on(eventType, (data: unknown) => {
          if (jsonMode) {
            writeStdout(JSON.stringify(data));
          } else {
            const obj = data as Record<string, unknown>;
            const type = typeof obj.type === "string" ? obj.type : eventType;
            const side = typeof obj.side === "string" ? obj.side : "";
            const price = typeof obj.price === "string" ? obj.price : "";
            process.stderr.write(`[${eventType}] ${type} ${side} @ ${price}\n`);
          }
        });
      }

      stream.on("disconnected", (reason: string) => {
        if (!jsonMode) process.stderr.write(`[DISCONNECTED] ${reason} — reconnecting...\n`);
      });

      stream.on("error", (err: Error) => {
        if (!jsonMode) process.stderr.write(`[ERROR] ${err.message}\n`);
      });

      stream.connect();
      await new Promise<void>(() => {});
    });
}
