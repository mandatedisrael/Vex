/**
 * Diagnostics — terminal stand-in for the future UI panels. Pulls the
 * live tail directly from the messages repo (no streaming hooks exist in
 * `engine/`) plus the wake / approval / mission overlays + cold-start
 * state captured by `bootstrapShell()`.
 *
 * Mutable shell state (last bootstrap result, last turn latency) lives here
 * so `commands.ts::printStatus` and
 * `commands.ts::handleDiagnostics` see a consistent picture.
 */

import * as messagesRepo from "../../../src/vex-agent/db/repos/messages.js";
import { getActiveProvider } from "../../../src/vex-agent/inference/registry.js";
import { writeLine } from "./render.js";
import {
  getMissionStatus,
  getPendingApprovalsForSession,
  getSession,
  summarizeSession,
} from "./session-host.js";
import { formatContextWindow, formatSessionCost, formatTokenCount } from "./render.js";
import { isSyncEnabled, isWakeEnabled } from "./runtime.js";
import type { BootstrapResult, ColdStartState } from "./bootstrap.js";
import { collectColdStartState } from "./bootstrap.js";

const TAIL_LIMIT = 10;
const LATENCY_BUFFER = 5;

interface BootstrapSnapshot {
  result: BootstrapResult;
  capturedAt: number;
}

let lastBootstrap: BootstrapSnapshot | null = null;
const recentLatencies: number[] = [];

export function recordBootstrapResult(result: BootstrapResult): void {
  lastBootstrap = { result, capturedAt: Date.now() };
}

export function getLastBootstrapResult(): BootstrapSnapshot | null {
  return lastBootstrap;
}

export function recordTurnLatency(latencyMs: number): void {
  recentLatencies.push(latencyMs);
  while (recentLatencies.length > LATENCY_BUFFER) recentLatencies.shift();
}

export function getLatencyStats(): { last: number | null; avg: number | null; samples: number } {
  if (recentLatencies.length === 0) return { last: null, avg: null, samples: 0 };
  const last = recentLatencies[recentLatencies.length - 1] ?? null;
  const avg = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
  return { last, avg, samples: recentLatencies.length };
}

export function renderColdStartSection(state: ColdStartState | null): void {
  writeLine("Cold-start state:");
  if (!state) {
    writeLine("  (no snapshot yet — run /status to capture)");
    return;
  }
  for (const check of state.systemChecks) {
    const mark = check.ok ? "OK" : "MISSING";
    writeLine(`  - ${check.label.padEnd(20)} ${mark}  ${check.detail}`);
  }
  const evm = state.wallets.evm;
  const sol = state.wallets.solana;
  writeLine(`  - EVM wallet         ${evm.status === "configured" ? "OK" : "MISSING"}  ${evm.detail}`);
  writeLine(`  - Solana wallet      ${sol.status === "configured" ? "OK" : "MISSING"}  ${sol.detail}`);
  writeLine(`  Snapshot age: ${ageMs(state.capturedAt)}`);
}

export function renderLastBootstrap(): void {
  writeLine("Last bootstrap:");
  if (!lastBootstrap) {
    writeLine("  (none yet)");
    return;
  }
  const { result, capturedAt } = lastBootstrap;
  const status = result.ok ? "OK" : `FAILED@${result.failure?.stage}`;
  writeLine(`  status=${status} durationMs=${result.durationMs} age=${ageMs(capturedAt)}`);
  if (result.failure) {
    writeLine(`  reason: ${result.failure.message}`);
    if (result.failure.hint) writeLine(`  hint:   ${result.failure.hint}`);
  }
}

export function renderLatency(): void {
  const stats = getLatencyStats();
  if (stats.samples === 0) {
    writeLine("Last turn latency: (no turns yet)");
    return;
  }
  writeLine(
    `Last turn latency: last=${stats.last}ms avg=${stats.avg!.toFixed(0)}ms samples=${stats.samples}`,
  );
}

export async function renderDiagnostics(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  writeLine();
  writeLine(`Diagnostics for session ${sessionId}`);
  writeLine("---");
  if (!session) {
    writeLine("Session row missing in DB.");
    return;
  }
  writeLine(
    `scope=${session.scope} mode=${session.mode} messages=${session.messageCount} tokens=${session.tokenCount}`,
  );
  writeLine(`started=${session.startedAt} ended=${session.endedAt ?? "-"}`);

  const [missionStatus, pending, messages, summary] = await Promise.all([
    getMissionStatus(sessionId),
    getPendingApprovalsForSession(sessionId),
    messagesRepo.getLiveMessages(sessionId),
    summarizeSession(sessionId),
  ]);
  const active = getActiveProvider();

  writeLine();
  writeLine(`Mission overlay: ${missionStatus ?? "none"}`);
  writeLine(`Wake executor: ${isWakeEnabled() ? "running" : "stopped"}`);
  writeLine(`Sync executor: ${isSyncEnabled() ? "running" : "stopped"}`);
  writeLine(`Active provider: ${active?.id ?? "none"}`);
  writeLine(`Context window: ${summary ? formatContextWindow(summary.context) : "none"}`);
  writeLine(`Session tokens: ${summary ? `${formatTokenCount(summary.usage.sessionTokens)} across ${summary.usage.requestCount} request(s)` : "none"}`);
  writeLine(`Session cost: ${summary ? formatSessionCost(summary.usage.sessionCost) : "none"}`);

  writeLine();
  renderColdStartSection(collectColdStartState());
  writeLine();
  renderLastBootstrap();
  writeLine();
  renderLatency();

  writeLine();
  writeLine(`Pending approvals (${pending.length}):`);
  if (pending.length === 0) {
    writeLine("  (none)");
  } else {
    for (const a of pending) {
      const tool = (a.toolCall.command ?? a.toolCall.name ?? "?") as string;
      writeLine(`  - ${a.id}  tool=${tool}  ${a.createdAt}`);
    }
  }

  writeLine();
  const tail = messages.slice(-TAIL_LIMIT);
  writeLine(`Last ${tail.length} message(s) (live tail, oldest first):`);
  if (tail.length === 0) {
    writeLine("  (none)");
  } else {
    for (const msg of tail) {
      const meta = msg.metadata?.messageType ?? msg.role;
      const visibility = msg.metadata?.visibility ?? "?";
      const preview = (msg.content ?? "").replace(/\s+/g, " ").slice(0, 160);
      writeLine(`  [${msg.timestamp}] role=${msg.role} type=${meta} vis=${visibility}`);
      writeLine(`    ${preview}${(msg.content?.length ?? 0) > 160 ? "…" : ""}`);
    }
  }
  writeLine();
}

function ageMs(capturedAt: number): string {
  const delta = Date.now() - capturedAt;
  if (delta < 1000) return `${delta}ms`;
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s`;
  return `${(delta / 60_000).toFixed(1)}m`;
}
