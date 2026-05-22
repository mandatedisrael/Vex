/**
 * Mission setup — guided conversation handler for drafting missions.
 *
 * Flow:
 * 1. Load or create mission draft
 * 2. Parse model response into patch (safe boundary)
 * 3. Convert domain → row, update DB
 * 4. Validate draft → report missing fields
 * 5. If valid → set status ready
 */

import type { MissionDraft } from "../types.js";
import { extractMissionPatch, sanitizePatch } from "./patch-parser.js";
import { domainToRow, missionToDraft } from "./mapper.js";
import { validateDraft } from "./validator.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import type { Mission } from "@vex-agent/db/repos/missions.js";

export interface SetupResult {
  missionId: string;
  status: string;
  currentDraft: Partial<MissionDraft>;
  missingFields: string[];
  ready: boolean;
}

const START_SUGGESTION_PATTERN =
  /(?:\/mission\s+(?:start|continue)|ready\s+to\s+start|mission\s+is\s+ready|all\s+required\s+fields|ready\s*=\s*true)/i;

export function textSuggestsMissionStart(text: string | null): boolean {
  if (!text) return false;
  return START_SUGGESTION_PATTERN.test(text);
}

export function formatMissingMissionFields(missingFields: readonly string[]): string {
  return missingFields.length > 0 ? missingFields.join(", ") : "none reported";
}

export function formatMissionDraftNotReadyNotice(setup: SetupResult): string {
  return [
    "Mission draft is not ready in the database.",
    `DB status: ${setup.status}. Missing fields: ${formatMissingMissionFields(setup.missingFields)}.`,
    "The model must save the complete draft with mission_draft_update before suggesting /mission start.",
  ].join(" ");
}

/**
 * Create a new mission draft for a session.
 */
export async function createMissionDraft(sessionId: string): Promise<SetupResult> {
  const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await missionsRepo.createDraft(missionId, sessionId);

  return {
    missionId,
    status: "draft",
    currentDraft: {},
    missingFields: [
      "title", "goal", "capitalSource", "startingCapital",
      "allowedWallets", "allowedChains", "allowedProtocols",
      "riskProfile", "successCriteria", "stopConditions",
    ],
    ready: false,
  };
}

/**
 * Apply a model-produced patch to an existing mission draft.
 *
 * Safe pipeline: extractMissionPatch(unknown) → sanitizePatch()
 * → Partial<MissionDraft> → domainToRow() → repo.updateDraft()
 */
export async function applyMissionPatch(
  missionId: string,
  rawModelOutput: unknown,
): Promise<SetupResult> {
  // Load current mission
  const mission = await missionsRepo.getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found`);

  // Parse + sanitize (safe boundary).
  // Puzzle 04: model can no longer set `stopConditionsAccepted` — patch
  // parser drops it. Acceptance is host-only via `mission.acceptContract`
  // and lives on `missions.accepted_contract_hash` (mig 023).
  const extracted = extractMissionPatch(rawModelOutput);
  if (extracted) {
    const sanitized = sanitizePatch(extracted);
    if (Object.keys(sanitized).length > 0) {
      const rowPatch = domainToRow(sanitized);

      // Merge capital_source_json with existing to avoid losing fields on partial update
      if (rowPatch.capital_source_json && mission.capitalSourceJson) {
        rowPatch.capital_source_json = { ...mission.capitalSourceJson, ...rowPatch.capital_source_json };
      }
      if (rowPatch.constraints_json && mission.constraintsJson) {
        rowPatch.constraints_json = { ...mission.constraintsJson, ...rowPatch.constraints_json };
      }

      await missionsRepo.updateDraft(missionId, rowPatch);
    }
  }

  // Re-load after update
  const updated = await missionsRepo.getMission(missionId);
  if (!updated) throw new Error(`Mission ${missionId} disappeared after update`);

  // Validate
  const validation = validateDraft(updated);

  // Keep status aligned with validation. Edits can clear a previously-ready
  // field, so a ready draft must fall back to draft until complete again.
  let status = updated.status;
  if (validation.valid && updated.status === "draft") {
    await missionsRepo.setStatus(missionId, "ready");
    status = "ready";
  } else if (!validation.valid && updated.status === "ready") {
    await missionsRepo.setStatus(missionId, "draft");
    status = "draft";
  }

  const currentDraft = missionToDraft(updated);

  return {
    missionId,
    status,
    currentDraft,
    missingFields: validation.missing,
    ready: validation.valid,
  };
}

/**
 * Get current setup state for a mission.
 */
export async function getMissionSetupState(missionId: string): Promise<SetupResult | null> {
  const mission = await missionsRepo.getMission(missionId);
  if (!mission) return null;

  const validation = validateDraft(mission);
  const currentDraft = missionToDraft(mission);

  return {
    missionId,
    status: mission.status,
    currentDraft,
    missingFields: validation.missing,
    ready: validation.valid,
  };
}
