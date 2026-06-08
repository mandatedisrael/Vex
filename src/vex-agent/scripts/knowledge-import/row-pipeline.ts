/**
 * knowledge-import — per-row pipeline.
 *
 * Processes a single JSONL row: audit/lifecycle validation → recompute
 * content_hash → dedup via findByContentHash → resolve predecessor FK →
 * embed → insertEntry (under maintenance-lease SHARE lock).
 *
 * The INSERT runs under `withLeaseSharedLock` so the importer honours the
 * same authoritative write-gate as `knowledge_write` and promotion. A
 * concurrent reembed flips `maintenance_leases.active = TRUE`, which makes
 * this call fail fast with `MaintenanceActiveError` — the orchestrator
 * distinguishes that case in its log for operator clarity. Lookup/lineage
 * reads (`findByContentHash`) stay outside the lease: they are pure reads
 * and blocking them would add latency for no correctness benefit.
 *
 * Throws on validation or downstream failure. The orchestrator catches and
 * increments report.failed; returning "skipped_duplicate" or "inserted" is
 * the success surface.
 *
 * `processRow` is stateless and does not touch the report or the logger —
 * those concerns live in the orchestrator so this function stays a pure
 * async transformation.
 */

import { getPool } from "@vex-agent/db/client.js";
import { findByContentHash, insertEntry } from "@vex-agent/db/repos/knowledge.js";
import { withLeaseSharedLock } from "@vex-agent/db/repos/maintenance-lease.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import type { EmbeddingConfig } from "@vex-agent/embeddings/config.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import {
  type ImportedRow,
  isStringArray,
  requireOptionalStringOrNull,
  requireValidActivationStrengthOrUndefined,
  requireValidDateOrUndefined,
  requireValidDecayPolicyOrUndefined,
  requireValidHashOrNull,
  requireValidInfluenceScopeOrUndefined,
  requireValidMaturityStateOrUndefined,
  requireValidOutcomeVersionOrUndefined,
  requireValidRegimeTagsOrUndefined,
  requireValidSourceOrUndefined,
  requireValidSourceSurfaceOrUndefined,
  requireValidStatusOrUndefined,
  requireValidValidUntil,
} from "./validators.js";

export type RowOutcome = "inserted" | "skipped_duplicate";

export async function processRow(
  row: ImportedRow,
  lineNumber: number,
  config: EmbeddingConfig,
): Promise<RowOutcome> {
  // Validate audit fields BEFORE any expensive work. Throws are surfaced up
  // the stack — silent coercion would falsify history exactly where the
  // importer should be most strict.
  const status = requireValidStatusOrUndefined(row.status, lineNumber);
  const validFrom = requireValidDateOrUndefined(row.valid_from, "valid_from", lineNumber);
  const validUntil = requireValidValidUntil(row.valid_until, lineNumber);
  const createdAt = requireValidDateOrUndefined(row.created_at, "created_at", lineNumber);
  const updatedAt = requireValidDateOrUndefined(row.updated_at, "updated_at", lineNumber);

  // v2 lifecycle fields — validated even on v1 manifests (defensive: if a
  // v1 backup accidentally carries them, catch format errors). When absent
  // they map to null and the DB defaults (or NULL) apply.
  const statusReason = requireOptionalStringOrNull(row.status_reason, "status_reason", lineNumber);
  const changeSummary = requireOptionalStringOrNull(row.change_summary, "change_summary", lineNumber);
  const whatFailed = requireOptionalStringOrNull(row.what_failed, "what_failed", lineNumber);
  const supersedesContentHash = requireValidHashOrNull(
    row.supersedes_content_hash,
    "supersedes_content_hash",
    lineNumber,
  );

  // v2 provenance fields — optional on both v1 and v2. Missing maps to
  // insertEntry defaults ('vex_agent' / NULL). Present-but-bad rejects.
  const sourceSurface = requireValidSourceSurfaceOrUndefined(row.source_surface, lineNumber);
  const sourceSession = requireOptionalStringOrNull(row.source_session, "source_session", lineNumber);

  // v3 provenance classification + memory-v2 influence/bi-temporal fields.
  // Absent on v1/v2 backups → undefined → insertEntry defaults (source='observed',
  // established/1.0/advisory/none/[]/null/0), so legacy restore is byte-for-byte.
  // Present-but-bad rejects (FIX-2: dropped/garbled durable state must not be
  // silently re-defaulted).
  const source = requireValidSourceOrUndefined(row.source, lineNumber);
  const maturityState = requireValidMaturityStateOrUndefined(row.maturity_state, lineNumber);
  const activationStrength = requireValidActivationStrengthOrUndefined(
    row.activation_strength,
    lineNumber,
  );
  const influenceScope = requireValidInfluenceScopeOrUndefined(row.influence_scope, lineNumber);
  const decayPolicy = requireValidDecayPolicyOrUndefined(row.decay_policy, lineNumber);
  const regimeTags = requireValidRegimeTagsOrUndefined(row.regime_tags, lineNumber);
  const firstPromotedAt = requireValidDateOrUndefined(
    row.first_promoted_at,
    "first_promoted_at",
    lineNumber,
  );
  const lastReinforcedAt = requireValidDateOrUndefined(
    row.last_reinforced_at,
    "last_reinforced_at",
    lineNumber,
  );
  const nextReviewAt = requireValidDateOrUndefined(row.next_review_at, "next_review_at", lineNumber);
  const outcomeVersion = requireValidOutcomeVersionOrUndefined(row.outcome_version, lineNumber);

  // Recompute content_hash locally — never trust the file's hash. A
  // tampered/corrupted hash in the backup is therefore a no-op.
  const contentHash = computeContentHash({
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    contentMd: row.content_md,
  });

  // Short-circuit on content_hash BEFORE embedding. Re-importing a
  // healthy backup must not require a working provider — re-running on
  // the same backup is a no-op (zero embed calls).
  const existing = await findByContentHash(contentHash);
  if (existing) {
    return "skipped_duplicate";
  }

  // Resolve lineage FK: export carries predecessor's content_hash (stable
  // cross-DB), we map it back to a local id. Export order is id ASC so the
  // predecessor is guaranteed to already exist when we reach its successor.
  // Missing predecessor is fail-loud — silently NULLing the FK would lose
  // lineage for this successor and degrade the backup to v1 semantics.
  let supersedesId: number | null = null;
  if (supersedesContentHash !== null) {
    const predecessor = await findByContentHash(supersedesContentHash);
    if (!predecessor) {
      throw new Error(
        `supersedes_content_hash=${supersedesContentHash} does not resolve to any existing entry ` +
          `(expected predecessor to appear earlier in the export)`,
      );
    }
    supersedesId = predecessor.id;
  }

  const { embedding, providerModel } = await embedDocument(row.title, row.summary, config);

  // INSERT runs under the maintenance-lease SHARE lock so a concurrent
  // reembed (FOR UPDATE on the same singleton row) cannot flip the gate
  // mid-import. `MaintenanceActiveError` propagates up — the orchestrator
  // logs it under a dedicated event for operator clarity.
  const { inserted } = await withLeaseSharedLock(getPool(), (tx) =>
    insertEntry(
      {
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        contentMd: row.content_md,
        tags: isStringArray(row.tags) ? row.tags : [],
        sourceRefs:
          row.source_refs && typeof row.source_refs === "object" && !Array.isArray(row.source_refs)
            ? (row.source_refs as Record<string, unknown>)
            : {},
        confidence: typeof row.confidence === "number" ? row.confidence : null,
        pinned: row.pinned === true,
        validUntil,
        contentHash,
        // Honest provenance: stamp the model the provider actually reported
        // for THIS row, NOT the requested config.model.
        embeddingModel: providerModel,
        embeddingDim: embedding.length,
        embedding,
        // ── audit roundtrip
        status,
        validFrom,
        createdAt,
        updatedAt,
        // ── lifecycle roundtrip (v2). On v1 input these are all null.
        supersedesId,
        statusReason,
        changeSummary,
        whatFailed,
        // ── provenance roundtrip (v2). Undefined → insertEntry defaults apply
        // ('vex_agent' / NULL); explicit values preserve the original writer.
        sourceSurface,
        sourceSession: sourceSession ?? undefined,
        // ── v3 provenance classification + memory-v2 influence roundtrip.
        // Undefined → insertEntry defaults (observed / established / 1.0 /
        // advisory / none / [] / null / 0); explicit values preserve state.
        source,
        maturityState,
        activationStrength,
        influenceScope,
        decayPolicy,
        regimeTags,
        firstPromotedAt,
        lastReinforcedAt,
        nextReviewAt,
        outcomeVersion,
      },
      tx,
    ),
  );

  if (inserted) return "inserted";
  // Race condition: someone else wrote the same hash between our
  // findByContentHash check and the INSERT. CTE upsert caught it.
  return "skipped_duplicate";
}
