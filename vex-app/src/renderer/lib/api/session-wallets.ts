/**
 * Session wallet scope TanStack Query/Mutation hooks (puzzle 1).
 *
 * Distinct from the existing `wallets.ts` api module which targets
 * onboarding wallet operations. This file owns the per-session wallet
 * scope contract that puzzle 05/10 fills in.
 *
 * `useSessionWallets` returns an empty scope today. The mutation hooks
 * (`useSetSessionWalletScope`, `useGetPreparedIntent` is read-style
 * but DB-backed in future; `useCancelPreparedIntent`) all fail-closed
 * until the wallet scope rows + intent runtime ship.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  PreparedIntentDto,
  SessionWalletScopeDto,
  WalletsActionResult,
  WalletsCancelPreparedIntentInput,
  WalletsSetScopeInput,
  WalletsSetScopeResult,
} from "@shared/schemas/wallets.js";
import { walletsKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

function sessionScopeOptions(sessionId: string) {
  return queryOptions({
    queryKey: walletsKeys.sessionScope(sessionId),
    queryFn: () => window.vex.wallets.listSessionWallets({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

function preparedIntentOptions(sessionId: string, intentId: string) {
  return queryOptions({
    queryKey: walletsKeys.preparedIntent(sessionId, intentId),
    queryFn: () =>
      window.vex.wallets.getPreparedIntent({ sessionId, intentId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0 && intentId.length > 0,
  });
}

export function useSessionWallets(
  sessionId: string | null,
): UseQueryResult<Result<SessionWalletScopeDto>> {
  return useQuery(sessionScopeOptions(sessionId ?? ""));
}

/**
 * Puzzle 5 phase 4 — both `sessionId` and `intentId` are required by the
 * IPC contract (cross-session lookup MUST miss). Pass `null` for either
 * to disable the query.
 */
export function usePreparedIntent(
  sessionId: string | null,
  intentId: string | null,
): UseQueryResult<Result<PreparedIntentDto | null>> {
  return useQuery(preparedIntentOptions(sessionId ?? "", intentId ?? ""));
}

export function useSetSessionWalletScope(): UseMutationResult<
  Result<WalletsSetScopeResult>,
  Error,
  WalletsSetScopeInput
> {
  return useMutation({
    mutationFn: (input) => window.vex.wallets.setSessionWalletScope(input),
    retry: false,
  });
}

export function useCancelPreparedIntent(): UseMutationResult<
  Result<WalletsActionResult>,
  Error,
  WalletsCancelPreparedIntentInput
> {
  return useMutation({
    mutationFn: (input) => window.vex.wallets.cancelPreparedIntent(input),
    retry: false,
  });
}
