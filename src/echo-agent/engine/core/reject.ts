/**
 * Approval rejection — single-item CAS-safe reject. Does NOT abort the
 * mission run (if any); callers handling a hard "no" on the whole batch
 * should use `abortActiveMissionForSession` instead. This path exists so
 * an operator can reject one queued tool call without tearing down the
 * entire mission or the `paused_approval` → `paused_*` transition.
 */

import type { ApprovalItem } from "../../db/repos/approvals.js";
import * as approvalsRepo from "../../db/repos/approvals.js";
import logger from "../../../utils/logger.js";

/**
 * Reject a single pending approval by id.
 *
 * Returns the rejected `ApprovalItem`, or `null` when the approval was
 * already resolved (approved or rejected earlier) — callers distinguish
 * "reject applied" from "noop because someone else moved first".
 */
export async function rejectApproval(approvalId: string): Promise<ApprovalItem | null> {
  const rejected = await approvalsRepo.reject(approvalId);
  if (!rejected) {
    logger.warn("engine.reject.already_resolved", { approvalId });
    return null;
  }
  logger.info("engine.reject.ok", {
    approvalId,
    sessionId: rejected.sessionId,
    toolCallId: rejected.toolCallId,
  });
  return rejected;
}
