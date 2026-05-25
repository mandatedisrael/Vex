/**
 * Shared `feature_unavailable` factory for puzzle-1 fail-closed handlers.
 *
 * Per Codex review: closed `VexErrorCode` union is a public contract, so
 * we add codes only for what we actually emit. Each puzzle-1 mutating
 * handler whose backing runtime lives in a later puzzle returns the
 * per-domain `*.feature_unavailable` code with `retryable: false,
 * userActionable: true` so the renderer surfaces "not available yet"
 * without firing an automatic bug report.
 *
 * The helper sets `correlationId` to `ctx.requestId`; `registerHandler`
 * re-stamps it on mismatch so the boundary stays auditable.
 */

import type { VexDomain, VexError, VexErrorCode } from "@shared/ipc/result.js";

/**
 * Domain → code map for fail-closed mutations. Adding a domain here
 * requires the matching error code to live in `VEX_ERROR_CODES` (and in
 * the `VexErrorCode` union); the type checker enforces both at compile
 * time. Read-only handlers must NOT use this helper — DB unavailability
 * for them maps to `internal.unexpected` per the `*-db.ts` modules.
 */
export type FeatureUnavailableDomain =
  | "runtime"
  | "mission"
  | "approvals"
  | "wallets";

const CODE_BY_DOMAIN: Readonly<Record<FeatureUnavailableDomain, VexErrorCode>> = {
  runtime: "runtime.feature_unavailable",
  mission: "mission.feature_unavailable",
  approvals: "approvals.feature_unavailable",
  wallets: "wallets.feature_unavailable",
};

export interface FeatureUnavailableArgs {
  readonly domain: FeatureUnavailableDomain;
  readonly correlationId: string;
  readonly message: string;
}

export function featureUnavailable(args: FeatureUnavailableArgs): VexError {
  const domain: VexDomain = args.domain;
  return {
    code: CODE_BY_DOMAIN[args.domain],
    domain,
    message: args.message,
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId: args.correlationId,
  };
}
