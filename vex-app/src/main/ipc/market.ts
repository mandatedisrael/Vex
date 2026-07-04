/**
 * vex.market.* — read-only VEX market snapshot IPC surface (T1).
 *
 * The single handler returns main's in-memory snapshot cache (no network call);
 * the live poll + `EV.market.vex` broadcast are owned by the market service
 * (`../market/vex-market-service.ts`), started with the app lifecycle in
 * `index.ts`. Routes through `registerHandler` (sender validation + strict
 * empty input + output Zod validation + redacted Result) like every other
 * boundary handler.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  vexMarketSnapshotResultSchema,
  type VexMarketSnapshot,
} from "@shared/schemas/market.js";
import { getCurrentSnapshot } from "../market/snapshot-cache.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();

export function registerMarketHandlers(): Array<() => void> {
  return [
    registerHandler({
      channel: CH.market.getVexSnapshot,
      domain: "market",
      inputSchema: empty,
      outputSchema: vexMarketSnapshotResultSchema,
      handle: (): Promise<Result<VexMarketSnapshot | null>> =>
        Promise.resolve(ok(getCurrentSnapshot())),
    }),
  ];
}
