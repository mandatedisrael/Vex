/**
 * knowledge_write handler — writes a new canonical memory entry.
 *
 * Short-circuits on content_hash BEFORE loading the embedding config or calling
 * the provider: repeat writes of the same fact are common (the agent
 * re-derives the same observation across sessions) — paying for an embed
 * round-trip just to discover a duplicate is wasted budget. The CTE upsert in
 * insertEntry is still a safety net for race conditions, but 99% of duplicates
 * land in the short-circuit.
 *
 * Fail-loud on provider outage: no DB write happens if embedDocument throws.
 *
 * All entries MUST be written in English regardless of conversation language —
 * see Knowledge Layer Rules in tool-usage.ts and registry tool descriptions.
 */

import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { computeContentHash } from "@echo-agent/knowledge/content-hash.js";
import { computeValidUntil, isValidKind } from "@echo-agent/knowledge/policy.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str, num, bool, ok, fail } from "../types.js";
import { readStringArray, readObject, readClampedNumber } from "./params.js";
import logger from "@utils/logger.js";

export async function handleKnowledgeWrite(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const kind = str(params, "kind");
  const title = str(params, "title");
  const summary = str(params, "summary");
  if (!kind || !title || !summary) {
    return fail("Missing required fields: kind, title, summary");
  }
  if (!isValidKind(kind)) {
    return fail(
      `Invalid kind "${kind}". Must be snake_case ASCII (a-z, 0-9, _), start with a letter, max 64 chars. Example: pumpfun_entry_pattern.`,
    );
  }

  const contentMd = str(params, "content_md") || summary;
  const tags = readStringArray(params, "tags");
  const sourceRefs = readObject(params, "source_refs");
  const confidence = readClampedNumber(params, "confidence", 0, 1);
  const pinned = bool(params, "pinned");
  const ttlHours = num(params, "ttl_hours");

  const validUntil = computeValidUntil(ttlHours, pinned, new Date());

  // Short-circuit on content_hash BEFORE loading the embedding config or
  // calling the provider. Repeat writes of the same fact are common (the
  // agent re-derives the same observation across sessions) — paying for an
  // embed round-trip just to discover a duplicate is wasted budget. The CTE
  // upsert in insertEntry is still a safety net for race conditions, but
  // 99% of duplicates land here.
  const contentHash = computeContentHash({ kind, title, summary, contentMd });
  try {
    const existing = await knowledgeRepo.findByContentHash(contentHash);
    if (existing) {
      logger.info("knowledge.write.duplicate_short_circuit", {
        id: existing.id,
        kind: existing.kind,
        contentHash,
      });
      return ok({
        id: existing.id,
        kind: existing.kind,
        validUntil: existing.validUntil,
        pinned: existing.pinned,
        embedded: true,
        duplicate: true,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge.write.lookup_failed", { error: msg });
    return fail(`knowledge_write failed: ${msg}`);
  }

  // Load config once per call. We use it for the embedDocument call AND to
  // stamp embeddingModel/embeddingDim authoritatively (no `?? "unknown"`,
  // no compile-time constant).
  let config;
  try {
    config = loadEmbeddingConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.write.config_failed", { error: msg });
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
    logger.warn("knowledge.write.embedding_failed", { error: msg });
    return fail(`embedding service unavailable: ${msg}`);
  }

  try {
    const { entry, inserted } = await knowledgeRepo.insertEntry({
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
      // Honest provenance: stamp the model the provider actually reported,
      // NOT the requested config.model. The audit column and the recall
      // filter both consume this — they must agree on the same source.
      embeddingModel: providerModel,
      embeddingDim: embedding.length,
      embedding,
      // Surface provenance: defaults to 'echo_agent' when context omits it
      // (legacy / scripts / tests). Production MCP server fills in 'mcp_local'
      // and its own session id via makeProductionContext.
      sourceSurface: context.sourceSurface,
      sourceSession: context.sourceSession,
    });
    if (!inserted) {
      logger.info("knowledge.write.duplicate", {
        id: entry.id,
        kind: entry.kind,
        contentHash,
      });
    }
    return ok({
      id: entry.id,
      kind: entry.kind,
      validUntil: entry.validUntil,
      pinned: entry.pinned,
      embedded: true,
      duplicate: !inserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge.write.insert_failed", { error: msg });
    return fail(`knowledge_write failed: ${msg}`);
  }
}
