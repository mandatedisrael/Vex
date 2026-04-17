/**
 * Rolling summary merge — the "summary" leg of checkpoint.
 *
 * Unlike the old full-archive path, we pass the PREVIOUS summary into the
 * compaction call so nothing said before the current prefix is dropped on the
 * floor. The prompt instructs the model to MERGE, not replace — preserving
 * decisions, tool outcomes, and pending actions across successive checkpoints.
 */

import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";

/** Truncation cap for per-message content shown to the summarizer. */
const PER_MESSAGE_CHAR_CAP = 500;

export async function summarizePrefix(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<string> {
  if (prefix.length === 0) {
    throw new Error("summarizePrefix: prefix must be non-empty");
  }

  const compactionPrompt = buildCompactionPrompt(prefix, previousSummary);
  const { content: summary } = await provider.chatCompletionSimple(
    [{ role: "system", content: compactionPrompt }],
    config,
  );

  const trimmed = summary?.trim();
  if (!trimmed) {
    throw new Error("summarizePrefix: provider returned empty summary");
  }
  return trimmed;
}

// ── Prompt builder ─────────────────────────────────────────────

function buildCompactionPrompt(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
): string {
  const conversation = prefix
    .map((m) => `[${m.role}]: ${m.content.slice(0, PER_MESSAGE_CHAR_CAP)}`)
    .join("\n");

  const previousBlock = previousSummary
    ? `Previous rolling summary (carry forward what's still relevant):\n${previousSummary}\n\n`
    : "";

  return `You are a conversation summarizer. Produce a single rolling summary that MERGES the previous summary (if any) with the newly archived prefix below. Preserve across checkpoints:
- Key decisions made
- Tool calls executed and their results
- Current state of any ongoing mission or task
- Important data points (balances, prices, positions)
- Any pending actions or next steps

Drop superseded details. Do not re-output the previous summary verbatim — integrate it. Output plain text, no preamble. Output in English — if the archived conversation uses another language, translate to English; never mirror the source language.

${previousBlock}Archived prefix:
${conversation}`;
}
