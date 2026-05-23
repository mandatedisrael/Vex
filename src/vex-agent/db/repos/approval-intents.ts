/**
 * Approval intents repo — policy-layer companion to `approval_queue`.
 *
 * Plan: agents_dm/plan-integration/05-approvals-wallet-policy.md §"Approval DB model".
 * Migration: `src/vex-agent/db/migrations/024_approval_intents.sql`.
 *
 * Puzzle 5 phase 2 (this commit) writes the snapshot columns at enqueue
 * time (`action_kind`, `risk_level`, `preview_json`, `policy_json`, plus
 * `mission_run_id`, `tool_call_id`). Phase 3 will populate `decision`,
 * `decision_reason`, `decided_at`, `execution_status`,
 * `execution_result_hash`, and use `idempotency_key` / `expires_at` for
 * the approve/reject runtime semantics.
 *
 * Transactional contract: `createWith(client, ...)` is the supported call
 * path; the enqueue site wraps `approval_queue` INSERT + this INSERT +
 * `mission_runs.updateStatus` in one `withTransaction` so a partial state
 * (queue without intent, or queue+intent without `paused_approval`) is
 * unrepresentable.
 */

import type { PoolClient } from "pg";
import type { ActionKind } from "../../tools/taxonomy.js";
import type { RiskLevel } from "../../tools/risk-level.js";
import { query, queryOne } from "../client.js";
import { jsonb } from "../params.js";

export type ApprovalDecision = "approved" | "rejected" | "rejected_stop";
export type ApprovalExecutionStatus = "not_started" | "dispatching" | "succeeded" | "failed";

export interface ApprovalIntent {
  approvalId: string;
  sessionId: string;
  missionRunId: string | null;
  toolCallId: string | null;
  actionKind: ActionKind;
  riskLevel: RiskLevel;
  previewJson: Record<string, unknown>;
  policyJson: Record<string, unknown>;
  expiresAt: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  decidedAt: string | null;
  decision: ApprovalDecision | null;
  decisionReason: string | null;
  executionStatus: ApprovalExecutionStatus;
  executionResultHash: string | null;
}

export interface CreateIntentInput {
  approvalId: string;
  sessionId: string;
  missionRunId: string | null;
  toolCallId: string | null;
  actionKind: ActionKind;
  riskLevel: RiskLevel;
  previewJson: Record<string, unknown>;
  policyJson: Record<string, unknown>;
  /** Phase 3 sets via approve. Phase 2 always passes null. */
  expiresAt?: string | null;
  /** Phase 3 sets via approve. Phase 2 always passes null. */
  idempotencyKey?: string | null;
}

const INSERT_INTENT_SQL = `INSERT INTO approval_intents (
  approval_id, session_id, mission_run_id, tool_call_id,
  action_kind, risk_level, preview_json, policy_json,
  expires_at, idempotency_key
) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`;

function toParams(input: CreateIntentInput): unknown[] {
  return [
    input.approvalId,
    input.sessionId,
    input.missionRunId,
    input.toolCallId,
    input.actionKind,
    input.riskLevel,
    jsonb(input.previewJson),
    jsonb(input.policyJson),
    input.expiresAt ?? null,
    input.idempotencyKey ?? null,
  ];
}

/**
 * Transactional INSERT — required for the puzzle-5 phase-2 enqueue site
 * (queue+intent+mission status updated together via `withTransaction`).
 * Caller is responsible for `BEGIN`/`COMMIT`; pass the `PoolClient`
 * yielded by `withTransaction(fn)`.
 */
export async function createWith(
  client: PoolClient,
  input: CreateIntentInput,
): Promise<void> {
  await client.query(INSERT_INTENT_SQL, toParams(input));
}

const SELECT_COLUMNS =
  "approval_id, session_id, mission_run_id, tool_call_id, " +
  "action_kind, risk_level, preview_json, policy_json, " +
  "expires_at, idempotency_key, created_at, decided_at, " +
  "decision, decision_reason, execution_status, execution_result_hash";

/**
 * `pg` returns `TIMESTAMPTZ` columns as `Date` objects (driver-side
 * parsing). The repo interface stores them as ISO-8601 strings so the
 * boundary (IPC DTO, JSONB equality, snapshot comparison) stays scalar.
 * Codex final review puzzle 5/2 — same pattern as the other repos.
 */
function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function mapRow(r: Record<string, unknown>): ApprovalIntent {
  return {
    approvalId: r.approval_id as string,
    sessionId: r.session_id as string,
    missionRunId: r.mission_run_id as string | null,
    toolCallId: r.tool_call_id as string | null,
    actionKind: r.action_kind as ActionKind,
    riskLevel: r.risk_level as RiskLevel,
    previewJson: (r.preview_json as Record<string, unknown>) ?? {},
    policyJson: (r.policy_json as Record<string, unknown>) ?? {},
    expiresAt: toIsoOrNull(r.expires_at as string | Date | null),
    idempotencyKey: r.idempotency_key as string | null,
    createdAt: toIso(r.created_at as string | Date),
    decidedAt: toIsoOrNull(r.decided_at as string | Date | null),
    decision: r.decision as ApprovalDecision | null,
    decisionReason: r.decision_reason as string | null,
    executionStatus: (r.execution_status as ApprovalExecutionStatus) ?? "not_started",
    executionResultHash: r.execution_result_hash as string | null,
  };
}

export async function getByApprovalId(approvalId: string): Promise<ApprovalIntent | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${SELECT_COLUMNS} FROM approval_intents WHERE approval_id = $1`,
    [approvalId],
  );
  return row ? mapRow(row) : null;
}

export async function getPendingForSession(sessionId: string): Promise<ApprovalIntent[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT i.${SELECT_COLUMNS.replace(/, /g, ", i.")}
       FROM approval_intents i
       JOIN approval_queue q ON q.id = i.approval_id
      WHERE i.session_id = $1 AND q.status = 'pending'
      ORDER BY i.created_at ASC`,
    [sessionId],
  );
  return rows.map(mapRow);
}
