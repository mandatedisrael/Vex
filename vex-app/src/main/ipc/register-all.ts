/**
 * Centralised IPC registration. Phase 1 surface only.
 *
 * Each handler returns its own teardown fn — they all flow into globalCleanup
 * so app quit / reload removes them cleanly.
 */

import { globalCleanup } from "../lifecycle/cleanup-registry.js";
import { registerCancelHandler } from "./cancel.js";
import { registerCapabilitiesHandler } from "./capabilities.js";
import { registerChatSubmitHandler } from "./chat.js";
import { registerDatabaseHandlers } from "./database.js";
import { registerDockerHandlers } from "./docker.js";
import { registerOnboardingHandlers } from "./onboarding.js";
import { registerAgentCoreHandler } from "./onboarding/agent-core.js";
import { registerApiKeysHandler } from "./onboarding/api-keys.js";
import { registerEmbeddingHandler } from "./onboarding/embedding.js";
import { registerFinalizeHandler } from "./onboarding/finalize.js";
import { registerPolymarketSetupHandler } from "./onboarding/polymarket-setup.js";
import { registerProviderHandler } from "./onboarding/provider.js";
import { registerWalletHandlers } from "./onboarding/wallets.js";
import { registerSessionsCreateHandler } from "./sessions/create.js";
import { registerSessionsDeleteHandler } from "./sessions/delete.js";
import { registerSessionsGetHandler } from "./sessions/get.js";
import { registerSessionsListHandler } from "./sessions/list.js";
import { registerSessionsSetPinnedHandler } from "./sessions/set-pinned.js";
import { registerSecretsHandlers } from "./secrets.js";
import { registerSettingsHandlers } from "./settings.js";
import { registerSupportHandler } from "./support.js";
import { registerSystemHandlers } from "./system.js";
import { registerTelemetryHandler } from "./telemetry.js";
import { registerWalletExportHandler } from "./wallet-export.js";

export function registerAllIpcHandlers(): void {
  const teardowns: Array<() => void> = [];

  teardowns.push(registerCancelHandler());
  teardowns.push(registerCapabilitiesHandler());
  teardowns.push(...registerSystemHandlers());
  teardowns.push(...registerDockerHandlers());
  teardowns.push(...registerDatabaseHandlers());
  teardowns.push(...registerSecretsHandlers());
  teardowns.push(...registerOnboardingHandlers());
  teardowns.push(...registerWalletHandlers());
  teardowns.push(registerWalletExportHandler());
  teardowns.push(registerApiKeysHandler());
  teardowns.push(registerPolymarketSetupHandler());
  teardowns.push(registerEmbeddingHandler());
  teardowns.push(registerAgentCoreHandler());
  teardowns.push(registerProviderHandler());
  teardowns.push(registerFinalizeHandler());
  teardowns.push(registerSessionsCreateHandler());
  teardowns.push(registerSessionsListHandler());
  teardowns.push(registerSessionsGetHandler());
  teardowns.push(registerSessionsSetPinnedHandler());
  teardowns.push(registerSessionsDeleteHandler());
  teardowns.push(registerChatSubmitHandler());
  teardowns.push(...registerSettingsHandlers());
  teardowns.push(registerTelemetryHandler());
  teardowns.push(registerSupportHandler());

  globalCleanup.add(() => {
    for (const t of teardowns) t();
  });
}
