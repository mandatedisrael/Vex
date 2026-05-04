/**
 * Failed mission recovery.
 *
 * A failed run is immutable audit history. Recovery creates a new run from the
 * failed run's frozen contract snapshot and links it through
 * `recovered_from_run_id`.
 */

import type { TurnResult } from "../../types.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import { requireMissionPromptContextFromSnapshot } from "../../mission/run-contract.js";

export async function recoverFailedMissionRun(sessionId: string): Promise<TurnResult> {
  const active = await missionRunsRepo.getActiveRunBySession(sessionId);
  if (active) {
    throw new Error(`Mission run ${active.id} is still active (${active.status}); stop or finish it before recovery.`);
  }

  const failed = await missionRunsRepo.getLatestFailedRunBySession(sessionId);
  if (!failed) {
    throw new Error("No failed mission run found for this session.");
  }

  // Validate before mutating mission/run state.
  requireMissionPromptContextFromSnapshot(failed.contractSnapshotJson);

  const mission = await missionsRepo.getMission(failed.missionId);
  if (!mission) {
    throw new Error(`Mission ${failed.missionId} not found for failed run ${failed.id}.`);
  }

  await missionsRepo.setStatus(mission.id, "running");
  await missionsRepo.setApprovedAt(mission.id);

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await missionRunsRepo.createRun(runId, mission.id, sessionId, failed.loopMode, {
    contractSnapshotJson: failed.contractSnapshotJson,
    recoveredFromRunId: failed.id,
  });

  await messagesRepo.addEngineMessage(
    sessionId,
    [
      "[Engine: mission_recovered — The operator requested recovery from a failed mission run.",
      "This is a new run using the failed run's frozen Mission Contract.",
      "The old failed run remains terminal audit history. Execute the recovered Mission Contract now.]",
    ].join(" "),
    {
      source: "engine",
      messageType: "mission_recovered",
      visibility: "internal",
      payload: {
        missionId: mission.id,
        recoveredRunId: runId,
        recoveredFromRunId: failed.id,
      },
    },
  );

  const { resumeMissionRun } = await import("./mission.js");
  return resumeMissionRun(runId);
}
