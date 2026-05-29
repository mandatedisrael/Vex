/**
 * vex.onboarding.wallet* — Wizard Step 2 IPC handlers (M8).
 *
 * Six handlers split out from `onboarding.ts` per codex turn 8 GREEN
 * and user decision (file boundary at the wallet domain). Every handler
 * routes through `withWalletLock` (global mutex) and
 * `withFreshKeystorePassword` (injects the unlocked in-memory master password
 * into `process.env` only for the duration of the engine call) so concurrent
 * invocations cannot interleave keystore + config writes and the password is
 * not persisted in `.env`.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { BrowserWindow, dialog, shell } from "electron";
import {
  BACKUPS_DIR,
  listAvailableBackups,
  restoreFromBackupArchive,
  type WalletInventoryEntry,
} from "@vex-lib/wallet.js";
import { applySecretVaultToProcessEnv } from "@vex-lib/local-secret-vault.js";
import { loadProviderDotenv } from "@vex-lib/runtime-env.js";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  walletAddInputSchema,
  walletAddResultSchema,
  walletExportAllInputSchema,
  walletExportAllResultSchema,
  walletGenerateInputSchema,
  walletGenerateEvmResultSchema,
  walletGenerateSolanaResultSchema,
  walletImportAddInputSchema,
  walletImportEvmInputSchema,
  walletImportSolanaInputSchema,
  walletImportEvmResultSchema,
  walletImportSolanaResultSchema,
  walletListBackupsInputSchema,
  walletListBackupsResultSchema,
  walletOpenBackupFolderInputSchema,
  walletOpenBackupFolderResultSchema,
  walletRestoreArchiveInputSchema,
  walletRestoreArchiveResultSchema,
  walletRestoreInputSchema,
  walletRestoreResultSchema,
  type WalletAddResult,
  type WalletChain,
  type WalletExportAllResult,
  type WalletGenerateEvmResult,
  type WalletGenerateSolanaResult,
  type WalletImportEvmResult,
  type WalletImportSolanaResult,
  type WalletListBackupsResult,
  type WalletOpenBackupFolderResult,
  type WalletRestoreArchiveResult,
  type WalletRestoreResult,
  type WalletRestoredEntry,
} from "@shared/schemas/wallets.js";
import {
  addEvmWallet,
  addSolanaWallet,
  exportAllWalletsRunner,
  generateEvmWallet,
  generateSolanaWallet,
  importEvmWallet,
  importEvmWalletInventory,
  importSolanaWalletInventory,
  importSolanaWalletRunner,
  mapWalletEngineError,
} from "../../onboarding/wallets-runner.js";
import { restoreWalletFromFile } from "../../onboarding/wallet-restore.js";
import {
  adoptUnlockedPassword,
  lockSecretSession,
} from "../../secrets/session.js";
import { SECRETS_VAULT_FILE } from "../../paths/config-dir.js";
import {
  isPasswordSetupError,
  withFreshKeystorePassword,
} from "../../onboarding/wallet-password.js";
import { withWalletLock } from "../../onboarding/wallet-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

/**
 * Truncate an address for the dialog message — short enough to fit
 * a single dialog line on every platform without horizontal scroll.
 */
function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Resolve `candidate` to its real on-disk path and confirm it is a
 * directory inside `${CONFIG_DIR}/backups/` even after symlink
 * resolution (codex turn 8 answer #5 + turn 9 STILL-OPEN). Returns
 * the resolved real path on success — the handler MUST pass that
 * resolved path (not the renderer-supplied one) to `shell.openPath`
 * to close the symlink-swap TOCTOU window between validation and open.
 */
async function resolveBackupDir(candidate: string): Promise<string | null> {
  try {
    const baseReal = await fs.realpath(BACKUPS_DIR);
    const candidateReal = await fs.realpath(candidate);
    const stat = await fs.stat(candidateReal);
    if (!stat.isDirectory()) return null;
    if (
      candidateReal === baseReal ||
      candidateReal.startsWith(baseReal + path.sep)
    ) {
      return candidateReal;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a C1 `WalletInventoryEntry` to the secret-free IPC DTO. Allowlists the
 * public fields explicitly so a future field added to the engine entry never
 * leaks across the boundary by accident. `legacy` is omitted entirely when
 * undefined to match the strict schema's optional property.
 */
function toRestoredEntry(entry: WalletInventoryEntry): WalletRestoredEntry {
  const base = {
    id: entry.id,
    address: entry.address,
    label: entry.label,
    createdAt: entry.createdAt,
  };
  return entry.legacy === undefined
    ? base
    : { ...base, legacy: entry.legacy };
}

export function registerWalletHandlers(): Array<() => void> {
  const handlers: Array<() => void> = [];

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletGenerateEvm,
      domain: "onboarding",
      inputSchema: walletGenerateInputSchema,
      outputSchema: walletGenerateEvmResultSchema,
      handle: async (
        _input,
        ctx
      ): Promise<Result<WalletGenerateEvmResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return generateEvmWallet();
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletGenerateEvm] ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletGenerateSolana,
      domain: "onboarding",
      inputSchema: walletGenerateInputSchema,
      outputSchema: walletGenerateSolanaResultSchema,
      handle: async (
        _input,
        ctx
      ): Promise<Result<WalletGenerateSolanaResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return generateSolanaWallet();
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletGenerateSolana] ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportEvm,
      domain: "onboarding",
      inputSchema: walletImportEvmInputSchema,
      outputSchema: walletImportEvmResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletImportEvmResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importEvmWallet(input.rawKey);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportEvm] ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportSolana,
      domain: "onboarding",
      inputSchema: walletImportSolanaInputSchema,
      outputSchema: walletImportSolanaResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletImportSolanaResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importSolanaWalletRunner(input.rawKey);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportSolana] ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletRestoreFromBackup,
      domain: "onboarding",
      inputSchema: walletRestoreInputSchema,
      outputSchema: walletRestoreResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletRestoreResult>> => {
        const parentWindow = BrowserWindow.fromWebContents(ctx.event.sender);

        // Single-roundtrip flow (codex turn 8 answer #2): main owns the
        // file picker so the renderer never sees absolute paths.
        const dialogResult = await dialog.showOpenDialog(
          parentWindow ?? undefined,
          {
            title: `Restore ${input.chain === "evm" ? "EVM" : "Solana"} keystore from backup`,
            filters: [{ name: "Keystore JSON", extensions: ["json"] }],
            properties: ["openFile"],
          }
        );
        if (dialogResult.canceled) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "Restore cancelled.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        const sourcePath = dialogResult.filePaths[0];
        if (!sourcePath) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "No file selected.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }

        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async (pwdCtx) => {
            const confirmReplace = async (mismatch: {
              chain: WalletChain;
              existingAddress: string;
              incomingAddress: string;
            }): Promise<boolean> => {
              const message =
                `Replace your current ${mismatch.chain === "evm" ? "EVM" : "Solana"} wallet ` +
                `(${truncateAddress(mismatch.existingAddress)}) with the imported one ` +
                `(${truncateAddress(mismatch.incomingAddress)})?`;
              const detail =
                "The current wallet will be backed up automatically before " +
                "the replacement. This is irreversible without your master password " +
                "and the backup folder.";
              const choice = await dialog.showMessageBox(
                parentWindow ?? undefined,
                {
                  type: "warning",
                  title: "Replace wallet?",
                  message,
                  detail,
                  buttons: ["Replace", "Cancel"],
                  defaultId: 1,
                  cancelId: 1,
                  noLink: true,
                }
              );
              return choice.response === 0;
            };

            return restoreWalletFromFile({
              chain: input.chain,
              sourcePath,
              password: pwdCtx.password,
              confirmReplace,
            });
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletRestoreFromBackup] ` +
                `chain=${outcome.data.chain} ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `replaced=${outcome.data.replacedAddress ? truncateAddress(outcome.data.replacedAddress) : "<none>"} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  // ── Full-archive restore (C2) ──────────────────────────────────────────────
  // List backup archives (metadata only — no secrets, no absolute paths). The
  // C1 primitive already strips paths to opaque ids. Read-only, so the wallet
  // mutex alone is sufficient (it serialises with any in-flight restore).
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletListBackups,
      domain: "onboarding",
      inputSchema: walletListBackupsInputSchema,
      outputSchema: walletListBackupsResultSchema,
      handle: async (
        _input,
        ctx
      ): Promise<Result<WalletListBackupsResult>> => {
        return withWalletLock(async () => {
          const backups = listAvailableBackups();
          log.info(
            `[ipc:vex:onboarding:walletListBackups] ` +
              `count=${backups.length} correlationId=${ctx.requestId}`
          );
          return ok({ backups });
        });
      },
    })
  );

  // Restore an ENTIRE backup archive (wallets + vault + .env) by opaque id.
  // The C1 primitive owns: realpath containment under BACKUPS_DIR, manifest
  // validation, decrypt-verify, atomic swap + auto-backup. After the swap, the
  // process runtime is refreshed from the RESTORED on-disk state so no stale
  // in-memory secret survives a vault file the supplied password can/can't open.
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletRestoreArchive,
      domain: "onboarding",
      inputSchema: walletRestoreArchiveInputSchema,
      outputSchema: walletRestoreArchiveResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletRestoreArchiveResult>> => {
        const parentWindow = BrowserWindow.fromWebContents(ctx.event.sender);

        return withWalletLock(async () => {
          // `id` is an opaque basename, never a path. Joining it under
          // BACKUPS_DIR + the C1 primitive's realpath containment guard is the
          // contract — we do NOT trust `id` as a traversable path.
          const archiveDir = path.join(BACKUPS_DIR, input.id);

          const confirmReplace = async (mismatch: {
            family: WalletChain;
            existingAddress: string;
            incomingAddress: string;
          }): Promise<boolean> => {
            const message =
              `Replace your current ${mismatch.family === "evm" ? "EVM" : "Solana"} wallet ` +
              `(${truncateAddress(mismatch.existingAddress)}) with the one in this backup ` +
              `(${truncateAddress(mismatch.incomingAddress)})?`;
            const detail =
              "The current wallet will be backed up automatically before " +
              "the replacement. This is irreversible without your master password " +
              "and the backup folder.";
            const choice = await dialog.showMessageBox(
              parentWindow ?? undefined,
              {
                type: "warning",
                title: "Replace wallet?",
                message,
                detail,
                buttons: ["Replace", "Cancel"],
                defaultId: 1,
                cancelId: 1,
                noLink: true,
              }
            );
            return choice.response === 0;
          };

          let result;
          try {
            result = await restoreFromBackupArchive({
              archiveDir,
              password: input.password,
              confirmReplace,
            });
          } catch (cause) {
            // NEVER include input.password / archiveDir in the mapped error.
            return mapWalletEngineError(cause);
          }

          // ── POST-RESTORE runtime refresh (Codex block #7) ─────────────────
          // Only touch vault/session state if a vault file was ACTUALLY
          // restored. Use C1's ROLE-derived `vaultRestored` signal — NOT a
          // filename check on `filesRestored` — because an untrusted manifest
          // could declare role:"vault" under a different name, and because
          // `vaultLocked:false` is also returned when the archive carried no
          // vault. (C1 additionally fail-closes a non-canonical vault filename.)
          if (result.vaultRestored) {
            // The on-disk vault file was just swapped — refresh runtime so no
            // stale in-memory secret outlives the new vault file.
            if (result.vaultLocked) {
              // Restored vault uses a DIFFERENT password than the one supplied →
              // scrub all managed secrets + reset the provider cache. The user
              // must re-unlock with the backup's password.
              await lockSecretSession();
            } else {
              // Restored vault opens with the supplied password → refresh
              // process.env from the RESTORED vault and adopt it as the unlocked
              // session. `applySecretVaultToProcessEnv` re-reads the new file;
              // `adoptUnlockedPassword` mirrors the in-memory unlock state.
              applySecretVaultToProcessEnv(input.password, {
                filePath: SECRETS_VAULT_FILE,
              });
              adoptUnlockedPassword(input.password);
            }
          }
          // If no vault was restored, the current vault/session is untouched —
          // leave it as-is (do not apply/adopt/scrub).

          // ALWAYS: the restored .env's provider/embedding keys replace stale
          // process.env values, then re-resolve inference against the refreshed
          // env (same pattern as providerPersist). Dynamic import keeps the
          // engine off the main bundle's static graph.
          loadProviderDotenv({ overwrite: true });
          const { resetProvider } = await import(
            "@vex-agent/inference/registry.js"
          );
          resetProvider();

          log.info(
            `[ipc:vex:onboarding:walletRestoreArchive] ` +
              `files=${result.filesRestored.length} ` +
              `wallets=${result.walletsRestored.length} ` +
              `vaultLocked=${result.vaultLocked} correlationId=${ctx.requestId}`
          );

          return ok({
            filesRestored: result.filesRestored,
            walletsRestored: result.walletsRestored.map(toRestoredEntry),
            vaultLocked: result.vaultLocked,
          });
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletOpenBackupFolder,
      domain: "onboarding",
      inputSchema: walletOpenBackupFolderInputSchema,
      outputSchema: walletOpenBackupFolderResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletOpenBackupFolderResult>> => {
        const resolved = await resolveBackupDir(input.backupDir);
        if (resolved === null) {
          log.warn(
            `[ipc:vex:onboarding:walletOpenBackupFolder] rejected path correlationId=${ctx.requestId}`
          );
          return err({
            code: "validation.invalid_input",
            domain: "onboarding",
            message: "Backup path is not inside the Vex backups directory.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        // Pass the realpath-resolved candidate (not the renderer
        // input) to shell.openPath so a symlink swap between
        // validation and open cannot redirect the open target.
        const errorMessage = await shell.openPath(resolved);
        if (errorMessage !== "") {
          log.error(
            `[ipc:vex:onboarding:walletOpenBackupFolder] shell.openPath failed: ${errorMessage}`
          );
          return err({
            code: "internal.unexpected",
            domain: "internal",
            message: "Could not open backup folder in the file manager.",
            retryable: true,
            userActionable: false,
            redacted: true,
          });
        }
        return ok({ ok: true });
      },
    })
  );

  // ── Multi-wallet inventory (puzzle 5 phase 5D) ───────────────────────────
  // Append a wallet to the per-family inventory (≤3). Same lock + fresh-
  // password wrap as generate/import: the engine encrypts a new keystore.

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletAddEvm,
      domain: "onboarding",
      inputSchema: walletAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return addEvmWallet(input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletAddEvm] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletAddSolana,
      domain: "onboarding",
      inputSchema: walletAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return addSolanaWallet(input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletAddSolana] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  // Import-add: rawKey is a SECRET — NEVER logged (only id + truncated addr).
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportAddEvm,
      domain: "onboarding",
      inputSchema: walletImportAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importEvmWalletInventory(input.rawKey, input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportAddEvm] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportAddSolana,
      domain: "onboarding",
      inputSchema: walletImportAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importSolanaWalletInventory(input.rawKey, input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportAddSolana] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  // Export all: copies ENCRYPTED keystores + a sanitized manifest to a
  // user-chosen folder. No plaintext key material is read, so NO fresh
  // keystore password — withWalletLock alone (Codex 5D review). Main owns the
  // directory picker; the renderer never receives the path (result = filenames).
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletExportAll,
      domain: "onboarding",
      inputSchema: walletExportAllInputSchema,
      outputSchema: walletExportAllResultSchema,
      handle: async (_input, ctx): Promise<Result<WalletExportAllResult>> => {
        const parentWindow = BrowserWindow.fromWebContents(ctx.event.sender);
        const dialogResult = await dialog.showOpenDialog(
          parentWindow ?? undefined,
          {
            title: "Export all wallets to a folder",
            properties: ["openDirectory", "createDirectory"],
          }
        );
        if (dialogResult.canceled) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "Export cancelled.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        const destDir = dialogResult.filePaths[0];
        if (!destDir) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "No folder selected.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        return withWalletLock(async () => {
          const outcome = await exportAllWalletsRunner(destDir);
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletExportAll] ` +
                `files=${outcome.data.files.length} correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  return handlers;
}
