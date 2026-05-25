import { CH } from "../../shared/ipc/channels.js";
import {
  compactionHistoryInputSchema,
  compactionStatusInputSchema,
} from "../../shared/schemas/compaction.js";
import type {
  CompactionHistoryInput,
  CompactionStatusInput,
} from "../../shared/schemas/compaction.js";
import type { CompactionBridge } from "../../shared/types/bridge/agent/compaction.js";
import { invokeWithSchema } from "../_dispatch.js";

export const compaction = {
  getStatus(input: CompactionStatusInput) {
    return invokeWithSchema(
      CH.compaction.getStatus,
      input,
      compactionStatusInputSchema,
    );
  },
  listHistory(input: CompactionHistoryInput) {
    return invokeWithSchema(
      CH.compaction.listHistory,
      input,
      compactionHistoryInputSchema,
    );
  },
} satisfies CompactionBridge;
