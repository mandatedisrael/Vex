/**
 * Maintenance lease — authoritative write-gate for knowledge_entries.
 *
 * Coordinates the long-running reembed script with every normal writer
 * (`insertEntry`, `supersedeEntry`, promotion inserts from PR4 Fase IV).
 *
 * The gate lives on a single row in `maintenance_leases` (see migration
 * `009_maintenance_leases.sql`). Two helpers share this module:
 *
 *   - `acquireReembedLease(client, ownerId)` / `releaseReembedLease(...)`:
 *     taken by the reembed script. `acquireReembedLease` runs a short tx
 *     that SELECTs `FOR UPDATE` on the lease row, fails loudly if an
 *     unrelated owner already holds it, and otherwise flips `active=TRUE`
 *     with the caller's `ownerId`.
 *   - `withLeaseSharedLock(pool, fn)`: taken by every writer. Opens its
 *     own tx, SELECTs `FOR SHARE` on the lease row, and fails with
 *     `MaintenanceActiveError` if `active=TRUE`. Otherwise runs `fn(tx)`
 *     inside the same tx so the actual writes (insertEntry,
 *     supersedeEntry, etc.) hold the SHARE lock for their whole duration.
 *     Reembed's later `FOR UPDATE` call queues behind the SHARE lock, so
 *     the writer's tx always completes before maintenance can flip the
 *     gate — closing the TOCTOU window without an advisory lock.
 *
 * The lease is intentionally minimal: no TTL, no force-release CLI, no
 * stale-owner heartbeats. Desktop scenario: operator runs reembed by
 * hand, and a crashed reembed that leaves `active=TRUE` is cleared with
 * one SQL statement (`UPDATE maintenance_leases SET active=FALSE WHERE
 * id=1`). Adding TTL + recovery tooling is deferred to v2 per plan v5.
 */

import type { Pool, PoolClient } from "pg";

import logger from "@utils/logger.js";

// ── Errors ──────────────────────────────────────────────────────────

export class MaintenanceActiveError extends Error {
  readonly code = "MAINTENANCE_ACTIVE" as const;
  readonly ownerId: string;
  constructor(ownerId: string) {
    super(
      `maintenance active — lease held by "${ownerId}". Retry after the operator finishes (or run "UPDATE maintenance_leases SET active = FALSE WHERE id = 1" if the lease is stale).`,
    );
    this.name = "MaintenanceActiveError";
    this.ownerId = ownerId;
  }
}

// ── Writer gate ─────────────────────────────────────────────────────

/**
 * Run `fn` inside a fresh transaction that holds the lease-row SHARE lock
 * for its whole duration. Throws {@link MaintenanceActiveError} fail-fast
 * if the lease is already held (reembed running). Otherwise runs `fn`
 * with a `PoolClient` that can be passed down to repo writers
 * (`insertEntry`, `supersedeEntry`) so they join the same tx.
 *
 * Rolls back on any error and releases the client in `finally`.
 */
export async function withLeaseSharedLock<T>(
  pool: Pool,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const res = await tx.query<{ owner_id: string; active: boolean }>(
      "SELECT owner_id, active FROM maintenance_leases WHERE id = 1 FOR SHARE",
    );
    const row = res.rows[0];
    if (!row) {
      // Migration 009 seeds the singleton, so this path should never fire.
      // If it does, the DB is in a bad state — fail loud rather than create
      // a false sense of safety by defaulting to "not active".
      throw new Error(
        "maintenance_leases singleton row missing — run migration 009 and seed the row before writing.",
      );
    }
    if (row.active) {
      await tx.query("ROLLBACK");
      throw new MaintenanceActiveError(row.owner_id);
    }
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await tx.query("ROLLBACK");
    } catch {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    }
    throw err;
  } finally {
    tx.release();
  }
}

// ── Reembed gate ────────────────────────────────────────────────────

/**
 * Acquire the lease for a maintenance operation (typically reembed).
 *
 * Must be called with a dedicated `pg.Client` (NOT a slot from the shared
 * pool — the reembed loop is long-running and would starve other
 * operations). The client owns the short acquire tx; the caller continues
 * using it for the main reembed work AFTER the acquire tx has committed.
 *
 * Semantics:
 *   - BEGIN → SELECT owner_id, active FROM ... WHERE id = 1 FOR UPDATE
 *   - If already active and `owner_id != us`: fail-fast loud, ROLLBACK,
 *     throw {@link MaintenanceActiveError}.
 *   - If already active BUT `owner_id == us`: idempotent — do not flip
 *     again, just commit and return. (Lets a resumed reembed re-enter
 *     without tripping on its own stale state.)
 *   - Otherwise UPDATE active=TRUE, owner_id=us, acquired_at=NOW() and
 *     COMMIT.
 *
 * On success, the operator MUST call `releaseReembedLease` in `finally`
 * so the row is cleared; if the process crashes, the lease persists and
 * the operator clears it manually (see migration comment).
 */
export async function acquireReembedLease(
  client: PoolClient,
  ownerId: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    const res = await client.query<{ owner_id: string; active: boolean }>(
      "SELECT owner_id, active FROM maintenance_leases WHERE id = 1 FOR UPDATE",
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error(
        "maintenance_leases singleton row missing — run migration 009 and seed the row.",
      );
    }
    if (row.active) {
      if (row.owner_id === ownerId) {
        // Already ours — idempotent re-entry, nothing to do.
        await client.query("COMMIT");
        logger.info("maintenance.lease.reentered", { ownerId });
        return;
      }
      await client.query("ROLLBACK");
      throw new MaintenanceActiveError(row.owner_id);
    }
    await client.query(
      "UPDATE maintenance_leases SET active = TRUE, owner_id = $1, acquired_at = NOW() WHERE id = 1",
      [ownerId],
    );
    await client.query("COMMIT");
    logger.info("maintenance.lease.acquired", { ownerId });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* non-actionable */
    }
    throw err;
  }
}

/**
 * Release the lease. Safe to call even when not held (no-op on inactive
 * state). Guarded on `owner_id` so a crashed-and-restarted operator does
 * not accidentally release someone else's active lease.
 */
export async function releaseReembedLease(
  client: PoolClient,
  ownerId: string,
): Promise<void> {
  try {
    const res = await client.query(
      "UPDATE maintenance_leases SET active = FALSE WHERE id = 1 AND owner_id = $1 AND active = TRUE",
      [ownerId],
    );
    if ((res.rowCount ?? 0) > 0) {
      logger.info("maintenance.lease.released", { ownerId });
    } else {
      logger.warn("maintenance.lease.release.noop", {
        ownerId,
        hint: "lease was not held by this owner or was already inactive",
      });
    }
  } catch (err) {
    logger.error("maintenance.lease.release.failed", {
      ownerId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Read the current lease state. Non-blocking — does not take any lock.
 * Intended for observability (UI / CLI status), NOT for gating writes
 * (use {@link withLeaseSharedLock} for that).
 */
export async function inspectLease(
  pool: Pool,
): Promise<{ ownerId: string; active: boolean; acquiredAt: string } | null> {
  const res = await pool.query<{
    owner_id: string;
    active: boolean;
    acquired_at: string;
  }>("SELECT owner_id, active, acquired_at FROM maintenance_leases WHERE id = 1");
  const row = res.rows[0];
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    active: row.active,
    acquiredAt: row.acquired_at,
  };
}
