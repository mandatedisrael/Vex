/**
 * `checkpoint_handoff_prepare` handler — persists a pre-compact handoff for
 * the session's NEXT checkpoint generation (see PR-9). Phase II of
 * `executeCheckpoint` consumes the row atomically with the generation bump,
 * and PR-10's `effectiveRecallSeed` reads `preferred_recall_query` as the
 * first-choice recall seed after compaction.
 *
 * Parameter contract:
 *   - `important_entities` / `open_loops` are declared as `string` in the
 *     OpenAI tool schema (see `registry/autonomy.ts`) because our
 *     `JsonSchema` only supports primitive `type` strings. The handler
 *     accepts EITHER a JSON array OR a JSON-encoded string, normalises to
 *     `string[]`, and rejects anything else at the Zod boundary.
 */

import { z } from "zod";

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { fail } from "./types.js";
import * as checkpointHandoffsRepo from "@echo-agent/db/repos/checkpoint-handoffs.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";

const PRESERVE_MD_MAX = 2000;
const RECALL_QUERY_MAX = 500;
const ENTITIES_MAX_ITEMS = 20;
const ENTITY_MAX_CHARS = 100;
const OPEN_LOOPS_MAX_ITEMS = 20;
const OPEN_LOOP_MAX_CHARS = 200;

const stringArray = (maxItems: number, maxChars: number, field: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed.length === 0) return [];
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parsed;
      } catch {
        return value;
      }
    },
    z
      .array(
        z
          .string()
          .min(1, { message: `${field} items must be non-empty` })
          .max(maxChars, { message: `${field} items must be ≤ ${maxChars} chars` }),
      )
      .max(maxItems, { message: `${field} must have ≤ ${maxItems} items` }),
  );

const HandoffArgs = z.object({
  preserve_md: z
    .string({ error: "preserve_md is required" })
    .max(PRESERVE_MD_MAX, { message: `preserve_md must be ≤ ${PRESERVE_MD_MAX} chars` }),
  preferred_recall_query: z
    .string({ error: "preferred_recall_query is required" })
    .min(1, { message: "preferred_recall_query is required (non-empty)" })
    .max(RECALL_QUERY_MAX, { message: `preferred_recall_query must be ≤ ${RECALL_QUERY_MAX} chars` }),
  important_entities: stringArray(ENTITIES_MAX_ITEMS, ENTITY_MAX_CHARS, "important_entities"),
  open_loops: stringArray(OPEN_LOOPS_MAX_ITEMS, OPEN_LOOP_MAX_CHARS, "open_loops"),
});

export async function handleCheckpointHandoffPrepare(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  // Defense-in-depth — the registry visibility filter already gates by band,
  // but dispatcher paths that bypass the filter (operator resume, ad-hoc
  // tooling) could still deliver the call. Reject if the band is clearly wrong.
  if (context.contextUsageBand === "normal") {
    return fail(
      "checkpoint_handoff_prepare is only useful when contextUsageBand is 'warning' or 'critical'",
    );
  }

  const parsed = HandoffArgs.safeParse(params);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(`checkpoint_handoff_prepare: ${firstIssue?.message ?? "invalid arguments"}`);
  }
  const payload = parsed.data;

  const session = await sessionsRepo.getSession(context.sessionId);
  if (!session) {
    return fail(`checkpoint_handoff_prepare: session ${context.sessionId} not found`);
  }

  const targetGeneration = session.checkpointGeneration + 1;

  const row = await checkpointHandoffsRepo.writeHandoff(
    context.sessionId,
    targetGeneration,
    {
      preserveMd: payload.preserve_md,
      preferredRecallQuery: payload.preferred_recall_query,
      importantEntities: payload.important_entities,
      openLoops: payload.open_loops,
    },
  );

  return {
    success: true,
    output:
      `Handoff prepared for checkpoint generation ${targetGeneration}. ` +
      `The post-compact turn will seed recall with "${payload.preferred_recall_query}".`,
    data: {
      handoff_id: row.id,
      target_checkpoint_generation: row.targetCheckpointGeneration,
      status: row.status,
    },
  };
}
