/**
 * Knowledge IPC handlers — read (stage 7-2a) + disable/archive mutation
 * (stage 7-2b).
 *
 * `list` is a read-only sanitized management list (`knowledge-db`).
 * `updateStatus` disables/archives an ACTIVE entry via the engine repo — the
 * one mutating knowledge channel. It is a USER action on the local store (no
 * agent approval-intent gate); the renderer confirms (destructive, one-way)
 * and main audits. The dynamic import + repo call are wrapped so an
 * import/DB failure maps to a redacted `internal.unexpected` (knowledge)
 * rather than surfacing as `internal.contract_violation`.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result, type VexError, type VexErrorCode } from "@shared/ipc/result.js";
import {
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  knowledgeUpdateStatusInputSchema,
  knowledgeUpdateStatusResultSchema,
  type KnowledgeListResult,
  type KnowledgeUpdateStatusResult,
} from "@shared/schemas/knowledge.js";
import { listKnowledge } from "../database/knowledge-db.js";
import { ensureEngineDbUrl } from "./runtime/_ensure-engine-db-url.js";
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

function knowledgeError(
  code: VexErrorCode,
  message: string,
  correlationId: string,
  opts: { readonly retryable: boolean; readonly userActionable: boolean },
): Result<never, VexError> {
  return err({
    code,
    domain: "knowledge",
    message,
    retryable: opts.retryable,
    userActionable: opts.userActionable,
    redacted: true,
    correlationId,
  });
}

function registerUpdateStatusHandler(): () => void {
  return registerHandler({
    channel: CH.knowledge.updateStatus,
    domain: "knowledge",
    inputSchema: knowledgeUpdateStatusInputSchema,
    outputSchema: knowledgeUpdateStatusResultSchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<KnowledgeUpdateStatusResult>> => {
      const dbUrl = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrl.ok) return dbUrl;
      try {
        const { updateStatus } = await import(
          "@vex-agent/db/repos/knowledge.js"
        );
        // `reason` is forwarded to the repo (honoring the validated field) but
        // kept OUT of the logs (free-text). `undefined` lets the repo leave any
        // previously-stored reason intact. The 7-2b UI does not capture one yet.
        const outcome = await updateStatus(
          input.id,
          input.status,
          input.reason ?? undefined,
        );
        if (outcome.ok) {
          log.info(
            `[ipc:vex:knowledge:updateStatus] ok id=${input.id} ` +
              `status=${input.status} correlationId=${ctx.requestId}`,
          );
          return ok({ id: input.id, status: input.status });
        }
        if (outcome.reason === "not_found") {
          log.info(
            `[ipc:vex:knowledge:updateStatus] not_found id=${input.id} ` +
              `correlationId=${ctx.requestId}`,
          );
          return knowledgeError(
            "knowledge.not_found",
            "That knowledge entry no longer exists.",
            ctx.requestId,
            { retryable: false, userActionable: true },
          );
        }
        log.info(
          `[ipc:vex:knowledge:updateStatus] not_active id=${input.id} ` +
            `correlationId=${ctx.requestId}`,
        );
        return knowledgeError(
          "knowledge.invalid_state",
          "That entry is no longer active and can't be changed.",
          ctx.requestId,
          { retryable: false, userActionable: true },
        );
      } catch (cause) {
        // Import/DB failure — redact + map to internal.unexpected so it never
        // surfaces as a contract violation through registerHandler.
        log.warn(
          `[ipc:vex:knowledge:updateStatus] failed id=${input.id} ` +
            `correlationId=${ctx.requestId}`,
          cause,
        );
        return knowledgeError(
          "internal.unexpected",
          "Unable to update knowledge. Verify services are running and retry.",
          ctx.requestId,
          { retryable: true, userActionable: true },
        );
      }
    },
  });
}

export function registerKnowledgeHandlers(): ReadonlyArray<() => void> {
  return [registerListHandler(), registerUpdateStatusHandler()];
}
