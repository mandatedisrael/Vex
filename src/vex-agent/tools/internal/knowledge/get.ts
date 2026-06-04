/**
 * knowledge_get handler — direct fetch by id.
 *
 * Returns both lineage directions (supersedesId + supersededBy) so the agent
 * can diagnose historical entries (supersededBy) and new-version entries
 * (supersedesId) symmetrically. Injects content_md into the engine's
 * loadedDocuments map under the "knowledge:{id}" prefix so it surfaces in the
 * system prompt's loaded-content section.
 */

import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { num, ok, fail } from "../types.js";

export async function handleKnowledgeGet(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const id = num(params, "id");
  if (id === undefined) return fail("Missing required parameter: id");

  const entry = await knowledgeRepo.getById(id);
  if (!entry) return fail(`knowledge entry not found: ${id}`);

  // Inject content_md into the engine's loadedDocuments map so it surfaces in
  // the system prompt. Key uses the "knowledge:{id}" prefix to namespace the entry.
  context.loadedDocuments.set(`knowledge:${entry.id}`, entry.contentMd);

  return ok({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    contentMd: entry.contentMd,
    tags: entry.tags,
    sourceRefs: entry.sourceRefs,
    confidence: entry.confidence,
    status: entry.status,
    pinned: entry.pinned,
    validUntil: entry.validUntil,
    // Lifecycle lineage — both directions so the agent can diagnose historical
    // entries (supersededBy) and new-version entries (supersedesId) symmetrically.
    supersedesId: entry.supersedesId,
    supersededBy: entry.supersededBy,
    statusReason: entry.statusReason,
    changeSummary: entry.changeSummary,
    whatFailed: entry.whatFailed,
  });
}
