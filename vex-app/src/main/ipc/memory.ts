/**
 * Memory IPC handlers — read-only per-session memory list + stats
 * (agent integration stage 7-2a).
 *
 * Backed by `memory-db.ts` (sanitized; outstanding work as counts only). Both
 * handlers return a `null` result for an unknown/foreign/deleted session.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  memoryStatsInputSchema,
  memoryStatsResultSchema,
  sessionMemoryListInputSchema,
  sessionMemoryListResultSchema,
  type MemoryStatsResult,
  type SessionMemoryListResult,
} from "@shared/schemas/memory.js";
import { getMemoryStats, listSessionMemories } from "../database/memory-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerListSessionHandler(): () => void {
  return registerHandler({
    channel: CH.memory.listSession,
    domain: "memory",
    inputSchema: sessionMemoryListInputSchema,
    outputSchema: sessionMemoryListResultSchema,
    handle: async (input, ctx): Promise<Result<SessionMemoryListResult>> => {
      const outcome = await listSessionMemories(input.sessionId, input.limit);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:memory:listSession] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} count=${outcome.data?.length ?? 0} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:memory:listSession] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetStatsHandler(): () => void {
  return registerHandler({
    channel: CH.memory.getStats,
    domain: "memory",
    inputSchema: memoryStatsInputSchema,
    outputSchema: memoryStatsResultSchema,
    handle: async (input, ctx): Promise<Result<MemoryStatsResult>> => {
      const outcome = await getMemoryStats(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:memory:getStats] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:memory:getStats] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerMemoryHandlers(): ReadonlyArray<() => void> {
  return [registerListSessionHandler(), registerGetStatsHandler()];
}
