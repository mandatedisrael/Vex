/**
 * Episode extraction — the "episodes" leg of checkpoint.
 *
 * Separate provider call from `summarizePrefix`: we want summary to succeed
 * even if extraction misbehaves, and vice versa. Pipeline mirrors
 * `engine/mission/patch-parser.ts`: boundary `unknown → JSON → zod → narrow`.
 *
 * Failure modes are non-blocking — both `JSON.parse` throw and schema
 * validation failure return `[]` with a warn log. Embedding happens in the
 * caller, not here.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";
import { EPISODE_KINDS, type EpisodeKind } from "@echo-agent/db/repos/session-episodes.js";
import logger from "@utils/logger.js";

/** Truncation cap for per-message content shown to the extractor. */
const PER_MESSAGE_CHAR_CAP = 800;

export interface ExtractedEpisode {
  episodeKind: EpisodeKind;
  summaryEn: string;
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  openLoops: Record<string, unknown>;
  entities: string[];
  toolOutcomes: Record<string, unknown>;
  /** sha256 of `episodeKind + '\n' + summaryEn` — stable across retries. */
  episodeHash: string;
}

// ── Schema ─────────────────────────────────────────────────────

const EpisodeSchema = z.object({
  episode_kind: z.enum(EPISODE_KINDS),
  summary_en: z.string().min(1).max(2000),
  facts: z.record(z.string(), z.unknown()).default({}),
  decisions: z.record(z.string(), z.unknown()).default({}),
  open_loops: z.record(z.string(), z.unknown()).default({}),
  entities: z.array(z.string()).max(50).default([]),
  tool_outcomes: z.record(z.string(), z.unknown()).default({}),
});

const EpisodesBatchSchema = z.array(EpisodeSchema).max(20);

// ── Entry point ────────────────────────────────────────────────

export async function extractEpisodes(
  prefix: readonly MessageWithId[],
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<ExtractedEpisode[]> {
  if (prefix.length === 0) return [];

  const prompt = buildExtractionPrompt(prefix);
  let raw: { content: string | null };
  try {
    raw = await provider.chatCompletionSimple(
      [{ role: "system", content: prompt }],
      config,
    );
  } catch (err) {
    logger.warn("checkpoint.extract.provider_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const text = raw.content ?? "";
  const parsed = parseJsonObject(text);
  if (parsed === null) {
    logger.warn("checkpoint.extract.json_parse_failed", {
      textPreview: text.slice(0, 120),
    });
    return [];
  }

  const batch = toBatchCandidate(parsed);
  const result = EpisodesBatchSchema.safeParse(batch);
  if (!result.success) {
    logger.warn("checkpoint.extract.schema_invalid", {
      issueCount: result.error.issues.length,
      firstIssue: result.error.issues[0]?.message,
    });
    return [];
  }

  return result.data.map((ep) => ({
    episodeKind: ep.episode_kind,
    summaryEn: ep.summary_en.trim(),
    facts: ep.facts,
    decisions: ep.decisions,
    openLoops: ep.open_loops,
    entities: ep.entities,
    toolOutcomes: ep.tool_outcomes,
    episodeHash: computeEpisodeHash(ep.episode_kind, ep.summary_en.trim()),
  }));
}

/**
 * Stable hash used for dedupe when retrying extraction on the same prefix.
 * Exposed so the giant-tool synthetic fallback can build rows that collide
 * with a second attempt.
 */
export function computeEpisodeHash(kind: EpisodeKind, summaryEn: string): string {
  const h = createHash("sha256");
  h.update(kind);
  h.update("\n");
  h.update(summaryEn);
  return h.digest("hex");
}

// ── Helpers ────────────────────────────────────────────────────

function buildExtractionPrompt(prefix: readonly MessageWithId[]): string {
  const conversation = prefix
    .map((m) => `[${m.role}]: ${m.content.slice(0, PER_MESSAGE_CHAR_CAP)}`)
    .join("\n");

  return `You extract reusable episodic memory from a conversation prefix.

Output a single JSON array (max 20 items). No prose, no markdown fences. Each item has this shape:

{
  "episode_kind": "decision" | "fact" | "preference" | "open_loop" | "tool_result_summary" | "lesson",
  "summary_en": "1-2 sentence summary in English (required, <= 2000 chars)",
  "facts": { ...arbitrary structured fields, all text values in English... },
  "decisions": { ...all text values in English... },
  "open_loops": { ...all text values in English... },
  "entities": ["canonical names / ids in English"],
  "tool_outcomes": { "tool_name": "outcome summary in English" }
}

All text values — in summary_en, facts, decisions, open_loops, tool_outcomes, and entities — MUST be in English, regardless of the source conversation language. If a fact originates in another language, translate it to English; never mirror the source language in the output.

Only emit episodes that carry value across sessions. Skip chitchat, repeated instructions, and ephemeral state. Prefer concise, self-contained facts over paragraphs. If nothing is worth saving, output [].

Conversation prefix:
${conversation}`;
}

function parseJsonObject(text: string): unknown {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through to raw parse
    }
  }

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    } catch {
      // fall through
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function toBatchCandidate(raw: unknown): unknown {
  // Accept either `[...]` directly or `{ "episodes": [...] }` for lenient models.
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const maybe = (raw as Record<string, unknown>)["episodes"];
    if (Array.isArray(maybe)) return maybe;
  }
  return [];
}
