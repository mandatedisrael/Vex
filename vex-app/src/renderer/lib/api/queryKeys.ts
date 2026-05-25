/**
 * TanStack Query key factories per skill §5. Centralised so M2-M5 view
 * code never assembles raw key arrays inline (and so invalidation
 * targets — `queryClient.invalidateQueries({ queryKey: dockerKeys.all })`
 * — touch every consumer atomically).
 */

export const systemKeys = {
  all: ["system"] as const,
  health: () => ["system", "health"] as const,
  osInfo: () => ["system", "osInfo"] as const,
  network: () => ["system", "network"] as const,
};

export const dockerKeys = {
  all: ["docker"] as const,
  status: () => ["docker", "status"] as const,
};

export const onboardingKeys = {
  all: ["onboarding"] as const,
  envState: () => ["onboarding", "envState"] as const,
  wizardState: () => ["onboarding", "wizardState"] as const,
  // Puzzle 5 B-UI — lowercased EVM addresses with Polymarket creds configured.
  polymarketConfiguredAddresses: () =>
    ["onboarding", "polymarketConfiguredAddresses"] as const,
};

// ── Agent integration puzzle 1 ────────────────────────────────────────
// Each factory namespaces queries under a stable root so cross-cutting
// invalidation (`queryClient.invalidateQueries({ queryKey: messagesKeys.all })`)
// targets every consumer at once. Mutation hooks for fail-closed
// handlers do NOT invalidate query caches — there is no state change to
// surface until the matching puzzle ships the runtime.

// Puzzle 02 re-key: `sessionId` lives at position 1 so the live-event
// hook (`useTranscriptLiveSync`) can call
// `queryClient.invalidateQueries({ queryKey: messagesKeys.forSession(s) })`
// and match every tail / list / around variant for that session at once.
// Previous layout had `sessionId` at position 2 (after "tail"/"list"/
// "around"), which forced a per-variant + per-limit invalidation walk.
export const messagesKeys = {
  all: ["messages"] as const,
  /**
   * Prefix for every messages query of a session. Used as the
   * invalidation target on `engine.transcriptAppend` so any active
   * variant (tail with any limit, list with any cursor, around with any
   * window) refetches in one call.
   */
  forSession: (sessionId: string) => ["messages", sessionId] as const,
  tail: (sessionId: string, limit: number) =>
    ["messages", sessionId, "tail", { limit }] as const,
  list: (sessionId: string, limit: number, cursorId: number | null) =>
    ["messages", sessionId, "list", { limit, cursorId }] as const,
  around: (
    sessionId: string,
    messageId: number,
    before: number,
    after: number,
  ) =>
    ["messages", sessionId, "around", messageId, { before, after }] as const,
};

export const usageKeys = {
  all: ["usage"] as const,
  sessionTotals: (sessionId: string, currency: string) =>
    ["usage", "sessionTotals", sessionId, { currency }] as const,
  lastTurn: (sessionId: string, currency: string) =>
    ["usage", "lastTurn", sessionId, { currency }] as const,
  contextWindow: (sessionId: string) =>
    ["usage", "contextWindow", sessionId] as const,
};

/**
 * Predicate for invalidating every usage query of one session at once.
 * All `usageKeys` factories intentionally keep `sessionId` at index 2
 * (`["usage", <kind>, sessionId, ...]`), so the live-sync hook and the
 * chat-submit success handler can target one session without
 * enumerating each kind/currency variant. Named here so the positional
 * contract is stated once.
 */
export function isUsageQueryForSession(
  queryKey: readonly unknown[],
  sessionId: string,
): boolean {
  return queryKey[0] === "usage" && queryKey[2] === sessionId;
}

export const runtimeKeys = {
  all: ["runtime"] as const,
  state: (sessionId: string) => ["runtime", "state", sessionId] as const,
};

export const missionKeys = {
  all: ["mission"] as const,
  draft: (sessionId: string) => ["mission", "draft", sessionId] as const,
  /**
   * Puzzle 04 phase 6 — contract status (current vs. accepted hash +
   * isAccepted/isDirty booleans). Used by MissionContractCard to
   * gate the Accept button.
   */
  diff: (sessionId: string, missionId: string) =>
    ["mission", "diff", sessionId, missionId] as const,
  /**
   * Puzzle 04 phase 7 — latest terminal accepted mission for
   * `/mission-renew`. Returns `{ missionId }` or null. Invalidated on
   * any mutation that may flip a mission to terminal (start, stop,
   * recover) or accept a new contract.
   */
  renewableSource: (sessionId: string) =>
    ["mission", "renewableSource", sessionId] as const,
};

export const approvalsKeys = {
  all: ["approvals"] as const,
  pending: (sessionId: string) => ["approvals", "pending", sessionId] as const,
  detail: (id: string) => ["approvals", "detail", id] as const,
  history: (sessionId: string, limit: number) =>
    ["approvals", "history", sessionId, { limit }] as const,
};

export const walletsKeys = {
  all: ["wallets"] as const,
  available: () => ["wallets", "available"] as const,
  sessionScope: (sessionId: string) =>
    ["wallets", "sessionScope", sessionId] as const,
  preparedIntent: (sessionId: string, intentId: string) =>
    ["wallets", "preparedIntent", sessionId, intentId] as const,
};

export const modelsKeys = {
  all: ["models"] as const,
  available: () => ["models", "available"] as const,
};

export const sessionModelKeys = {
  all: ["sessionModel"] as const,
  detail: (sessionId: string) =>
    ["sessionModel", "detail", sessionId] as const,
};
