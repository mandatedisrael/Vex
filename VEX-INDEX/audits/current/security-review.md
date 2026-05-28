---
id: audit.current.security-review
kind: audit
paths: ["src/**", "vex-app/**"]
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change: ["src/**", "vex-app/**", "VEX-INDEX/modules/**/*.md"]
related: [module.vex-app.main-process, module.vex-app.local-services-docker, module.src-root.lib-vault-secrets]
---

# Current Security Review Snapshot

| ID | Finding | Status | Evidence |
|---|---|---|---|
| FINDING-security-001 | Renderer boundary is currently clean in searched files | monitor | Renderer uses `window.vex`; current `@vex-lib` imports are pure metadata/schemas. |
| FINDING-security-002 | BrowserWindow/protocol/permission posture is hardened | monitor | sandbox/contextIsolation/no nodeIntegration; `app://vex`; deny-all permissions. |
| FINDING-security-003 | Vault lock did not clear vault-injected API keys from `process.env` nor reset the cached provider | fixed | Bundle A (Round 4): `lockSecretSession()` now sweeps `MANAGED_SECRET_ENV_KEYS` from `process.env` + awaits `resetProvider()`; centralized via `scrubUnlockedRuntime()`/`invalidateProviderCache()`; `getUnlockedSecretPresence` failure path routes through the same scrub. Explicit lock IPC + export-lockout await the reset; quit hooks fire-and-forget after the synchronous scrub. `vex-app/src/main/secrets/session.ts`. Dual Codex GREEN LIGHT. |
| FINDING-security-004 | Wallet keystore KDF N=16384 weaker than vault N=65536 | open | Tracked from Z5. Codex confirmed: `src/tools/wallet/keystore.ts:25 KDF_PARAMS` vs `src/lib/local-secret-vault.ts:31 CURRENT_KDF_PARAMS`. Migrate keystore upward (≥ vault parity), benchmark vs OWASP scrypt guidance. Candidate Bundle B. |
| FINDING-security-005 | `document_delete` was `actionKind:"destructive"` but `mutating:false` → ran ungated in restricted mode | fixed | Bundle A (Round 4): flipped `document_delete` to `mutating: true` (`src/vex-agent/tools/registry/documents.ts:54`); dispatcher gate now fires (restricted+unapproved → pendingApproval). Regression in `dispatcher-misc.test.ts`; census in `registry.test.ts` updated. `document_write` intentionally stays ungated (low-risk recoverable scratchpad; pinned by test). Dual Codex GREEN LIGHT. |
| FINDING-security-006 | Remote Docker contexts must remain rejected | monitor | Endpoint policy protects local DB/secrets/volumes from remote daemons. |
| FINDING-security-007 | Updater implementation absent, so no silent updater path exists today | monitor | Any future updater must stay user-triggered only (F12). Candidate Bundle B; user-triggered electron-updater (autoDownload=false). |
| FINDING-codex-001 | Wallet auto-backup omits newer `wallet-<id>.json` inventory keystores | open | Codex Round-4 audit: `src/tools/wallet/backup.ts:43 autoBackup` walks legacy paths; multi-wallet inventory entries (`src/tools/wallet/inventory-create.ts`) may be missed by a backup → recovery gap. Verify scope + fix. Candidate Bundle B. |

Do not treat this as a full release security audit. Production release needs fresh signing/updater/Docker/Electron verification.
