/**
 * Centralised IPC registration. Phase 1 surface only.
 *
 * Each handler returns its own teardown fn — they all flow into globalCleanup
 * so app quit / reload removes them cleanly.
 */

import { globalCleanup } from "../lifecycle/cleanup-registry.js";
import { registerCapabilitiesHandler } from "./capabilities.js";
import { registerDatabaseHandlers } from "./database.js";
import { registerDockerHandlers } from "./docker.js";
import { registerOnboardingHandlers } from "./onboarding.js";
import { registerAgentCoreHandler } from "./onboarding/agent-core.js";
import { registerApiKeysHandler } from "./onboarding/api-keys.js";
import { registerEmbeddingHandler } from "./onboarding/embedding.js";
import { registerFinalizeHandler } from "./onboarding/finalize.js";
import { registerModeHandler } from "./onboarding/mode.js";
import { registerProviderHandler } from "./onboarding/provider.js";
import { registerWakeHandler } from "./onboarding/wake.js";
import { registerWalletHandlers } from "./onboarding/wallets.js";
import { registerSettingsHandlers } from "./settings.js";
import { registerSystemHandlers } from "./system.js";
import { registerTelemetryHandler } from "./telemetry.js";

export function registerAllIpcHandlers(): void {
  const teardowns: Array<() => void> = [];

  teardowns.push(registerCapabilitiesHandler());
  teardowns.push(...registerSystemHandlers());
  teardowns.push(...registerDockerHandlers());
  teardowns.push(...registerDatabaseHandlers());
  teardowns.push(...registerOnboardingHandlers());
  teardowns.push(...registerWalletHandlers());
  teardowns.push(registerApiKeysHandler());
  teardowns.push(registerEmbeddingHandler());
  teardowns.push(registerAgentCoreHandler());
  teardowns.push(registerProviderHandler());
  teardowns.push(registerModeHandler());
  teardowns.push(registerWakeHandler());
  teardowns.push(registerFinalizeHandler());
  teardowns.push(...registerSettingsHandlers());
  teardowns.push(registerTelemetryHandler());

  globalCleanup.add(() => {
    for (const t of teardowns) t();
  });
}
