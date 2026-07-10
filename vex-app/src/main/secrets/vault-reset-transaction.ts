import { promises as fs } from "node:fs";
import path from "node:path";
import {
  autoBackup,
  isCanonicalVaultResetBackupName,
  readArchiveManifest,
  type BackupManifestV2,
} from "@vex-lib/wallet-backup.js";
import { BACKUPS_DIR } from "@vex-lib/wallet.js";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  ENV_FILE,
  SECRETS_VAULT_FILE,
  SETUP_COMPLETE_FILE,
  VAULT_RESET_JOURNAL_FILE,
} from "../paths/config-dir.js";
import { wizardStateStore } from "../onboarding/wizard-state-store.js";
import {
  clearVaultResetJournal,
  readVaultResetJournal,
  writeVaultResetJournal,
  type VaultResetJournal,
  type VaultResetJournalRead,
} from "./vault-reset-journal.js";

export type VaultResetRecoveryResult =
  | "no-op"
  | "completed"
  | "recoverable-request-failure"
  | "unsafe-recovery-state";

type ResetStep =
  | "backup-complete"
  | "wallet-keystore"
  | "config"
  | "env"
  | "setup-marker"
  | "vault"
  | "wizard"
  | "journal-cleared";

export interface VaultResetTransactionDeps {
  readonly configDir: string;
  readonly backupsDir: string;
  readonly configFile: string;
  readonly envFile: string;
  readonly vaultFile: string;
  readonly setupCompleteFile: string;
  readonly journalFile: string;
  readonly readJournal: () => Promise<VaultResetJournalRead>;
  readonly writeJournal: (journal: VaultResetJournal) => Promise<void>;
  readonly clearJournal: () => Promise<void>;
  readonly createBackup: () => Promise<string | null>;
  readonly readManifest: (archiveDir: string) => BackupManifestV2 | unknown;
  readonly resetWizard: () => Promise<unknown>;
  readonly afterStep?: (step: ResetStep) => void;
}

const productionDeps: VaultResetTransactionDeps = {
  configDir: CONFIG_DIR,
  backupsDir: BACKUPS_DIR,
  configFile: CONFIG_FILE,
  envFile: ENV_FILE,
  vaultFile: SECRETS_VAULT_FILE,
  setupCompleteFile: SETUP_COMPLETE_FILE,
  journalFile: VAULT_RESET_JOURNAL_FILE,
  readJournal: () => readVaultResetJournal(),
  writeJournal: (journal) => writeVaultResetJournal(journal),
  clearJournal: () => clearVaultResetJournal(),
  createBackup: () => autoBackup({ purpose: "vault-reset" }),
  readManifest: (archiveDir) => readArchiveManifest(archiveDir),
  resetWizard: () => wizardStateStore.resetForFreshVault(),
};

function basenameOnly(value: string): boolean {
  return value !== "." && value !== ".." && path.basename(value) === value;
}

const WALLET_FILE_PATTERNS = {
  "wallet-evm": /^wallet-evm_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i,
  "wallet-solana": /^wallet-sol_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i,
} as const;

function isCanonicalRoleFilename(
  entry: BackupManifestV2["files"][number],
): boolean {
  switch (entry.role) {
    case "legacy-evm":
      return entry.filename === "keystore.json";
    case "legacy-solana":
      return entry.filename === "solana-keystore.json";
    case "wallet-evm":
    case "wallet-solana":
      return WALLET_FILE_PATTERNS[entry.role].test(entry.filename);
    case "config":
      return entry.filename === "config.json";
    case "env":
      return entry.filename === ".env";
    case "vault":
      return entry.filename === "secrets.vault.json";
  }
}

async function isContainedDirectory(base: string, candidate: string): Promise<boolean> {
  try {
    const [baseReal, candidateReal, stat] = await Promise.all([
      fs.realpath(base),
      fs.realpath(candidate),
      fs.stat(candidate),
    ]);
    return stat.isDirectory() && candidateReal.startsWith(`${baseReal}${path.sep}`);
  } catch {
    return false;
  }
}

function livePathForRole(
  entry: BackupManifestV2["files"][number],
  deps: VaultResetTransactionDeps,
): { readonly group: "wallet" | "config" | "env" | "vault"; readonly path: string } | null {
  if (!basenameOnly(entry.filename)) return null;
  switch (entry.role) {
    case "legacy-evm":
    case "legacy-solana":
    case "wallet-evm":
    case "wallet-solana":
      return { group: "wallet", path: path.join(deps.configDir, entry.filename) };
    case "config":
      return entry.filename === path.basename(deps.configFile)
        ? { group: "config", path: deps.configFile }
        : null;
    case "env":
      return entry.filename === path.basename(deps.envFile)
        ? { group: "env", path: deps.envFile }
        : null;
    case "vault":
      return entry.filename === path.basename(deps.vaultFile)
        ? { group: "vault", path: deps.vaultFile }
        : null;
  }
}

async function verifyAndRemove(
  livePath: string,
  archivedPath: string,
): Promise<"removed" | "missing" | "unsafe"> {
  let live: Buffer;
  try {
    live = await fs.readFile(livePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    return "unsafe";
  }
  try {
    const archived = await fs.readFile(archivedPath);
    if (!live.equals(archived)) return "unsafe";
    await fs.unlink(livePath);
    return "removed";
  } catch {
    return "unsafe";
  }
}

async function validateArchive(
  name: string,
  deps: VaultResetTransactionDeps,
): Promise<{ readonly dir: string; readonly manifest: BackupManifestV2 } | null> {
  if (!basenameOnly(name) || !isCanonicalVaultResetBackupName(name)) return null;
  const dir = path.join(deps.backupsDir, name);
  if (!(await isContainedDirectory(deps.backupsDir, dir))) return null;
  let manifest: unknown;
  try {
    manifest = deps.readManifest(dir);
  } catch {
    return null;
  }
  if (
    typeof manifest !== "object" || manifest === null ||
    !("version" in manifest) || manifest.version !== 2 ||
    !("purpose" in manifest) || manifest.purpose !== "vault-reset" ||
    !("files" in manifest) || !Array.isArray(manifest.files)
  ) return null;
  const typed = manifest as BackupManifestV2;
  if (
    typed.files.filter((entry) => entry.role === "vault").length !== 1 ||
    typed.files.filter((entry) => entry.role === "config").length !== 1 ||
    typed.files.filter((entry) => entry.role === "env").length !== 1
  ) {
    return null;
  }
  for (const entry of typed.files) {
    if (!basenameOnly(entry.filename) || !isCanonicalRoleFilename(entry)) return null;
    const archived = path.join(dir, entry.filename);
    try {
      const real = await fs.realpath(archived);
      const dirReal = await fs.realpath(dir);
      const stat = await fs.stat(real);
      if (!stat.isFile() || !real.startsWith(`${dirReal}${path.sep}`)) return null;
    } catch {
      return null;
    }
  }
  return { dir, manifest: typed };
}

export async function runVaultResetTransaction(
  deps: VaultResetTransactionDeps = productionDeps,
): Promise<VaultResetRecoveryResult> {
  const read = await deps.readJournal();
  if (read.kind === "absent") return "no-op";
  if (read.kind !== "valid") return "unsafe-recovery-state";

  let journal = read.journal;
  if (journal.state === "requested") {
    let backupPath: string | null;
    try {
      backupPath = await deps.createBackup();
    } catch {
      return "recoverable-request-failure";
    }
    if (backupPath === null) return "recoverable-request-failure";
    const backupDirName = path.basename(backupPath);
    journal = { version: 1, state: "backup-complete", backupDirName };
    try {
      await deps.writeJournal(journal);
      deps.afterStep?.("backup-complete");
    } catch {
      return "unsafe-recovery-state";
    }
  }

  const archive = await validateArchive(journal.backupDirName, deps);
  if (archive === null) return "unsafe-recovery-state";
  const entries = archive.manifest.files.map((entry) => ({
    entry,
    live: livePathForRole(entry, deps),
  }));
  if (entries.some(({ live }) => live === null)) return "unsafe-recovery-state";
  const orderedGroups = ["wallet", "config", "env", "vault"] as const;
  const seen = new Set<string>();
  for (const group of orderedGroups) {
    for (const item of entries) {
      if (item.live === null || item.live.group !== group) continue;
      if (seen.has(item.live.path)) return "unsafe-recovery-state";
      seen.add(item.live.path);
      const outcome = await verifyAndRemove(
        item.live.path,
        path.join(archive.dir, item.entry.filename),
      );
      if (outcome === "unsafe") return "unsafe-recovery-state";
      deps.afterStep?.(
        group === "wallet" ? "wallet-keystore" : group,
      );
    }
    if (group === "env") {
      try {
        await fs.unlink(deps.setupCompleteFile);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
          return "unsafe-recovery-state";
        }
      }
      deps.afterStep?.("setup-marker");
    }
  }
  try {
    await deps.resetWizard();
    deps.afterStep?.("wizard");
    await deps.clearJournal();
    deps.afterStep?.("journal-cleared");
    return "completed";
  } catch {
    return "unsafe-recovery-state";
  }
}
