/**
 * Typed Result<T, VexError> envelope per skill §6.
 *
 * Renderer NEVER receives raw thrown errors. Main process logs internal errors
 * with correlation IDs and redacts public output. All IPC handlers return Result<T>.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type VexDomain =
  | "wallet"
  | "agents"
  | "chat"
  | "services"
  | "data"
  | "settings"
  | "updater"
  | "telemetry"
  | "support"
  | "permissions"
  | "system"
  | "docker"
  | "database"
  | "onboarding"
  | "embedding"
  | "capabilities"
  /**
   * Agent integration puzzle 1 — dedicated domains for the typed bridge
   * surface (`vex.<domain>.<method>`). Each owns its DTO contracts and any
   * `<domain>.feature_unavailable` codes the read-only or fail-closed
   * handlers emit. Adding a handler under one of these domains MUST go
   * through the matching shared schema; ad-hoc dot-property strings in
   * channel constants without a paired schema/DTO are rejected by review.
   */
  | "messages"
  | "runtime"
  | "mission"
  | "approvals"
  | "wallets"
  | "models"
  | "usage"
  /**
   * Agent integration stage 7-1 — read-only `compaction.getStatus`
   * (Track-2 worker job status for the runtime bar). Electron main owns
   * the executor; this domain is purely the status read surface. DB
   * unavailability maps to `internal.unexpected` like the other read
   * domains (no `compaction.feature_unavailable` — there is no mutation).
   */
  | "compaction"
  /**
   * Used by the read-only `sessions.getModel` handler (global runtime
   * model resolution). Existing sessions handlers
   * (`vex:sessions:create|list|get|setPinned|delete`) deliberately keep
   * `domain: "internal"` as a historical marker — migrating them is a
   * separate follow-up.
   */
  | "sessions"
  /** Used by the preload boundary when input fails its own Zod schema before reaching main. */
  | "preload"
  /** Reserved for unexpected internal errors that don't fit a specific domain. */
  | "internal";

export type VexErrorCode =
  | "validation.invalid_input"
  | "validation.invalid_sender"
  | "permissions.denied"
  | "wallet.insufficient_funds"
  | "wallet.user_rejected"
  | "wallet.risk_confirmation_required"
  | "wallet.policy_blocked"
  | "wallet.export_throttled"
  | "wallet.keystore_locked"
  | "wallet.keystore_corrupt"
  | "wallet.keystore_missing"
  | "wallet.password_invalid"
  | "wallet.vault_not_configured"
  | "wallet.cap_reached"
  | "wallet.address_exists"
  | "wallet.not_found"
  | "secrets.unlock_throttled"
  | "services.docker_unavailable"
  | "services.port_in_use"
  | "services.healthcheck_failed"
  | "services.compose_failed"
  | "data.search_unavailable"
  | "data.migration_failed"
  | "update.check_failed"
  | "update.download_failed"
  | "update.apply_failed"
  | "onboarding.step_failed"
  | "onboarding.env_persist_failed"
  | "embedding.dim_locked"
  | "embedding.db_unavailable"
  | "embedding.defaults_unavailable"
  | "provider.invalid_api_key"
  | "provider.insufficient_credits"
  | "provider.model_unsupported"
  | "provider.polymarket_setup_failed"
  | "provider.unavailable"
  | "provider.test_failed"
  | "support.persist_failed"
  /**
   * Agent integration puzzle 1 — per-domain `feature_unavailable` codes.
   * Emitted by fail-closed mutating handlers whose backing runtime lands
   * in a later puzzle (runtime control = 03, mission contract/commands =
   * 04, approval queue runtime = 05, wallet scope/intents = 05/10). These
   * are `retryable: false,
   * userActionable: true` so the renderer surfaces "not yet available"
   * without triggering an automatic bug report. Read-only handlers do
   * not return these codes — DB unavailability still maps to
   * `internal.unexpected` via the per-domain wrapper.
   */
  | "runtime.feature_unavailable"
  | "mission.feature_unavailable"
  | "approvals.feature_unavailable"
  | "wallets.feature_unavailable"
  | "wallets.invalid_selection"
  /**
   * Puzzle 5 phase 3 — approve/reject runtime semantics. Surfaced when the
   * IPC handler observes a non-actionable state of the approval intent or
   * its mission run; the renderer renders a "cannot proceed" toast rather
   * than retrying. `retryable: false, userActionable: true, redacted: true`.
   *
   *  - `approvals.expired`           — `expires_at` lapsed before approve;
   *                                    auto-rejection applied + run resumed.
   *  - `approvals.already_resolved`  — concurrent decision wrote first
   *                                    (race with another operator or sweep).
   *  - `approvals.run_terminated`    — mission run reached a terminal status
   *                                    after the approval was enqueued.
   *  - `approvals.dispatch_failed`   — approved tool dispatch threw an
   *                                    unhandled exception; run flipped to
   *                                    `paused_error`.
   */
  | "approvals.expired"
  | "approvals.already_resolved"
  | "approvals.run_terminated"
  | "approvals.dispatch_failed"
  | "internal.contract_violation"
  | "internal.cancelled"
  | "internal.unexpected";

export interface VexError {
  readonly code: VexErrorCode;
  readonly domain: VexDomain;
  /** Public, user-safe message. NEVER contains secrets, raw stack traces, or PII. */
  readonly message: string;
  readonly retryable: boolean;
  readonly userActionable: boolean;
  /** Always `true` — a marker that this error has been intentionally redacted by main. */
  readonly redacted: true;
  readonly details?: Readonly<Record<string, JsonValue>>;
  /**
   * Stable id for correlating renderer-visible error with main-process logs.
   * Required so every error surface (UI, support copy, telemetry) can be traced
   * back to the originating request. `registerHandler` generates a UUID on the
   * main side if the inbound envelope was malformed, so this field is never
   * missing at the IPC boundary.
   */
  readonly correlationId: string;
  /**
   * Optional backoff hint in milliseconds. Set by rate-limited operations
   * (e.g. `secrets.unlock_throttled`) so the renderer can render a precise
   * "Try again in Xs" message. Not present on errors without a retry window.
   */
  readonly retryAfterMs?: number;
}

/**
 * Runtime mirror of the `VexErrorCode` union for boundary validation. Keep
 * this array in sync with the type union above when adding a code. The
 * `satisfies` clause catches typos in this array; the type-level
 * exhaustiveness assertion at the bottom of this file catches the OTHER
 * direction (missing entries when the union grows). Either way the build
 * fails before a code can slip through.
 */
export const VEX_ERROR_CODES = [
  "validation.invalid_input",
  "validation.invalid_sender",
  "permissions.denied",
  "wallet.insufficient_funds",
  "wallet.user_rejected",
  "wallet.risk_confirmation_required",
  "wallet.policy_blocked",
  "wallet.export_throttled",
  "wallet.keystore_locked",
  "wallet.keystore_corrupt",
  "wallet.keystore_missing",
  "wallet.password_invalid",
  "wallet.vault_not_configured",
  "wallet.cap_reached",
  "wallet.address_exists",
  "wallet.not_found",
  "secrets.unlock_throttled",
  "services.docker_unavailable",
  "services.port_in_use",
  "services.healthcheck_failed",
  "services.compose_failed",
  "data.search_unavailable",
  "data.migration_failed",
  "update.check_failed",
  "update.download_failed",
  "update.apply_failed",
  "onboarding.step_failed",
  "onboarding.env_persist_failed",
  "embedding.dim_locked",
  "embedding.db_unavailable",
  "embedding.defaults_unavailable",
  "provider.invalid_api_key",
  "provider.insufficient_credits",
  "provider.model_unsupported",
  "provider.polymarket_setup_failed",
  "provider.unavailable",
  "provider.test_failed",
  "support.persist_failed",
  "runtime.feature_unavailable",
  "mission.feature_unavailable",
  "approvals.feature_unavailable",
  "wallets.feature_unavailable",
  "wallets.invalid_selection",
  "approvals.expired",
  "approvals.already_resolved",
  "approvals.run_terminated",
  "approvals.dispatch_failed",
  "internal.contract_violation",
  "internal.cancelled",
  "internal.unexpected",
] as const satisfies readonly VexErrorCode[];

/** Runtime mirror of `VexDomain`. Same maintenance note as `VEX_ERROR_CODES`. */
export const VEX_DOMAINS = [
  "wallet",
  "agents",
  "chat",
  "services",
  "data",
  "settings",
  "updater",
  "telemetry",
  "support",
  "permissions",
  "system",
  "docker",
  "database",
  "onboarding",
  "embedding",
  "capabilities",
  "messages",
  "runtime",
  "mission",
  "approvals",
  "wallets",
  "models",
  "usage",
  "compaction",
  "sessions",
  "preload",
  "internal",
] as const satisfies readonly VexDomain[];

export type Result<T, E extends VexError = VexError> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <E extends VexError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

/** Exhaustive switch helper — call from default branch to assert all variants handled. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

// ── Type-level exhaustiveness checks ────────────────────────────────────────
// If a future contributor adds a new code/domain to the union above but
// forgets to mirror it into the runtime array, these assignments fail to
// compile because the `Exclude<...>` type is no longer `never`.

type _MissingCodes = Exclude<VexErrorCode, (typeof VEX_ERROR_CODES)[number]>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _vexErrorCodesAreExhaustive: [_MissingCodes] extends [never] ? true : false = true;

type _MissingDomains = Exclude<VexDomain, (typeof VEX_DOMAINS)[number]>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _vexDomainsAreExhaustive: [_MissingDomains] extends [never] ? true : false = true;
