/**
 * Render helpers — thin wrappers around `cli/setup/ui.ts` so the shell
 * cockpit looks like the existing connect flow without copying any of it.
 *
 * Provider / Engine / Wake / Session sections are shell-specific because
 * the launcher does not have an equivalent.
 */

import {
  renderEnvStatuses,
  renderSection,
  renderWalletStatuses,
} from "../../../src/cli/setup/ui.js";
import {
  collectEnvFieldStatuses,
  getEvmWalletStatus,
  getSolanaWalletStatus,
} from "../../../src/cli/setup/status.js";
import type { ContextUsageBand } from "../../../src/vex-agent/engine/core/context-band.js";
import type { BootstrapResult } from "./bootstrap.js";
import { isSyncEnabled, isWakeEnabled } from "./runtime.js";

export interface ProviderSummary {
  name: "openrouter" | "none";
  detail: string;
}

export interface SessionSummary {
  id: string;
  kind: "agent" | "mission";
  missionStatus: string | null;
  missionCommand: "start" | "continue" | null;
  pendingApprovals: number;
  usage: TokenUsageSummary;
  context: ContextWindowSummary;
}

export interface TokenUsageSummary {
  sessionTokens: number;
  sessionCost: number;
  requestCount: number;
  lastRequestAt: string | null;
}

export interface ContextWindowSummary {
  promptTokens: number;
  limit: number;
  percent: number;
  band: ContextUsageBand;
}

export function writeLine(text: string = ""): void {
  process.stderr.write(`${text}\n`);
}

export function renderHeader(): void {
  writeLine();
  writeLine("Vex Shell — local harness over the real Vex Agent engine");
  writeLine("Private. Not published. Not an MCP transport.");
  writeLine();
}

export function renderEnvironmentSection(): void {
  renderEnvStatuses(collectEnvFieldStatuses());
}

export function renderWalletsSection(): void {
  renderWalletStatuses([getEvmWalletStatus(), getSolanaWalletStatus()]);
}

export function renderEngineSection(result: BootstrapResult): void {
  renderSection("Engine");
  if (result.ok) {
    writeLine("- Status: OK (env validated, migrations applied, probes green)");
    return;
  }
  const failure = result.failure!;
  writeLine(`- Status: FAILED at stage "${failure.stage}"`);
  writeLine(`- Reason: ${failure.message}`);
  if (failure.hint) {
    writeLine(`- Hint:   ${failure.hint}`);
  }
}

export function renderProviderSection(provider: ProviderSummary): void {
  renderSection("Provider");
  writeLine(`- Active: ${provider.name}`);
  writeLine(`- Detail: ${provider.detail}`);
}

export function renderSessionSection(session: SessionSummary | null): void {
  renderSection("Session");
  if (!session) {
    writeLine("- None (no active session in this shell)");
    return;
  }
  writeLine(`- ID:       ${session.id}`);
  writeLine(`- Mode:     ${session.kind}`);
  writeLine(`- Mission:  ${session.missionStatus ?? "none"}`);
  writeLine(`- Command:  ${session.missionCommand ? `/mission ${session.missionCommand}` : "none"}`);
  writeLine(`- Pending:  ${session.pendingApprovals} approval(s)`);
  writeLine(`- Context:  ${formatContextWindow(session.context)}`);
  writeLine(`- Tokens:   ${formatTokenCount(session.usage.sessionTokens)} total, ${session.usage.requestCount} request(s)`);
}

export function renderWakeSection(): void {
  renderSection("Wake executor");
  writeLine(`- State: ${isWakeEnabled() ? "running" : "stopped"}`);
  writeLine(`- Sync:  ${isSyncEnabled() ? "running" : "stopped"}`);
}

export function renderPrompt(session: SessionSummary | null, provider: ProviderSummary): string {
  const runtime = `wake=${isWakeEnabled() ? "on" : "off"} sync=${isSyncEnabled() ? "on" : "off"}`;
  if (!session) {
    return `[local_shell] no-session provider=${provider.name} ${runtime}`;
  }
  const mission = session.missionStatus ?? "none";
  return `[local_shell] session=${session.id.slice(0, 8)} mode=${session.kind} mission=${mission} provider=${provider.name} approvals=${session.pendingApprovals} ${runtime}`;
}

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${trimFixed(value / 1_000, 1)}k`;
  return `${trimFixed(value / 1_000_000, 1)}M`;
}

export function formatContextWindow(context: ContextWindowSummary): string {
  const percent = Number.isFinite(context.percent) ? Math.max(0, context.percent) : 0;
  return `${formatTokenCount(context.promptTokens)}/${formatTokenCount(context.limit)} ${trimFixed(percent, 1)}% ${context.band}`;
}

export function formatSessionCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.0000";
  if (value < 0.0001) return value.toExponential(2);
  return value.toFixed(4);
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
