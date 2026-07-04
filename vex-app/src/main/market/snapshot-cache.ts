/**
 * Single source of truth for the renderer-visible VEX market snapshot (T1).
 *
 * Mirrors `updates/statusCache.ts`: main owns the external polling; the
 * renderer only ever sees the sanitized `VexMarketSnapshot` cached here and
 * broadcast on `EV.market.vex`. `publishSnapshot` re-validates with the shared
 * schema (defense-in-depth) so a composition bug can never push an off-contract
 * / unredacted shape across the IPC boundary.
 */

import { EV } from "@shared/ipc/channels.js";
import {
  vexMarketSnapshotSchema,
  type VexMarketSnapshot,
} from "@shared/schemas/market.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { log } from "../logger/index.js";

let current: VexMarketSnapshot | null = null;

/** Last-known snapshot (what `market.getVexSnapshot` returns; no network). */
export function getCurrentSnapshot(): VexMarketSnapshot | null {
  return current;
}

/** Validate, cache, and broadcast a composed snapshot to all windows. */
export function publishSnapshot(next: VexMarketSnapshot): void {
  const parsed = vexMarketSnapshotSchema.safeParse(next);
  if (!parsed.success) {
    log.error(
      "[market] refused to publish invalid VexMarketSnapshot",
      parsed.error.format(),
    );
    return;
  }
  current = parsed.data;
  broadcastToAllWindows(EV.market.vex, parsed.data);
}

/** Test-only: reset the cache to empty. */
export function __resetSnapshotCacheForTests(): void {
  current = null;
}
