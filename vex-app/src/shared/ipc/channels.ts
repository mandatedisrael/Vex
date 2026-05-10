/**
 * IPC channel name constants — single source of truth shared between main + preload + renderer.
 *
 * Naming per skill §6:
 *   vex:<domain>:<action>          — request/response (ipcMain.handle / ipcRenderer.invoke)
 *   vex:event:<domain>:<topic>     — main → renderer push event
 *   vex:stream:<domain>:<topic>    — main → renderer streaming chunks
 *   vex:cancel                     — renderer → main cancellation by requestId
 */

// ── Phase 1 channels (M0–M12) ───────────────────────────────────────────────
export const CH = {
  // Capabilities — feature flags, phase, onboarding completion
  capabilities: {
    get: "vex:capabilities:get",
  },

  // System — health, OS info, network probe
  system: {
    health: "vex:system:health",
    osInfo: "vex:system:osInfo",
    network: "vex:system:network",
  },

  // Docker — detection + lifecycle (M4)
  docker: {
    detect: "vex:docker:detect",
    install: "vex:docker:install",
    start: "vex:docker:start",
    composeUp: "vex:docker:composeUp",
    composeDown: "vex:docker:composeDown",
  },

  // Database — migrations + status (M6)
  database: {
    migrate: "vex:database:migrate",
    status: "vex:database:status",
  },

  // Onboarding — wizard step actions (M7–M11)
  onboarding: {
    getEnvState: "vex:onboarding:getEnvState",
    getWizardState: "vex:onboarding:getWizardState",
    setWizardState: "vex:onboarding:setWizardState",
    keystoreSet: "vex:onboarding:keystoreSet",
    walletGenerateEvm: "vex:onboarding:walletGenerateEvm",
    walletImportEvm: "vex:onboarding:walletImportEvm",
    walletGenerateSolana: "vex:onboarding:walletGenerateSolana",
    walletImportSolana: "vex:onboarding:walletImportSolana",
    walletRestoreFromBackup: "vex:onboarding:walletRestoreFromBackup",
    walletOpenBackupFolder: "vex:onboarding:walletOpenBackupFolder",
    apiKeysSet: "vex:onboarding:apiKeysSet",
    embeddingConfigure: "vex:onboarding:embeddingConfigure",
    agentCoreConfigure: "vex:onboarding:agentCoreConfigure",
    providerListModels: "vex:onboarding:providerListModels",
    providerTest: "vex:onboarding:providerTest",
    providerPersist: "vex:onboarding:providerPersist",
    modeSet: "vex:onboarding:modeSet",
    wakeSet: "vex:onboarding:wakeSet",
    completeSetup: "vex:onboarding:completeSetup",
  },

  // Settings — read-only Phase 1 (Phase 2 dodaje setters)
  settings: {
    getPreferences: "vex:settings:getPreferences",
    setTelemetryConsent: "vex:settings:setTelemetryConsent",
  },

  // Updater — manual check only (M13)
  updater: {
    check: "vex:updater:check",
  },

  // Telemetry — renderer-side error reporting (no-op stub bez consent)
  telemetry: {
    reportRendererError: "vex:telemetry:reportRendererError",
  },

  // Permissions — request privilege escalation (Linux pkexec)
  permissions: {
    requestAccess: "vex:permissions:requestAccess",
  },

  // Cancellation
  cancel: "vex:cancel",
} as const;

// ── Event channels (main → renderer push) ──────────────────────────────────
export const EV = {
  system: {
    logLine: "vex:event:system:logLine",
    resume: "vex:event:system:resume",
  },
  docker: {
    installProgress: "vex:event:docker:installProgress",
    daemonChanged: "vex:event:docker:daemonChanged",
    composeLogs: "vex:event:docker:composeLogs",
  },
  database: {
    migrateProgress: "vex:event:database:migrateProgress",
  },
  updater: {
    available: "vex:event:updater:available",
  },
} as const;

export type ChannelName = string;
