/**
 * Cross-boundary re-export of {@link autoBackup} for the vex-app
 * onboarding finalize handler (M11). The Electron main process
 * imports this thin bridge through `@vex-lib/wallet-backup` so the
 * concrete implementation in `src/tools/wallet/backup.ts` stays
 * untouched and the engine + GUI share one backup contract.
 *
 * Bridge purity per skill §1/§3 — `backup.ts` only imports node:fs,
 * node:path, engine errors, the logger-shim (post-M10 winston removal),
 * and `loadConfig`. No transitive winston pull.
 */

export {
  autoBackup,
  isCanonicalVaultResetBackupName,
  readArchiveManifest,
} from "../tools/wallet/backup.js";
export type {
  AutoBackupOptions,
  BackupManifestV2,
} from "../tools/wallet/backup.js";
