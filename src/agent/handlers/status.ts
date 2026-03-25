/**
 * Status and usage handlers (Postgres-backed, reads real loop state).
 */

import { registerRoute, jsonResponse } from "../routes.js";
import * as soulRepo from "../db/repos/soul.js";
import * as memoryRepo from "../db/repos/memory.js";
import * as knowledgeRepo from "../db/repos/knowledge.js";
import * as usageRepo from "../db/repos/usage.js";
import * as approvalsRepo from "../db/repos/approvals.js";
import * as sessionsRepo from "../db/repos/sessions.js";
import * as loopRepo from "../db/repos/loop.js";
import * as backupRepo from "../db/repos/backup.js";
import { loadComputeState } from "../../0g-compute/readiness.js";
import { getInferenceConfig } from "../engine.js";
import { getActiveProvider } from "../providers/registry.js";
import { getAgentPackageVersion } from "../compose.js";
import { DEFAULT_CONTEXT_LIMIT, COMPACTION_THRESHOLD } from "../constants.js";
import { runEchoPapaCycle } from "../echo-papa.js";
import type { AgentStatus } from "../types.js";
import logger from "../../utils/logger.js";

export function registerStatusRoutes(): void {
  registerRoute("GET", "/api/agent/status", async (_req, res) => {
    const computeState = loadComputeState();
    const [usage, pendingApprovals, sessions, loop, lastBackup] = await Promise.all([
      usageRepo.getUsageStats(),
      approvalsRepo.getPendingCount(),
      sessionsRepo.listSessionsByScope("chat", 1),
      loopRepo.getLoopState(),
      backupRepo.getLastBackup(),
    ]);
    const latestSession = sessions[0];

    const memoryEntries = await memoryRepo.listEntriesWithIds();

    const status: AgentStatus = {
      running: true,
      model: getInferenceConfig()?.model ?? computeState?.model ?? null,
      provider: getActiveProvider()?.displayName ?? computeState?.activeProvider ?? null,
      hasSoul: await soulRepo.hasSoul(),
      memorySize: await memoryRepo.getMemorySize(),
      knowledgeFileCount: await knowledgeRepo.fileCount(),
      sessionId: latestSession?.id ?? null,
      sessionMessageCount: latestSession?.message_count ?? 0,
      sessionTokenCount: latestSession?.token_count ?? 0,
      sessionStartedAt: latestSession?.started_at ?? null,
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      compactionThreshold: COMPACTION_THRESHOLD,
      memoryEntryCount: memoryEntries.length,
      usage: { ...usage, lastBackupAt: lastBackup?.createdAt ?? null },
      loop,
      pendingApprovals,
      version: getAgentPackageVersion(),
    };

    jsonResponse(res, 200, status);
  });

  registerRoute("GET", "/api/agent/usage", async (_req, res) => {
    const usage = await usageRepo.getUsageStats();
    jsonResponse(res, 200, usage);
  });

  /** Trigger a manual Echo Papa maintenance cycle. */
  registerRoute("POST", "/api/agent/memory/cleanup", async (_req, res) => {
    try {
      const report = await runEchoPapaCycle();
      jsonResponse(res, 200, report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("echo_papa.manual_cycle_failed", { error: msg });
      jsonResponse(res, 500, { error: msg });
    }
  });
}
