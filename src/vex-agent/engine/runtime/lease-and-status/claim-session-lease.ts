/**
 * `claimSessionLease` — atomic per-session lease claim for chat-only
 * flow (no mission_run_id). Uses the same INSERT ... ON CONFLICT
 * primitive but inside its own single-statement transaction so two
 * rapid `chat.submit` IPC calls can't fork the turn loop.
 */

import { withTransaction, queryOneWith } from "../../../db/client.js";
import { acquireLease } from "../../../db/repos/runner-leases.js";
import type {
  ClaimSessionLeaseInput,
  ClaimSessionLeaseOutcome,
} from "./_types.js";
import { type RunnerLeaseRow, mapLease } from "./_row-shapes.js";

export async function claimSessionLease(
  input: ClaimSessionLeaseInput,
): Promise<ClaimSessionLeaseOutcome> {
  return withTransaction(async (client) => {
    // Lock existing lease (if any) first so we can return its
    // `expires_at` for `retryAfterMs` on busy.
    const existingLease = await queryOneWith<RunnerLeaseRow>(
      client,
      `SELECT session_id, mission_run_id, owner_id, process_kind,
              acquired_at, heartbeat_at, expires_at
         FROM runner_leases
        WHERE session_id = $1
        FOR UPDATE`,
      [input.sessionId],
    );
    if (
      existingLease !== null
      && existingLease.expires_at >= new Date()
      && existingLease.owner_id !== input.ownerId
    ) {
      return { outcome: "lease_busy", currentLease: mapLease(existingLease) };
    }

    const lease = await acquireLease(
      {
        sessionId: input.sessionId,
        ownerId: input.ownerId,
        processKind: input.processKind,
        ttlMs: input.ttlMs,
      },
      client,
    );
    if (lease === null) {
      throw new Error(
        "claimSessionLease: lease upsert returned null despite passing validation",
      );
    }
    return { outcome: "claimed", lease };
  });
}
