/**
 * Wallet generate/import runner (M8) — thin wrappers on the engine's
 * `createWallet`/`createSolanaWallet`/`importWallet`/`importSolanaWallet`
 * via the `@vex-lib/wallet.js` re-export. Returns `Result<T, VexError>`
 * envelopes mapped from engine `VexError` codes per codex turn 8 YELLOW
 * #5 — explicit per-error codes, no generic `onboarding.step_failed`.
 *
 * Callers (`ipc/onboarding/wallets.ts`) wrap each invocation in
 * `withWalletLock` (mutex) and `withFreshKeystorePassword` (force-fresh
 * password from `${CONFIG_DIR}/.env`).
 *
 * M8 explicitly REFUSES overwrite on generate/import: `force` is never
 * passed, so the engine throws `KEYSTORE_ALREADY_EXISTS` when a keystore
 * for that chain already exists. The mapping surfaces this as
 * `wallet.policy_blocked` with a user-actionable message pointing at
 * Restore as the recovery path.
 */

import {
  createSolanaWallet,
  createWallet,
  importSolanaWallet,
  importWallet,
} from "@vex-lib/wallet.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import type {
  WalletGenerateEvmResult,
  WalletGenerateSolanaResult,
  WalletImportEvmResult,
  WalletImportSolanaResult,
} from "@shared/schemas/wallets.js";
import { log } from "../logger/index.js";

// Engine VexError code constants (mirror src/errors.ts ErrorCodes). Inlined
// rather than imported so the re-export surface stays narrow.
const ENGINE_CODE = {
  KEYSTORE_ALREADY_EXISTS: "KEYSTORE_ALREADY_EXISTS",
  KEYSTORE_DECRYPT_FAILED: "KEYSTORE_DECRYPT_FAILED",
  KEYSTORE_PASSWORD_NOT_SET: "KEYSTORE_PASSWORD_NOT_SET",
  KEYSTORE_NOT_FOUND: "KEYSTORE_NOT_FOUND",
  KEYSTORE_CORRUPT: "KEYSTORE_CORRUPT",
  AUTO_BACKUP_FAILED: "AUTO_BACKUP_FAILED",
  INVALID_PRIVATE_KEY: "INVALID_PRIVATE_KEY",
} as const;

interface EngineErrorLike {
  readonly code: string;
  readonly message?: string;
}

function isEngineError(cause: unknown): cause is EngineErrorLike {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code: unknown }).code === "string"
  );
}

/**
 * Map engine errors to the public `VexError` surface. Anything we
 * don't explicitly recognise becomes `internal.unexpected` (NOT
 * `internal.contract_violation` — that is reserved for IPC handler
 * shape mismatches by registerHandler).
 */
export function mapWalletEngineError(cause: unknown): Result<never, VexError> {
  // normalizePrivateKey throws plain Error("Invalid private key: must be 32 bytes hex")
  if (cause instanceof Error && /Invalid private key/i.test(cause.message)) {
    return err({
      code: "validation.invalid_input",
      domain: "onboarding",
      message: "Invalid private key format.",
      retryable: false,
      userActionable: true,
      redacted: true,
    });
  }
  if (isEngineError(cause)) {
    switch (cause.code) {
      case ENGINE_CODE.KEYSTORE_ALREADY_EXISTS:
        return err({
          code: "wallet.policy_blocked",
          domain: "wallet",
          message:
            "A wallet already exists for this chain. Use Restore from backup to load a different one.",
          retryable: false,
          userActionable: true,
          redacted: true,
        });
      case ENGINE_CODE.KEYSTORE_DECRYPT_FAILED:
        return err({
          code: "wallet.password_invalid",
          domain: "wallet",
          message: "Wrong password or corrupted keystore.",
          retryable: true,
          userActionable: true,
          redacted: true,
        });
      case ENGINE_CODE.KEYSTORE_PASSWORD_NOT_SET:
        return err({
          code: "wallet.password_invalid",
          domain: "wallet",
          message: "Master password not configured. Complete Step 1 first.",
          retryable: false,
          userActionable: true,
          redacted: true,
        });
      case ENGINE_CODE.KEYSTORE_NOT_FOUND:
        // Distinct from KEYSTORE_CORRUPT: file is absent vs present-but-bad.
        // Surface as `wallet.keystore_missing` so the renderer can route
        // the user to Generate / Import instead of Restore-from-backup.
        return err({
          code: "wallet.keystore_missing",
          domain: "wallet",
          message: "Keystore file is missing.",
          retryable: false,
          userActionable: true,
          redacted: true,
        });
      case ENGINE_CODE.KEYSTORE_CORRUPT:
        return err({
          code: "wallet.keystore_corrupt",
          domain: "wallet",
          message: "Keystore file is corrupted or in an unsupported format.",
          retryable: false,
          userActionable: false,
          redacted: true,
        });
      case ENGINE_CODE.AUTO_BACKUP_FAILED:
        return err({
          code: "onboarding.env_persist_failed",
          domain: "onboarding",
          message: "Failed to back up the existing wallet. Check disk space and permissions.",
          retryable: true,
          userActionable: true,
          redacted: true,
        });
      case ENGINE_CODE.INVALID_PRIVATE_KEY:
        return err({
          code: "validation.invalid_input",
          domain: "onboarding",
          message: cause.message ?? "Invalid private key format.",
          retryable: false,
          userActionable: true,
          redacted: true,
        });
    }
  }
  log.error("[wallets-runner] unexpected engine error", cause);
  return err({
    code: "internal.unexpected",
    domain: "internal",
    message: "Unexpected error during wallet operation.",
    retryable: false,
    userActionable: false,
    redacted: true,
  });
}

export async function generateEvmWallet(): Promise<Result<WalletGenerateEvmResult>> {
  try {
    const result = await createWallet();
    return ok({ address: result.address });
  } catch (cause) {
    return mapWalletEngineError(cause);
  }
}

export async function generateSolanaWallet(): Promise<Result<WalletGenerateSolanaResult>> {
  try {
    const result = await createSolanaWallet();
    return ok({ address: result.address });
  } catch (cause) {
    return mapWalletEngineError(cause);
  }
}

export async function importEvmWallet(
  rawKey: string
): Promise<Result<WalletImportEvmResult>> {
  try {
    const result = await importWallet(rawKey);
    return ok({ address: result.address });
  } catch (cause) {
    return mapWalletEngineError(cause);
  }
}

export async function importSolanaWalletRunner(
  rawKey: string
): Promise<Result<WalletImportSolanaResult>> {
  try {
    const result = await importSolanaWallet(rawKey);
    return ok({ address: result.address });
  } catch (cause) {
    return mapWalletEngineError(cause);
  }
}
