import { query, queryOne, execute } from "../client.js";

export async function logUsage(sessionId: string, promptTokens: number, completionTokens: number, cost: number, provider?: string, currency?: string): Promise<void> {
  await execute(
    "INSERT INTO usage_log (session_id, prompt_tokens, completion_tokens, total_tokens, cost, provider, currency) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [sessionId, promptTokens, completionTokens, promptTokens + completionTokens, cost, provider ?? null, currency ?? null],
  );
}

export interface UsageStats {
  sessionTokens: number;
  sessionCost: number;
  lifetimeTokens: number;
  lifetimeCost: number;
  requestCount: number;
  lastRequestAt: string | null;
}

/**
 * Get usage stats, optionally filtered by currency to avoid blending 0G and USD.
 */
export async function getUsageStats(sessionId?: string, currency?: string): Promise<UsageStats> {
  // Lifetime totals — filter by currency if provided to prevent blending providers
  const currencyClause = currency ? " WHERE currency = $1" : "";
  const currencyParams = currency ? [currency] : [];

  const lifetime = await queryOne<{ tokens: string; cost: string; count: string; last: string | null }>(
    `SELECT COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost),0) AS cost, COUNT(*) AS count, MAX(created_at) AS last FROM usage_log${currencyClause}`,
    currencyParams,
  );

  // Session totals
  let sessionTokens = 0, sessionCost = 0;
  if (sessionId) {
    const sessionClause = currency ? " AND currency = $2" : "";
    const sessionParams = currency ? [sessionId, currency] : [sessionId];
    const session = await queryOne<{ tokens: string; cost: string }>(
      `SELECT COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost),0) AS cost FROM usage_log WHERE session_id = $1${sessionClause}`,
      sessionParams,
    );
    sessionTokens = parseInt(session?.tokens ?? "0", 10);
    sessionCost = parseFloat(session?.cost ?? "0");
  }

  return {
    sessionTokens,
    sessionCost,
    lifetimeTokens: parseInt(lifetime?.tokens ?? "0", 10),
    lifetimeCost: parseFloat(lifetime?.cost ?? "0"),
    requestCount: parseInt(lifetime?.count ?? "0", 10),
    lastRequestAt: lifetime?.last ?? null,
  };
}
