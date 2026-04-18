/**
 * knowledge_supersede handler — atomic "this entry replaces entry N".
 *
 * Separate file because the supersede flow has its own pre-validation shape
 * (previous_id, reason, change_summary, what_failed) and its own error taxonomy
 * (SupersedeError codes) distinct from `knowledge_write`. Keeping it out of
 * `knowledge.ts` also respects the 400-line file limit.
 *
 * Flow:
 *   1. Validate kind + required params.
 *   2. Compute content_hash.
 *   3. Load embedding config, embed(title, summary) — fail-loud on provider down.
 *   4. Call repo supersedeEntry() inside one transaction (predecessor lock,
 *      validations, insert successor, flip predecessor to superseded).
 *   5. Map SupersedeError codes to actionable tool failures.
 *
 * Fail-loud contract matches `knowledge_write`: no DB write happens if the
 * embedding provider is unavailable. Business rejections from supersedeEntry
 * surface their `code` + a helpful message so the agent can decide what to do
 * next (write a fresh entry, invalidate, skip).
 */

import { getPool } from "@echo-agent/db/client.js";
import {
  MaintenanceActiveError,
  withLeaseSharedLock,
} from "@echo-agent/db/repos/maintenance-lease.js";
import { supersedeEntry, SupersedeError } from "@echo-agent/db/repos/knowledge-lifecycle.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { computeContentHash } from "@echo-agent/knowledge/content-hash.js";
import { computeValidUntil, isValidKind } from "@echo-agent/knowledge/policy.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str, num, bool, ok, fail } from "../types.js";
import { readStringArray, readObject, readClampedNumber } from "./params.js";
import logger from "@utils/logger.js";

export async function handleKnowledgeSupersede(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  // ── Param validation ──────────────────────────────────────────
  const previousId = num(params, "previous_id");
  const kind = str(params, "kind");
  const title = str(params, "title");
  const summary = str(params, "summary");
  const reason = str(params, "reason");

  if (previousId === undefined || !kind || !title || !summary || !reason) {
    return fail(
      "Missing required fields: previous_id, kind, title, summary, reason",
    );
  }
  if (!Number.isFinite(previousId) || previousId <= 0) {
    return fail(`Invalid previous_id: ${previousId}`);
  }
  if (!isValidKind(kind)) {
    return fail(
      `Invalid kind "${kind}". Must be snake_case ASCII (a-z, 0-9, _), start with a letter, max 64 chars.`,
    );
  }

  const contentMd = str(params, "content_md") || summary;
  const tags = readStringArray(params, "tags");
  const sourceRefs = readObject(params, "source_refs");
  const confidence = readClampedNumber(params, "confidence", 0, 1);
  const pinned = bool(params, "pinned");
  const ttlHours = num(params, "ttl_hours");

  // Optional narrative fields for the successor row.
  const rawChange = str(params, "change_summary");
  const changeSummary = rawChange.length > 0 ? rawChange : null;
  const rawFailed = str(params, "what_failed");
  const whatFailed = rawFailed.length > 0 ? rawFailed : null;

  const validUntil = computeValidUntil(ttlHours, pinned, new Date());
  const contentHash = computeContentHash({ kind, title, summary, contentMd });

  // ── Embed (fail-loud, NO DB write on provider outage) ─────────
  let config;
  try {
    config = loadEmbeddingConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.supersede.config_failed", { error: msg });
    return fail(`embedding config invalid: ${msg}`);
  }

  let embedding: number[];
  let providerModel: string;
  try {
    const result = await embedDocument(title, summary, config);
    embedding = result.embedding;
    providerModel = result.providerModel;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.supersede.embedding_failed", { error: msg });
    return fail(`embedding service unavailable: ${msg}`);
  }

  // ── Transaction ───────────────────────────────────────────────
  //
  // Both the supersede validations (predecessor SELECT FOR UPDATE + business
  // checks) and the write (successor INSERT + predecessor UPDATE) run inside
  // the maintenance-lease SHARE lock. `withLeaseSharedLock` opens the tx,
  // grabs the SHARE lock on `maintenance_leases(id=1)`, then runs the
  // supersede statements against the same tx. Reembed's FOR UPDATE on the
  // same row blocks behind our SHARE lock, so the lineage flip and the gate
  // flip cannot interleave.
  try {
    const { successor, predecessor } = await withLeaseSharedLock(getPool(), (tx) =>
      supersedeEntry(
        {
          previousId,
          kind,
          title,
          summary,
          contentMd,
          tags,
          sourceRefs,
          confidence,
          pinned,
          validUntil,
          contentHash,
          embeddingModel: providerModel,
          embeddingDim: embedding.length,
          embedding,
          sourceSurface: context.sourceSurface,
          sourceSession: context.sourceSession,
          reason,
          changeSummary,
          whatFailed,
        },
        tx,
      ),
    );

    logger.info("knowledge.supersede.ok", {
      predecessorId: predecessor.id,
      successorId: successor.id,
      kind: successor.kind,
    });

    return ok({
      id: successor.id,
      kind: successor.kind,
      supersedesId: predecessor.id,
      predecessorStatus: predecessor.status,
      validUntil: successor.validUntil,
      pinned: successor.pinned,
      embedded: true,
    });
  } catch (err) {
    if (err instanceof SupersedeError) {
      logger.info("knowledge.supersede.rejected", {
        code: err.code,
        predecessorId: err.predecessorId,
        details: err.details,
      });
      return fail(`knowledge_supersede rejected (${err.code}): ${err.message}`);
    }
    if (err instanceof MaintenanceActiveError) {
      logger.warn("knowledge.supersede.maintenance_active", { ownerId: err.ownerId });
      return fail(
        `knowledge_supersede blocked — maintenance active (reembed running, owner "${err.ownerId}"). Retry after the operator finishes.`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge.supersede.failed", { error: msg });
    return fail(`knowledge_supersede failed: ${msg}`);
  }
}

