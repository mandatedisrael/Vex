import type { Result } from "../../../ipc/result.js";
import type {
  ContextWindowInput,
  ContextWindowResult,
  LastTurnUsageResult,
  SessionUsageTotalsDto,
  UsageInput,
} from "../../../schemas/usage.js";

/**
 * Usage meter — last-turn snapshot + session totals from `usage_log`,
 * plus the context-window projection (session `token_count` vs the
 * global context limit). Empty sessions resolve to all-zero totals +
 * `null` last-turn; `getContextWindow` returns `null` for a
 * missing/deleted session, never an error.
 */
export interface UsageBridge {
  readonly getSessionTotals: (
    input: UsageInput
  ) => Promise<Result<SessionUsageTotalsDto>>;
  readonly getLastTurn: (
    input: UsageInput
  ) => Promise<Result<LastTurnUsageResult>>;
  readonly getContextWindow: (
    input: ContextWindowInput
  ) => Promise<Result<ContextWindowResult>>;
}
