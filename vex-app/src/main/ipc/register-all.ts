/**
 * Centralised IPC registration. Phase 1 surface only.
 *
 * Each handler returns its own teardown fn — they all flow into globalCleanup
 * so app quit / reload removes them cleanly.
 */

import { setupAgentBridges } from "../agent/index.js";
import { globalCleanup } from "../lifecycle/cleanup-registry.js";
import { registerApprovalsHandlers } from "./approvals.js";
import { registerCancelHandler } from "./cancel.js";
import { registerCapabilitiesHandler } from "./capabilities.js";
import { registerChatSubmitHandler } from "./chat.js";
import { registerCompactionHandlers } from "./compaction.js";
import { registerDatabaseHandlers } from "./database.js";
import { registerKnowledgeHandlers } from "./knowledge.js";
import { registerMemoryHandlers } from "./memory.js";
import { registerDockerHandlers } from "./docker.js";
import { registerMessagesHandlers } from "./messages.js";
import { registerMissionHandlers } from "./mission.js";
import { registerModelsHandlers } from "./models.js";
import { registerOnboardingHandlers } from "./onboarding.js";
import { registerAgentCoreHandler } from "./onboarding/agent-core.js";
import { registerApiKeysHandler } from "./onboarding/api-keys.js";
import { registerEmbeddingHandler } from "./onboarding/embedding.js";
import { registerFinalizeHandler } from "./onboarding/finalize.js";
import { registerPolymarketConfiguredAddressesHandler } from "./onboarding/polymarket-configured-addresses.js";
import { registerPolymarketSetupHandler } from "./onboarding/polymarket-setup.js";
import { registerProviderHandler } from "./onboarding/provider.js";
import { registerWalletHandlers } from "./onboarding/wallets.js";
import { registerRuntimeHandlers } from "./runtime.js";
import { registerSessionsCreateHandler } from "./sessions/create.js";
import { registerSessionsDeleteHandler } from "./sessions/delete.js";
import { registerSessionsGetHandler } from "./sessions/get.js";
import { registerSessionsGetModelHandler } from "./sessions/get-model.js";
import { registerSessionsListHandler } from "./sessions/list.js";
import { registerSessionsSetPinnedHandler } from "./sessions/set-pinned.js";
import { registerSecretsHandlers } from "./secrets.js";
import { registerSettingsHandlers } from "./settings.js";
import { registerSupportHandler } from "./support.js";
import { registerSystemHandlers } from "./system.js";
import { registerTelemetryHandler } from "./telemetry.js";
import { registerUsageHandlers } from "./usage.js";
import { registerWalletExportHandler } from "./wallet-export.js";
import { registerWalletsSessionHandlers } from "./wallets-session.js";

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
  teardowns.push(registerPolymarketConfiguredAddressesHandler());
  teardowns.push(registerEmbeddingHandler());
  teardowns.push(registerAgentCoreHandler());
  teardowns.push(registerProviderHandler());
  teardowns.push(registerFinalizeHandler());
  teardowns.push(registerSessionsCreateHandler());
  teardowns.push(registerSessionsListHandler());
  teardowns.push(registerSessionsGetHandler());
  teardowns.push(registerSessionsSetPinnedHandler());
  teardowns.push(registerSessionsDeleteHandler());
  // Agent integration puzzle 1: typed bridge surface for the chat panel,
  // runtime control, mission contract/commands, approvals, wallet scope,
  // the global model, and usage meter. Read-only handlers serve real DB
  // data; mutating handlers fail-close per the per-domain code until
  // the backing runtime ships in puzzles 03/04/05.
  teardowns.push(...registerMessagesHandlers());
  teardowns.push(...registerUsageHandlers());
  // Agent integration stage 7-1: read-only Track-2 compaction status for the
  // runtime bar. The Track-2 executor itself is owned by main and started in
  // `index.ts` (see `setupCompactWorker`), not here. Stage 7-2a extends this
  // with `compaction.listHistory` + adds read-only knowledge/memory lists for
  // the knowledge-management panel.
  teardowns.push(...registerCompactionHandlers());
  teardowns.push(...registerKnowledgeHandlers());
  teardowns.push(...registerMemoryHandlers());
  teardowns.push(...registerRuntimeHandlers());
  teardowns.push(...registerMissionHandlers());
  teardowns.push(...registerApprovalsHandlers());
  teardowns.push(...registerWalletsSessionHandlers());
  teardowns.push(...registerModelsHandlers());
  teardowns.push(registerSessionsGetModelHandler());
  teardowns.push(registerChatSubmitHandler());
  // Agent integration puzzle 2: engine -> renderer transcript event spine.
  // Subscribes the in-process transcript bus to the IPC broadcaster so
  // committed `messages` INSERTs surface as `EV.engine.transcriptAppend`.
  teardowns.push(setupAgentBridges());
  teardowns.push(...registerSettingsHandlers());
  teardowns.push(registerTelemetryHandler());
  teardowns.push(registerSupportHandler());

  globalCleanup.add(() => {
    for (const t of teardowns) t();
  });
}
