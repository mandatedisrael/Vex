/**
 * Provider env-state probe (M10).
 *
 * Mirrors the engine's runtime resolution so the wizard's skip card
 * reflects what the engine will actually pick at next startup:
 *
 *   1. If `AGENT_PROVIDER` is set to "openrouter" explicitly → use it.
 *   2. Else if `OPENROUTER_API_KEY` + `AGENT_MODEL` both present → openrouter.
 *   3. Else → null (not configured).
 *
 * `configured` = `name !== null` AND prerequisites met:
 *   - openrouter: OPENROUTER_API_KEY + AGENT_MODEL both present.
 *
 * `modelLabel`:
 *   - openrouter → AGENT_MODEL value (or null if missing). Capped at 200
 *     chars defensively.
 */

import { readEnvValue } from "./env-state.js";
import type { ProviderState } from "@shared/schemas/onboarding.js";
import { log } from "../logger/index.js";

const MAX_MODEL_LABEL = 200;

function capLabel(value: string | null): string | null {
  if (value === null) return null;
  return value.length > MAX_MODEL_LABEL
    ? value.slice(0, MAX_MODEL_LABEL)
    : value;
}

export async function probeProvider(envPath: string): Promise<ProviderState> {
  const [openRouterKey, modelValue, agentProvider] =
    await Promise.all([
      // Use `readEnvValue` (not `readEnvKeyPresence`) so `KEY=""` is
      // correctly treated as "not configured" — matches engine
      // `loadEnvConfig` which requires non-empty key.
      readEnvValue(envPath, "OPENROUTER_API_KEY"),
      readEnvValue(envPath, "AGENT_MODEL"),
      readEnvValue(envPath, "AGENT_PROVIDER"),
    ]);
  const hasOpenRouterKey = openRouterKey !== null;

  // Step 1: explicit AGENT_PROVIDER wins.
  // Bogus explicit value → engine logs error + returns null + agent won't
  // start. Mirror that here: don't fall through to fallback when user
  // explicitly chose an unsupported provider — otherwise the wizard
  // skip-card would say "openrouter configured" while the engine refuses
  // to start.
  if (agentProvider !== null) {
    if (agentProvider === "openrouter") {
      const openrouterReady = hasOpenRouterKey && modelValue !== null;
      return {
        configured: openrouterReady,
        name: "openrouter",
        modelLabel: capLabel(modelValue),
      };
    }
    // Explicit but unsupported (e.g. `AGENT_PROVIDER=bogus`) — fail closed.
    // Don't log the raw value; env values are not secrets by contract but
    // get misused. Codex turn 6 YELLOW.
    log.warn(
      `[provider-state] AGENT_PROVIDER is set to an unsupported value; treating as not configured`,
    );
    return { configured: false, name: null, modelLabel: null };
  }

  // Step 2: fallback to key+model → openrouter.
  if (hasOpenRouterKey && modelValue !== null) {
    return {
      configured: true,
      name: "openrouter",
      modelLabel: capLabel(modelValue),
    };
  }

  // Step 3: not configured.
  return { configured: false, name: null, modelLabel: null };
}
