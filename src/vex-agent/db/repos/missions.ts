/**
 * Missions repo — pure CRUD persistence for mission drafts and lifecycle.
 *
 * Zero validation logic — draft completeness lives in engine/mission/validator.ts.
 * This repo is the DB boundary: it writes MissionDraftRow (snake_case, JSONB)
 * and reads it back. Domain ↔ row conversion is mapper's responsibility.
 */

import { query, queryOne, execute } from "../client.js";
import { jsonb, jsonbPlaceholder } from "../params.js";

const MISSION_DRAFT_COLUMN_KINDS = {
  title: "scalar",
  goal: "scalar",
  constraints_json: "jsonb",
  success_criteria_json: "jsonb",
  stop_conditions_json: "jsonb",
  risk_profile: "scalar",
  capital_source_json: "jsonb",
  allowed_protocols: "scalar",
  allowed_chains: "scalar",
  allowed_wallets: "scalar",
} satisfies Record<keyof MissionDraftRow, "jsonb" | "scalar">;

// ── Row types (DB shape) ────────────────────────────────────────

export interface MissionRow {
  id: string;
  root_session_id: string;
  status: string;
  title: string | null;
  goal: string | null;
  constraints_json: Record<string, unknown>;
  success_criteria_json: string[];
  stop_conditions_json: string[];
  risk_profile: string | null;
  capital_source_json: Record<string, unknown>;
  allowed_protocols: string[];
  allowed_chains: string[];
  allowed_wallets: string[];
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  // Host-only acceptance metadata (mig 023). All four are either set
  // together (CHECK chk_missions_acceptance_atomicity) or all NULL.
  accepted_contract_hash: string | null;
  accepted_contract_at: string | null;
  accepted_contract_by: string | null;
  contract_hash_version: number | null;
  // Mission-level lineage for /mission-renew (mig 023).
  renewed_from_mission_id: string | null;
}

export interface Mission {
  id: string;
  rootSessionId: string;
  status: string;
  title: string | null;
  goal: string | null;
  constraintsJson: Record<string, unknown>;
  successCriteriaJson: string[];
  stopConditionsJson: string[];
  riskProfile: string | null;
  capitalSourceJson: Record<string, unknown>;
  allowedProtocols: string[];
  allowedChains: string[];
  allowedWallets: string[];
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  /** Host-set acceptance hash (mig 023). `null` = unaccepted draft. */
  acceptedContractHash: string | null;
  acceptedContractAt: string | null;
  acceptedContractBy: string | null;
  contractHashVersion: number | null;
  /** Mission-level lineage for /mission-renew (mig 023). */
  renewedFromMissionId: string | null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value as string;
}

function mapRow(r: Record<string, unknown>): Mission {
  return {
    id: r.id as string,
    rootSessionId: r.root_session_id as string,
    status: r.status as string,
    title: r.title as string | null,
    goal: r.goal as string | null,
    constraintsJson: (typeof r.constraints_json === "string" ? JSON.parse(r.constraints_json) : r.constraints_json ?? {}) as Record<string, unknown>,
    successCriteriaJson: (typeof r.success_criteria_json === "string" ? JSON.parse(r.success_criteria_json) : r.success_criteria_json ?? []) as string[],
    stopConditionsJson: (typeof r.stop_conditions_json === "string" ? JSON.parse(r.stop_conditions_json) : r.stop_conditions_json ?? []) as string[],
    riskProfile: r.risk_profile as string | null,
    capitalSourceJson: (typeof r.capital_source_json === "string" ? JSON.parse(r.capital_source_json) : r.capital_source_json ?? {}) as Record<string, unknown>,
    allowedProtocols: (r.allowed_protocols ?? []) as string[],
    allowedChains: (r.allowed_chains ?? []) as string[],
    allowedWallets: (r.allowed_wallets ?? []) as string[],
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at as string),
    updatedAt: (r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at as string),
    approvedAt: toIsoOrNull(r.approved_at),
    acceptedContractHash: (r.accepted_contract_hash ?? null) as string | null,
    acceptedContractAt: toIsoOrNull(r.accepted_contract_at),
    acceptedContractBy: (r.accepted_contract_by ?? null) as string | null,
    contractHashVersion: (r.contract_hash_version ?? null) as number | null,
    renewedFromMissionId: (r.renewed_from_mission_id ?? null) as string | null,
  };
}

// ── Partial row for updates (snake_case DB columns) ─────────────

export interface MissionDraftRow {
  title?: string | null;
  goal?: string | null;
  constraints_json?: Record<string, unknown>;
  success_criteria_json?: string[];
  stop_conditions_json?: string[];
  risk_profile?: string | null;
  capital_source_json?: Record<string, unknown>;
  allowed_protocols?: string[];
  allowed_chains?: string[];
  allowed_wallets?: string[];
}

// ── CRUD ────────────────────────────────────────────────────────

export async function createDraft(id: string, rootSessionId: string): Promise<void> {
  await execute(
    "INSERT INTO missions (id, root_session_id, status) VALUES ($1, $2, 'draft')",
    [id, rootSessionId],
  );
}

export async function updateDraft(id: string, fields: MissionDraftRow): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const columnKind = MISSION_DRAFT_COLUMN_KINDS[key as keyof MissionDraftRow];
    if (!columnKind) continue;
    const placeholder = columnKind === "jsonb" ? jsonbPlaceholder(idx) : `$${idx}`;
    const dbValue = columnKind === "jsonb" ? jsonb(value) : value;
    sets.push(`${key} = ${placeholder}`);
    params.push(dbValue);
    idx++;
  }

  if (sets.length === 0) return;

  sets.push(`updated_at = NOW()`);
  params.push(id);

  await execute(
    `UPDATE missions SET ${sets.join(", ")} WHERE id = $${idx}`,
    params,
  );
}

export async function setStatus(id: string, status: string): Promise<void> {
  await execute(
    "UPDATE missions SET status = $1, updated_at = NOW() WHERE id = $2",
    [status, id],
  );
}

export async function setApprovedAt(id: string): Promise<void> {
  await execute(
    "UPDATE missions SET approved_at = NOW(), updated_at = NOW() WHERE id = $1",
    [id],
  );
}

export async function clearApprovedAt(id: string): Promise<void> {
  await execute(
    "UPDATE missions SET approved_at = NULL, updated_at = NOW() WHERE id = $1",
    [id],
  );
}

export async function getMission(id: string): Promise<Mission | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM missions WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function getMissionBySession(rootSessionId: string): Promise<Mission | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM missions WHERE root_session_id = $1 ORDER BY created_at DESC LIMIT 1",
    [rootSessionId],
  );
  return row ? mapRow(row) : null;
}

export async function getActiveMission(rootSessionId: string): Promise<Mission | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM missions WHERE root_session_id = $1 AND status NOT IN ('completed', 'failed', 'cancelled') ORDER BY created_at DESC LIMIT 1",
    [rootSessionId],
  );
  return row ? mapRow(row) : null;
}
