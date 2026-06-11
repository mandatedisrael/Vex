import { CH } from "../../shared/ipc/channels.js";
import { longMemoryListInputSchema } from "../../shared/schemas/long-memory.js";
import type { LongMemoryListInput } from "../../shared/schemas/long-memory.js";
import type { LongMemoryBridge } from "../../shared/types/bridge/agent/long-memory.js";
import { invokeWithSchema } from "../_dispatch.js";

export const longMemory = {
  list(input: LongMemoryListInput) {
    return invokeWithSchema(
      CH.longMemory.list,
      input,
      longMemoryListInputSchema,
    );
  },
} satisfies LongMemoryBridge;
