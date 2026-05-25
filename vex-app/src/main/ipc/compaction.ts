/**
 * Compaction IPC handlers — read-only Track-2 worker status.
 *
 * Backed by `compaction-db.ts`. A session with no compact jobs resolves to
 * `{ latest: null, activeCount: 0 }`; an unknown/foreign-scope session
 * resolves to `null` — never an error shape. The Track-2 executor itself is
 * owned by Electron main (`agent/compact-worker.ts`); this surface is read
 * only.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  compactionHistoryInputSchema,
  compactionHistoryResultSchema,
  compactionStatusInputSchema,
  compactionStatusResultSchema,
  type CompactionHistoryResult,
  type CompactionStatusResult,
} from "@shared/schemas/compaction.js";
import {
  getCompactionStatus,
  listCompactionHistory,
} from "../database/compaction-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerGetStatusHandler(): () => void {
  return registerHandler({
    channel: CH.compaction.getStatus,
    domain: "compaction",
    inputSchema: compactionStatusInputSchema,
    outputSchema: compactionStatusResultSchema,
    handle: async (input, ctx): Promise<Result<CompactionStatusResult>> => {
      const outcome = await getCompactionStatus(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:compaction:getStatus] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} ` +
            `active=${outcome.data?.activeCount ?? 0} ` +
            `latest=${outcome.data?.latest?.status ?? "none"} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:compaction:getStatus] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerListHistoryHandler(): () => void {
  return registerHandler({
    channel: CH.compaction.listHistory,
    domain: "compaction",
    inputSchema: compactionHistoryInputSchema,
    outputSchema: compactionHistoryResultSchema,
    handle: async (input, ctx): Promise<Result<CompactionHistoryResult>> => {
      const outcome = await listCompactionHistory(input.sessionId, input.limit);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:compaction:listHistory] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} count=${outcome.data?.length ?? 0} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:compaction:listHistory] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerCompactionHandlers(): ReadonlyArray<() => void> {
  return [registerGetStatusHandler(), registerListHistoryHandler()];
}
