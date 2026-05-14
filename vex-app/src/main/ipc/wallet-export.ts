/**
 * vex.wallet.exportPrivateKey — sudo-style export of a wallet's private key
 * to the OS clipboard with an auto-clear lease (Phase 2 feature #6).
 *
 * Flow per locked spec:
 *   1. Throttle gate (`checkExportAllowed`). On lockout return
 *      `wallet.export_throttled` with `retryAfterMs` so the renderer can
 *      render a precise "Try again in Xs" message.
 *   2. Session must be unlocked. The export path does NOT itself prompt
 *      for unlock; the renderer is expected to gate the action behind
 *      `getSecretSessionStatus().unlocked`.
 *   3. Re-auth via `verifySecretVaultPassword` — sudo-style, does NOT
 *      mutate session state or rewrite the vault file. Wrong password
 *      advances the throttle. At `EXPORT_FAIL_LIMIT` we relock the vault
 *      so the user must re-enter the password from scratch.
 *   4. Load the chain-specific keystore. Missing file → distinct
 *      `wallet.keystore_missing` (no policy_blocked confusion).
 *   5. Decrypt + encode (EVM hex / Solana base58). Solana path zeroizes
 *      the mutable plaintext buffer immediately after encoding.
 *   6. Write to clipboard inside a single global lease. A new export
 *      cancels the previous lease's timer + cleanup registry entry.
 *   7. Timer fires after CLEAR_AFTER_MS: only clears the clipboard if the
 *      content still matches the secret we wrote (compared by SHA-256 to
 *      avoid keeping the plaintext alive).
 *   8. Audit log records chain + correlationId only; never the secret.
 *
 * Strict process-boundary discipline: the secret string is created and
 * dropped inside this module. It never returns to the renderer; the
 * Result<T> payload reports only `copied: true` + `clearAfterMs`.
 */

import crypto from "node:crypto";
import { clipboard } from "electron";
import {
  decryptPrivateKey,
  decryptSolanaSecretKey,
  encodeSolanaSecretKey,
  type KeystoreV1,
  loadKeystore,
  loadSolanaKeystore,
} from "@vex-lib/wallet.js";
import {
  LocalSecretVaultError,
  verifySecretVaultPassword,
} from "@vex-lib/local-secret-vault.js";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  walletExportPrivateKeyInputSchema,
  walletExportPrivateKeyResultSchema,
  type WalletExportPrivateKeyInput,
  type WalletExportPrivateKeyResult,
} from "@shared/schemas/wallets.js";
import { globalCleanup } from "../lifecycle/cleanup-registry.js";
import { SECRETS_VAULT_FILE } from "../paths/config-dir.js";
import {
  getSecretSessionStatus,
  lockSecretSession,
} from "../secrets/session.js";
import {
  checkExportAllowed,
  recordExportFailure,
  recordExportSuccess,
} from "../wallet/export-throttle.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

/**
 * How long the secret stays on the OS clipboard before the lease timer
 * tries to clear it. 10 seconds is enough for "select → switch app →
 * paste" without leaving the secret resident for an unreasonable window.
 * Spec-locked at 10_000ms — do not bump without revisiting the renderer
 * UX copy that promises this exact value.
 */
const CLEAR_AFTER_MS = 10_000;

interface ClipboardLease {
  /**
   * Monotonic token used as the idempotency key for the lease's timer
   * and quit-time cleanup. The timer / cleanup callback checks
   * `activeLease?.token !== token` before doing anything so a newer
   * lease's actions cannot accidentally clear (or re-clear) the
   * older lease's clipboard payload.
   */
  readonly token: number;
  /** SHA-256 of the secret string — used to confirm the clipboard still
   * holds OUR write before we clear it. Storing the hash (not the
   * plaintext) means a memory dump of the lease object reveals nothing. */
  readonly secretHash: string;
  readonly timerId: NodeJS.Timeout;
  /** Unregister callback from `globalCleanup.add`. Calling it removes
   * the task from the registry AND runs it; our task is idempotent so a
   * double-run is safe. */
  readonly unregister: () => Promise<void>;
}

let activeLease: ClipboardLease | null = null;
let nextToken = 0;

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Conditional clear: only wipe the clipboard if the current text
 * SHA-256 still matches `secretHash`. Tolerates the (very common) case
 * where the user has already copied something else over the secret —
 * we don't want to nuke a banking password the user typed during the
 * 10s window.
 */
function clearIfStillOurs(secretHash: string): void {
  try {
    const current = clipboard.readText();
    if (hashSecret(current) === secretHash) {
      clipboard.clear();
    }
  } catch (cause: unknown) {
    // electron's clipboard API throws synchronously on platforms where
    // the underlying native call fails (rare; X11 without selection
    // server). Log and continue — best-effort cleanup.
    log.warn("[wallet:export] clipboard cleanup probe failed", cause);
  }
}

/**
 * Acquire (or replace) the single clipboard lease.
 *
 * Replacement protocol — the order matters:
 *   1. Capture a reference to the previous lease.
 *   2. NULL OUT `activeLease` BEFORE running the previous lease's
 *      unregister callback. The unregister both removes the task from
 *      the cleanup registry AND runs it (CleanupRegistry's surface),
 *      and the task's body is gated on `activeLease?.token === token`.
 *      With `activeLease` already null the task short-circuits — it
 *      does NOT clear the clipboard, which is correct because we are
 *      about to overwrite it with the new secret.
 *   3. Clear the previous timer so it cannot fire mid-replacement.
 *   4. Write the new secret + install the new lease.
 */
function acquireLease(secret: string): void {
  const prior = activeLease;
  if (prior !== null) {
    // Order matters: null out the module's active-lease reference
    // FIRST so the prior task's `activeLease?.token !== token` guard
    // makes it no-op when unregister runs it. Otherwise the prior
    // task would conditionally clear the clipboard — and at this
    // exact moment clipboard still holds the prior secret, so it
    // would clear BEFORE we writeText the new one below. Wasteful
    // and observable as a transient empty clipboard.
    activeLease = null;
    clearTimeout(prior.timerId);
    void prior.unregister().catch((unregErr: unknown) => {
      log.warn(
        "[wallet:export] previous lease unregister failed",
        unregErr,
      );
    });
  }

  const secretHash = hashSecret(secret);
  clipboard.writeText(secret);
  // `secret` reference is allowed to drop after this point — caller is
  // expected to scope it locally.

  nextToken += 1;
  const token = nextToken;

  const timerId = setTimeout(() => {
    // Token check: a newer lease may have replaced us. If so it
    // already cleared our timer; this branch is a defensive no-op.
    if (activeLease?.token !== token) return;
    clearIfStillOurs(secretHash);
    // Detach the registry entry so app quit doesn't re-run the
    // (now no-op) cleanup. We've already done the conditional clear.
    const leaseRef = activeLease;
    activeLease = null;
    void leaseRef.unregister().catch((unregErr: unknown) => {
      log.warn("[wallet:export] timer unregister failed", unregErr);
    });
  }, CLEAR_AFTER_MS);

  const unregister = globalCleanup.add(() => {
    // App quit / forced cleanup path. Same idempotency check as the
    // timer — only act if we're still the active lease.
    if (activeLease?.token !== token) return;
    clearTimeout(timerId);
    clearIfStillOurs(secretHash);
    activeLease = null;
  });

  activeLease = { token, secretHash, timerId, unregister };
}

function formatRetryAfter(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

/**
 * Engine `VexError` code constants mirrored locally to avoid coupling
 * to the engine's `ErrorCodes` namespace at the public surface.
 */
const ENGINE_CODE = {
  KEYSTORE_CORRUPT: "KEYSTORE_CORRUPT",
} as const;

function isEngineErrorWithCode(cause: unknown, code: string): boolean {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code: unknown }).code === "string"
  ) {
    return (cause as { code: string }).code === code;
  }
  return false;
}

function keystoreCorruptError(correlationId: string): VexError {
  return {
    code: "wallet.keystore_corrupt",
    domain: "wallet",
    message: "Keystore file is corrupted or in an unsupported format.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function keystoreMissingError(correlationId: string): VexError {
  return {
    code: "wallet.keystore_missing",
    domain: "wallet",
    message:
      "No wallet exists for this chain. Generate or import one before exporting.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

type KeystoreLoadOutcome =
  | { readonly kind: "ok"; readonly value: KeystoreV1 }
  | { readonly kind: "missing" }
  | { readonly kind: "corrupt" };

/**
 * Wraps the engine keystore loader so the handler can distinguish
 * "file absent" from "file present but malformed" without leaking the
 * engine error surface. `loadKeystore` returns `null` on absence and
 * throws an engine `VexError(KEYSTORE_CORRUPT)` on bad JSON; both
 * surfaces map to distinct public error codes.
 */
function loadKeystoreSafely(
  loader: () => KeystoreV1 | null,
): KeystoreLoadOutcome {
  try {
    const value = loader();
    if (value === null) return { kind: "missing" };
    return { kind: "ok", value };
  } catch (cause: unknown) {
    if (isEngineErrorWithCode(cause, ENGINE_CODE.KEYSTORE_CORRUPT)) {
      return { kind: "corrupt" };
    }
    // Unknown loader failure — surface as corrupt so the user is told
    // to restore from backup rather than retry blindly.
    log.error("[wallet:export] unexpected keystore loader error", cause);
    return { kind: "corrupt" };
  }
}

/**
 * Decrypt + encode the secret per chain. Solana path operates on a
 * mutable Uint8Array so we can zeroize it after encoding; the engine
 * function returns a fresh buffer per call. Returns the secret string
 * + the format label the renderer surfaces.
 *
 * The returned `secret` is the only place the plaintext exists; callers
 * MUST scope it locally and drop the reference before logging or
 * Result construction.
 */
function decryptSecret(
  chain: WalletExportPrivateKeyInput["chain"],
  keystore: KeystoreV1,
  password: string,
): { readonly secret: string; readonly format: "hex" | "base58" } {
  if (chain === "evm") {
    // decryptPrivateKey returns Hex (`0x...`). Treat as string for clipboard.
    const secret = decryptPrivateKey(keystore, password);
    return { secret, format: "hex" };
  }
  const decryptedBytes: Uint8Array = decryptSolanaSecretKey(
    keystore,
    password,
  );
  try {
    const encoded = encodeSolanaSecretKey(decryptedBytes);
    return { secret: encoded, format: "base58" };
  } finally {
    // Mutable buffer — zeroize before letting it drop. Cannot do this
    // for the encoded base58 string (immutable JS string), so the
    // best we can do for the string is keep its lifetime as short as
    // possible: callers must not retain the result struct.
    decryptedBytes.fill(0);
  }
}

export function registerWalletExportHandler(): () => void {
  return registerHandler({
    channel: CH.wallet.exportPrivateKey,
    domain: "wallet",
    inputSchema: walletExportPrivateKeyInputSchema,
    outputSchema: walletExportPrivateKeyResultSchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<WalletExportPrivateKeyResult>> => {
      // 1. Throttle gate ─────────────────────────────────────────────
      const gate = checkExportAllowed();
      if (!gate.allowed) {
        log.warn(
          `[ipc:vex:wallet:exportPrivateKey] throttled chain=${input.chain} ` +
            `retryAfterMs=${gate.retryAfterMs} correlationId=${ctx.requestId}`,
        );
        return err({
          code: "wallet.export_throttled",
          domain: "wallet",
          message: `Too many failed export attempts. Try again in ${formatRetryAfter(
            gate.retryAfterMs,
          )}.`,
          retryable: true,
          userActionable: true,
          redacted: true,
          retryAfterMs: gate.retryAfterMs,
          correlationId: ctx.requestId,
        });
      }

      // 2. Session must be unlocked ─────────────────────────────────
      const sessionStatus = getSecretSessionStatus();
      if (!sessionStatus.unlocked) {
        log.warn(
          `[ipc:vex:wallet:exportPrivateKey] session locked correlationId=${ctx.requestId}`,
        );
        return err({
          code: "wallet.keystore_locked",
          domain: "wallet",
          message:
            "Unlock Vex with your master password before exporting wallet keys.",
          retryable: false,
          userActionable: true,
          redacted: true,
          correlationId: ctx.requestId,
        });
      }

      // 3. Sudo-style re-auth — verifySecretVaultPassword does NOT
      //    upgrade KDF params or rewrite the vault on disk, and does
      //    not return the decrypted payload. ───────────────────────
      try {
        verifySecretVaultPassword(input.password, {
          filePath: SECRETS_VAULT_FILE,
        });
      } catch (cause: unknown) {
        if (
          cause instanceof LocalSecretVaultError &&
          cause.code === "invalid_password"
        ) {
          const { lockoutTriggered } = recordExportFailure();
          if (lockoutTriggered) {
            // Relock the vault — the user must re-unlock from scratch.
            // The throttle continues to enforce a 30s window in parallel
            // so an attacker also can't immediately retry.
            lockSecretSession();
            log.warn(
              `[ipc:vex:wallet:exportPrivateKey] lockout triggered, vault relocked ` +
                `chain=${input.chain} correlationId=${ctx.requestId}`,
            );
            return err({
              code: "wallet.keystore_locked",
              domain: "wallet",
              message:
                "Too many failed export attempts. Vault has been relocked — re-enter your master password.",
              retryable: false,
              userActionable: true,
              redacted: true,
              correlationId: ctx.requestId,
            });
          }
          log.warn(
            `[ipc:vex:wallet:exportPrivateKey] wrong password correlationId=${ctx.requestId}`,
          );
          // After-record gate read — if the failure landed us inside the
          // window, surface the same retryAfterMs hint as the throttle
          // path so the renderer can render a precise countdown.
          const postGate = checkExportAllowed();
          return err({
            code: "wallet.password_invalid",
            domain: "wallet",
            message: "Master password is incorrect.",
            retryable: true,
            userActionable: true,
            redacted: true,
            retryAfterMs:
              !postGate.allowed ? postGate.retryAfterMs : undefined,
            correlationId: ctx.requestId,
          });
        }
        if (
          cause instanceof LocalSecretVaultError &&
          cause.code === "missing"
        ) {
          return err({
            code: "wallet.vault_not_configured",
            domain: "wallet",
            message: "Master password is not configured. Complete setup first.",
            retryable: false,
            userActionable: true,
            redacted: true,
            correlationId: ctx.requestId,
          });
        }
        // Any other vault error (IO, corrupt JSON) — NOT an attacker
        // signal. Do not advance the throttle.
        log.error(
          `[ipc:vex:wallet:exportPrivateKey] vault verify failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err({
          code: "internal.unexpected",
          domain: "wallet",
          message: "Could not access the secret vault.",
          retryable: true,
          userActionable: false,
          redacted: true,
          correlationId: ctx.requestId,
        });
      }

      // 4. Load chain-specific keystore ──────────────────────────────
      const loader = input.chain === "evm" ? loadKeystore : loadSolanaKeystore;
      const outcome = loadKeystoreSafely(loader);
      if (outcome.kind === "missing") {
        log.warn(
          `[ipc:vex:wallet:exportPrivateKey] keystore missing chain=${input.chain} correlationId=${ctx.requestId}`,
        );
        return err(keystoreMissingError(ctx.requestId));
      }
      if (outcome.kind === "corrupt") {
        log.error(
          `[ipc:vex:wallet:exportPrivateKey] keystore corrupt chain=${input.chain} correlationId=${ctx.requestId}`,
        );
        return err(keystoreCorruptError(ctx.requestId));
      }
      const keystore = outcome.value;

      // 5. Decrypt + format. The plaintext exists only inside the
      //    `secret` binding below; we drop the reference as soon as
      //    the clipboard write is queued. ───────────────────────────
      let secret: string;
      let format: "hex" | "base58";
      try {
        const decrypted = decryptSecret(input.chain, keystore, input.password);
        secret = decrypted.secret;
        format = decrypted.format;
      } catch (cause: unknown) {
        // verifySecretVaultPassword passed, so a decrypt failure here is
        // either (a) the keystore was encrypted with a different password
        // than the vault (mismatched state — should not happen but is
        // surfaced honestly) or (b) corrupt ciphertext. Map both to
        // wallet.keystore_corrupt; we do NOT advance the export throttle
        // because the password proved correct against the vault.
        log.error(
          `[ipc:vex:wallet:exportPrivateKey] decrypt failed chain=${input.chain} correlationId=${ctx.requestId}`,
          cause,
        );
        return err(keystoreCorruptError(ctx.requestId));
      }

      // 6+7. Acquire clipboard lease (timer + quit-time cleanup) ─────
      acquireLease(secret);
      // Allow the secret string reference to drop. JS strings are
      // immutable so we can't zeroize, but minimising lifetime gives
      // the GC a chance to collect before a crash dump captures it.
      secret = "";

      // 8. Audit log: metadata only, never the secret ─────────────────
      log.info(
        `[ipc:vex:wallet:exportPrivateKey] chain=${input.chain} format=${format} ` +
          `correlationId=${ctx.requestId}`,
      );

      recordExportSuccess();

      return ok({
        chain: input.chain,
        format,
        copied: true,
        clearAfterMs: CLEAR_AFTER_MS,
      });
    },
  });
}

/**
 * Test-only helper. Drops any active lease without performing its
 * cleanup — used by unit tests to reset module state between cases.
 * NEVER call from production code.
 */
export function __resetWalletExportStateForTests(): void {
  if (activeLease !== null) {
    clearTimeout(activeLease.timerId);
    void activeLease.unregister().catch(() => {
      /* swallow — tests reset cleanup registry separately */
    });
    activeLease = null;
  }
  nextToken = 0;
}

/** Exposed for tests so they can probe the lease state without mocks. */
export function __getActiveLeaseTokenForTests(): number | null {
  return activeLease?.token ?? null;
}
