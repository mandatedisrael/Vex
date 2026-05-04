/**
 * Rolling summary merge — the "summary" leg of checkpoint.
 *
 * Unlike the old full-archive path, we pass the PREVIOUS summary into the
 * compaction call so nothing said before the current prefix is dropped on the
 * floor. The prompt instructs the model to MERGE, not replace — preserving
 * decisions, tool outcomes, and pending actions across successive checkpoints.
 *
 * Multilingual contract (PR2, post-migration 008):
 *   The summary is produced in the session's language, not forced English.
 *   The caller passes the persisted `sessions.memory_language_code` as
 *   `currentCode`; the prompt pins the output language. For the very first
 *   checkpoint (`currentCode === null`) or sessions marked `"und"`, the
 *   summarizer picks the dominant language of the archived prefix.
 */

import type { InferenceProvider, InferenceConfig } from "@vex-agent/inference/types.js";
import type { MessageWithId } from "@vex-agent/db/repos/messages.js";
import logger from "@utils/logger.js";

/** Truncation cap for per-message content shown to the summarizer. */
const PER_MESSAGE_CHAR_CAP = 500;
const FALLBACK_MESSAGE_CHAR_CAP = 220;

export async function summarizePrefix(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
  provider: InferenceProvider,
  config: InferenceConfig,
  currentCode: string | null,
  handoffPreserve: string | null = null,
): Promise<string> {
  if (prefix.length === 0) {
    throw new Error("summarizePrefix: prefix must be non-empty");
  }

  const compactionPrompt = buildCompactionPrompt(prefix, previousSummary, currentCode, handoffPreserve);
  const { content: firstSummary } = await provider.chatCompletionSimple(
    [{ role: "system", content: compactionPrompt }],
    config,
  );

  const firstTrimmed = firstSummary?.trim();
  if (firstTrimmed) {
    return firstTrimmed;
  }

  logger.warn("checkpoint.summary.empty", {
    attempt: 1,
    sourceStartMessageId: prefix[0]?.id ?? null,
    sourceEndMessageId: prefix[prefix.length - 1]?.id ?? null,
  });

  const retryPrompt = buildRetryCompactionPrompt(compactionPrompt);
  const { content: retrySummary } = await provider.chatCompletionSimple(
    [{ role: "system", content: retryPrompt }],
    config,
  );

  const retryTrimmed = retrySummary?.trim();
  if (retryTrimmed) {
    return retryTrimmed;
  }

  logger.error("checkpoint.summary.empty_fallback", {
    sourceStartMessageId: prefix[0]?.id ?? null,
    sourceEndMessageId: prefix[prefix.length - 1]?.id ?? null,
    messageCount: prefix.length,
    hasPreviousSummary: previousSummary !== null && previousSummary.trim().length > 0,
    hasHandoffPreserve: handoffPreserve !== null && handoffPreserve.trim().length > 0,
  });

  return buildDeterministicFallbackSummary(prefix, previousSummary, handoffPreserve);
}

// ── Prompt builder ─────────────────────────────────────────────

function buildCompactionPrompt(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
  currentCode: string | null,
  handoffPreserve: string | null,
): string {
  const conversation = prefix
    .map((m) => `[${m.role}]: ${m.content.slice(0, PER_MESSAGE_CHAR_CAP)}`)
    .join("\n");

  const previousBlock = previousSummary
    ? `Previous rolling summary (carry forward what's still relevant):\n${previousSummary}\n\n`
    : "";

  // PR-9 handoff `preserve_md` — the agent's own note about what must
  // survive compaction. Rendered as a hard-priority block above the
  // previous-summary bullet so the LLM can't quietly drop it during the
  // merge. Empty strings are skipped (no placeholder clutter).
  const preserveBlock =
    handoffPreserve && handoffPreserve.trim().length > 0
      ? `Preserve MUST block (directly requested by the agent pre-compaction — do not drop any of this):\n${handoffPreserve.trim()}\n\n`
      : "";

  return `You are a conversation summarizer. Produce a single rolling summary that MERGES the previous summary (if any) with the newly archived prefix below. Preserve across checkpoints:
- Key decisions made
- Tool calls executed and their results
- Current state of any ongoing mission or task
- Important data points (balances, prices, positions)
- Any pending actions or next steps

Drop superseded details. Do not re-output the previous summary verbatim — integrate it. Output plain text, no preamble.

${buildLanguageDirective(currentCode)}

${preserveBlock}${previousBlock}Archived prefix:
${conversation}`;
}

function buildRetryCompactionPrompt(compactionPrompt: string): string {
  return `${compactionPrompt}

The previous summarizer call returned an empty response. Return a non-empty rolling summary now. Output plain text only.`;
}

function buildDeterministicFallbackSummary(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
  handoffPreserve: string | null,
): string {
  const lines: string[] = [];
  const startId = prefix[0]?.id ?? "unknown";
  const endId = prefix[prefix.length - 1]?.id ?? "unknown";

  lines.push(
    `Deterministic fallback summary for compacted messages ${startId}-${endId}.`,
  );

  const preserve = handoffPreserve?.trim();
  if (preserve) {
    lines.push(`Pre-compact handoff: ${preserve}`);
  }

  const previous = previousSummary?.trim();
  if (previous) {
    lines.push(`Previous rolling summary to carry forward: ${previous}`);
  }

  const excerpts = prefix
    .map((message) => {
      const excerpt = message.content.trim().slice(0, FALLBACK_MESSAGE_CHAR_CAP);
      return excerpt.length > 0 ? `[${message.role}#${message.id}]: ${excerpt}` : null;
    })
    .filter((excerpt): excerpt is string => excerpt !== null);

  if (excerpts.length > 0) {
    lines.push(`Archived prefix excerpts: ${excerpts.join(" | ")}`);
  }

  return lines.join("\n");
}

function buildLanguageDirective(currentCode: string | null): string {
  if (currentCode === null || currentCode === "und") {
    return "Output in the dominant language of the archived conversation — preserve the user's language naturally. If the previous summary (above) is in a different language than the archived prefix, align the merged output with the archived prefix's language.";
  }
  const languageName = languageNameFor(currentCode);
  return `Output in ${languageName}. Preserve this language across the entire summary — do not translate out of ${languageName}. If the previous summary or archived prefix mixes other languages, normalise to ${languageName}.`;
}

function languageNameFor(code: string): string {
  const primary = code.split("-")[0]!;
  const map: Record<string, string> = {
    en: "English",
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
  const name = map[primary];
  if (!name) return `the language with code "${code}"`;
  return code.includes("-") ? `${name} (${code})` : name;
}
