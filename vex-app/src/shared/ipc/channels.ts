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

  secrets: {
    status: "vex:secrets:status",
    unlock: "vex:secrets:unlock",
    lock: "vex:secrets:lock",
  },

  // Wallet — sudo-style ops on existing keystores (Phase 2 feature #6)
  wallet: {
    exportPrivateKey: "vex:wallet:exportPrivateKey",
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
    walletAddEvm: "vex:onboarding:walletAddEvm",
    walletAddSolana: "vex:onboarding:walletAddSolana",
    walletImportAddEvm: "vex:onboarding:walletImportAddEvm",
    walletImportAddSolana: "vex:onboarding:walletImportAddSolana",
    walletExportAll: "vex:onboarding:walletExportAll",
    apiKeysSet: "vex:onboarding:apiKeysSet",
    polymarketAutoSetup: "vex:onboarding:polymarketAutoSetup",
    polymarketConfiguredAddresses: "vex:onboarding:polymarketConfiguredAddresses",
    embeddingConfigure: "vex:onboarding:embeddingConfigure",
    agentCoreConfigure: "vex:onboarding:agentCoreConfigure",
    providerListModels: "vex:onboarding:providerListModels",
    providerTest: "vex:onboarding:providerTest",
    providerPersist: "vex:onboarding:providerPersist",
    completeSetup: "vex:onboarding:completeSetup",
  },

  // Sessions — multi-session shell (M12, Phase 2)
  sessions: {
    create: "vex:sessions:create",
    list: "vex:sessions:list",
    get: "vex:sessions:get",
    setPinned: "vex:sessions:setPinned",
    delete: "vex:sessions:delete",
    /**
     * Agent integration puzzle 1 — per-session model contract. `getModel`
     * is read-only and returns the resolved source (global default vs.
     * unconfigured) without touching DB columns that don't exist yet.
     * `setModel` fail-closes with `sessions.feature_unavailable` until
     * puzzle 06 adds the `sessions.model_id` migration.
     */
    getModel: "vex:sessions:getModel",
    setModel: "vex:sessions:setModel",
  },

  // Chat — operator text routed to agent or mission setup/run.
  chat: {
    submit: "vex:chat:submit",
  },

  // ── Agent integration puzzle 1 (typed bridge surface) ─────────────────
  // Each namespace is a new VexDomain with paired Zod shared schemas.
  // Read-only handlers serve real DB data; mutating handlers fail-closed
  // with the per-domain `*.feature_unavailable` code until the matching
  // puzzle ships its backing runtime. Renderer never sees raw DB JSONB —
  // every mapper is allowlist + Zod validated in main.

  // Messages — paginated transcript reads. Live transcript only (archive
  // rows are out of scope until restore/history view in puzzle 04).
  messages: {
    list: "vex:messages:list",
    getTail: "vex:messages:getTail",
    getAround: "vex:messages:getAround",
  },

  // Runtime — durable control plane for an active mission run. `getState`
  // resolves the active run row for the session; control mutations fail
  // closed until puzzle 03 adds DB-backed pause/stop/resume + leases.
  runtime: {
    getState: "vex:runtime:getState",
    requestPause: "vex:runtime:requestPause",
    requestStop: "vex:runtime:requestStop",
    requestResume: "vex:runtime:requestResume",
    cancelWake: "vex:runtime:cancelWake",
  },

  // Mission — draft/contract/command surface. `getDraft` is read-only;
  // `getDiff` and the command mutations fail closed until puzzle 04 lands
  // host-only acceptance + `/rewind`/`/restore`/`/mission-renew`.
  mission: {
    getDraft: "vex:mission:getDraft",
    updateDraft: "vex:mission:updateDraft",
    getDiff: "vex:mission:getDiff",
    acceptContract: "vex:mission:acceptContract",
    start: "vex:mission:start",
    continue: "vex:mission:continue",
    recover: "vex:mission:recover",
    rewind: "vex:mission:rewind",
    restore: "vex:mission:restore",
    renew: "vex:mission:renew",
    stop: "vex:mission:stop",
    getRenewableSource: "vex:mission:getRenewableSource",
  },

  // Approvals — queue browsing + decisions. Pending/get/history are
  // read-only (renderer never receives raw `tool_call` JSONB — mapper
  // extracts toolName/permissionAtEnqueue/reasoningPreview only).
  // approve/reject fail closed until puzzle 05 wires durable approval
  // intents + runtime continuation.
  approvals: {
    listPending: "vex:approvals:listPending",
    get: "vex:approvals:get",
    approve: "vex:approvals:approve",
    reject: "vex:approvals:reject",
    getHistory: "vex:approvals:getHistory",
  },

  // Wallets — per-session wallet scope contract. `listSessionWallets`
  // returns an empty scope until puzzle 05 introduces the DB-backed
  // wallet scope rows. setSessionWalletScope / prepared-intent mutations
  // fail closed. Wallet side effects are local user-wallet flows only; no
  // remote-signing action kind exists in the app contract.
  wallets: {
    listAvailable: "vex:wallets:listAvailable",
    listSessionWallets: "vex:wallets:listSessionWallets",
    setSessionWalletScope: "vex:wallets:setSessionWalletScope",
    getPreparedIntent: "vex:wallets:getPreparedIntent",
    cancelPreparedIntent: "vex:wallets:cancelPreparedIntent",
  },

  // Models — provider/model picker. Puzzle 1 returns a single "configured
  // global default" derived from `AGENT_PROVIDER`/`AGENT_MODEL` in env;
  // OpenRouter `/models` catalogue arrives in puzzle 06. No network call
  // and no pricing/context claims in puzzle 1.
  models: {
    listAvailable: "vex:models:listAvailable",
  },

  // Usage — last-turn + session totals from `usage_log`. Currency
  // defaults to USD; provider/model columns from the DB row pass through
  // as `nullable` for older sessions.
  usage: {
    getSessionTotals: "vex:usage:getSessionTotals",
    getLastTurn: "vex:usage:getLastTurn",
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

  // Telemetry — renderer-side error reporting (Sentry, opt-in only)
  telemetry: {
    reportRendererError: "vex:telemetry:reportRendererError",
  },

  // Support — local-first bug report sink (Phase 1: persist; Phase 3: upload)
  support: {
    createBugReport: "vex:support:createBugReport",
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
  /**
   * Engine spine (agent integration puzzle 2 + puzzle 3).
   *
   *  - `transcriptAppend` (puzzle 02) fires after every committed
   *    `messages` INSERT — renderer invalidates the matching session's
   *    TanStack query prefix and re-fetches DTOs through
   *    `messages.getTail`.
   *  - `controlState` (puzzle 03) fires after a committed runtime
   *    control transition (pause/stop/resume/lease change). Payload is
   *    a signal; renderer invalidates the session's runtime state
   *    query. Lease metadata is bounded to `leaseActive` +
   *    `leaseExpiresAt` — owner IDs are internal runtime state.
   *
   * DB remains source of truth for both.
   */
  engine: {
    transcriptAppend: "vex:event:engine:transcriptAppend",
    controlState: "vex:event:engine:controlState",
  },
} as const;

export type ChannelName = string;
