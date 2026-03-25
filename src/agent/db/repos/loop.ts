/**
 * Loop state repo — persists Echo Loop lifecycle in DB.
 *
 * Extended for phased loop: tracks current phase, loop session, cycle history.
 */

import { queryOne, query, execute } from "../client.js";
import type { LoopState, LoopPhase, LoopCycleRecord } from "../../types.js";

export async function getLoopState(): Promise<LoopState> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT active, mode, interval_ms, started_at, last_cycle_at, cycle_count,
            current_phase, phase_started_at, loop_session_id
     FROM loop_state WHERE id = 1`,
  );
  if (!row) {
    return {
      active: false, mode: "restricted", intervalMs: 300_000,
      startedAt: null, lastCycleAt: null, cycleCount: 0,
      currentPhase: "idle", phaseStartedAt: null, loopSessionId: null,
    };
  }
  return {
    active: row.active as boolean,
    mode: row.mode as LoopState["mode"],
    intervalMs: row.interval_ms as number,
    startedAt: row.started_at as string | null,
    lastCycleAt: row.last_cycle_at as string | null,
    cycleCount: row.cycle_count as number,
    currentPhase: (row.current_phase as LoopPhase) ?? "idle",
    phaseStartedAt: row.phase_started_at as string | null,
    loopSessionId: row.loop_session_id as string | null,
  };
}

export async function startLoop(mode: "full" | "restricted", intervalMs = 300_000): Promise<void> {
  await execute(
    "UPDATE loop_state SET active = TRUE, mode = $1, interval_ms = $2, started_at = NOW(), current_phase = 'idle' WHERE id = 1",
    [mode, intervalMs],
  );
}

export async function stopLoop(): Promise<void> {
  await execute("UPDATE loop_state SET active = FALSE, current_phase = 'idle', phase_started_at = NULL WHERE id = 1");
}

export async function setLoopSessionId(sessionId: string): Promise<void> {
  await execute("UPDATE loop_state SET loop_session_id = $1 WHERE id = 1", [sessionId]);
}

export async function updatePhase(phase: LoopPhase): Promise<void> {
  await execute(
    "UPDATE loop_state SET current_phase = $1, phase_started_at = NOW() WHERE id = 1",
    [phase],
  );
}

export async function recordCycle(): Promise<void> {
  await execute("UPDATE loop_state SET last_cycle_at = NOW(), cycle_count = cycle_count + 1 WHERE id = 1");
}

// ── Cycle history ────────────────────────────────────────────────────

export async function insertCycle(cycle: {
  cycleNumber: number;
  startedAt: Date;
  endedAt?: Date;
  phasesCompleted: LoopPhase[];
  outcome: string;
  decisions?: Record<string, unknown>;
  tokenCost?: number;
  errorMessage?: string;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO loop_cycles (cycle_number, started_at, ended_at, phases_completed, outcome, decisions, token_cost, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      cycle.cycleNumber,
      cycle.startedAt,
      cycle.endedAt ?? null,
      cycle.phasesCompleted,
      cycle.outcome,
      JSON.stringify(cycle.decisions ?? {}),
      cycle.tokenCost ?? 0,
      cycle.errorMessage ?? null,
    ],
  );
  return row?.id ?? 0;
}

export async function getRecentCycles(limit = 20): Promise<LoopCycleRecord[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM loop_cycles ORDER BY started_at DESC LIMIT $1",
    [limit],
  );
  return rows.map((row) => ({
    id: row.id as number,
    cycleNumber: row.cycle_number as number,
    startedAt: (row.started_at as Date).toISOString(),
    endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
    phasesCompleted: (row.phases_completed as LoopPhase[]) ?? [],
    outcome: row.outcome as LoopCycleRecord["outcome"],
    decisions: (typeof row.decisions === "string" ? JSON.parse(row.decisions) : row.decisions) as Record<string, unknown>,
    tokenCost: Number(row.token_cost ?? 0),
    errorMessage: row.error_message as string | null,
  }));
}
