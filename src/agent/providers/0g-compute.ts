/**
 * 0G Compute inference provider.
 *
 * Decentralized AI inference on the 0G Network.
 * Auth via broker HMAC signing, billing via on-chain ledger.
 * Extracted from inference.ts and billing.ts.
 *
 * @see https://0g.ai
 */

import type { InferenceConfig } from "../types.js";
import type { InferenceProvider, ProviderBalance } from "./types.js";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { getServiceMetadata, listChatServices, getLedgerBalance, getSubAccountBalance } from "../../0g-compute/operations.js";
import { loadComputeState } from "../../0g-compute/readiness.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { retryWithBackoff } from "../resilience.js";
import { DEFAULT_CONTEXT_LIMIT } from "../constants.js";
import logger from "../../utils/logger.js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_INPUT_PRICE_PER_M = 1.0;
const DEFAULT_OUTPUT_PRICE_PER_M = 3.2;
const DEFAULT_RECOMMENDED_MIN_OG = 1.0;
const DEFAULT_ALERT_THRESHOLD_OG = 1.2;
const BALANCE_CACHE_TTL_MS = 30_000;

// ── Provider implementation ──────────────────────────────────────────

export class ZeroGProvider implements InferenceProvider {
  readonly id = "0g-compute";
  readonly displayName = "0G Compute";

  /** 0G-specific: alert threshold and recommended minimum */
  private alertThresholdOg = DEFAULT_ALERT_THRESHOLD_OG;
  private recommendedMinOg = DEFAULT_RECOMMENDED_MIN_OG;

  /** Balance cache to avoid excessive on-chain reads */
  private cachedBalance: ProviderBalance | null = null;
  private cachedAt = 0;

  async loadConfig(): Promise<InferenceConfig | null> {
    const state = loadComputeState();
    if (!state) {
      logger.warn("provider.0g.no_compute_state", { hint: "Run 'echoclaw echo connect' first" });
      return null;
    }

    try {
      const broker = await getAuthenticatedBroker();
      const metadata = await getServiceMetadata(broker, state.activeProvider);

      let inputPricePerM = DEFAULT_INPUT_PRICE_PER_M;
      let outputPricePerM = DEFAULT_OUTPUT_PRICE_PER_M;

      try {
        const services = await listChatServices(broker);
        const svc = services.find(s => s.provider.toLowerCase() === state.activeProvider.toLowerCase());
        if (svc) {
          inputPricePerM = parseFloat(formatPricePerMTokens(svc.inputPrice));
          outputPricePerM = parseFloat(formatPricePerMTokens(svc.outputPrice));
          const pricing = calculateProviderPricing(svc.inputPrice, svc.outputPrice);
          this.recommendedMinOg = pricing.recommendedMinLockedOg;
          this.alertThresholdOg = pricing.recommendedAlertLockedOg;
          logger.info("provider.0g.pricing_loaded", {
            inputPricePerM, outputPricePerM,
            recommendedMinOg: this.recommendedMinOg,
          });
        }
      } catch {
        logger.warn("provider.0g.pricing_fallback", { inputPricePerM, outputPricePerM });
      }

      return {
        provider: state.activeProvider,
        model: state.model ?? metadata.model,
        endpoint: metadata.endpoint,
        contextLimit: DEFAULT_CONTEXT_LIMIT,
        inputPricePerM,
        outputPricePerM,
        priceCurrency: "0G",
      };
    } catch (err) {
      logger.error("provider.0g.config_failed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  async getAuthHeaders(content: string): Promise<Record<string, string>> {
    const broker = await getAuthenticatedBroker();
    const state = loadComputeState();
    if (!state) throw new Error("0G Compute state not available");
    const headers = await broker.inference.getRequestHeaders(state.activeProvider, content);
    return headers as unknown as Record<string, string>;
  }

  async getBalance(): Promise<ProviderBalance | null> {
    const now = Date.now();
    if (this.cachedBalance && (now - this.cachedAt) < BALANCE_CACHE_TTL_MS) {
      return this.cachedBalance;
    }

    const state = loadComputeState();
    if (!state) return null;

    try {
      const broker = await getAuthenticatedBroker();
      const ledger = await retryWithBackoff(
        () => getLedgerBalance(broker),
        { maxRetries: 2, baseDelayMs: 1000 },
        "0g-ledger",
      );
      const subAccount = await retryWithBackoff(
        () => getSubAccountBalance(broker, state.activeProvider),
        { maxRetries: 2, baseDelayMs: 1000 },
        "0g-sub-account",
      );

      if (!ledger) return null;

      const lockedOg = subAccount?.lockedOg ?? 0;
      const isLow = lockedOg < this.alertThresholdOg;

      this.cachedBalance = {
        availableDisplay: `${lockedOg.toFixed(4)} 0G`,
        availableRaw: lockedOg,
        currency: "0G",
        isLow,
        lowBalanceMessage: isLow
          ? `Low compute balance: ${lockedOg.toFixed(4)} 0G (threshold: ${this.alertThresholdOg.toFixed(4)} 0G)`
          : undefined,
        total: ledger.totalOg,
        available: ledger.availableOg,
        locked: lockedOg,
      };
      this.cachedAt = now;

      return this.cachedBalance;
    } catch (err) {
      logger.warn("provider.0g.balance_failed", { error: err instanceof Error ? err.message : String(err) });
      return this.cachedBalance; // return stale cache
    }
  }

  getEndpoint(config: InferenceConfig): string {
    return config.endpoint;
  }
}
