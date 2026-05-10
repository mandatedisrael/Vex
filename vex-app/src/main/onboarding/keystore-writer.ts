/**
 * Keystore password writer (M7) — persists `VEX_KEYSTORE_PASSWORD` into
 * the shared `${CONFIG_DIR}/.env` so vex-shell and vex-app see the same
 * value (CLI ↔ GUI parity gate).
 *
 * The actual atomic write lives in `appendToDotenvFile()` in the engine
 * tree, re-exported through `src/lib/dotenv.ts` so we can pull it via
 * the `@vex-lib` alias established in M6. The engine and the GUI never
 * diverge on the on-disk format (mode 0o600, line-based key=value with
 * quoted value, atomic temp+rename).
 *
 * Idempotency: if the requested password already matches the value on
 * disk, we return `{ kind: "unchanged" }` without writing. This keeps
 * the wizard "Continue" path safe against StrictMode dev double-mount,
 * Retry button presses, and partial-recovery resumes.
 *
 * No safeStorage / Argon2id KDF here — those land in the Phase 2 KDF
 * migration (re-encrypt existing wallets with user's password). Until
 * then plaintext + 0o600 + shared format with vex-shell is the contract
 * (see `vex-app/src/main/compose/electron-secret-adapter.ts:1-10` for
 * the same posixSecretAdapter alignment story).
 */

import {
  appendToDotenvFile,
  readDotenvFileValue,
} from "@vex-lib/dotenv.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import type { KeystoreSetResult } from "@shared/schemas/wizard.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";

const KEYSTORE_ENV_KEY = "VEX_KEYSTORE_PASSWORD";

export interface SetKeystorePasswordOptions {
  /** Override `ENV_FILE` for tests; production callers omit this. */
  readonly envFile?: string;
}

export async function setKeystorePassword(
  password: string,
  options: SetKeystorePasswordOptions = {}
): Promise<Result<KeystoreSetResult>> {
  const targetFile = options.envFile ?? ENV_FILE;

  // Read first so a no-op submission (Continue after partial recovery,
  // dev double-mount, deliberate retry) doesn't churn the file. Read
  // failures are tolerated — readDotenvFileValue returns null on any
  // I/O error and we proceed to write.
  let current: string | null = null;
  try {
    current = readDotenvFileValue(KEYSTORE_ENV_KEY, targetFile);
  } catch (cause) {
    log.warn(
      `[keystore-writer] read of ${KEYSTORE_ENV_KEY} failed; proceeding to write`,
      cause
    );
  }

  if (current !== null && current === password) {
    return ok({ kind: "unchanged" });
  }

  try {
    appendToDotenvFile(KEYSTORE_ENV_KEY, password, targetFile);
  } catch (cause) {
    log.error(
      `[keystore-writer] failed to persist ${KEYSTORE_ENV_KEY} to ${targetFile}`,
      cause
    );
    return err({
      code: "onboarding.env_persist_failed",
      domain: "onboarding",
      message: "Could not persist password. Check disk space and permissions.",
      retryable: true,
      userActionable: true,
      redacted: true,
    });
  }

  return ok({ kind: "set" });
}
