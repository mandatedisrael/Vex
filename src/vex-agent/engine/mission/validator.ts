/**
 * Mission validator — sole source of truth for draft completeness.
 *
 * Repo is pure CRUD. This module decides if a draft has all required
 * fields to transition from draft → ready. No DB access.
 *
 * Puzzle 04: completeness is now decoupled from acceptance. A draft is
 * `ready` once every required field has a non-empty value. Acceptance
 * (host-only `mission.acceptContract` → `missions.accepted_contract_hash`,
 * mig 023) is enforced by `startMission` as a separate gate, not by
 * draft validation. This lets the UI show the contract diff +
 * "Accept contract" button BEFORE acceptance is granted, instead of
 * pretending the draft is still incomplete.
 */

import type { Mission } from "@vex-agent/db/repos/missions.js";
import { MISSION_DRAFT_REQUIRED_FIELDS } from "../types.js";

// ── Field mapping: domain field → DB column accessor ────────────

type FieldAccessor = (m: Mission) => unknown;

const FIELD_ACCESSORS: Record<string, FieldAccessor> = {
  title: m => m.title,
  goal: m => m.goal,
  capitalSource: m => {
    const src = m.capitalSourceJson;
    return src && Object.keys(src).length > 0 ? src : null;
  },
  startingCapital: m => {
    const src = m.capitalSourceJson;
    return (src as Record<string, unknown>)?.amount ?? (src as Record<string, unknown>)?.startingCapital ?? null;
  },
  allowedWallets: m => m.allowedWallets.length > 0 ? m.allowedWallets : null,
  allowedChains: m => m.allowedChains.length > 0 ? m.allowedChains : null,
  allowedProtocols: m => m.allowedProtocols.length > 0 ? m.allowedProtocols : null,
  riskProfile: m => m.riskProfile,
  successCriteria: m => m.successCriteriaJson.length > 0 ? m.successCriteriaJson : null,
  stopConditions: m => m.stopConditionsJson.length > 0 ? m.stopConditionsJson : null,
};

// ── Public API ──────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

/**
 * Validate a mission's draft fields against required field set.
 * Returns which fields are missing (null, empty string, empty array).
 */
export function validateDraft(mission: Mission): ValidationResult {
  const missing = getMissingFields(mission);
  return { valid: missing.length === 0, missing };
}

/** Get list of required fields that are not yet populated. */
export function getMissingFields(mission: Mission): string[] {
  const missing: string[] = [];

  for (const field of MISSION_DRAFT_REQUIRED_FIELDS) {
    const accessor = FIELD_ACCESSORS[field];
    if (!accessor) {
      missing.push(field);
      continue;
    }

    const value = accessor(mission);
    if (value === null || value === undefined || value === "") {
      missing.push(field);
    }
  }

  return missing;
}

/** Whether the draft has all required fields for transition to ready. */
export function isReadyToStart(mission: Mission): boolean {
  return getMissingFields(mission).length === 0;
}
