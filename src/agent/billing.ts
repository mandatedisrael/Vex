/**
 * Compute billing — provider-agnostic balance tracking and burn rate.
 *
 * Delegates balance reads to the active InferenceProvider.
 * Records billing snapshots to Postgres for history/analytics.
 */

import { getActiveProvider } from "./providers/registry.js";
import type { ProviderBalance } from "./providers/types.js";
import * as billingRepo from "./db/repos/billing.js";
import * as usageRepo from "./db/repos/usage.js";
import type { InferenceConfig } from "./types.js";
import logger from "../utils/logger.js";

// ── Provider balance (delegated) ─────────────────────────────────────

/**
 * Get current provider balance via the active provider.
 * Returns null if no provider or provider doesn't expose balance.
 */
export async function getProviderBalance(): Promise<ProviderBalance | null> {
  const provider = getActiveProvider();
  if (!provider) return null;
  return provider.getBalance();
}

// ── Billing snapshots ────────────────────────────────────────────────

/**
 * Record a billing snapshot after each inference request.
 */
export async function recordBillingSnapshot(providerId: string, sessionBurn: number): Promise<void> {
  const balance = await getProviderBalance();
  if (!balance) return;

  await billingRepo.insertSnapshot({
    providerBalance: balance.total ?? balance.availableRaw,
    providerAvailable: balance.available ?? balance.availableRaw,
    providerLocked: balance.locked ?? balance.availableRaw,
    sessionCost: sessionBurn,
    provider: providerId,
    currency: balance.currency,
  });
}

// ── Billing state (for API) ──────────────────────────────────────────

export interface BillingState {
  providerBalance: number;
  providerCurrency: string;
  sessionBurn: number;
  lifetimeBurn: number;
  avgCostPerRequest: number;
  estimatedRequestsRemaining: number;
  isLowBalance: boolean;
  model: string;
  pricing: { inputPerM: string; outputPerM: string; currency: string };
  fetchedAt: string;
}

/**
 * Build full billing state for API response.
 */
export async function getBillingState(config: InferenceConfig, sessionId?: string): Promise<BillingState> {
  const balance = await getProviderBalance();
  const usage = await usageRepo.getUsageStats(sessionId);

  const avgCost = usage.requestCount > 0 ? usage.lifetimeCost / usage.requestCount : 0;
  const available = balance?.availableRaw ?? null;
  const estimatedRemaining = avgCost > 0 && available != null ? Math.floor(available / avgCost) : 0;

  return {
    providerBalance: available ?? 0,
    providerCurrency: balance?.currency ?? config.priceCurrency,
    sessionBurn: usage.sessionCost,
    lifetimeBurn: usage.lifetimeCost,
    avgCostPerRequest: avgCost,
    estimatedRequestsRemaining: estimatedRemaining,
    isLowBalance: balance?.isLow ?? false,
    model: config.model,
    pricing: {
      inputPerM: config.inputPricePerM.toFixed(4),
      outputPerM: config.outputPricePerM.toFixed(4),
      currency: config.priceCurrency,
    },
    fetchedAt: new Date().toISOString(),
  };
}
