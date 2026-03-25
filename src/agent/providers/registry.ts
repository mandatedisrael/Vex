/**
 * Provider registry — resolves and caches the active inference provider.
 *
 * Resolution order:
 * 1. AGENT_PROVIDER env var (explicit choice)
 * 2. OPENROUTER_API_KEY present → OpenRouter
 * 3. compute-state.json exists → 0G Compute
 * 4. null (agent won't start)
 */

import type { InferenceProvider } from "./types.js";
import { loadComputeState } from "../../0g-compute/readiness.js";
import logger from "../../utils/logger.js";

// ── Lazy imports to avoid loading unused provider dependencies ────────

async function createZeroGProvider(): Promise<InferenceProvider> {
  const { ZeroGProvider } = await import("./0g-compute.js");
  return new ZeroGProvider();
}

async function createOpenRouterProvider(): Promise<InferenceProvider> {
  const { OpenRouterProvider } = await import("./openrouter.js");
  return new OpenRouterProvider();
}

const PROVIDER_FACTORIES: Record<string, () => Promise<InferenceProvider>> = {
  "0g-compute": createZeroGProvider,
  "openrouter": createOpenRouterProvider,
};

// ── Cached singleton ─────────────────────────────────────────────────

let cachedProvider: InferenceProvider | null = null;

/**
 * Resolve which provider to use based on config/env.
 * Returns null if no provider is configured.
 */
export async function resolveProvider(): Promise<InferenceProvider | null> {
  if (cachedProvider) return cachedProvider;

  const explicit = process.env.AGENT_PROVIDER?.toLowerCase();

  // 1. Explicit env var — fail-fast on unknown value (§2.10)
  if (explicit && !PROVIDER_FACTORIES[explicit]) {
    logger.error("provider.unknown", {
      provider: explicit,
      supported: Object.keys(PROVIDER_FACTORIES),
      hint: "Check AGENT_PROVIDER env var for typos",
    });
    return null;
  }
  if (explicit && PROVIDER_FACTORIES[explicit]) {
    try {
      cachedProvider = await PROVIDER_FACTORIES[explicit]();
      logger.info("provider.resolved", { provider: explicit, source: "AGENT_PROVIDER" });
      return cachedProvider;
    } catch (err) {
      logger.error("provider.resolve_failed", { provider: explicit, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  // 2. OpenRouter API key present
  if (process.env.OPENROUTER_API_KEY) {
    try {
      cachedProvider = await createOpenRouterProvider();
      logger.info("provider.resolved", { provider: "openrouter", source: "OPENROUTER_API_KEY" });
      return cachedProvider;
    } catch (err) {
      logger.warn("provider.openrouter.init_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 3. 0G Compute state exists
  if (loadComputeState()) {
    try {
      cachedProvider = await createZeroGProvider();
      logger.info("provider.resolved", { provider: "0g-compute", source: "compute-state.json" });
      return cachedProvider;
    } catch (err) {
      logger.warn("provider.0g.init_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.error("provider.none_configured", {
    hint: "Set OPENROUTER_API_KEY or configure 0G Compute via 'echoclaw echo connect'",
  });
  return null;
}

/** Get the cached provider (must call resolveProvider first). */
export function getActiveProvider(): InferenceProvider | null {
  return cachedProvider;
}

/** Reset cached provider (for tests). */
export function resetProvider(): void {
  cachedProvider = null;
}
