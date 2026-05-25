/**
 * Session runtime bar — model + usage + context, shown under the session
 * context strip (agent integration puzzle 06).
 *
 * Three independent facts, each self-gating on ITS OWN data (NOT on model
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
 *
 * All four reads are TanStack queries kept fresh by `useUsageLiveSync`
 * (mounted in `SessionPanel`) + the chat-submit success invalidation.
 */

import type { JSX } from "react";
import type { SessionModelDto } from "@shared/schemas/sessions.js";
import type {
  ContextWindowDto,
  SessionUsageTotalsDto,
  TurnUsageDto,
} from "@shared/schemas/usage.js";
import {
  useContextWindow,
  useLastTurnUsage,
  useSessionUsageTotals,
} from "../../lib/api/usage.js";
import { useSessionModel } from "../../lib/api/sessions.js";
import { ModelBrandIcon } from "../wizard/steps/provider/ModelBrandIcon.js";

export interface SessionRuntimeBarProps {
  readonly sessionId: string;
}

export function SessionRuntimeBar({
  sessionId,
}: SessionRuntimeBarProps): JSX.Element {
  const modelQuery = useSessionModel(sessionId);
  const lastTurnQuery = useLastTurnUsage(sessionId);
  const totalsQuery = useSessionUsageTotals(sessionId);
  const contextQuery = useContextWindow(sessionId);

  const model = modelQuery.data?.ok ? modelQuery.data.data : null;
  const lastTurn = lastTurnQuery.data?.ok ? lastTurnQuery.data.data : null;
  const totals = totalsQuery.data?.ok ? totalsQuery.data.data : null;
  const context = contextQuery.data?.ok ? contextQuery.data.data : null;

  return (
    <div
      data-vex-area="session-runtime-bar"
      className="flex w-full flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]"
    >
      <ModelIndicator model={model} />
      <UsageChip lastTurn={lastTurn} totals={totals} />
      <ContextMeter context={context} />
    </div>
  );
}

const PILL =
  "inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 font-mono text-[10px]";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(cost: number): string {
  return cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
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
        className="inline-flex items-center rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-[var(--color-text-muted)]"
      >
        Model not configured
      </span>
    );
  }
  return (
    <span
      data-vex-area="session-model-indicator"
      data-state="configured"
      className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1"
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

  return (
    <span
      data-vex-area="session-usage-chip"
      className={`${PILL} text-[var(--color-text-muted)]`}
      title={buildUsageTitle(lastTurn, totals)}
    >
      {lastTurn !== null ? (
        <span aria-label="last turn tokens">
          ↑{fmtTokens(lastTurn.promptTokens)} ↓
          {fmtTokens(lastTurn.completionTokens)}
        </span>
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
  }
  if (totals !== null) {
    lines.push(
      `Session: ${totals.totalTokens} tokens over ${totals.requestCount} request(s)`,
    );
    if (totals.totalCost !== null) {
      lines.push(`Cost: ${fmtCost(totals.totalCost)} ${totals.currency}`);
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
          className="absolute inset-y-0 left-0 rounded-full bg-[#6f91ff]"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span>{pct}%</span>
    </span>
  );
}
