/**
 * Memory-inspector IPC handlers — read-only window into the memory manager's
 * pipeline (memory-system S10). Three channels: `memoryInspector.listCandidates`,
 * `memoryInspector.listDecisions`, `memoryInspector.jobsSummary`
 * (`memory-inspector-db`).
 *
 * Read-only by doctrine — the memory lifecycle (consolidation, promotion,
 * reject/expire, reconcile) is exclusively manager-owned (S9); there is NO
 * mutation surface here and none may ever be added to this namespace.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  memoryInspectorJobsSummaryInputSchema,
  memoryInspectorListCandidatesInputSchema,
  memoryInspectorListDecisionsInputSchema,
  memoryInspectorListCandidatesResultSchema,
  memoryInspectorListDecisionsResultSchema,
  memoryJobsSummaryDtoSchema,
  type MemoryInspectorListCandidatesResult,
  type MemoryInspectorListDecisionsResult,
  type MemoryJobsSummaryDto,
} from "@shared/schemas/memory-inspector.js";
import {
  getJobsSummary,
  listInspectorCandidates,
  listInspectorDecisions,
} from "../database/memory-inspector-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerListCandidatesHandler(): () => void {
  return registerHandler({
    channel: CH.memoryInspector.listCandidates,
    domain: "memory",
    inputSchema: memoryInspectorListCandidatesInputSchema,
    outputSchema: memoryInspectorListCandidatesResultSchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<MemoryInspectorListCandidatesResult>> => {
      const outcome = await listInspectorCandidates(input);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:memoryInspector:listCandidates] ok count=${outcome.data.length} ` +
            `status=${input.status ?? "all"} correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:memoryInspector:listCandidates] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerListDecisionsHandler(): () => void {
  return registerHandler({
    channel: CH.memoryInspector.listDecisions,
    domain: "memory",
    inputSchema: memoryInspectorListDecisionsInputSchema,
    outputSchema: memoryInspectorListDecisionsResultSchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<MemoryInspectorListDecisionsResult>> => {
      const outcome = await listInspectorDecisions(input);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:memoryInspector:listDecisions] ok count=${outcome.data.length} ` +
            `type=${input.decisionType ?? "all"} correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:memoryInspector:listDecisions] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerJobsSummaryHandler(): () => void {
  return registerHandler({
    channel: CH.memoryInspector.jobsSummary,
    domain: "memory",
    inputSchema: memoryInspectorJobsSummaryInputSchema,
    outputSchema: memoryJobsSummaryDtoSchema,
    handle: async (input, ctx): Promise<Result<MemoryJobsSummaryDto>> => {
      const outcome = await getJobsSummary(input);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:memoryInspector:jobsSummary] ok recent=${outcome.data.recentJobs.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:memoryInspector:jobsSummary] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerMemoryInspectorHandlers(): ReadonlyArray<() => void> {
  return [
    registerListCandidatesHandler(),
    registerListDecisionsHandler(),
    registerJobsSummaryHandler(),
  ];
}
