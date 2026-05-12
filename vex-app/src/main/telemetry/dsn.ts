/**
 * Sentry DSN resolver — kept Sentry-free so `capabilities.get()` can
 * decide whether to expose the consent checkbox without paying the
 * @sentry/electron import cost (codex v3 hard fix #2: lazy import).
 *
 * Phase 1 source: `process.env.VEX_SENTRY_DSN`. Empty / absent → null
 * → renderer hides the consent control. M14 will add a build-time
 * baked fallback (Vite `define` injecting `VITE_VEX_SENTRY_DSN` from
 * the CI release secret) so packaged dev builds without a runtime
 * env var still report telemetry when the operator opts in.
 *
 * The string is treated as opaque — no parsing, no validation. Sentry
 * itself rejects malformed DSNs at `Sentry.init()` time and we surface
 * that as `telemetryWarning` on the finalize result rather than
 * pretending we can validate the format here.
 */

export function resolveDsn(): string | null {
  const raw = process.env["VEX_SENTRY_DSN"];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
