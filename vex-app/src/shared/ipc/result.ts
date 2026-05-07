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
  | "wallet.keystore_locked"
  | "wallet.keystore_corrupt"
  | "wallet.password_invalid"
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
  /** Stable id for correlating renderer-visible error with main-process logs. */
  readonly correlationId?: string;
}

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
