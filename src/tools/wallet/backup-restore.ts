/**
 * Archive-restore primitive (crypto-sensitive: wallet private keys).
 *
 * Restores a backup archive produced by {@link autoBackup} (manifest V2; V1 is
 * also accepted by the schema but carries no per-file roles so only the flat
 * file list would apply — V2 is the supported restore source). The flow is
 * strictly ordered to protect the user's CURRENT wallets:
 *
 *   Phase 1 — VALIDATE   : no writes, no backup. Treat the archive as UNTRUSTED.
 *   Phase 2 — STAGE      : copy validated bytes into a private staging dir.
 *   Phase 3 — BACKUP     : mandatory snapshot of current state (HARD GATE).
 *   Phase 4 — COMMIT     : journaled apply with full rollback on any failure.
 *
 * Engine/main only — never imported by the renderer. Throws `VexError`.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

import { privateKeyToAddress } from "viem/accounts";

import {
  CONFIG_DIR,
  BACKUPS_DIR,
  CONFIG_FILE,
  ENV_FILE,
  KEYSTORE_FILE,
  SECRETS_VAULT_FILE,
  SOLANA_KEYSTORE_FILE,
} from "../../config/paths.js";
import {
  isValidWalletId,
  loadConfig,
  saveConfig,
  type WalletInventoryEntry,
} from "../../config/store.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { isManagedSecretEnvKey } from "../../lib/secret-keys.js";
import {
  LocalSecretVaultError,
  unlockSecretVault,
} from "../../lib/local-secret-vault.js";
import { minLogger as logger } from "../../utils/logger-shim.js";
import { autoBackup, readArchiveManifest } from "./backup.js";
import {
  decryptPrivateKey,
  loadKeystoreFile,
  type KeystoreV1,
} from "./keystore.js";
import { decryptSolanaSecretKey, deriveSolanaAddress } from "./solana-keystore.js";
import {
  derivePath,
  MAX_WALLETS_PER_FAMILY,
  walletAddressesEqual,
  type InventoryFamily,
} from "./inventory.js";

export interface RestoreFromBackupArchiveArgs {
  readonly archiveDir: string;
  readonly password: string;
  /**
   * Gates a LEGITIMATE legacy-wallet replacement (Class B): the incoming legacy
   * address for a family differs from the current on-disk legacy address. NOT
   * consulted for address/keystore mismatches (Class A) — those always fail.
   */
  readonly confirmReplace?: (args: {
    family: InventoryFamily;
    existingAddress: string;
    incomingAddress: string;
  }) => Promise<boolean>;
}

export interface RestoreFromBackupArchiveResult {
  readonly filesRestored: string[];
  readonly walletsRestored: WalletInventoryEntry[];
  readonly backupDir: string | null;
  /**
   * Whether the archive actually carried a `role:"vault"` file that was written
   * to `SECRETS_VAULT_FILE`. ROLE-derived (not filename-derived): callers must
   * use THIS — not a filename check on `filesRestored` — to decide whether to
   * refresh the secret session, because `vaultLocked:false` is also returned
   * when there is no vault at all.
   */
  readonly vaultRestored: boolean;
  /**
   * Only meaningful when `vaultRestored` is true: false = the restored vault
   * opens with the supplied password; true = it does not (different password).
   */
  readonly vaultLocked: boolean;
}

/** A validated, decrypt-verified keystore file ready to write to its live path. */
interface ValidatedWallet {
  readonly family: InventoryFamily;
  readonly legacy: boolean;
  readonly id: string;
  readonly address: string;
  readonly label: string;
  readonly createdAt: string;
  readonly stagedFilename: string;
  readonly livePath: string;
}

interface JournalEntry {
  readonly path: string;
  readonly existedBefore: boolean;
  readonly preimage: Buffer | null;
}

const FILENAME_ILLEGAL = /[/\\\0]/;

function rejectMalformed(message: string): never {
  throw new VexError(ErrorCodes.ARCHIVE_MANIFEST_MALFORMED, message);
}

function isInside(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Restore a backup archive. See module header for the four-phase contract.
 */
export async function restoreFromBackupArchive(
  args: RestoreFromBackupArchiveArgs,
): Promise<RestoreFromBackupArchiveResult> {
  const { archiveDir, password, confirmReplace } = args;

  // ── Phase 1 — VALIDATE (no writes, no backup) ─────────────────────────────

  // 1. Path containment: the archive MUST live inside the backups root.
  let resolved: string;
  let backupsRoot: string;
  try {
    resolved = realpathSync(archiveDir);
    backupsRoot = realpathSync(BACKUPS_DIR);
  } catch (err) {
    throw new VexError(
      ErrorCodes.ARCHIVE_RESTORE_FAILED,
      `Backup archive path could not be resolved: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!isInside(resolved, backupsRoot)) {
    throw new VexError(
      ErrorCodes.ARCHIVE_RESTORE_FAILED,
      "Refusing to restore: archive path is outside the backups directory.",
    );
  }

  // 2. Manifest: read + version-gated Zod validation (rejects v > 2 / malformed).
  const manifest = readArchiveManifest(resolved);
  if (manifest.version !== 2) {
    // V1 archives have no per-file roles → not a supported restore source.
    rejectMalformed(
      "Backup archive uses the legacy v1 manifest, which cannot be restored. Create a fresh backup.",
    );
  }

  // 3. Per-file structural validation (UNTRUSTED → fail-closed, no skip).
  const seenFilenames = new Set<string>();
  let vaultCount = 0;
  let envCount = 0;
  let configCount = 0;
  // walletId → the single wallets[] entry it must map to.
  const walletsById = new Map<string, (typeof manifest.wallets)[number]>();
  for (const w of manifest.wallets) {
    if (walletsById.has(w.id)) {
      rejectMalformed(`Manifest lists wallet id "${w.id}" more than once.`);
    }
    walletsById.set(w.id, w);
  }

  for (const file of manifest.files) {
    const { filename, role } = file;
    if (
      filename === "" ||
      filename === "." ||
      filename === ".." ||
      isAbsolute(filename) ||
      FILENAME_ILLEGAL.test(filename) ||
      basenameOf(filename) !== filename
    ) {
      rejectMalformed(`Manifest references an unsafe filename: ${JSON.stringify(filename)}`);
    }
    if (seenFilenames.has(filename)) {
      rejectMalformed(`Manifest references duplicate filename: ${filename}`);
    }
    seenFilenames.add(filename);

    // Singleton system files MUST use their canonical basename. This makes the
    // vault/env/config decision role-based AND filename-stable: an untrusted
    // archive cannot, e.g., declare role:"vault" under a different filename to
    // swap the live vault while a filename-based caller misses it.
    if (role === "vault") {
      if (filename !== basenameOf(SECRETS_VAULT_FILE)) {
        rejectMalformed(`Vault file must be named ${basenameOf(SECRETS_VAULT_FILE)}.`);
      }
      vaultCount += 1;
    } else if (role === "env") {
      if (filename !== basenameOf(ENV_FILE)) {
        rejectMalformed(`Env file must be named ${basenameOf(ENV_FILE)}.`);
      }
      envCount += 1;
    } else if (role === "config") {
      if (filename !== basenameOf(CONFIG_FILE)) {
        rejectMalformed(`Config file must be named ${basenameOf(CONFIG_FILE)}.`);
      }
      configCount += 1;
    } else if (role === "wallet-evm" || role === "wallet-solana") {
      const family: InventoryFamily = role === "wallet-solana" ? "solana" : "evm";
      if (!file.walletId || !file.walletFamily || !file.address) {
        rejectMalformed(`Wallet file ${filename} is missing walletId/walletFamily/address.`);
      }
      if (file.walletFamily !== family) {
        rejectMalformed(`Wallet file ${filename} family does not match its role.`);
      }
      if (!isValidWalletId(family, file.walletId, false)) {
        rejectMalformed(`Wallet file ${filename} has a non-canonical wallet id.`);
      }
      const w = walletsById.get(file.walletId);
      if (!w) {
        rejectMalformed(`Wallet file ${filename} references unknown wallet id ${file.walletId}.`);
      }
      if (w.family !== family || !walletAddressesEqual(family, w.address, file.address)) {
        rejectMalformed(`Wallet file ${filename} does not match its wallets[] entry.`);
      }
    }
    // legacy-evm / legacy-solana need no extra structural fields here; their
    // wallets[] entry is matched below.
  }
  if (vaultCount > 1) rejectMalformed("Manifest references more than one vault file.");
  if (envCount > 1) rejectMalformed("Manifest references more than one .env file.");
  if (configCount > 1) rejectMalformed("Manifest references more than one config file.");

  // 3b. Full wallets[] <-> keystore-file reconciliation (EXACTLY 1:1). Catches
  //     orphan wallets[] entries (no keystore), duplicate legacy roles, and
  //     per-wallet files referencing unknown ids. Every wallet id is validated
  //     up front (UNTRUSTED → fail-closed) regardless of whether it's reached
  //     by the decrypt loop below.
  let legacyEvmFiles = 0;
  let legacySolanaFiles = 0;
  const fileCountByWalletId = new Map<string, number>();
  for (const file of manifest.files) {
    if (file.role === "wallet-evm" || file.role === "wallet-solana") {
      // walletId presence was asserted in the per-file loop above.
      const id = file.walletId as string;
      fileCountByWalletId.set(id, (fileCountByWalletId.get(id) ?? 0) + 1);
    } else if (file.role === "legacy-evm") {
      legacyEvmFiles += 1;
    } else if (file.role === "legacy-solana") {
      legacySolanaFiles += 1;
    }
  }
  if (legacyEvmFiles > 1) rejectMalformed("Manifest references more than one legacy EVM keystore.");
  if (legacySolanaFiles > 1) rejectMalformed("Manifest references more than one legacy Solana keystore.");
  // Every per-wallet keystore file must reference a known wallets[] id, exactly once.
  for (const [id, count] of fileCountByWalletId) {
    if (!walletsById.has(id)) rejectMalformed(`Keystore file references unknown wallet id ${id}.`);
    if (count !== 1) rejectMalformed(`Wallet id ${id} is referenced by ${count} keystore files (expected 1).`);
  }
  // Every wallets[] entry must have a canonical id AND exactly one keystore file.
  for (const w of manifest.wallets) {
    if (!isValidWalletId(w.family, w.id, w.legacy)) {
      rejectMalformed(`Manifest wallet "${w.id}" has a non-canonical id for family ${w.family} (legacy=${w.legacy}).`);
    }
    if (w.legacy) {
      const have = w.family === "solana" ? legacySolanaFiles : legacyEvmFiles;
      if (have !== 1) {
        rejectMalformed(`Legacy ${w.family} wallet ${w.id} must have exactly one keystore file (found ${have}).`);
      }
    } else if ((fileCountByWalletId.get(w.id) ?? 0) !== 1) {
      rejectMalformed(`Wallet ${w.id} has no matching keystore file in the manifest.`);
    }
  }
  // A legacy keystore file with no matching legacy wallets[] entry is also invalid.
  if (legacyEvmFiles === 1 && !manifest.wallets.some((w) => w.family === "evm" && w.legacy)) {
    rejectMalformed("Manifest has a legacy EVM keystore file but no matching wallets[] entry.");
  }
  if (legacySolanaFiles === 1 && !manifest.wallets.some((w) => w.family === "solana" && w.legacy)) {
    rejectMalformed("Manifest has a legacy Solana keystore file but no matching wallets[] entry.");
  }

  // 3c. Preserve the inventory duplicate-address invariant (assertCanAddWallet
  //     enforces it for normal add/import). The rebuild below replaces the
  //     arrays wholesale, so two manifest entries with different ids but the
  //     same address would smuggle a duplicate past that guard — reject here,
  //     before any decrypt/write.
  for (const family of ["evm", "solana"] as const) {
    const seen = new Set<string>();
    for (const w of manifest.wallets) {
      if (w.family !== family) continue;
      const key = family === "evm" ? w.address.toLowerCase() : w.address;
      if (seen.has(key)) {
        rejectMalformed(`Manifest lists the same ${family} address more than once.`);
      }
      seen.add(key);
    }
  }

  // 4. Existence + lstat (regular file, not symlink/dir) + realpath containment.
  const missing: string[] = [];
  for (const file of manifest.files) {
    const p = join(resolved, file.filename);
    if (!existsSync(p)) {
      missing.push(file.filename);
      continue;
    }
    const st = lstatSync(p);
    if (!st.isFile()) {
      rejectMalformed(`Manifest entry ${file.filename} is not a regular file (symlink/dir rejected).`);
    }
    const realFile = realpathSync(p);
    if (!isInside(realFile, resolved)) {
      rejectMalformed(`Manifest entry ${file.filename} resolves outside the archive.`);
    }
  }
  if (missing.length > 0) {
    throw new VexError(
      ErrorCodes.ARCHIVE_INCOMPLETE,
      `Backup archive is missing referenced files: ${missing.join(", ")}.`,
      "The backup may be corrupt or partially deleted; choose another backup.",
    );
  }

  // 5. Decrypt-verify every keystore. Wrong password → KEYSTORE_DECRYPT_FAILED
  //    and STOP. Address mismatch → SIGNER_MISMATCH (Class A, always hard fail).
  const validatedWallets: ValidatedWallet[] = [];
  for (const file of manifest.files) {
    if (
      file.role !== "wallet-evm" &&
      file.role !== "wallet-solana" &&
      file.role !== "legacy-evm" &&
      file.role !== "legacy-solana"
    ) {
      continue;
    }
    const family: InventoryFamily =
      file.role === "wallet-solana" || file.role === "legacy-solana" ? "solana" : "evm";
    const legacy = file.role === "legacy-evm" || file.role === "legacy-solana";

    // The wallets[] entry that owns this file.
    const wallet = legacy
      ? manifest.wallets.find((w) => w.family === family && w.legacy === true)
      : walletsById.get(file.walletId ?? "");
    if (!wallet) {
      rejectMalformed(`No wallets[] entry for ${file.role} file ${file.filename}.`);
    }
    if (legacy && !isValidWalletId(family, wallet.id, true)) {
      rejectMalformed(`Legacy ${family} wallet has a non-canonical id ${wallet.id}.`);
    }

    const p = join(resolved, file.filename);
    const keystore = loadKeystoreFile(p);
    if (!keystore) {
      // existence was checked above; a null here means an unreadable shape.
      rejectMalformed(`Keystore ${file.filename} could not be read.`);
    }

    const derived = deriveAddressFromKeystore(family, keystore, password);
    if (!walletAddressesEqual(family, derived, wallet.address)) {
      // Class A: NEVER consult confirmReplace. The archive claims an address
      // the key does not produce — refuse outright.
      throw new VexError(
        ErrorCodes.SIGNER_MISMATCH,
        `Decrypted ${family} key does not match the address recorded in the backup.`,
        "The backup archive is inconsistent and was not restored.",
      );
    }

    validatedWallets.push({
      family,
      legacy,
      id: wallet.id,
      address: wallet.address,
      label: wallet.label,
      createdAt: wallet.createdAt,
      stagedFilename: file.filename,
      livePath: derivePath(family, {
        id: wallet.id,
        address: wallet.address,
        label: wallet.label,
        createdAt: wallet.createdAt,
        ...(legacy ? { legacy: true } : {}),
      }),
    });
  }

  // 6. Cap check: restore REPLACES the inventory, so the effective per-family
  //    count is just the manifest count. > MAX → reject before any write.
  for (const family of ["evm", "solana"] as const) {
    const count = validatedWallets.filter((w) => w.family === family).length;
    if (count > MAX_WALLETS_PER_FAMILY) {
      throw new VexError(
        ErrorCodes.WALLET_INVENTORY_FULL,
        `Backup archive has ${count} ${family} wallets; the limit is ${MAX_WALLETS_PER_FAMILY}.`,
      );
    }
  }

  // 7. Class B: legitimate legacy replacement requires confirmReplace.
  const currentCfg = loadConfig();
  for (const w of validatedWallets) {
    if (!w.legacy) continue;
    const currentLegacy = currentCfg.wallet[w.family].find((e) => e.legacy === true);
    if (!currentLegacy) continue; // fresh slot — no replacement to confirm.
    if (walletAddressesEqual(w.family, currentLegacy.address, w.address)) continue;
    const approved = confirmReplace
      ? await confirmReplace({
          family: w.family,
          existingAddress: currentLegacy.address,
          incomingAddress: w.address,
        })
      : false;
    if (!approved) {
      throw new VexError(
        ErrorCodes.WALLET_USER_REJECTED,
        `Restore would replace the existing ${w.family} wallet; the user did not confirm.`,
      );
    }
  }

  // ── Phase 2 — STAGE (before backup, so retention cannot delete the source) ──
  const stagingDir = join(CONFIG_DIR, `.restore-${randomUUID()}`);
  mkdirSync(stagingDir, { recursive: true });

  try {
    for (const file of manifest.files) {
      const stagedPath = join(stagingDir, file.filename);
      const bytes = readFileSync(join(resolved, file.filename));
      const secret =
        file.role === "vault" ||
        file.role === "wallet-evm" ||
        file.role === "wallet-solana" ||
        file.role === "legacy-evm" ||
        file.role === "legacy-solana";
      writeFileSync(stagedPath, bytes, secret ? { mode: 0o600 } : undefined);
    }

    // ── Phase 3 — MANDATORY backup of current state (HARD GATE) ──────────────
    // Is there any current state we'd be overwriting? If so, a successful
    // snapshot is REQUIRED before any live write — a null return or a pruned/
    // missing backup dir must abort. Only a genuinely empty install (nothing to
    // lose) may proceed without a backup.
    // Fixed legacy keystores count as current state even when they are NOT in
    // the inventory (orphan) — restore could still overwrite them.
    const hasFixedEvm = existsSync(KEYSTORE_FILE);
    const hasFixedSolana = existsSync(SOLANA_KEYSTORE_FILE);
    const hasCurrentState =
      existsSync(CONFIG_FILE) ||
      existsSync(SECRETS_VAULT_FILE) ||
      existsSync(ENV_FILE) ||
      hasFixedEvm ||
      hasFixedSolana ||
      (["evm", "solana"] as const).some((fam) =>
        currentCfg.wallet[fam].some((e) => {
          try {
            return existsSync(derivePath(fam, e));
          } catch {
            return false;
          }
        }),
      );
    let backupDir: string | null;
    try {
      backupDir = await autoBackup();
    } catch (err) {
      throw new VexError(
        ErrorCodes.AUTO_BACKUP_FAILED,
        "Could not snapshot current wallets before restore; aborted to protect existing wallets.",
        err instanceof Error ? err.message : String(err),
      );
    }
    const BACKUP_GATE_MSG =
      "Could not snapshot current wallets before restore; aborted to protect existing wallets.";
    if (hasCurrentState) {
      // Inline throws (not a helper) so TS narrows backupDir to string below.
      if (backupDir === null) {
        throw new VexError(
          ErrorCodes.AUTO_BACKUP_FAILED,
          BACKUP_GATE_MSG,
          "autoBackup produced no archive despite existing state.",
        );
      }
      if (!existsSync(backupDir)) {
        throw new VexError(
          ErrorCodes.AUTO_BACKUP_FAILED,
          BACKUP_GATE_MSG,
          `pre-restore backup dir is missing: ${backupDir}`,
        );
      }
      // The snapshot must be USABLE (manifest parses), not merely a directory.
      let backupManifest: ReturnType<typeof readArchiveManifest>;
      try {
        backupManifest = readArchiveManifest(backupDir);
      } catch (err) {
        throw new VexError(
          ErrorCodes.AUTO_BACKUP_FAILED,
          BACKUP_GATE_MSG,
          `pre-restore backup manifest is unreadable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // An ORPHAN fixed legacy keystore (on disk but absent from inventory) is
      // not captured by autoBackup's inventory walk. Refuse to overwrite a
      // keystore we could not snapshot.
      const backedUpRoles = new Set(
        backupManifest.version === 2 ? backupManifest.files.map((f) => f.role) : [],
      );
      if (hasFixedEvm && !backedUpRoles.has("legacy-evm")) {
        throw new VexError(
          ErrorCodes.AUTO_BACKUP_FAILED,
          BACKUP_GATE_MSG,
          "a fixed EVM keystore (keystore.json) exists on disk but was not captured in the pre-restore backup (orphan / not in inventory); resolve it before restoring.",
        );
      }
      if (hasFixedSolana && !backedUpRoles.has("legacy-solana")) {
        throw new VexError(
          ErrorCodes.AUTO_BACKUP_FAILED,
          BACKUP_GATE_MSG,
          "a fixed Solana keystore (solana-keystore.json) exists on disk but was not captured in the pre-restore backup; resolve it before restoring.",
        );
      }
    }

    // ── Phase 4 — JOURNALED COMMIT with rollback ─────────────────────────────
    const journal: JournalEntry[] = [];
    const recordPreimage = (path: string): void => {
      const existedBefore = existsSync(path);
      journal.push({
        path,
        existedBefore,
        preimage: existedBefore ? readFileSync(path) : null,
      });
    };

    // Targets that Phase 4 writes directly (config goes via saveConfig).
    for (const w of validatedWallets) recordPreimage(w.livePath);
    const stagedEnv = manifest.files.find((f) => f.role === "env");
    if (stagedEnv) recordPreimage(ENV_FILE);
    const stagedVault = manifest.files.find((f) => f.role === "vault");
    if (stagedVault) recordPreimage(SECRETS_VAULT_FILE);
    recordPreimage(CONFIG_FILE);

    const filesRestored: string[] = [];
    let walletsRestored: WalletInventoryEntry[] = [];

    try {
      // 4a. Write each staged keystore to its live derived path.
      for (const w of validatedWallets) {
        const bytes = readFileSync(join(stagingDir, w.stagedFilename));
        writeFileSync(w.livePath, bytes, { mode: 0o600 });
        filesRestored.push(w.stagedFilename);
      }

      // 4b. Sanitized .env — drop every MANAGED secret line.
      if (stagedEnv) {
        const rawEnv = readFileSync(join(stagingDir, stagedEnv.filename), "utf-8");
        writeFileSync(ENV_FILE, sanitizeDotenv(rawEnv), { mode: 0o600 });
        filesRestored.push(stagedEnv.filename);
      }

      // 4c. Vault verbatim from staging.
      if (stagedVault) {
        const bytes = readFileSync(join(stagingDir, stagedVault.filename));
        writeFileSync(SECRETS_VAULT_FILE, bytes, { mode: 0o600 });
        filesRestored.push(stagedVault.filename);
      }

      // 4d. Rebuild inventory in-memory, then ONE atomic saveConfig.
      const cfg = loadConfig();
      cfg.wallet.evm = [];
      cfg.wallet.solana = [];
      for (const w of validatedWallets) {
        const entry: WalletInventoryEntry = {
          id: w.id,
          address: w.address,
          label: w.label,
          createdAt: w.createdAt,
          ...(w.legacy ? { legacy: true } : {}),
        };
        cfg.wallet[w.family].push(entry);
      }
      saveConfig(cfg);
      walletsRestored = [...cfg.wallet.evm, ...cfg.wallet.solana];
    } catch (applyErr) {
      rollback(journal, backupDir);
      throw applyErr;
    }

    // vaultLocked: does the restored vault open with `password`? (Detection
    // only — applying secrets to process.env is the vex-app handler's job.)
    let vaultLocked = false;
    if (stagedVault) {
      try {
        unlockSecretVault(password);
      } catch (err) {
        if (err instanceof LocalSecretVaultError && err.code === "invalid_password") {
          vaultLocked = true;
        } else {
          // corrupt / io / missing — treat as locked (cannot confirm unlock).
          vaultLocked = true;
        }
      }
    }

    return {
      filesRestored,
      walletsRestored,
      backupDir,
      vaultRestored: stagedVault !== undefined,
      vaultLocked,
    };
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(
        `Could not remove restore staging dir ${stagingDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** basename without importing path.basename's platform sep handling subtleties. */
function basenameOf(p: string): string {
  const idxF = p.lastIndexOf("/");
  const idxB = p.lastIndexOf("\\");
  const idx = Math.max(idxF, idxB);
  return idx === -1 ? p : p.slice(idx + 1);
}

function deriveAddressFromKeystore(
  family: InventoryFamily,
  keystore: KeystoreV1,
  password: string,
): string {
  if (family === "evm") {
    const privateKey = decryptPrivateKey(keystore, password);
    return privateKeyToAddress(privateKey);
  }
  const secretKey = decryptSolanaSecretKey(keystore, password);
  try {
    return deriveSolanaAddress(secretKey);
  } finally {
    secretKey.fill(0);
  }
}

/**
 * Drop every line whose key is a MANAGED secret (master password + all vault
 * secret keys). Preserves everything else verbatim — comments, blanks, quoting.
 * The vault is the source of truth for managed secrets after restore; leaving
 * them in `.env` would defeat the vault and risk plaintext key exposure.
 */
function sanitizeDotenv(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      kept.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) {
      kept.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (isManagedSecretEnvKey(key)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Restore every journaled target to its preimage. On a clean rollback the
 * caller re-throws the original error. If rollback itself fails on any path we
 * escalate to ARCHIVE_RESTORE_FAILED naming the incomplete paths + backup dir.
 */
function rollback(journal: JournalEntry[], backupDir: string | null): void {
  const failed: string[] = [];
  // Reverse order: undo last writes first.
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i]!;
    try {
      if (entry.existedBefore && entry.preimage) {
        writeFileSync(entry.path, entry.preimage);
      } else if (!entry.existedBefore && existsSync(entry.path)) {
        unlinkSync(entry.path);
      }
    } catch (err) {
      logger.error(
        `Rollback failed for ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed.push(entry.path);
    }
  }
  if (failed.length > 0) {
    const recovery = backupDir
      ? `Recover from the pre-restore backup at ${backupDir}.`
      : "No pre-restore backup was created (the install had no prior state).";
    throw new VexError(
      ErrorCodes.ARCHIVE_RESTORE_FAILED,
      `Restore failed AND rollback could not fully restore: ${failed.join(", ")}. ${recovery}`,
    );
  }
}
