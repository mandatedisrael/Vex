/**
 * Supersede transaction statements — the actual SQL sequence run inside
 * an already-open transaction (owned either by `supersedeEntry`'s own
 * BEGIN/COMMIT path or by a caller that passed in a `PoolClient`, e.g.
 * `withLeaseSharedLock`).
 *
 * Sequence (under FOR UPDATE on the predecessor):
 *   1. Lock predecessor (serialises concurrent supersedes on same id).
 *   2. Validate: exists, status=active, no existing successor, content
 *      differs from predecessor, no collision with another row.
 *   3. INSERT successor with supersedes_id + change_summary + what_failed.
 *   4. UPDATE predecessor: status='superseded', status_reason=reason.
 *
 * ROLLBACK is handled by the outer caller.
 */

import pg, { type PoolClient } from "pg";

import { jsonb } from "../../params.js";
import { SupersedeError } from "./errors.js";
import {
  mapRowLocal,
  vectorLiteral,
  type KnowledgeRowShape,
  type SupersedeInput,
  type SupersedeResult,
} from "./types.js";

export async function runSupersedeStatements(
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
    //
    // Memory v2: the successor must be able to CARRY non-default influence /
    // bi-temporal lifecycle values. The memory_manager (later stage) supersedes
    // AND sets influence on the successor in one step, so omitting these columns
    // here would silently drop caller-supplied v2 fields to DB defaults — the
    // same data-loss class S1a fixed for insertEntry/export/import. We mirror
    // insertEntry's pattern: the 9 v2 columns are appended at the TAIL of the
    // column + param list, each defaulted in TS to the SAME value as its DB
    // column default, so callers that omit them produce successor rows identical
    // to the pre-v2 behaviour (byte-for-byte behaviour-neutral).
    const successorRes = await tx.query<KnowledgeRowShape>(
      `INSERT INTO knowledge_entries (
         kind, title, summary, content_md, tags, source_refs,
         confidence, status, pinned, valid_from, valid_until,
         content_hash, embedding_model, embedding_dim, embedding,
         source_surface, source_session,
         supersedes_id, status_reason, change_summary, what_failed,
         source,
         created_at, updated_at,
         maturity_state, activation_strength, influence_scope, decay_policy,
         regime_tags, first_promoted_at, last_reinforced_at, next_review_at,
         outcome_version
       )
       VALUES (
         $1, $2, $3, $4, $5, $6::jsonb,
         $7, 'active', $8, NOW(), $9,
         $10, $11, $12, $13::vector,
         COALESCE($14::text, 'vex_agent'), $15,
         $16, NULL, $17, $18,
         COALESCE($19::text, 'observed'),
         NOW(), NOW(),
         $20, $21, $22, $23,
         $24, $25::timestamptz, $26::timestamptz, $27::timestamptz,
         $28
       )
       RETURNING *`,
      [
        input.kind,
        input.title,
        input.summary,
        input.contentMd,
        input.tags,
        jsonb(input.sourceRefs),
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
        input.source ?? null,
        // ── Memory v2: default in TS to the SAME values as the DB column
        // defaults so callers that omit these are byte-for-byte behavior-neutral.
        // Appended at the TAIL — existing positional params ($1–$19) are unchanged.
        input.maturityState ?? "established",
        input.activationStrength ?? 1.0,
        input.influenceScope ?? "advisory",
        input.decayPolicy ?? "none",
        input.regimeTags ?? [],
        input.firstPromotedAt ? input.firstPromotedAt.toISOString() : null,
        input.lastReinforcedAt ? input.lastReinforcedAt.toISOString() : null,
        input.nextReviewAt ? input.nextReviewAt.toISOString() : null,
        input.outcomeVersion ?? 0,
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
