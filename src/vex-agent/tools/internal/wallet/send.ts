/**
 * Wallet send handlers — prepare + confirm transfers (Solana + EVM multi-chain).
 *
 * Puzzle 5 phase 4: process-local `pendingIntents = new Map<...>` replaced
 * by DB-backed `wallet_intents` (migration 025). Confirm gates on
 * expiry + status + session ownership via the repo CAS, persists tx hash
 * on success, and surfaces structurally redacted failures so raw RPC /
 * wallet messages never leak into the transcript.
 *
 * File-level structure (Codex puzzle-5 phase-4 review v3 LOC discipline):
 *   - this file              — public handlers + outcome finalisation
 *   - send-types.ts          — ExecuteOutcome union, summarizeWalletError,
 *                              buildWalletIntentPreview, TTL constant
 *   - send-execute-solana.ts — Solana validation + staged broadcast
 *   - send-execute-evm.ts    — EVM setup + sendTx + receipt wait
 */

import { randomUUID } from "node:crypto";

import { walletAddressesEqual } from "@tools/wallet/inventory.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import * as walletIntentsRepo from "@vex-agent/db/repos/wallet-intents.js";
import logger from "@utils/logger.js";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str } from "../types.js";

import { executeEvmTransfer } from "./send-execute-evm.js";
import { executeSolanaTransfer } from "./send-execute-solana.js";
import {
  resolveSelectedAddress,
  resolveSigningWallet,
  walletScopeErrorToResult,
} from "./resolve.js";
import {
  WALLET_INTENT_TTL_MS,
  buildWalletIntentPreview,
  summarizeWalletError,
  type ExecuteOutcome,
} from "./send-types.js";

function ok(data: unknown): ToolResult {
  return {
    success: true,
    output: JSON.stringify(data, null, 2),
    data: data as Record<string, unknown>,
  };
}

function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

// ── wallet_send_prepare ─────────────────────────────────────────────────

export async function handleWalletSendPrepare(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const network = str(params, "network") as "eip155" | "solana";
  const to = str(params, "to");
  const amount = str(params, "amount");
  const token = str(params, "token") || null;

  if (!network || !to || !amount) {
    return fail("Missing required: network, to, amount");
  }

  if (network !== "eip155" && network !== "solana") {
    return fail("network must be eip155 or solana");
  }

  const chain = str(params, "chain") || null;
  if (network === "eip155" && chain === null) {
    return fail("Missing required: chain for eip155 transfers");
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return fail(`Invalid amount: ${amount}`);
  }

  // Per-session selected wallet (puzzle 5 phase 5B) — address only, no decrypt.
  let walletAddress: string;
  try {
    walletAddress = resolveSelectedAddress(context.walletResolution, context.walletPolicy, network);
  } catch (err) {
    return walletScopeErrorToResult(err);
  }

  const intentId = `intent-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + WALLET_INTENT_TTL_MS).toISOString();
  const previewJson = buildWalletIntentPreview({
    network,
    chain,
    to,
    amount,
    token,
  });

  await walletIntentsRepo.create({
    intentId,
    sessionId: context.sessionId,
    walletAddress,
    network,
    chainAlias: chain,
    toAddress: to,
    amount,
    token,
    previewJson,
    expiresAt,
    idempotencyKey: intentId,
  });

  return ok({
    intentId,
    network,
    chain: chain ?? undefined,
    to,
    amount,
    token: token ?? "native",
    status: "prepared",
    expiresAt,
    message: "Use wallet_send_confirm to broadcast this transfer.",
  });
}

// ── wallet_send_confirm ─────────────────────────────────────────────────

export async function handleWalletSendConfirm(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const network = str(params, "network") as "eip155" | "solana";
  const intentId = str(params, "intentId");

  if (!network || !intentId) {
    return fail("Missing required: network, intentId");
  }

  // Session-scoped lookup — cross-session intentId yields null (Codex
  // puzzle-5 phase-4 review point 3).
  const intent = await walletIntentsRepo.getById(intentId, context.sessionId);
  if (!intent) {
    return fail(`Intent not found: ${intentId}.`);
  }

  if (intent.network !== network) {
    return fail(
      `Network mismatch: intent is ${intent.network}, got ${network}`,
    );
  }

  if (intent.status !== "pending") {
    return fail(`Intent ${intentId} is ${intent.status} — cannot consume.`);
  }

  if (new Date(intent.expiresAt) <= new Date()) {
    return fail(`Intent expired at ${intent.expiresAt}.`);
  }

  // Approval gate — UNCHANGED from pre-phase-4. Intent stays `pending`
  // for the approval-then-retry cycle; the same row is consumed on the
  // second dispatch after the operator approves.
  if (!context.approved && context.sessionPermission === "restricted") {
    return {
      success: false,
      output:
        "Transfer requires approval under restricted permission. Use the approval flow to confirm.",
      pendingApproval: true,
    };
  }

  // Resolve the session's signing wallet AFTER the approval gate, and assert it
  // matches the intent's recorded wallet BEFORE consuming. A mismatch (selection
  // drift / bug) fails closed WITHOUT mutating the intent — it stays `pending`
  // and expires; no markFailed (which requires `consuming`). Codex 5B review.
  let signer: ChainWallet;
  try {
    signer = resolveSigningWallet(context.walletResolution, context.walletPolicy, network);
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  const invFamily = network === "solana" ? "solana" : "evm";
  if (!walletAddressesEqual(invFamily, signer.address, intent.walletAddress)) {
    return fail("Selected wallet does not match this intent's wallet. Re-prepare the transfer.");
  }

  // CAS-consume atomically; race losers get null.
  const claimed = await walletIntentsRepo.consumeIfPending(
    intentId,
    context.sessionId,
  );
  if (!claimed) {
    const cur = await walletIntentsRepo.getById(intentId, context.sessionId);
    return fail(
      `Cannot consume intent ${intentId}: status=${cur?.status ?? "unknown"}.`,
    );
  }

  let outcome: ExecuteOutcome;
  if (network === "solana") {
    if (signer.family !== "solana") return fail("Resolved wallet family mismatch.");
    outcome = await executeSolanaTransfer(claimed, signer);
  } else {
    if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");
    outcome = await executeEvmTransfer(claimed, signer);
  }

  return finalizeOutcome(intentId, context.sessionId, outcome);
}

// ── Outcome finalisation (audit writes + ToolResult shape) ──────────────

async function finalizeOutcome(
  intentId: string,
  sessionId: string,
  outcome: ExecuteOutcome,
): Promise<ToolResult> {
  switch (outcome.kind) {
    case "confirmed":
      return finalizeConfirmed(intentId, sessionId, outcome);
    case "chain_failed":
      await markFailedChecked(intentId, sessionId, outcome, outcome.txHash);
      return fail(
        `Wallet transfer reverted on-chain. Error hash: ${outcome.errorHash}. Tx hash: ${outcome.txHash}.`,
      );
    case "confirmation_unknown":
      await markFailedChecked(
        intentId,
        sessionId,
        { errorKind: "ConfirmationUnknown", errorHash: outcome.errorHash },
        outcome.txHash,
      );
      return fail(
        `Wallet transfer broadcast but confirmation unknown. Error hash: ${outcome.errorHash}. Tx hash: ${outcome.txHash}.`,
      );
    case "pre_broadcast_failed":
      await markFailedChecked(intentId, sessionId, outcome, null);
      return fail(
        `Wallet transfer failed before broadcast. Error hash: ${outcome.errorHash}.`,
      );
  }
}

/**
 * `markFailed` returns `null` on CAS miss (status was already
 * non-`consuming` when this write ran). That is an audit/status drift —
 * caller-side log it structurally so the operator notices. The original
 * outcome (failed transfer) still surfaces to the agent via the
 * `ToolResult` returned by `finalizeOutcome` — the audit log entry is
 * the only place the inconsistency is visible.
 *
 * Codex puzzle-5 phase-4 final review point 1.
 */
async function markFailedChecked(
  intentId: string,
  sessionId: string,
  cause: { errorKind: string; errorHash: string },
  txHash: string | null,
): Promise<void> {
  const row = await walletIntentsRepo.markFailed(
    intentId,
    sessionId,
    `${cause.errorKind}:${cause.errorHash}`,
    txHash,
  );
  if (row === null) {
    logger.warn("wallet.send.mark_failed_status_mismatch", {
      intentId,
      sessionId,
      txHash,
      errorKind: cause.errorKind,
      errorHash: cause.errorHash,
    });
  }
}

async function finalizeConfirmed(
  intentId: string,
  sessionId: string,
  outcome: Extract<ExecuteOutcome, { kind: "confirmed" }>,
): Promise<ToolResult> {
  let markedExecuted = false;
  let auditReason: string | null = null;
  try {
    const row = await walletIntentsRepo.markExecuted(
      intentId,
      sessionId,
      outcome.txHash,
    );
    if (row === null) {
      // CAS miss — status was not 'consuming' at write time. Possible
      // operator-side mutation or process-restart inconsistency. Tx is
      // still real on-chain; surface via structural audit log + flip the
      // row to `audit_failed` so phase 7 reconcile tooling sees it.
      logger.warn("wallet.send.mark_executed_status_mismatch", {
        intentId,
        sessionId,
        txHash: outcome.txHash,
      });
      auditReason = "StatusMismatch:no_consuming_row";
    } else {
      markedExecuted = true;
    }
  } catch (auditErr) {
    const sum = summarizeWalletError(auditErr);
    logger.warn("wallet.send.audit_write_failed", {
      intentId,
      sessionId,
      txHash: outcome.txHash,
      errorKind: sum.errorKind,
      errorHash: sum.errorHash,
    });
    // Preserve the underlying cause as the audit reason — the structural
    // ErrorKind:hash label matches the failure_reason format used on
    // pre/post-broadcast failure paths.
    auditReason = `${sum.errorKind}:${sum.errorHash}`;
  }

  if (!markedExecuted && auditReason !== null) {
    await tryMarkAuditFailed(
      intentId,
      sessionId,
      outcome.txHash,
      auditReason,
    );
  }

  return {
    success: true,
    output: JSON.stringify(outcome.data, null, 2),
    data: outcome.data,
  };
}

/**
 * Best-effort `markAuditFailed` for the `consuming` row when markExecuted
 * could not flip to `executed`. Returns silently — the tx is already
 * on-chain; the audit row drift is logged but does not change the
 * `ToolResult` (Codex puzzle-5 phase-4 final review point 1). The reason
 * threads through from the original markExecuted outcome (throw cause OR
 * `StatusMismatch:no_consuming_row` for the null CAS path).
 */
async function tryMarkAuditFailed(
  intentId: string,
  sessionId: string,
  txHash: string,
  reason: string,
): Promise<void> {
  try {
    const row = await walletIntentsRepo.markAuditFailed(
      intentId,
      sessionId,
      txHash,
      reason,
    );
    if (row === null) {
      // markAuditFailed also requires status='consuming'. If we missed
      // here too, the intent is in a status the audit lifecycle does not
      // cover (likely 'cancelled' or 'failed' from a concurrent path).
      logger.warn("wallet.send.mark_audit_failed_status_mismatch", {
        intentId,
        sessionId,
        txHash,
      });
    }
  } catch (cascadingErr) {
    const csum = summarizeWalletError(cascadingErr);
    logger.warn("wallet.send.audit_cascade_failed", {
      intentId,
      sessionId,
      txHash,
      errorKind: csum.errorKind,
      errorHash: csum.errorHash,
    });
  }
}
