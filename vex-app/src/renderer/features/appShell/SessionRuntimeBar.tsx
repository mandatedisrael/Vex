/**
 * Session runtime bar — model + usage + context, shown under the session
 * context strip (agent integration puzzle 06).
 *
 * Four independent facts, each self-gating on ITS OWN data (NOT on model
 * configuration — usage rows + token_count persist across config changes,
 * so a currently-unconfigured model must not hide historical usage):
 *
 *  - **model**: the global runtime model the engine resolves from
 *    `AGENT_PROVIDER`/`AGENT_MODEL` (`sessions.getModel`). Brand icon +
 *    name when configured, a muted "Model not configured" otherwise.
 *  - **usage**: last-turn in/out tokens + session cost (`usage_log`).
 *    Renders nothing until the session has at least one turn.
 *  - **context**: tokens used vs the global limit. `null` result (missing
 *    /deleted session) → no meter; `null` limit (invalid config) → token
 *    count without a bar.
 *  - **compaction** (stage 7-1): Track-2 worker status — "compacting" /
 *    "queued" / "failed", or hidden when nothing is in flight. The chip
 *    names the remote (OpenRouter, redacted) path in its accessible label,
 *    since the worker is enabled by default.
 *
 * The model/usage/context reads are kept fresh by `useUsageLiveSync`
 * (mounted in `SessionPanel`) + the chat-submit success invalidation;
 * compaction has its own poll + `useCompactionLiveSync` (mounted here,
 * since background Track-2 completion fires no transcript event).
 */

import type { JSX } from "react";
import type { SessionModelDto } from "@shared/schemas/sessions.js";
import type {
  ContextWindowDto,
  SessionUsageTotalsDto,
  TurnUsageDto,
} from "@shared/schemas/usage.js";
import type { CompactionStatusDto } from "@shared/schemas/compaction.js";
import {
  useContextWindow,
  useLastTurnUsage,
  useSessionUsageTotals,
} from "../../lib/api/usage.js";
import {
  useCompactionLiveSync,
  useCompactionStatus,
} from "../../lib/api/compaction.js";
import { useSessionModel } from "../../lib/api/sessions.js";
import { ModelBrandIcon } from "../wizard/steps/provider/ModelBrandIcon.js";

export interface SessionRuntimeBarProps {
  readonly sessionId: string;
}

export function SessionRuntimeBar({
  sessionId,
}: SessionRuntimeBarProps): JSX.Element {
  useCompactionLiveSync(sessionId);

  const modelQuery = useSessionModel(sessionId);
  const lastTurnQuery = useLastTurnUsage(sessionId);
  const totalsQuery = useSessionUsageTotals(sessionId);
  const contextQuery = useContextWindow(sessionId);
  const compactionQuery = useCompactionStatus(sessionId);

  const model = modelQuery.data?.ok ? modelQuery.data.data : null;
  const lastTurn = lastTurnQuery.data?.ok ? lastTurnQuery.data.data : null;
  const totals = totalsQuery.data?.ok ? totalsQuery.data.data : null;
  const context = contextQuery.data?.ok ? contextQuery.data.data : null;
  const compaction = compactionQuery.data?.ok
    ? compactionQuery.data.data
    : null;

  return (
    <div
      data-vex-area="runtime-status"
      role="group"
      aria-label="Session runtime status"
      className="flex w-full flex-wrap items-center gap-2 text-[11px] text-[var(--vex-text-3)]"
    >
      <ModelIndicator model={model} />
      <UsageChip lastTurn={lastTurn} totals={totals} />
      <ContextMeter context={context} />
      <CompactionChip status={compaction} />
    </div>
  );
}

const PILL =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px]";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(cost: number): string {
  return cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
}

/**
 * Sign-aware cost formatter for cache savings. `fmtCost(-0.0012)` would
 * render the misleading "$-0.0012"; negative NET savings (cache overhead /
 * cache net) format the magnitude and carry an explicit minus sign. No
 * pricing math here — the value arrives computed from the main process.
 */
function fmtSignedCost(cost: number): string {
  return cost < 0 ? `−${fmtCost(Math.abs(cost))}` : fmtCost(cost);
}

function ModelIndicator({
  model,
}: {
  readonly model: SessionModelDto | null;
}): JSX.Element {
  if (model === null || model.source === "unconfigured" || model.modelId === null) {
    return (
      <span
        data-vex-area="session-model-indicator"
        data-state="unconfigured"
        aria-label="Model not configured"
        className="inline-flex items-center rounded-md px-2 py-1 text-[10px] text-[var(--vex-text-3)]"
      >
        Model not configured
      </span>
    );
  }
  return (
    <span
      data-vex-area="session-model-indicator"
      data-state="configured"
      aria-label={`Model: ${model.modelId}`}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
      title={`Global model${model.provider !== null ? ` · ${model.provider}` : ""} · ${model.modelId}`}
    >
      <ModelBrandIcon modelId={model.modelId} size={13} />
      <span className="max-w-[220px] truncate font-mono text-[10px] text-foreground">
        {model.modelId}
      </span>
    </span>
  );
}

function UsageChip({
  lastTurn,
  totals,
}: {
  readonly lastTurn: TurnUsageDto | null;
  readonly totals: SessionUsageTotalsDto | null;
}): JSX.Element | null {
  const hasTurns =
    lastTurn !== null || (totals !== null && totals.requestCount > 0);
  if (!hasTurns) return null;

  const cost = totals?.totalCost ?? null;
  // Cached (read-from-cache) tokens for the last turn, and the cumulative
  // tokens billed across the whole session — both already captured/summed in
  // the DB; surfaced here so the on-screen accounting is complete, not just
  // hidden in the tooltip.
  const cached =
    lastTurn !== null && lastTurn.cachedTokens > 0 ? lastTurn.cachedTokens : null;
  const sessionTotal =
    totals !== null && totals.totalTokens > 0 ? totals.totalTokens : null;

  return (
    <span
      data-vex-area="usage-meter"
      className={`${PILL} text-[var(--vex-text-3)]`}
      title={buildUsageTitle(lastTurn, totals)}
    >
      {lastTurn !== null ? (
        <span aria-label="last turn tokens">
          ↑{fmtTokens(lastTurn.promptTokens)} ↓
          {fmtTokens(lastTurn.completionTokens)}
        </span>
      ) : null}
      {cached !== null ? (
        <span aria-label="cached tokens">⚡{fmtTokens(cached)}</span>
      ) : null}
      {sessionTotal !== null ? (
        <span aria-label="session total tokens">Σ{fmtTokens(sessionTotal)}</span>
      ) : null}
      {cost !== null ? (
        <span aria-label="session cost">{fmtCost(cost)}</span>
      ) : null}
    </span>
  );
}

function buildUsageTitle(
  lastTurn: TurnUsageDto | null,
  totals: SessionUsageTotalsDto | null,
): string {
  const lines: string[] = [];
  if (lastTurn !== null) {
    lines.push(
      `Last turn: ${lastTurn.promptTokens} in / ${lastTurn.completionTokens} out` +
        ` (${lastTurn.totalTokens} total)`,
    );
    // Per-turn cache line: when a NET savings figure exists and is non-zero
    // it annotates the cached-token count (positive = saved, negative =
    // overhead from cache writes); otherwise fall back to the plain
    // cached-token line. Values arrive computed — no pricing math here.
    const turnSavings = lastTurn.cachedSavings;
    if (turnSavings !== null && turnSavings !== 0) {
      lines.push(
        turnSavings > 0
          ? `Cached: ${lastTurn.cachedTokens} tokens (saved ~${fmtSignedCost(turnSavings)})`
          : `Cached: ${lastTurn.cachedTokens} tokens (cache overhead ${fmtCost(Math.abs(turnSavings))})`,
      );
    } else if (lastTurn.cachedTokens > 0) {
      lines.push(`Cached: ${lastTurn.cachedTokens} tokens read from cache`);
    }
    if (lastTurn.reasoningTokens > 0) {
      lines.push(`Reasoning: ${lastTurn.reasoningTokens} tokens`);
    }
  }
  if (totals !== null) {
    lines.push(
      `Session: ${totals.totalTokens} tokens over ${totals.requestCount} request(s)`,
    );
    if (totals.totalCost !== null) {
      lines.push(`Cost: ${fmtCost(totals.totalCost)} ${totals.currency}`);
    }
    const sessionSavings = totals.totalCachedSavings;
    if (sessionSavings !== null && sessionSavings !== 0) {
      lines.push(
        sessionSavings > 0
          ? `Cache savings: ${fmtSignedCost(sessionSavings)} total`
          : `Cache net: ${fmtSignedCost(sessionSavings)} total`,
      );
    }
  }
  return lines.join("\n");
}

function ContextMeter({
  context,
}: {
  readonly context: ContextWindowDto | null;
}): JSX.Element | null {
  // `null` = session missing/deleted/out-of-scope → no meter at all.
  if (context === null) return null;

  const { tokensUsed, contextLimit } = context;

  // Invalid configured limit → show the (approximate) token count without
  // a bar rather than a fabricated denominator.
  if (contextLimit === null) {
    return (
      <span
        data-vex-area="session-context-meter"
        data-state="no-limit"
        className={PILL}
        title="Context limit unavailable (invalid AGENT_CONTEXT_LIMIT)"
      >
        ctx {fmtTokens(tokensUsed)}
      </span>
    );
  }

  const pct =
    contextLimit > 0
      ? Math.min(100, Math.max(0, Math.round((tokensUsed / contextLimit) * 100)))
      : 0;

  return (
    <span
      data-vex-area="session-context-meter"
      data-state="ok"
      className={PILL}
      title={`Context (approx, lags one turn): ${tokensUsed} / ${contextLimit} tokens`}
      aria-label={`Context ${pct}% used`}
    >
      <span
        className="relative h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.12]"
        aria-hidden
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--vex-accent)]"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span>{pct}%</span>
    </span>
  );
}

const COMPACTION_REMOTE_NOTE =
  "Builds session memory from older messages via your OpenRouter model; " +
  "the transcript is redacted before it is sent.";

function CompactionChip({
  status,
}: {
  readonly status: CompactionStatusDto | null;
}): JSX.Element | null {
  // `null` = session missing/deleted/out-of-scope → no chip.
  if (status === null) return null;

  const running = status.latest?.status === "running";
  const active = status.activeCount > 0;

  let label: string;
  let state: "running" | "queued" | "failed";
  if (active) {
    label = running ? "Compacting…" : "Compaction queued";
    state = running ? "running" : "queued";
  } else if (status.latest?.status === "permanently_failed") {
    label = "Compaction failed";
    state = "failed";
  } else {
    // Nothing in flight and no terminal failure → keep the bar uncluttered.
    return null;
  }

  // The remote-path note lives in `aria-label` (NOT title-only) so it is
  // accessible without hover; `title` mirrors it for sighted pointer users.
  // Full remote diagnostics land in stage 7-4.
  return (
    <span
      data-vex-area="session-compaction-chip"
      data-state={state}
      className={`${PILL} ${
        state === "failed"
          ? "text-[var(--vex-warn-text)]"
          : "text-[var(--vex-text-3)]"
      }`}
      title={`${label} · ${COMPACTION_REMOTE_NOTE}`}
      aria-label={`Compaction status: ${label}. ${COMPACTION_REMOTE_NOTE}`}
    >
      {label}
    </span>
  );
}
