/**
 * knowledge_update_status handler — marks an entry invalidated/archived.
 *
 * Cannot transition back to active — write a new entry instead. For replacing
 * an entry with a new version, use knowledge_supersede. Terminal states
 * (superseded, invalidated, archived) are immutable; the repo refuses to
 * rewrite them and this handler surfaces that refusal with an actionable
 * message that includes the current status.
 */

import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import { isUpdatableKnowledgeStatus } from "@echo-agent/knowledge/policy.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, ok, fail } from "./types.js";

export async function handleKnowledgeUpdateStatus(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const id = num(params, "id");
  const statusParam = str(params, "status");
  if (id === undefined || !statusParam) {
    return fail("Missing required parameters: id, status");
  }
  if (!isUpdatableKnowledgeStatus(statusParam)) {
    return fail(
      `Invalid status "${statusParam}". Must be one of: invalidated, archived. ` +
        `(Cannot transition back to active — write a new entry instead. ` +
        `For replacing an entry with a new version, use knowledge_supersede.)`,
    );
  }

  // `reason` is optional; when present we persist it to `status_reason` so the
  // rationale stays with the row (previously only logged).
  const rawReason = str(params, "reason");
  const reason = rawReason.length > 0 ? rawReason : undefined;

  const result = await knowledgeRepo.updateStatus(id, statusParam, reason);
  if (result.ok) {
    return ok({ id, status: statusParam, updated: true, reason: reason ?? null });
  }
  if (result.reason === "not_found") {
    return fail(`knowledge entry not found: ${id}`);
  }
  // not_active: the row exists but is already superseded/invalidated/archived.
  // Re-stamping it would silently rewrite lifecycle history, so we refuse with
  // an actionable message — the agent should either write a new entry or leave
  // the current terminal state alone.
  return fail(
    `entry ${id} is not active (current status: ${result.currentStatus}) — ` +
      `cannot transition to ${statusParam}. Terminal states (superseded, invalidated, archived) ` +
      `are immutable; write a new entry instead.`,
  );
}
