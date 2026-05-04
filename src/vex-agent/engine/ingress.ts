/**
 * Ingress router — the single entry point transport layers (MCP, CLI) call
 * when a user message arrives for a session.
 *
 * Responsibilities:
 *   1. Cancel any pending `loop_defer` wake for the session (user preempt).
 *   2. Re-check mission run / session state.
 *   3. Route the message to the right runtime:
 *        - `paused_wake` mission run → flip to `running` + save user msg +
 *          `resumeMissionRun` so the agent sees the preempt as the next user
 *          turn instead of a scheduled wake.
 *        - `running` / `paused_approval` mission run → persist the message
 *          as an interrupt; resume is driven by the approval flow, not here.
 *        - `full_autonomous` session without a mission run →
 *          `processFullAutonomousTurn`.
 *        - Everything else → `processChatTurn` (chat / mission-setup).
 */

import type { TurnResult } from "./types.js";
import {
  processChatTurn,
  processMissionSetupTurn,
  processFullAutonomousTurn,
  resumeMissionRun,
  resumeFullAutonomousSession,
} from "./core/runner.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as fullAutonomousRunsRepo from "@vex-agent/db/repos/full-autonomous-runs.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import {
  addOperatorCue,
  addOperatorInstruction,
} from "./core/operator-instructions.js";
import logger from "@utils/logger.js";

const QUEUED_INTERRUPT_TEXT =
  "Operator instruction queued for the active run. The model will read it at the next safe iteration boundary and continue.";

const PAUSED_ERROR_TEXT =
  "Run is paused due to a provider/runtime error. I saved your instruction; use /retry to re-attempt or /rewind to roll back.";

/**
 * Route an incoming user message to the correct runtime. Always cancels any
 * pending wake first so the freshly-typed user turn is not racing against a
 * banner injection for a stale wake.
 */
export async function routeUserMessage(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  const cancelled = await loopWakeRepo.cancelForSession(sessionId, "user_preempt");
  if (cancelled > 0) {
    logger.info("ingress.preempt_cancelled_wake", { sessionId, cancelled });
  }

  const activeRun = await missionRunsRepo.getActiveRunBySession(sessionId);

  if (activeRun) {
    if (activeRun.status === "paused_wake") {
      return resumeMissionRunWithPreempt(sessionId, userInput, activeRun.id);
    }
    if (activeRun.status === "paused_error") {
      // The run is parked because the previous loop threw. Persist the
      // user message so the operator's input is visible in transcript,
      // but return a clear hint instead of letting the shell render the
      // empty-fallback `(no text — stopReason: unknown)` string. The
      // operator drives recovery via /retry or /rewind.
      await addOperatorInstruction(sessionId, userInput, {
        target: "mission_run",
        runId: activeRun.id,
        runStatus: activeRun.status,
      });
      await addOperatorCue(sessionId);
      logger.info("ingress.paused_error_hint", { sessionId, runId: activeRun.id });
      return {
        text: PAUSED_ERROR_TEXT,
        toolCallsMade: 0,
        pendingApprovals: [],
        stopReason: null,
        missionStatus: "running",
      };
    }
    // `paused_approval` / `running` — persist the message as an interrupt
    // but do NOT fire a new turn here. Approvals resume through their own
    // flow (`approveAndResume`); a running run will pick up the message on
    // its next iteration.
    await addOperatorInstruction(sessionId, userInput, {
      target: "mission_run",
      runId: activeRun.id,
      runStatus: activeRun.status,
    });
    logger.info("ingress.user_interrupt_persisted", {
      sessionId,
      runId: activeRun.id,
      runStatus: activeRun.status,
    });
    return {
      text: QUEUED_INTERRUPT_TEXT,
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: "running",
    };
  }

  // No active run — route by session kind.
  const session = await sessionsRepo.getSession(sessionId);
  const kind = session?.kind ?? "chat";

  if (kind === "full_autonomous") {
    const activeFullAutonomous = await fullAutonomousRunsRepo.getActiveRunBySession(sessionId);
    if (activeFullAutonomous) {
      if (activeFullAutonomous.status === "paused_wake") {
        return resumeFullAutonomousWithPreempt(sessionId, userInput, activeFullAutonomous.id);
      }
      if (activeFullAutonomous.status === "paused_error") {
        await addOperatorInstruction(sessionId, userInput, {
          target: "full_autonomous",
          runId: activeFullAutonomous.id,
          runStatus: activeFullAutonomous.status,
        });
        await addOperatorCue(sessionId);
        return {
          text: PAUSED_ERROR_TEXT,
          toolCallsMade: 0,
          pendingApprovals: [],
          stopReason: null,
          missionStatus: null,
        };
      }
      await addOperatorInstruction(sessionId, userInput, {
        target: "full_autonomous",
        runId: activeFullAutonomous.id,
        runStatus: activeFullAutonomous.status,
      });
      logger.info("ingress.full_autonomous_interrupt_persisted", {
        sessionId,
        runId: activeFullAutonomous.id,
        runStatus: activeFullAutonomous.status,
      });
      return {
        text: QUEUED_INTERRUPT_TEXT,
        toolCallsMade: 0,
        pendingApprovals: [],
        stopReason: null,
        missionStatus: null,
      };
    }
    return processFullAutonomousTurn(sessionId, userInput);
  }

  // Chat or mission-setup. Mission-setup is distinguished by the presence of
  // a non-terminal mission without an active run (draft/ready).
  const mission = await missionsRepo.getActiveMission(sessionId);
  if (mission && mission.status !== "running") {
    return processMissionSetupTurn(sessionId, userInput);
  }

  return processChatTurn(sessionId, userInput);
}

export async function submitOperatorInstruction(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  return routeUserMessage(sessionId, userInput);
}

async function resumeMissionRunWithPreempt(
  sessionId: string,
  userInput: string,
  runId: string,
): Promise<TurnResult> {
  // Flip out of paused_wake BEFORE saving the user message so the wake
  // executor, if it races us into `claimDue`, sees the run is no longer
  // `paused_wake` in its own re-check and skips banner injection.
  const previous = await missionRunsRepo.casFlipToRunning(runId, ["paused_wake"]);
  if (previous === null) {
    logger.info("ingress.preempt_claim_lost", { sessionId, runId });
    await addOperatorInstruction(sessionId, userInput, {
      target: "mission_run",
      runId,
      runStatus: "claim_lost",
    });
    return {
      text: QUEUED_INTERRUPT_TEXT,
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: "running",
    };
  }

  await addOperatorInstruction(sessionId, userInput, {
    target: "mission_run",
    runId,
    preempt: "wake",
  });
  await addOperatorCue(sessionId);

  logger.info("ingress.preempt_resume", { sessionId, runId });
  // `resumeMissionRun` refreshes tool_output_blob TTLs internally (PR-13
  // S-2), so we don't double-call here. If that behaviour ever moves, the
  // ingress path still has the opportunity to refresh before entering the
  // runner — restore the call above.
  return resumeMissionRun(runId);
}

async function resumeFullAutonomousWithPreempt(
  sessionId: string,
  userInput: string,
  runId: string,
): Promise<TurnResult> {
  const previous = await fullAutonomousRunsRepo.casFlipToRunning(runId, ["paused_wake"]);
  if (previous === null) {
    logger.info("ingress.full_autonomous_preempt_claim_lost", { sessionId, runId });
    await addOperatorInstruction(sessionId, userInput, {
      target: "full_autonomous",
      runId,
      runStatus: "claim_lost",
    });
    return {
      text: QUEUED_INTERRUPT_TEXT,
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: null,
    };
  }

  await addOperatorInstruction(sessionId, userInput, {
    target: "full_autonomous",
    runId,
    preempt: "wake",
  });
  await addOperatorCue(sessionId);
  logger.info("ingress.full_autonomous_preempt_resume", { sessionId, runId });
  return resumeFullAutonomousSession(sessionId);
}
