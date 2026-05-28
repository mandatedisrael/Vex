/**
 * Documents — DB-first freeform agent scratchpad.
 *
 * Canonical structured memory lives in knowledge_* — these are the freeform
 * notes-space sibling.
 */

import type { ToolDef } from "../types.js";

export const DOCUMENT_TOOLS: readonly ToolDef[] = [
  {
    name: "document_read", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description:
      "Read a freeform note from the notes scratchpad by exact slug. Documents are NOT semantically searchable and NOT embedded — slug-keyed retrieval only. "
      + "For durable cross-session knowledge (rules, lessons, strategies that should surface via semantic recall) use knowledge_recall / knowledge_get. "
      + "For per-session narrative chunks (what happened earlier in THIS conversation) use memory_recall. "
      + "✓ document_read(slug=\"risk-notes\", folder=\"notes\") — retrieves the exact note you previously wrote. "
      + "✗ \"find notes about risk\" — documents have no semantic index; use knowledge_recall for that. "
      + "Use preview=true for first 1000 chars without context load.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      slug: { type: "string", description: "Exact document slug (no fuzzy match)" },
      folder: { type: "string", description: "Folder slug (optional, default: root)" },
      preview: { type: "boolean", description: "Preview mode (first 1000 chars, no context load)" },
    }, required: ["slug"] },
  },
  {
    name: "document_write", kind: "internal", mutating: false, pressureSafety: "mutating", actionKind: "local_write",
    description:
      "Create or update a freeform note in the notes scratchpad. Scratchpad — NOT searchable, NOT embedded; future retrieval needs the exact slug. "
      + "For content that should be retrievable later by semantic intent (distilled rules, observed strategies, lessons from failure, user preferences with evidence) use knowledge_write instead — that path embeds and surfaces via knowledge_recall. "
      + "For per-session narrative memory: that lands automatically on `compact_now` via Track 2 chunking; do not write it manually here. "
      + "Pressure-band rule: blocked at barrier+ (catalog filter hides this from the LLM-visible tools then; compact_now first).",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      folder: { type: "string", description: "Folder slug (optional)" },
      title: { type: "string", description: "Document title" },
      slug: { type: "string", description: "URL-safe identifier (auto-generated from title if omitted)" },
      content: { type: "string", description: "Markdown content" },
    }, required: ["title", "content"] },
  },
  {
    name: "document_list", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description:
      "Enumerate notes in the scratchpad space, optionally filtered by folder. Returns slugs + metadata only — NOT a search; do not rely on this to \"remember\" content. "
      + "✓ document_list(folder=\"notes\") — gives you the slug list you can later read. "
      + "✗ relying on this to find content by topic — use knowledge_recall (semantic) for that.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      folder: { type: "string", description: "Folder slug filter" },
    } },
  },
  {
    name: "document_delete", kind: "internal", mutating: true, pressureSafety: "mutating", actionKind: "destructive",
    description:
      "Archive (soft-delete) a scratchpad note. Reversible by writing the same slug again. "
      + "For durable knowledge entries use knowledge_update_status (status='archived') instead — knowledge has lifecycle (active / superseded / invalidated / archived) and a lineage chain; documents are just a flat slug→content scratchpad.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space" },
      slug: { type: "string", description: "Exact document slug" },
      folder: { type: "string", description: "Folder slug" },
    }, required: ["slug"] },
  },
];
