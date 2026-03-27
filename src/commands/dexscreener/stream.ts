/**
 * `echoclaw dexscreener stream <type>` — Real-time DexScreener updates via WebSocket.
 *
 * JSON mode: each event as a JSON line on stdout.
 * UI mode: formatted summary on stderr.
 */

import { Command } from "commander";
import { DexScreenerStream } from "../../tools/dexscreener/ws-client.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeStdout } from "../../utils/output.js";
import type { DexStreamChannel } from "../../tools/dexscreener/types.js";

const VALID_CHANNELS = new Set<DexStreamChannel>(["profiles", "boosts", "boosts-top", "community-takeovers", "ads"]);

export function createStreamSubcommand(): Command {
  return new Command("stream")
    .description("Real-time WebSocket stream (profiles, boosts, boosts-top)")
    .argument("<type>", "Stream type: profiles, boosts, boosts-top, community-takeovers, ads")
    .option("--json", "Output JSON lines (default in headless mode)")
    .action(async (typeArg: string, options: { json?: boolean }) => {
      if (!VALID_CHANNELS.has(typeArg as DexStreamChannel)) {
        throw new EchoError(
          ErrorCodes.DEXSCREENER_API_ERROR,
          `Invalid stream type: "${typeArg}". Must be one of: profiles, boosts, boosts-top, community-takeovers, ads`,
        );
      }

      const channel = typeArg as DexStreamChannel;
      const jsonMode = options.json || isHeadless();

      const stream = new DexScreenerStream({ channel });

      // Graceful shutdown on Ctrl+C
      const cleanup = () => {
        stream.disconnect();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      stream.on("connected", () => {
        if (!jsonMode) {
          process.stderr.write(`Connected to DexScreener ${channel} stream\n`);
          process.stderr.write("Waiting for data...\n\n");
        }
      });

      stream.on("handshake", (data: unknown) => {
        if (jsonMode) {
          writeStdout(JSON.stringify({ event: "handshake", ...data as object }));
        } else {
          const obj = data as { limit?: number; data?: unknown[] };
          process.stderr.write(
            `[HANDSHAKE] Received initial snapshot: ${obj.data?.length ?? 0} items (limit: ${obj.limit ?? "?"})\n\n`,
          );
        }
      });

      stream.on("update", (data: unknown) => {
        if (jsonMode) {
          writeStdout(JSON.stringify({ event: "update", ...data as object }));
        } else {
          const obj = data as Record<string, unknown>;
          const chainId = obj.chainId ?? "?";
          const tokenAddress = typeof obj.tokenAddress === "string"
            ? obj.tokenAddress.slice(0, 12) + "..."
            : "?";
          process.stderr.write(`[UPDATE] ${chainId} ${tokenAddress}\n`);
        }
      });

      stream.on("disconnected", (reason: string) => {
        if (!jsonMode) {
          process.stderr.write(`\n[DISCONNECTED] ${reason} — reconnecting...\n`);
        }
      });

      stream.on("error", (err: Error) => {
        if (!jsonMode) {
          process.stderr.write(`[ERROR] ${err.message}\n`);
        }
      });

      stream.connect();

      // Keep process alive
      await new Promise<void>(() => {});
    });
}
