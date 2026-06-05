/**
 * Approval runtime — shared helpers (logging, redaction, hashing).
 *
 * Codex puzzle-5 phase-3 review point 6 — logger output is strictly
 * structural; raw tool/protocol/wallet error messages never reach logs.
 * Transcript redaction is the only place a short summary may appear.
 */

import { createHash } from "node:crypto";

import type { Permission } from "../../types.js";

/**
 * Ordinal rank for the 2-level `Permission` lattice. Higher rank = MORE
 * permissive (`full` > `restricted`). Used by the approve-time drift gate to
 * decide whether the live session permission became strictly more restrictive
 * than the snapshot captured at enqueue.
 */
const PERMISSION_RANK: Readonly<Record<Permission, number>> = {
  restricted: 0,
  full: 1,
};

/**
 * True when `live` is strictly MORE restrictive than `atEnqueue` — i.e. an
 * action authorized under a looser policy at enqueue would no longer be
 * permitted to auto-dispatch under the current policy. This is the only
 * direction the approve path fails closed on; unchanged or looser live
 * permission keeps the existing approve+dispatch path byte-identical.
 */
export function isPermissionMoreRestrictive(
  live: Permission,
  atEnqueue: Permission,
): boolean {
  return PERMISSION_RANK[live] < PERMISSION_RANK[atEnqueue];
}

export const TOOL_RESULT_REJECTED_DEFAULT_REASON = "No reason provided";
export const TOOL_RESULT_EXPIRED_REASON = "expired_ttl";
export const TOOL_RESULT_EXPIRED_MESSAGE =
  "Tool call auto-rejected: approval expired before user action.";

/**
 * B-001 — approve-time live-policy re-enforcement. When the live session
 * permission has drifted MORE restrictive than the permission snapshot
 * captured at enqueue, the approve fails closed BEFORE any dispatch: the
 * queue+intent are flipped to `rejected` in the same locked tx (no approved
 * decision, no dispatch, no approved tool-result). These constants name that
 * outcome so the auto-rejection tool-result + audit reason stay structural.
 */
export const TOOL_RESULT_POLICY_DRIFT_REASON = "policy_drift_blocked";
export const TOOL_RESULT_POLICY_DRIFT_MESSAGE =
  "Tool call auto-rejected: session permission became more restrictive " +
  "after this approval was requested. Re-issue the action under the current " +
  "permission policy.";

export const LEASE_TTL_MS = 5 * 60_000;
export const SWEEP_BATCH_LIMIT = 50;

export function shortSha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function summarizeErrorForLog(cause: unknown): {
  errorKind: string;
  errorHash: string;
} {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    errorKind:
      cause instanceof Error ? cause.constructor.name : typeof cause,
    errorHash: shortSha256(message),
  };
}

/**
 * Build a structural-only tool-result content for a dispatch failure.
 *
 * Codex puzzle-5 phase-3 review point 3 — tool/protocol/wallet errors can
 * contain API keys, bearer tokens, DB URLs, private keys, seed fragments,
 * and arbitrary request payloads. Persisting any of that into the
 * transcript (which the agent re-reads on every turn) is a leak vector.
 *
 * The agent only needs to know "the dispatch failed" + a stable identifier
 * to correlate with the structural log line — `errorHash` is the cross-log
 * correlation key. Raw / redacted message text is intentionally absent.
 */
export function buildDispatchFailedToolResultContent(
  errorKind: string,
  errorHash: string,
): string {
  return `Tool dispatch failed: ${errorKind}. Error hash: ${errorHash}.`;
}

export function buildPolicyDriftToolResultContent(): string {
  return TOOL_RESULT_POLICY_DRIFT_MESSAGE;
}

export function buildRejectedToolResultContent(reason: string | null): string {
  const effective =
    reason && reason.length > 0 ? reason : TOOL_RESULT_REJECTED_DEFAULT_REASON;
  return `Tool call rejected by user.\nReason: ${effective}`;
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toIsoOrNull(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

interface ToolCallShape {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolCallId: string;
}

/**
 * Extract tool name + args from the JSONB-stored `approval_queue.tool_call`.
 * Supports both `{command, args}` (canonical enqueue shape) and the legacy
 * `{name, arguments}` shape — same approach as the original
 * `approveAndResume` extraction.
 */
export function extractToolCall(
  rawToolCall: Record<string, unknown>,
  fallbackToolCallId: string,
): ToolCallShape {
  const name = (rawToolCall.command ?? rawToolCall.name) as string | undefined;
  const args = (rawToolCall.args ?? rawToolCall.arguments ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      "Approval tool_call missing command/name — cannot dispatch",
    );
  }
  return { toolName: name, toolArgs: args, toolCallId: fallbackToolCallId };
}
