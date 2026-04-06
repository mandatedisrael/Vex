/**
 * Active Knowledge prompt block — sync formatter.
 *
 * Pure rendering. The DB query happens upstream in `executeTurn` (pre-fetch via
 * Promise.all over knowledgeRepo.listActiveForHotContext + listKnownKinds), then
 * the formatted string is passed through PromptStackOptions.activeKnowledgeBlock.
 *
 * Empty state handling has 3 cases:
 *   - both empty             → ""             (entire section is omitted from prompt)
 *   - only entries empty     → render Known kinds section only (under the heading)
 *   - only known kinds empty → render hot context entries only
 *
 * Caps:
 *   - max ACTIVE_KNOWLEDGE_ENTRY_LIMIT (12) entries
 *   - per-entry summary truncated to ACTIVE_KNOWLEDGE_SUMMARY_TRUNCATE (200) chars
 *   - hot-context section total ACTIVE_KNOWLEDGE_HOT_CHARS_CAP (3000) chars
 *   - Known kinds line total ACTIVE_KNOWLEDGE_KINDS_CHARS_CAP (500) chars
 */

import {
  ACTIVE_KNOWLEDGE_ENTRY_LIMIT,
  ACTIVE_KNOWLEDGE_HOT_CHARS_CAP,
  ACTIVE_KNOWLEDGE_KINDS_CHARS_CAP,
  ACTIVE_KNOWLEDGE_SUMMARY_TRUNCATE,
} from "@echo-agent/knowledge/policy.js";
import type {
  ActiveKnowledgeListItem,
  KnownKind,
} from "@echo-agent/db/repos/knowledge.js";

export function formatActiveKnowledgeBlock(
  entries: readonly ActiveKnowledgeListItem[],
  knownKinds: readonly KnownKind[],
): string {
  if (entries.length === 0 && knownKinds.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("# Active Knowledge");
  lines.push("");

  const cappedEntries = entries.slice(0, ACTIVE_KNOWLEDGE_ENTRY_LIMIT);
  const pinned = cappedEntries.filter((e) => e.pinned);
  const recent = cappedEntries.filter((e) => !e.pinned);

  let charsUsed = 0;
  const renderedHotLines: string[] = [];

  if (pinned.length > 0) {
    renderedHotLines.push("Pinned (evergreen):");
    for (const e of pinned) {
      const line = formatEntry(e);
      if (charsUsed + line.length > ACTIVE_KNOWLEDGE_HOT_CHARS_CAP) break;
      renderedHotLines.push(line);
      charsUsed += line.length;
    }
    renderedHotLines.push("");
  }

  if (recent.length > 0) {
    renderedHotLines.push("Recent:");
    for (const e of recent) {
      const line = formatEntry(e);
      if (charsUsed + line.length > ACTIVE_KNOWLEDGE_HOT_CHARS_CAP) break;
      renderedHotLines.push(line);
      charsUsed += line.length;
    }
    renderedHotLines.push("");
  }

  for (const line of renderedHotLines) lines.push(line);

  if (knownKinds.length > 0) {
    const kindsLine = formatKnownKindsLine(knownKinds);
    lines.push("Known kinds (reuse before creating new):");
    lines.push(kindsLine);
    lines.push("");
  }

  lines.push(
    "Use `knowledge_recall <query>` for older entries, `knowledge_get <id>` for full text.",
  );

  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────

function formatEntry(e: ActiveKnowledgeListItem): string {
  const truncated = truncate(e.summary, ACTIVE_KNOWLEDGE_SUMMARY_TRUNCATE);
  const expiresHint = e.pinned || !e.validUntil ? "" : ` (expires ${humanizeRemaining(e.validUntil)})`;
  return `- [${e.kind}] ${e.title} — ${truncated} (id:${e.id})${expiresHint}`;
}

function formatKnownKindsLine(knownKinds: readonly KnownKind[]): string {
  // Format: "kind_a (12), kind_b (3), ..." with hard char cap.
  const parts: string[] = [];
  let used = 0;
  for (const k of knownKinds) {
    const piece = `${k.kind} (${k.count})`;
    const sep = parts.length > 0 ? ", " : "";
    if (used + piece.length + sep.length > ACTIVE_KNOWLEDGE_KINDS_CHARS_CAP) break;
    parts.push(piece);
    used += piece.length + sep.length;
  }
  return parts.join(", ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function humanizeRemaining(validUntilIso: string): string {
  const ms = new Date(validUntilIso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
