/**
 * Long-memory IPC handler — read-only sanitized list (memory-system S9
 * rewire). One channel: `longMemory.list` (`long-memory-db`).
 *
 * Deliberately NO mutation surface: the long-term memory lifecycle
 * (promotion, supersede, invalidation, archival, expiry) is owned by the
 * agent's memory manager — the renderer only inspects what the agent knows.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  longMemoryListInputSchema,
  longMemoryListResultSchema,
  type LongMemoryListResult,
} from "@shared/schemas/long-memory.js";
import { listLongMemory } from "../database/long-memory-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerListHandler(): () => void {
  return registerHandler({
    channel: CH.longMemory.list,
    domain: "memory",
    inputSchema: longMemoryListInputSchema,
    outputSchema: longMemoryListResultSchema,
    handle: async (input, ctx): Promise<Result<LongMemoryListResult>> => {
      const outcome = await listLongMemory(input);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:longMemory:list] ok count=${outcome.data.length} ` +
            `status=${input.status ?? "all"} correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:longMemory:list] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerLongMemoryHandlers(): ReadonlyArray<() => void> {
  return [registerListHandler()];
}
