/**
 * Portfolio TanStack Query hook (stage 3).
 *
 * Read-only dual-scope POSITION portfolio. A `null` active session reads
 * the GLOBAL inventory portfolio; a non-null active session reads that
 * session's wallet-scope portfolio. The renderer derives the discriminated
 * input here — it never supplies a wallet address. Empty scopes resolve to
 * the empty portfolio DTO, never an error.
 *
 * Not rendered yet (stage 4 wires the panel).
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  PortfolioDto,
  PortfolioReadInput,
} from "@shared/schemas/portfolio.js";
import { portfolioKeys } from "./queryKeys.js";

const STALE_MS = 15_000;
const REFETCH_MS = 45_000;

function portfolioInput(activeSessionId: string | null): PortfolioReadInput {
  return activeSessionId === null
    ? { scope: "global" }
    : { scope: "session", sessionId: activeSessionId };
}

function portfolioOptions(activeSessionId: string | null) {
  const input = portfolioInput(activeSessionId);
  return queryOptions({
    queryKey: portfolioKeys.read(input.scope, activeSessionId),
    queryFn: () => window.vex.portfolio.read(input),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
  });
}

export function usePortfolio(
  activeSessionId: string | null,
): UseQueryResult<Result<PortfolioDto>> {
  return useQuery(portfolioOptions(activeSessionId));
}
