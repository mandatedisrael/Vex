/**
 * Per-call tool execution helpers — builds the `InternalToolContext` for a
 * single dispatched tool call inside the batch loop.
 *
 * Extracted verbatim from `turn-loop-tool-batch.ts`. The orchestrator owns
 * the dispatch loop and the per-batch mutable state; this module only owns
 * the deterministic construction of the dispatch context object.
 */

import type { EngineContext } from "../../types.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { buildSessionWalletResolution } from "../hydrate.js";
import type { computeBand } from "../context-band.js";

export function buildToolContext(
  context: EngineContext,
  dispatchBand: ReturnType<typeof computeBand>,
): InternalToolContext {
  const toolContext: InternalToolContext = {
    sessionId: context.sessionId,
    loadedDocuments: context.loadedDocuments,
    sessionPermission: context.sessionPermission,
    approved: false,
    missionRunId: context.missionRunId,
    missionId: context.missionId,
    sessionKind: context.sessionKind,
    // Agent-autonomy path — the plan-acceptance gate applies here (turn-start
    // snapshot from EngineContext; the gate's live read resolves acceptance).
    planMode: context.planMode ?? false,
    contextUsageBand: dispatchBand,
    sourceSurface: "vex_agent",
    sourceSession: context.sessionId,
    walletResolution: buildSessionWalletResolution(context),
    walletPolicy: context.walletPolicy,
  };

  return toolContext;
}
