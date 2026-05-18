/**
 * `mark_outstanding_resolved` tool handler — closes a single outstanding
 * item on a session memory chunk. Updates the JSONB element + re-renders
 * `body_md` + re-embeds via the same local EmbeddingGemma service.
 *
 * Orchestrates the two-step pattern from PR1:
 *   1. markOutstandingResolved repo call — updates outstanding_items array
 *      element and body_md.
 *   2. embedDocument(theme, body_md) on the post-update body.
 *   3. updateEmbedding repo call — replaces the vector in place so future
 *      recall sees the resolved state.
 *
 * If embedding fails (local service down), the body_md change is preserved
 * (recoverable) but the embedding stays stale until a future re-embed pass.
 * That's preferable to losing the resolution acknowledgement.
 */

import { z } from "zod";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import {
  getById,
  markOutstandingResolved,
  updateEmbedding,
} from "@vex-agent/db/repos/session-memories/index.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import { OUTSTANDING_ITEM_TEXT_MAX } from "@vex-agent/memory/policy.js";
import logger from "@utils/logger.js";

const MarkResolvedSchema = z.object({
  memory_id: z.number().int().positive(),
  outstanding_item_id: z.string().uuid(),
  resolution_note: z.string().min(1).max(OUTSTANDING_ITEM_TEXT_MAX),
});

export async function handleMarkOutstandingResolved(
  args: unknown,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = MarkResolvedSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      output: `mark_outstanding_resolved: invalid arguments: ${parsed.error.message}`,
    };
  }
  const { memory_id, outstanding_item_id, resolution_note } = parsed.data;

  logger.info("mark_outstanding_resolved.called", {
    sessionId: context.sessionId,
    memoryId: memory_id,
  });

  // Verify the chunk belongs to this session (defense-in-depth).
  const existing = await getById(memory_id);
  if (!existing) {
    return { success: false, output: `Memory chunk ${memory_id} not found.` };
  }
  if (existing.sessionId !== context.sessionId) {
    return {
      success: false,
      output: `Memory chunk ${memory_id} does not belong to this session.`,
    };
  }

  const result = await markOutstandingResolved(
    memory_id,
    outstanding_item_id,
    resolution_note,
    "agent",
  );
  if (!result.ok) {
    return {
      success: false,
      output: `mark_outstanding_resolved: ${result.reason}`,
    };
  }

  // Re-embed the updated body. If embedDocument fails, the resolution still
  // persists in DB — the vector becomes stale until a future re-embed.
  try {
    const embedded = await embedDocument(result.memory.theme, result.memory.bodyMd);
    await updateEmbedding(
      memory_id,
      embedded.embedding,
      embedded.providerModel,
      embedded.embedding.length,
    );
  } catch (err) {
    logger.warn("mark_outstanding_resolved.embed_failed", {
      memoryId: memory_id,
      sessionId: context.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: true,
      output:
        `Outstanding item ${outstanding_item_id} resolved on chunk ${memory_id}. ` +
        "WARNING: re-embedding failed; the vector for this chunk is now stale. " +
        "Recall will continue to find the chunk via the old embedding until the next compact.",
      data: { resolved: true, embedding_stale: true },
    };
  }

  return {
    success: true,
    output: `Outstanding item ${outstanding_item_id} resolved on chunk ${memory_id} (theme: ${result.memory.theme}).`,
    data: {
      resolved: true,
      memory_id,
      outstanding_item_id,
      remaining_unresolved: result.memory.outstandingItems.filter((it) => it.resolvedAt === null).length,
    },
  };
}
