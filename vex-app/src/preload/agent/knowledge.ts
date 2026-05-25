import { CH } from "../../shared/ipc/channels.js";
import { knowledgeListInputSchema } from "../../shared/schemas/knowledge.js";
import type { KnowledgeListInput } from "../../shared/schemas/knowledge.js";
import type { KnowledgeBridge } from "../../shared/types/bridge/agent/knowledge.js";
import { invokeWithSchema } from "../_dispatch.js";

export const knowledge = {
  list(input: KnowledgeListInput) {
    return invokeWithSchema(CH.knowledge.list, input, knowledgeListInputSchema);
  },
} satisfies KnowledgeBridge;
