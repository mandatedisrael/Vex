/**
 * Inference configuration — ENV validation at startup.
 *
 * All configurable values come from .env — validated on load, fail fast.
 * Internal technical constants (timeouts, retry params) are NOT from ENV.
 *
 * M9 refactor: AGENT_ and SUBAGENT_ range plus default constants
 * moved to `src/lib/agent-config.ts` (single source of truth, shared
 * with vex-app onboarding writers and the vex-shell wizard). Engine
 * behavior preserved:
 *  - AGENT_ keys: parse errors aggregated and thrown (combined message).
 *  - SUBAGENT_ keys: parse errors fall back silently with `logger.warn`.
 *
 * @see Team Standards §16.1 Config as code, §16.2 Validation at startup
 */

import {
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
  formatParseErrors,
  parseAgentEnv,
  parseSubagentEnv,
} from "../../lib/agent-config.js";
import logger from "@utils/logger.js";

// ── ENV-loaded config (validated at startup) ─────────────────────

export type ProviderType = "openrouter";

export interface EnvConfig {
  /** Explicit provider choice — auto-detected if not set */
  agentProvider: ProviderType | null;
  /** Context window size in tokens */
  contextLimit: number;
  /** OpenRouter API key — required if provider=openrouter */
  openrouterApiKey: string | null;
  /** Model ID — required for OpenRouter */
  agentModel: string | null;
  /** Sampling temperature — OpenRouter only */
  temperature: number | null;
  /** Max output tokens per response */
  maxOutputTokens: number;
}

const VALID_PROVIDERS = new Set<string>(["openrouter"]);

/**
 * Load and validate all inference ENV variables.
 * Fail fast on invalid values — agent should not start with bad config.
 */
export function loadEnvConfig(): EnvConfig {
  const errors: string[] = [];

  // AGENT_PROVIDER (optional — auto-detected). Local validation —
  // this field is not in agent-config.ts because it's an enum, not a
  // numeric range.
  const rawProvider = process.env.AGENT_PROVIDER?.toLowerCase().trim() ?? null;
  let agentProvider: ProviderType | null = null;
  if (rawProvider !== null) {
    if (!VALID_PROVIDERS.has(rawProvider)) {
      errors.push(`AGENT_PROVIDER="${rawProvider}" is invalid. Must be: openrouter`);
    } else {
      agentProvider = rawProvider as ProviderType;
    }
  }

  // OPENROUTER_API_KEY + AGENT_MODEL — strings, no numeric validation.
  const openrouterApiKey = process.env.OPENROUTER_API_KEY?.trim() ?? null;
  const agentModel = process.env.AGENT_MODEL?.trim() ?? null;

  // AGENT_CONTEXT_LIMIT / AGENT_MAX_OUTPUT_TOKENS / AGENT_TEMPERATURE —
  // delegated to shared parser (returns collected ParseErrors so we
  // preserve the "throw all at once" engine contract).
  const agentParse = parseAgentEnv(process.env);
  for (const e of agentParse.errors) {
    if (e.reason === "out_of_range") {
      errors.push(
        `${e.key}="${e.raw}" is invalid. Must be ${e.detail?.min ?? "?"}-${e.detail?.max ?? "?"}`,
      );
    } else {
      errors.push(`${e.key}="${e.raw}" is invalid. Must be a number`);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error("inference.config.validation_failed", { error: err });
    }
    throw new Error(`Inference config validation failed:\n${errors.join("\n")}`);
  }

  return {
    agentProvider,
    contextLimit: agentParse.value.contextLimit,
    openrouterApiKey,
    agentModel,
    temperature: agentParse.value.temperature,
    maxOutputTokens: agentParse.value.maxOutputTokens,
  };
}

// ── Subagent config (ENV with fallbacks from AGENT_*) ───────────

export interface SubagentConfig {
  maxConcurrent: number;
  contextLimit: number;
  maxOutputTokens: number;
  temperature: number | null;
  maxIterations: number;
  timeoutMs: number;
}

export function loadSubagentConfig(agentConfig: EnvConfig): SubagentConfig {
  const result = parseSubagentEnv(process.env, {
    contextLimit: agentConfig.contextLimit,
    maxOutputTokens: agentConfig.maxOutputTokens,
    temperature: agentConfig.temperature,
  });
  if (result.errors.length > 0) {
    // Engine contract: SUBAGENT_* invalid values fall back silently
    // (parseSubagentEnv already returned the fallback in `value`).
    // Log warnings so ops can see misconfiguration without breaking
    // agent startup. vex-app onboarding writer enforces strict
    // validation at the write boundary.
    logger.warn(formatParseErrors("SUBAGENT_* env values invalid (using fallback):", result.errors));
  }
  return result.value;
}

// ── Re-exports of public field metadata ──────────────────────────
// vex-shell wizard + vex-app onboarding both import from
// `src/lib/agent-config.ts` directly. These are kept here for
// backward compatibility with any in-tree consumer that already
// imports from this module.
export { AGENT_CONTEXT_LIMIT, AGENT_MAX_OUTPUT_TOKENS, AGENT_TEMPERATURE };

// ── Internal constants (not from ENV — technical invariants) ─────

/** Streaming inference timeout (5 min) */
export const INFERENCE_TIMEOUT_MS = 300_000;

/** Non-streaming inference timeout (2 min) */
export const INFERENCE_SIMPLE_TIMEOUT_MS = 120_000;

/** Balance cache TTL (30s) */
export const BALANCE_CACHE_TTL_MS = 30_000;

/** OpenRouter app URL for rankings */
export const OPENROUTER_APP_URL = "https://vexlabs.ai";

/** OpenRouter app display name */
export const OPENROUTER_APP_TITLE = "Vex Agent";

/** OpenRouter app category */
export const OPENROUTER_APP_CATEGORY = "cli-agent";

/** OpenRouter low balance threshold (USD) */
export const OPENROUTER_LOW_BALANCE_USD = 5.0;

/** OpenRouter SDK timeout (5 min) */
export const OPENROUTER_SDK_TIMEOUT_MS = 300_000;

/** Retry: max attempts for inference calls */
export const INFERENCE_MAX_RETRIES = 2;

/** Retry: initial backoff delay */
export const INFERENCE_BASE_DELAY_MS = 2000;

/** Retry: max backoff delay */
export const INFERENCE_MAX_DELAY_MS = 15_000;
