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
  | "permissions"
  | "system"
  | "docker"
  | "database"
  | "onboarding"
  | "embedding"
  | "capabilities"
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
  "permissions",
  "system",
  "docker",
  "database",
  "onboarding",
  "embedding",
  "capabilities",
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
