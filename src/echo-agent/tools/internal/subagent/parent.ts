/**
 * Subagent parent tools — spawn, status, stop, reply.
 */

import { randomUUID } from "node:crypto";
import * as subagentsRepo from "@echo-agent/db/repos/subagents.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import * as subagentMessagesRepo from "@echo-agent/db/repos/subagent-messages.js";
import { loadEnvConfig, loadSubagentConfig } from "@echo-agent/inference/config.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str, num, bool, enumField, ok, fail } from "../types.js";
import logger from "@utils/logger.js";
import {
  activeSubagents,
  validateOwnership,
  isToolResult,
  startSubagentExecution,
  formatSubagent,
} from "./lifecycle.js";

// ── subagent_spawn ──────────────────────────────────────────────

export async function handleSubagentSpawn(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const name = str(params, "name");
  const task = str(params, "task");
  if (!name || !task) return fail("Missing required: name, task");

  const envConfig = loadEnvConfig();
  const subConfig = loadSubagentConfig(envConfig);

  if (activeSubagents.size >= subConfig.maxConcurrent) {
    return fail(`Max concurrent subagents (${subConfig.maxConcurrent}) reached. Wait for one to complete.`);
  }

  for (const [, sub] of activeSubagents) {
    if (sub.name === name) {
      return fail(`Subagent "${name}" is already running. Choose a different name.`);
    }
  }

  const allowTrades = bool(params, "allow_trades");
  const maxIterations = num(params, "max_iterations") ?? subConfig.maxIterations;
  // Memory scope strategy — default is "isolated" (server-enforced, not schema
  // default, because LLMs frequently omit even declared defaults). 'shared' is
  // the legacy opt-in for delegate-style subagents whose checkpoints should
  // contribute to the parent's episode pool. 'isolated' gives the subagent its
  // own memory_scope_key so parent recall never surfaces subagent episodes
  // (and vice versa) — this avoids context leaks between unrelated sibling
  // subagents running concurrently.
  const scopeStrategy = enumField(params, "scope_strategy", ["isolated", "shared"] as const) ?? "isolated";
  const subagentId = `subagent-${randomUUID()}`;
  const childSessionId = `session-${randomUUID()}`;

  await subagentsRepo.insert({ id: subagentId, name, task, allowTrades, maxIterations });
  await sessionsRepo.createSession(childSessionId);
  await sessionsRepo.setScope(childSessionId, "subagent");
  // Resolve memory_scope_key from the chosen strategy:
  //   - isolated: new scope keyed on the child session (own pool)
  //   - shared:   inherit parent's memoryScopeKey (fallback: parent sessionId)
  // Isolation is NOT transitive — a grandchild spawned as 'isolated' from a
  // 'shared' child still gets its own scope; a grandchild spawned as 'shared'
  // from an 'isolated' child inherits the child's (isolated) scope, not the
  // grandparent's. 'shared' semantics are per-level.
  let resolvedScope: string;
  if (scopeStrategy === "shared") {
    const parentSession = await sessionsRepo.getSession(context.sessionId);
    resolvedScope = parentSession?.memoryScopeKey ?? context.sessionId;
  } else {
    resolvedScope = childSessionId;
  }
  await sessionsRepo.setMemoryScopeKey(childSessionId, resolvedScope);
  await sessionLinksRepo.linkSessions(context.sessionId, childSessionId, "subagent", subagentId);

  logger.info("subagent.spawned", {
    id: subagentId,
    name,
    childSessionId,
    allowTrades,
    maxIterations,
    scopeStrategy,
    resolvedScope,
  });

  startSubagentExecution(subagentId, name);

  return ok({
    id: subagentId,
    name,
    sessionId: childSessionId,
    task: task.slice(0, 200),
    allowTrades,
    maxIterations,
    scopeStrategy,
    message: `Subagent "${name}" spawned (ID: ${subagentId}, scope: ${scopeStrategy}). Use subagent_status to check progress.`,
  });
}

// ── subagent_status ─────────────────────────────────────────────

export async function handleSubagentStatus(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const id = str(params, "id") || undefined;

  if (id) {
    // Hard ownership guard for specific subagent
    const check = await validateOwnership(id, context.sessionId);
    if (isToolResult(check)) return check;
    const { subagent: sub } = check;

    const formatted = formatSubagent(sub);

    // Enrich with pending request for waiting subagents
    if (sub.status === "waiting_for_parent") {
      const pending = await subagentMessagesRepo.getUnhandled(id, "to_parent", "request_parent");
      if (pending.length > 0) {
        const latest = pending[pending.length - 1];
        formatted.pendingRequest = {
          messageId: latest.id,
          question: latest.content,
          payload: latest.payloadJson,
          createdAt: latest.createdAt,
        };
      }
    }

    // Include latest report for completed subagents
    if (sub.status === "completed") {
      const reports = await subagentMessagesRepo.getMessagesByType(id, "report_complete");
      if (reports.length > 0) {
        const latest = reports[0]; // DESC order
        formatted.report = {
          summary: latest.content,
          findings: latest.payloadJson,
          createdAt: latest.createdAt,
        };
      }
    }

    return ok(formatted);
  }

  // List all — no hard ownership guard, but soft enrichment only for owned
  const active = await subagentsRepo.getActive();
  const recent = await subagentsRepo.getRecent(10);
  const seen = new Set(active.map(s => s.id));
  const all = [...active, ...recent.filter(s => !seen.has(s.id))];

  if (all.length === 0) {
    return ok({ message: "No active or recent subagents", subagents: [] });
  }

  return ok({ count: all.length, subagents: all.map(formatSubagent) });
}

// ── subagent_stop ───────────────────────────────────────────────

export async function handleSubagentStop(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const id = str(params, "id");
  if (!id) return fail("Missing required: id");

  // Ownership guard
  const check = await validateOwnership(id, context.sessionId);
  if (isToolResult(check)) return check;

  const active = activeSubagents.get(id);
  if (active) {
    active.abortController.abort();
    activeSubagents.delete(id);
  }

  await subagentsRepo.updateStatus(id, "stopped");
  logger.info("subagent.stopped", { id });

  return ok({ id, stopped: true, message: `Subagent ${id} stopped` });
}

// ── subagent_reply (parent → child) ─────────────────────────────

export async function handleSubagentReply(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const subagentId = str(params, "id");
  const reply = str(params, "reply");
  const messageId = num(params, "message_id");
  if (!subagentId || !reply) return fail("Missing required: id, reply");

  // Ownership guard
  const check = await validateOwnership(subagentId, context.sessionId);
  if (isToolResult(check)) return check;
  const { subagent: sub } = check;

  if (sub.status !== "waiting_for_parent") {
    return fail(`Subagent ${subagentId} is not waiting for parent (status: ${sub.status})`);
  }

  // 1. Send reply to child
  await subagentMessagesRepo.sendStructuredMessage(
    subagentId, "to_child", reply, "reply", { reply }, messageId ?? undefined,
  );

  // 2. Mark original request as handled
  if (messageId) {
    await subagentMessagesRepo.markHandled(messageId);
  }

  // 3. Atomowe przejście: waiting_for_parent → running (CAS guard)
  await subagentsRepo.updateStatus(subagentId, "running");

  // 4. Resume via shared lifecycle helper — fire-and-forget
  startSubagentExecution(subagentId, sub.name);

  logger.info("subagent.resumed", { id: subagentId, name: sub.name });

  return ok({
    subagentId,
    replied: true,
    message: `Reply sent to subagent "${sub.name}". Subagent resumed.`,
  });
}
