/**
 * Knowledge IPC handlers — read-only management list of the global
 * `knowledge_entries` store (agent integration stage 7-2a).
 *
 * Backed by `knowledge-db.ts` (sanitized metadata; no content_md / source_refs
 * / embeddings). Disable/archive mutation lands in 7-2b.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  type KnowledgeListResult,
} from "@shared/schemas/knowledge.js";
import { listKnowledge } from "../database/knowledge-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerListHandler(): () => void {
  return registerHandler({
    channel: CH.knowledge.list,
    domain: "knowledge",
    inputSchema: knowledgeListInputSchema,
    outputSchema: knowledgeListResultSchema,
    handle: async (input, ctx): Promise<Result<KnowledgeListResult>> => {
      const outcome = await listKnowledge(input);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:knowledge:list] ok count=${outcome.data.length} ` +
            `status=${input.status ?? "all"} correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:knowledge:list] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerKnowledgeHandlers(): ReadonlyArray<() => void> {
  return [registerListHandler()];
}
