import { CH } from "../../shared/ipc/channels.js";
import {
  memoryStatsInputSchema,
  sessionMemoryListInputSchema,
} from "../../shared/schemas/memory.js";
import type {
  MemoryStatsInput,
  SessionMemoryListInput,
} from "../../shared/schemas/memory.js";
import type { MemoryBridge } from "../../shared/types/bridge/agent/memory.js";
import { invokeWithSchema } from "../_dispatch.js";

export const memory = {
  listSession(input: SessionMemoryListInput) {
    return invokeWithSchema(
      CH.memory.listSession,
      input,
      sessionMemoryListInputSchema,
    );
  },
  getStats(input: MemoryStatsInput) {
    return invokeWithSchema(CH.memory.getStats, input, memoryStatsInputSchema);
  },
} satisfies MemoryBridge;
