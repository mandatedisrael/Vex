import { CH } from "../../shared/ipc/channels.js";
import {
  memoryInspectorJobsSummaryInputSchema,
  memoryInspectorListCandidatesInputSchema,
  memoryInspectorListDecisionsInputSchema,
} from "../../shared/schemas/memory-inspector.js";
import type {
  MemoryInspectorJobsSummaryInput,
  MemoryInspectorListCandidatesInput,
  MemoryInspectorListDecisionsInput,
} from "../../shared/schemas/memory-inspector.js";
import type { MemoryInspectorBridge } from "../../shared/types/bridge/agent/memory-inspector.js";
import { invokeWithSchema } from "../_dispatch.js";

export const memoryInspector = {
  listCandidates(input: MemoryInspectorListCandidatesInput) {
    return invokeWithSchema(
      CH.memoryInspector.listCandidates,
      input,
      memoryInspectorListCandidatesInputSchema,
    );
  },
  listDecisions(input: MemoryInspectorListDecisionsInput) {
    return invokeWithSchema(
      CH.memoryInspector.listDecisions,
      input,
      memoryInspectorListDecisionsInputSchema,
    );
  },
  jobsSummary(input: MemoryInspectorJobsSummaryInput) {
    return invokeWithSchema(
      CH.memoryInspector.jobsSummary,
      input,
      memoryInspectorJobsSummaryInputSchema,
    );
  },
} satisfies MemoryInspectorBridge;
