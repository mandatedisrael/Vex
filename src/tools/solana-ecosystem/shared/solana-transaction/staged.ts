/**
 * Idempotency-safe staged submission for the Jupiter shelves.
 */

import { createHash } from "node:crypto";
import { Connection, type Commitment, Keypair, Transaction } from "@solana/web3.js";
import { loadConfig } from "../../../../config/store.js";
import { VexError, ErrorCodes } from "../../../../errors.js";
import { DEFAULT_CONFIRM_TIMEOUT_MS, DEFAULT_SEND_RETRIES, DEFAULT_NETWORK_RETRIES } from "./constants.js";
import { deserializeVersionedTx } from "./deserialize.js";
import { signVersionedTx } from "./sign.js";
import { confirmVersionedTx } from "./confirm.js";
import { getSolanaConnection } from "./connection.js";

function getConfiguredSolanaConnection(): Connection {
  const cfg = loadConfig();
  return new Connection(
    cfg.solana.rpcUrl,
    { commitment: cfg.solana.commitment as Commitment },
  );
}

/**
 * Idempotency-safe broadcast of a signed versioned transaction.
 *
 * Splits the operation into two distinct phases so a retryable error after
 * broadcast can NEVER trigger a second `sendRawTransaction` (= duplicate
 * spend):
 *
 *   1. Pre-broadcast: `sendRawTransaction` is retried up to `networkRetries`
 *      times. This is safe because no transaction has hit the chain yet — a
 *      retryable send failure means the broadcast did not happen.
 *   2. Post-broadcast: once a signature is returned, the function switches to
 *      CONFIRM-ONLY. A confirmation timeout / unrecognised confirm error is
 *      surfaced as `confirmation_unknown` with the signature attached; it is
 *      NEVER re-broadcast.
 *
 * Returns a `StagedSubmissionResult` whose `signature` is always present.
 * Confirmation classification matches `signAndSubmitLegacyTxStaged`.
 */
export async function signAndSubmitVersionedTxStaged(
  txInput: Uint8Array | string,
  signers: Keypair[],
  options: {
    connection?: Connection;
    skipPreflight?: boolean;
    sendMaxRetries?: number;
    confirmTimeoutMs?: number;
    networkRetries?: number;
  } = {},
): Promise<StagedSubmissionResult> {
  const {
    connection = getConfiguredSolanaConnection(),
    networkRetries = DEFAULT_NETWORK_RETRIES,
    skipPreflight = false,
    sendMaxRetries = DEFAULT_SEND_RETRIES,
    confirmTimeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
  } = options;

  const tx = deserializeVersionedTx(txInput);
  signVersionedTx(tx, signers);
  const serialized = tx.serialize();

  // ── Phase 1: pre-broadcast send (retry-safe; no signature exists yet) ──
  let signature: string | undefined;
  let lastSendError: unknown;
  for (let attempt = 1; attempt <= networkRetries; attempt += 1) {
    try {
      signature = await connection.sendRawTransaction(serialized, {
        skipPreflight,
        maxRetries: sendMaxRetries,
      });
      break;
    } catch (err) {
      lastSendError = err;
      const retryable = err instanceof VexError ? err.retryable : true;
      if (!retryable || attempt >= networkRetries) {
        throw new VexError(
          ErrorCodes.SOLANA_TX_FAILED,
          `Failed to send transaction: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Unreachable in practice (loop either sets `signature` or throws), but the
  // narrowing keeps the post-broadcast section type-safe without a `!`.
  if (signature === undefined) {
    throw new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to send transaction: ${lastSendError instanceof Error ? lastSendError.message : String(lastSendError)}`,
    );
  }

  // ── Phase 2: post-broadcast confirm-only (NEVER re-broadcasts) ──
  try {
    await confirmVersionedTx(connection, signature, confirmTimeoutMs);
    return { signature, phase: "confirmed" };
  } catch (cause) {
    const phase = classifyConfirmFailure(cause);
    const errorKind =
      cause instanceof VexError
        ? cause.code
        : cause instanceof Error
          ? cause.constructor.name
          : typeof cause;
    return {
      signature,
      phase,
      errorKind,
      errorHash: structuralHash(cause),
    };
  }
}

// ── Staged legacy transaction helper (puzzle 5 phase 4) ─────────
//
// Additive variant for wallet_send_confirm that structurally surfaces the
// post-broadcast signature even when confirmation fails. Caller can then
// route to `markFailed(tx_hash=signature)` instead of losing the on-chain
// trace inside an opaque throw.
//
// The existing `signAndSendLegacyTx` is preserved verbatim for Jupiter
// swap and other callers that prefer the throw-on-any-error contract.
// Codex puzzle-5 phase-4 review point 1 (v3 GREEN LIGHT condition).

export type StagedSubmissionPhase =
  | "confirmed"
  | "chain_failed"
  | "confirmation_unknown";

export interface StagedSubmissionResult {
  /**
   * On-chain signature. ALWAYS present — `signAndSubmitLegacyTxStaged`
   * only returns after `sendRawTransaction` succeeds. Pre-broadcast
   * failures (signing, blockhash fetch, send) throw out instead.
   */
  signature: string;
  phase: StagedSubmissionPhase;
  /** Structural error label only — never raw cause message. */
  errorKind?: string;
  errorHash?: string;
}

/**
 * Submit a legacy `Transaction` and report the post-broadcast outcome
 * as a discriminated `phase`. Pre-broadcast failures (signing, blockhash
 * fetch, `sendRawTransaction`) throw out — caller wraps to map them to
 * `pre_broadcast_failed` in the wallet runtime path.
 *
 * Confirmation outcome classification:
 *   - `confirmed`              — `confirmVersionedTx` returned normally.
 *   - `chain_failed`           — `VexError` with code `SOLANA_TX_FAILED`
 *                                (chain reverted; status.err present).
 *   - `confirmation_unknown`   — `VexError` with code `SOLANA_TX_TIMEOUT`
 *                                OR an unrecognised throw (fall-through
 *                                via regex on the message). Broadcast
 *                                already happened; operator needs the
 *                                signature to inspect on-chain.
 */
export async function signAndSubmitLegacyTxStaged(
  transaction: Transaction,
  keypair: Keypair,
  opts?: { connection?: Connection },
): Promise<StagedSubmissionResult> {
  const connection = opts?.connection ?? getSolanaConnection();

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  // Pre-broadcast: any throw from sendRawTransaction bubbles out.
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false, maxRetries: 2 },
  );

  // Broadcast happened — anything below is post-broadcast.
  try {
    await confirmVersionedTx(connection, signature);
    return { signature, phase: "confirmed" };
  } catch (cause) {
    const phase = classifyConfirmFailure(cause);
    const errorKind =
      cause instanceof VexError
        ? cause.code
        : cause instanceof Error
          ? cause.constructor.name
          : typeof cause;
    return {
      signature,
      phase,
      errorKind,
      errorHash: structuralHash(cause),
    };
  }
}

function classifyConfirmFailure(cause: unknown): StagedSubmissionPhase {
  // Primary classifier — VexError code from the confirm helper.
  if (cause instanceof VexError) {
    if (cause.code === ErrorCodes.SOLANA_TX_FAILED) return "chain_failed";
    if (cause.code === ErrorCodes.SOLANA_TX_TIMEOUT) {
      return "confirmation_unknown";
    }
  }
  // Fallback regex (Codex puzzle-5 phase-4 review point 1 acceptance):
  // VexError code is authoritative; regex catches third-party errors that
  // bypass the typed wrapper.
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/reverted|simulation failed|transaction failed/i.test(message)) {
    return "chain_failed";
  }
  return "confirmation_unknown";
}

function structuralHash(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return createHash("sha256").update(message).digest("hex").slice(0, 16);
}
