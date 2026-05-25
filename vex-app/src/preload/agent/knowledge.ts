import { CH } from "../../shared/ipc/channels.js";
import {
  knowledgeListInputSchema,
  knowledgeUpdateStatusInputSchema,
} from "../../shared/schemas/knowledge.js";
import type {
  KnowledgeListInput,
  KnowledgeUpdateStatusInput,
} from "../../shared/schemas/knowledge.js";
import type { KnowledgeBridge } from "../../shared/types/bridge/agent/knowledge.js";
import { invokeWithSchema } from "../_dispatch.js";

export const knowledge = {
  list(input: KnowledgeListInput) {
    return invokeWithSchema(CH.knowledge.list, input, knowledgeListInputSchema);
  },
  updateStatus(input: KnowledgeUpdateStatusInput) {
    return invokeWithSchema(
      CH.knowledge.updateStatus,
      input,
      knowledgeUpdateStatusInputSchema,
    );
  },
} satisfies KnowledgeBridge;
