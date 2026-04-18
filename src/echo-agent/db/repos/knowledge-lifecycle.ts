/**
 * Knowledge lifecycle repo — transactional supersede for canonical agent memory.
 *
 * Split from `knowledge.ts` because the supersede path has its own atomicity
 * requirements (SELECT FOR UPDATE + INSERT + UPDATE in one COMMIT) and a distinct
 * error taxonomy (predecessor-not-active, duplicate-successor, identical-content).
 * Keeping it here avoids pushing the main repo file further past the 400-line limit.
 *
 * Contract (`supersedeEntry`):
 *   - Atomic: predecessor lock → validations → INSERT successor → UPDATE predecessor,
 *     all inside one BEGIN/COMMIT. A failure at any step rolls back; the DB never
 *     ends up with a successor row without its predecessor flipped to `superseded`
 *     (or vice versa).
 *   - Single-successor lineage: the partial unique index on `supersedes_id`
 *     enforces "at most one successor per predecessor". We surface a clean
 *     `SupersedeError` well before that constraint fires, via an in-transaction
 *     re-check under the FOR UPDATE lock.
 *   - Content identity check: the new content_hash MUST differ from the
 *     predecessor AND must not collide with any other existing row. If it does,
 *     we reject with `SupersedeError` — NOT a generic unique-violation trace.
 *
 * Errors use a discriminated `code` so callers (the handler) can map to good
 * LLM-facing messages without string-matching pg error text.
 */

import pg, { type PoolClient } from "pg";
import { getPool } from "../client.js";
import type { KnowledgeEntry, InsertEntryInput } from "./knowledge.js";
import type { KnowledgeStatus } from "@echo-agent/knowledge/policy.js";

// ── Errors ───────────────────────────────────────────────────────

export type SupersedeErrorCode =
  | "predecessor_not_found"
  | "predecessor_not_active"
  | "predecessor_already_superseded"
  | "identical_content"
  | "content_hash_collision";

export class SupersedeError extends Error {
  readonly code: SupersedeErrorCode;
  readonly predecessorId: number;
  readonly details: Record<string, unknown>;
  constructor(code: SupersedeErrorCode, predecessorId: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SupersedeError";
    this.code = code;
    this.predecessorId = predecessorId;
    this.details = details;
  }
}

// ── Types ────────────────────────────────────────────────────────

/**
 * Input shape mirrors `knowledge_write` params + lineage fields. We accept the
 * full `InsertEntryInput` for the successor (minus lifecycle fields, which this
 * function controls) and separate lineage/audit fields.
 */
export type SupersedeInput = Omit<
  InsertEntryInput,
  "supersedesId" | "statusReason" | "changeSummary" | "whatFailed" | "status"
> & {
  previousId: number;
  /** Short "why" for the supersede — stored on the predecessor's `status_reason`. */
  reason: string;
  /** Optional "what's new" narrative — stored on the successor's `change_summary`. */
  changeSummary?: string | null;
  /** Optional evidence that predecessor was wrong — stored on successor's `what_failed`. */
  whatFailed?: string | null;
};

export interface SupersedeResult {
  /** The new active successor entry. */
  successor: KnowledgeEntry;
  /** The predecessor entry, now flipped to status=superseded. */
  predecessor: KnowledgeEntry;
}

// ── Row helpers (local copy to avoid cyclic exports) ─────────────

interface KnowledgeRowShape {
  id: number;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[] | null;
  source_refs: Record<string, unknown> | null;
  confidence: number | null;
  status: string;
  pinned: boolean;
  valid_from: string;
  valid_until: string | null;
  content_hash: string;
  embedding_model: string;
  embedding_dim: number;
  source_surface: string;
  source_session: string | null;
  supersedes_id: number | null;
  status_reason: string | null;
  change_summary: string | null;
  what_failed: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowLocal(r: KnowledgeRowShape): KnowledgeEntry {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    tags: r.tags ?? [],
    sourceRefs: r.source_refs ?? {},
    confidence: r.confidence,
    status: r.status as KnowledgeStatus,
    pinned: r.pinned,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    contentHash: r.content_hash,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    sourceSurface: (r.source_surface as "echo_agent" | "mcp_local") ?? "echo_agent",
    sourceSession: r.source_session,
    supersedesId: r.supersedes_id,
    statusReason: r.status_reason,
    changeSummary: r.change_summary,
    whatFailed: r.what_failed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function vectorLiteral(v: readonly number[]): string {
  return "[" + v.join(",") + "]";
}

// ── Transaction ──────────────────────────────────────────────────

/**
 * Atomically replace an active predecessor with a new successor entry.
 *
 * Sequence inside BEGIN/COMMIT (own-tx path) OR inside the caller's tx
 * (external-tx path, PR4 Fase I.b+III — `withLeaseSharedLock` hands us a
 * `PoolClient` that already holds the maintenance-lease SHARE lock, and
 * we just layer the supersede logic on top without nesting transactions):
 *   1. SELECT predecessor FOR UPDATE → serializes concurrent supersedes on same id.
 *   2. Validate: exists, status=active, no existing successor, content differs,
 *      and no unrelated row has same content_hash.
 *   3. INSERT successor with supersedes_id + change_summary + what_failed.
 *   4. UPDATE predecessor: status='superseded', status_reason=reason.
 *   5. COMMIT (own-tx path only).
 *
 * ROLLBACK on any validation or DB error. Throws `SupersedeError` for business
 * rejections (stable `code`); rethrows unexpected pg errors as-is.
 *
 * When `client` is passed, we DO NOT issue BEGIN/COMMIT/ROLLBACK — the caller
 * owns the transaction boundary. We still emit `SupersedeError` on business
 * rejections; rolling back is the caller's responsibility in that mode.
 */
export async function supersedeEntry(
  input: SupersedeInput,
  client?: PoolClient,
): Promise<SupersedeResult> {
  if (input.embedding.length !== input.embeddingDim) {
    throw new Error(
      `supersedeEntry: embedding length ${input.embedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(content_hash=${input.contentHash}). The DB CHECK constraint would reject this.`,
    );
  }
  if (!Number.isFinite(input.previousId) || input.previousId <= 0) {
    throw new SupersedeError(
      "predecessor_not_found",
      input.previousId,
      `invalid previous_id: ${input.previousId}`,
    );
  }

  if (client) {
    // Caller owns the transaction (e.g. via `withLeaseSharedLock`). We run
    // the statements in-place; any throw propagates to the caller who is
    // responsible for the ROLLBACK.
    return runSupersedeStatements(client, input);
  }

  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    const result = await runSupersedeStatements(own, input);
    await own.query("COMMIT");
    return result;
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runSupersedeStatements(
  tx: PoolClient,
  input: SupersedeInput,
): Promise<SupersedeResult> {
  try {
    // 1. Lock the predecessor row. Concurrent supersedes on the same id block here.
    const predRes = await tx.query<KnowledgeRowShape>(
      "SELECT * FROM knowledge_entries WHERE id = $1 FOR UPDATE",
      [input.previousId],
    );
    const predRow = predRes.rows[0];
    if (!predRow) {
      throw new SupersedeError(
        "predecessor_not_found",
        input.previousId,
        `knowledge entry not found: ${input.previousId}`,
      );
    }
    if (predRow.status !== "active") {
      // Distinguish "already superseded" from "invalidated/archived" for a more
      // actionable error. If superseded, surface the successor id via reverse lookup.
      if (predRow.status === "superseded") {
        const succRes = await tx.query<{ id: number }>(
          "SELECT id FROM knowledge_entries WHERE supersedes_id = $1",
          [input.previousId],
        );
        const succId = succRes.rows[0]?.id ?? null;
        throw new SupersedeError(
          "predecessor_already_superseded",
          input.previousId,
          succId !== null
            ? `entry ${input.previousId} was already superseded by ${succId}`
            : `entry ${input.previousId} is already marked superseded`,
          { supersededBy: succId },
        );
      }
      throw new SupersedeError(
        "predecessor_not_active",
        input.previousId,
        `entry ${input.previousId} has status "${predRow.status}" — only active entries can be superseded`,
        { currentStatus: predRow.status },
      );
    }

    // 2a. Identical-content check against the predecessor.
    if (predRow.content_hash === input.contentHash) {
      throw new SupersedeError(
        "identical_content",
        input.previousId,
        `new content is identical to entry ${input.previousId} (content_hash match) — nothing to supersede`,
      );
    }

    // 2b. Collision check against any OTHER row. content_hash is UNIQUE globally;
    // if the "new" text already exists elsewhere we must not try to INSERT another.
    const collisionRes = await tx.query<{ id: number; status: string }>(
      "SELECT id, status FROM knowledge_entries WHERE content_hash = $1",
      [input.contentHash],
    );
    const collision = collisionRes.rows[0];
    if (collision) {
      throw new SupersedeError(
        "content_hash_collision",
        input.previousId,
        `new content is identical to existing knowledge entry ${collision.id} (status=${collision.status}) — this is not a superseding change`,
        { collidingId: collision.id, collidingStatus: collision.status },
      );
    }

    // 2c. Belt-and-braces: ensure the predecessor doesn't already have a successor.
    // The FOR UPDATE lock + "status=active" check should make this unreachable
    // in practice, but the partial unique index would fire later regardless —
    // surface it as a clean error instead of a pg constraint trace.
    const existingSuccRes = await tx.query<{ id: number }>(
      "SELECT id FROM knowledge_entries WHERE supersedes_id = $1",
      [input.previousId],
    );
    if (existingSuccRes.rows[0]) {
      throw new SupersedeError(
        "predecessor_already_superseded",
        input.previousId,
        `entry ${input.previousId} was already superseded by ${existingSuccRes.rows[0].id}`,
        { supersededBy: existingSuccRes.rows[0].id },
      );
    }

    // 3. INSERT successor.
    const successorRes = await tx.query<KnowledgeRowShape>(
      `INSERT INTO knowledge_entries (
         kind, title, summary, content_md, tags, source_refs,
         confidence, status, pinned, valid_from, valid_until,
         content_hash, embedding_model, embedding_dim, embedding,
         source_surface, source_session,
         supersedes_id, status_reason, change_summary, what_failed,
         created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, 'active', $8, NOW(), $9,
         $10, $11, $12, $13::vector,
         COALESCE($14::text, 'echo_agent'), $15,
         $16, NULL, $17, $18,
         NOW(), NOW()
       )
       RETURNING *`,
      [
        input.kind,
        input.title,
        input.summary,
        input.contentMd,
        input.tags,
        JSON.stringify(input.sourceRefs),
        input.confidence,
        input.pinned,
        input.validUntil ? input.validUntil.toISOString() : null,
        input.contentHash,
        input.embeddingModel,
        input.embeddingDim,
        vectorLiteral(input.embedding),
        input.sourceSurface ?? null,
        input.sourceSession ?? null,
        input.previousId,
        input.changeSummary ?? null,
        input.whatFailed ?? null,
      ],
    );
    const successorRow = successorRes.rows[0];
    if (!successorRow) throw new Error("supersedeEntry: INSERT returned no row");

    // 4. UPDATE predecessor.
    const predUpdateRes = await tx.query<KnowledgeRowShape>(
      `UPDATE knowledge_entries
       SET status = 'superseded',
           status_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [input.reason, input.previousId],
    );
    const updatedPredRow = predUpdateRes.rows[0];
    if (!updatedPredRow) throw new Error("supersedeEntry: predecessor UPDATE returned no row");

    return {
      successor: mapRowLocal(successorRow),
      predecessor: mapRowLocal(updatedPredRow),
    };
  } catch (err) {
    // Race-lost UNIQUE violations: discriminate by constraint name rather than
    // assuming every 23505 is the supersede lineage. knowledge_entries has two
    // UNIQUE indexes — idx_ke_supersedes_id (partial, enforces single-successor
    // lineage) and idx_ke_content_hash (global content identity). Our in-tx
    // pre-checks should handle both, but a concurrent writer can still slip in
    // between our SELECTs and the INSERT; surface the right error so the caller
    // doesn't get told "already superseded" when it's really a content collision.
    //
    // ROLLBACK is handled by the outer caller:
    //  - own-tx path: `supersedeEntry` catches our throw and rolls back.
    //  - external-tx path: the caller that passed `tx` in (e.g.
    //    `withLeaseSharedLock`) is responsible for the rollback.
    if (err instanceof pg.DatabaseError && err.code === "23505") {
      const constraint = err.constraint ?? "";
      if (constraint === "idx_ke_supersedes_id") {
        throw new SupersedeError(
          "predecessor_already_superseded",
          input.previousId,
          `entry ${input.previousId} was concurrently superseded by another writer`,
          { pgConstraint: constraint },
        );
      }
      if (constraint === "idx_ke_content_hash") {
        throw new SupersedeError(
          "content_hash_collision",
          input.previousId,
          `another writer concurrently inserted the same content (content_hash conflict)`,
          { pgConstraint: constraint },
        );
      }
      // Unknown UNIQUE violation — don't mask it behind a SupersedeError, the
      // caller can't act on a false diagnosis. Rethrow the original pg error.
    }
    throw err;
  }
}
