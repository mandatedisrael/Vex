/**
 * episode → knowledge promotion pipeline (PR4 Fase IV, minimal v1).
 *
 * Elevates repeated session episodes into the canonical `knowledge_entries`
 * layer so they survive session deletion and cross-session recall. This is
 * the only path that translates session-language content into English
 * (knowledge layer stays English-only) — translation does NOT happen on
 * per-turn recall.
 *
 * Decision flow for each candidate:
 *
 *   1. Scope-local candidate check (`listPromotable`): kind in
 *      {decision, preference, lesson, fact}, has `source_end_message_id`,
 *      not already promoted.
 *   2. Cluster signal: require ≥ `PROMOTION_MIN_SIMILAR` OTHER episodes in
 *      the same scope + kind with cosine ≥ `PROMOTION_SIMILARITY_THRESHOLD`.
 *      A one-off assertion does not promote; a repeated observation does.
 *   3. Language gate (must-fix #1 of plan v4): read the source session's
 *      `memory_language_code`. No text heuristic — we only promote when the
 *      language contract is known:
 *        - `en` → insert as-is (skip translate).
 *        - known non-EN code → translate episode payload to English via
 *          `provider.chatCompletionSimple`; skip candidate on translate fail.
 *        - `null` / `und` → skip with `language_unknown` reason (we refuse
 *          to guess; knowledge layer must stay English-clean).
 *   4. INSERT through `withLeaseSharedLock` → `insertEntry` so promotion
 *      respects the maintenance lease. Three idempotency layers catch
 *      duplicates: `source_episode_id` UNIQUE + `source_episode_hash`
 *      UNIQUE + existing `content_hash` UNIQUE.
 *
 * Best-effort: errors never crash the caller (turn-loop). Skip reasons are
 * surfaced via `logger.warn` with structured fields so an operator can
 * count `language_unknown` / `translation_failed` / `not_enough_similar`
 * over time.
 */

import { createHash } from "node:crypto";
import pg from "pg";

import { getPool } from "@echo-agent/db/client.js";
import type { KnowledgeEntry } from "@echo-agent/db/repos/knowledge.js";
import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import {
  MaintenanceActiveError,
  withLeaseSharedLock,
} from "@echo-agent/db/repos/maintenance-lease.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import {
  countSimilar,
  listPromotable,
  type EpisodeKind,
  type PromotionCandidate,
} from "@echo-agent/db/repos/session-episodes.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import type {
  InferenceConfig,
  InferenceProvider,
} from "@echo-agent/inference/types.js";
import logger from "@utils/logger.js";

// ── Tunables ────────────────────────────────────────────────────────

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_MIN_SIMILAR = 2;
const DEFAULT_MAX_CANDIDATES = 20;
const PROMOTION_VERSION = 1;

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Public result shape ─────────────────────────────────────────────

export type PromotionOutcome =
  | { code: "inserted"; entry: KnowledgeEntry }
  | { code: "already_promoted"; reason: "source_episode_id" | "content_hash" | "source_episode_hash" }
  | {
      code: "skipped";
      reason:
        | "not_enough_similar"
        | "language_unknown"
        | "translation_failed"
        | "invariant_violated"
        | "embedding_unavailable";
    };

export interface PromotionRunReport {
  sessionId: string;
  scopeKey: string;
  considered: number;
  inserted: number;
  alreadyPromoted: number;
  skipped: Record<string, number>;
}

// ── Entry point ─────────────────────────────────────────────────────

/**
 * Run the promotion pipeline for a session. Intended to be called from
 * `turn-loop.ts` in an OUTER try/catch AFTER `executeCheckpoint` has
 * committed — never inside the checkpoint tx.
 */
export async function runPromotionForSession(
  sessionId: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<PromotionRunReport> {
  const session = await sessionsRepo.getSession(sessionId);
  const scopeKey = session?.memoryScopeKey ?? sessionId;
  const report: PromotionRunReport = {
    sessionId,
    scopeKey,
    considered: 0,
    inserted: 0,
    alreadyPromoted: 0,
    skipped: {},
  };

  const candidates = await listPromotable(
    scopeKey,
    envNumber("PROMOTION_MAX_CANDIDATES", DEFAULT_MAX_CANDIDATES),
  );
  report.considered = candidates.length;
  if (candidates.length === 0) {
    logger.info("promotion.run.no_candidates", { sessionId, scopeKey });
    return report;
  }

  for (const candidate of candidates) {
    const outcome = await promoteEpisode(candidate, provider, config);
    switch (outcome.code) {
      case "inserted":
        report.inserted++;
        logger.info("promotion.promoted", {
          sessionId,
          scopeKey,
          episodeId: candidate.id,
          episodeKind: candidate.episodeKind,
          knowledgeEntryId: outcome.entry.id,
        });
        break;
      case "already_promoted":
        report.alreadyPromoted++;
        logger.info("promotion.already_promoted", {
          sessionId,
          scopeKey,
          episodeId: candidate.id,
          reason: outcome.reason,
        });
        break;
      case "skipped": {
        const count = report.skipped[outcome.reason] ?? 0;
        report.skipped[outcome.reason] = count + 1;
        logger.warn("promotion.skipped", {
          sessionId,
          scopeKey,
          episodeId: candidate.id,
          reason: outcome.reason,
        });
        break;
      }
    }
  }

  logger.info("promotion.run.completed", report);
  return report;
}

// ── Core promotion logic ────────────────────────────────────────────

async function promoteEpisode(
  candidate: PromotionCandidate,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<PromotionOutcome> {
  // Invariant: listPromotable already filters on source_end_message_id; this
  // is a belt-and-braces check for callers that might skip the helper later.
  if (candidate.sourceEndMessageId === null) {
    return { code: "skipped", reason: "invariant_violated" };
  }

  // Cluster signal — promote only when the same kind recurs in the scope.
  const threshold = envNumber(
    "PROMOTION_SIMILARITY_THRESHOLD",
    DEFAULT_SIMILARITY_THRESHOLD,
  );
  const minSimilar = envNumber("PROMOTION_MIN_SIMILAR", DEFAULT_MIN_SIMILAR);
  const similar = await countSimilar(
    candidate.id,
    candidate.memoryScopeKey,
    candidate.episodeKind,
    candidate.embedding,
    candidate.embeddingModel,
    threshold,
  );
  if (similar < minSimilar) {
    return { code: "skipped", reason: "not_enough_similar" };
  }

  // Language gate. `sessions.memory_language_code` is the only source of
  // truth — no text heuristic. If we can't read it, fail-closed: skip.
  const sourceSessionId = candidate.sourceSession ?? candidate.sessionId;
  const langCode = await sessionsRepo.getMemoryLanguageCode(sourceSessionId);

  let englishTitle = candidate.title;
  let englishSummary = candidate.summaryText;
  if (langCode === null || langCode === "und") {
    return { code: "skipped", reason: "language_unknown" };
  }
  if (langCode !== "en") {
    try {
      const translated = await translateEpisodeToEnglish(
        candidate.title,
        candidate.summaryText,
        langCode,
        provider,
        config,
      );
      englishTitle = translated.title;
      englishSummary = translated.summary;
    } catch (err) {
      logger.warn("promotion.translate_failed", {
        episodeId: candidate.id,
        langCode,
        error: err instanceof Error ? err.message : String(err),
      });
      return { code: "skipped", reason: "translation_failed" };
    }
  }

  // Re-embed against the English payload so recall filters stay clean. If
  // embeddings are down, skip this candidate — we'd rather wait than
  // insert with the session-language embedding into the English layer.
  let embedding: number[];
  let providerModel: string;
  let embeddingDim: number;
  try {
    const titleForEmbed =
      englishTitle.trim().length > 0
        ? englishTitle
        : englishSummary.slice(0, 120);
    const embedCfg = loadEmbeddingConfig();
    const result = await embedDocument(titleForEmbed, englishSummary, embedCfg);
    embedding = result.embedding;
    providerModel = result.providerModel;
    embeddingDim = embedding.length;
  } catch (err) {
    logger.warn("promotion.embed_failed", {
      episodeId: candidate.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { code: "skipped", reason: "embedding_unavailable" };
  }

  // Subagent provenance (plan v4.2 upgrade). Post-PR3 subagent episodes
  // live in their own `memory_scope_key`; the attribution path from
  // `knowledge_entries` back to the parent session runs through
  // `source_refs.parent_session_id`.
  const parentSessionId = await resolveParentSessionId(sourceSessionId);

  const contentMd = englishSummary;
  const contentHash = sha256(
    `${candidate.episodeKind}\n${englishTitle.trim()}\n${englishSummary.trim()}`,
  );
  const sourceRefs: Record<string, unknown> = {
    source_episode_id: candidate.id,
    source_session: sourceSessionId,
    ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
  };

  // All three idempotency layers (source_episode_id / source_episode_hash /
  // content_hash) can reject the insert. On any of them, we return the
  // "already_promoted" outcome so the caller logs it and moves on.
  try {
    const { entry, inserted } = await withLeaseSharedLock(getPool(), (tx) =>
      knowledgeRepo.insertEntry(
        {
          kind: mapEpisodeKindToKnowledgeKind(candidate.episodeKind),
          title: englishTitle,
          summary: englishSummary,
          contentMd,
          tags: [],
          sourceRefs,
          confidence: null,
          pinned: false,
          validUntil: null,
          contentHash,
          embeddingModel: providerModel,
          embeddingDim,
          embedding,
          sourceSurface: "echo_agent",
          sourceSession: sourceSessionId,
          sourceEpisodeId: candidate.id,
          sourceEpisodeHash: candidate.episodeHash,
          promotionVersion: PROMOTION_VERSION,
        },
        tx,
      ),
    );
    if (!inserted) {
      return { code: "already_promoted", reason: "content_hash" };
    }
    return { code: "inserted", entry };
  } catch (err) {
    // 23505 on the two promotion-specific indexes = silent "already
    // promoted" (race-lost). Anything else surfaces — caller logs it.
    if (err instanceof pg.DatabaseError && err.code === "23505") {
      const constraint = err.constraint ?? "";
      if (constraint === "idx_ke_source_episode_id") {
        return { code: "already_promoted", reason: "source_episode_id" };
      }
      if (constraint === "idx_ke_source_episode_hash") {
        return { code: "already_promoted", reason: "source_episode_hash" };
      }
    }
    if (err instanceof MaintenanceActiveError) {
      // Maintenance running — defer; don't poison the pipeline with a
      // partial promotion batch. Skip this candidate; next checkpoint's
      // pipeline will try again.
      logger.warn("promotion.maintenance_active", {
        episodeId: candidate.id,
        ownerId: err.ownerId,
      });
      return { code: "skipped", reason: "embedding_unavailable" };
    }
    throw err;
  }
}

// ── Translation ─────────────────────────────────────────────────────

/**
 * Translate an episode's title + summary to English via the same provider
 * the engine uses. Returns both fields trimmed. Throws on provider error
 * or empty content.
 */
async function translateEpisodeToEnglish(
  title: string,
  summary: string,
  langCode: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<{ title: string; summary: string }> {
  const systemPrompt = `You are a translation tool. Translate the input from ${humanLangName(langCode)} to English. Output ONLY a valid JSON object with exactly two fields: "title" (<= 100 chars) and "summary" (the translated body). No preamble, no markdown fences, no commentary. Preserve proper nouns, numbers, tickers, chain/protocol names, and transaction hashes verbatim.`;
  const userPayload = JSON.stringify({ title, summary });

  const { content } = await provider.chatCompletionSimple(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
    config,
  );

  const parsed = parseTranslationResponse(content);
  if (parsed === null) {
    throw new Error(
      `translation failed: provider returned malformed JSON (preview: ${(content ?? "").slice(0, 120)})`,
    );
  }
  const translatedTitle = parsed.title.trim();
  const translatedSummary = parsed.summary.trim();
  if (translatedSummary.length === 0) {
    throw new Error("translation failed: empty summary");
  }
  return { title: translatedTitle, summary: translatedSummary };
}

function parseTranslationResponse(
  raw: string | null,
): { title: string; summary: string } | null {
  if (!raw) return null;
  const stripped = stripCodeFence(raw.trim());
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    const obj = JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as {
      title?: unknown;
      summary?: unknown;
    };
    const title = typeof obj.title === "string" ? obj.title : "";
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    if (!summary) return null;
    return { title, summary };
  } catch {
    return null;
  }
}

function stripCodeFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1]!.trim() : s;
}

function humanLangName(code: string): string {
  const primary = code.split("-")[0]!;
  const map: Record<string, string> = {
    pl: "Polish",
    fr: "French",
    zh: "Chinese",
    vi: "Vietnamese",
    es: "Spanish",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ja: "Japanese",
    ko: "Korean",
    ru: "Russian",
    ar: "Arabic",
    nl: "Dutch",
    uk: "Ukrainian",
    tr: "Turkish",
  };
  return map[primary] ?? `the language with code "${code}"`;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function resolveParentSessionId(
  sourceSessionId: string,
): Promise<string | null> {
  try {
    const parent = await sessionLinksRepo.getParentSession(sourceSessionId);
    return parent?.parentSessionId ?? null;
  } catch (err) {
    // Attribution is best-effort; a missing parent_session_id does not
    // block the promotion itself.
    logger.warn("promotion.parent_lookup_failed", {
      sourceSessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Episode kinds are a closed taxonomy; knowledge_entries.kind is free-form
 * text but tooling expects human labels. Map 1:1 for now.
 */
function mapEpisodeKindToKnowledgeKind(kind: EpisodeKind): string {
  return kind;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
