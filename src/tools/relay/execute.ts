/**
 * Relay bridge executor — validate the WHOLE quote, then sign every step in
 * order, then poll to terminal.
 *
 * FAIL-CLOSED ORDERING (fund safety): validation and broadcasting are strictly
 * separated into two phases. PHASE 1 pre-validates EVERY step of the quote (kind,
 * per-step chainId ∈ {origin, destination}, from == the selected wallet, tx
 * calldata shape) with ZERO broadcasts. Only if the whole quote passes does PHASE
 * 2 broadcast the pre-validated transactions strictly in order. A single invalid
 * step — even the LAST one — aborts the whole bridge before any funds move, so a
 * valid early step can never leave funds mid-bridge on a quote that is rejected
 * further down.
 *
 * Wallet clients resolve via the INCLUSIVE chain resolver (2b): Robinhood 4663
 * uses the local registry client (honours the user RPC override + Multicall3);
 * every other chain uses the Khalani dynamic client. Only `kind: "transaction"`
 * steps are signed — a `signature` (permit) step is REJECTED in v1 (bounded
 * signing surface, mirroring Khalani's PERMIT2 block).
 */

import {
  getAddress,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import { resolveInclusiveEvmChain } from "@tools/evm-chains/resolver.js";
import { getLocalEvmClients } from "@tools/evm-chains/evm-client.js";
import { waitForSuccessfulReceipt } from "@tools/evm-chains/receipt-guard.js";
import {
  createDynamicPublicClient,
  createDynamicWalletClient,
} from "@tools/khalani/evm-client.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { VexError, ErrorCodes } from "../../errors.js";
import logger from "../../utils/logger.js";
import { getRelayClient, RELAY_INTENT_STATUS_PATH } from "./client.js";
import { RELAY_TERMINAL_STATUSES, type RelayQuoteResponse } from "./types.js";
import { loadConfig } from "../../config/store.js";

interface EvmClients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

async function resolveStepClients(chainId: number, privateKey: Hex): Promise<EvmClients> {
  const resolved = await resolveInclusiveEvmChain(String(chainId));
  if (resolved.family !== "eip155") {
    throw new VexError(ErrorCodes.RELAY_UNSUPPORTED_CHAIN, `Relay step chain ${chainId} is not an EVM chain.`);
  }
  if (resolved.source === "local") {
    return getLocalEvmClients(resolved.config, privateKey);
  }
  return {
    publicClient: createDynamicPublicClient(resolved.khalaniChain, resolved.khalaniChains),
    walletClient: createDynamicWalletClient(resolved.khalaniChain, resolved.khalaniChains, privateKey),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bounded status-poll budget: relay soft-confirms fast, but we never block a turn
// indefinitely. On timeout we return the last non-terminal status (the capture
// records it as pending — the intent is still live on Relay). Relay's docs
// recommend polling the status endpoint ~once per second; a constant 1s interval
// within the 60s budget makes the final poll land right at window close (the old
// 2s→8s backoff left the last poll near t=54s, missing late terminal flips).
const POLL_MAX_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Result of the bounded status poll. `observed` is true iff at least one
 * `getIntentStatus` call actually returned a status — it distinguishes a REAL
 * last-seen non-terminal status from a poll window where EVERY request threw
 * (Relay status API unreachable). The caller must not mask the latter as a
 * benign pending intent.
 */
interface RelayPollResult {
  readonly status: string;
  readonly observed: boolean;
}

async function pollToTerminal(requestId: string): Promise<RelayPollResult> {
  const client = getRelayClient();
  const started = Date.now();
  let status = "pending";
  let observed = false;
  while (Date.now() - started < POLL_MAX_MS) {
    await delay(POLL_INTERVAL_MS);
    try {
      const res = await client.getIntentStatus(requestId);
      status = res.status;
      observed = true;
      if (RELAY_TERMINAL_STATUSES.has(status)) return { status, observed };
    } catch (err) {
      logger.warn("relay.bridge.status_poll_failed", {
        reason: err instanceof VexError ? err.code : "unknown",
      });
    }
  }
  return { status, observed };
}

export interface RelayExecuteArgs {
  quote: RelayQuoteResponse;
  signer: ChainWallet;
  originChainId: number;
  destinationChainId: number;
}

/** One broadcast transaction paired with the chain it was broadcast on. */
export interface RelayTransaction {
  readonly chainId: number;
  readonly hash: string;
}

export interface RelayExecuteResult {
  txHashes: string[];
  /**
   * Per-tx records carrying the chain each hash was broadcast on. Additive
   * alongside `txHashes` (kept for compatibility): a Relay bridge spans the
   * origin AND destination chains, so a chain-less `txHashes[]` cannot map every
   * hash to an explorer. `transactions[i].hash === txHashes[i]` by construction.
   */
  transactions: RelayTransaction[];
  requestId: string | null;
  finalStatus: string;
  /**
   * True iff the intent status was actually OBSERVED (a `getIntentStatus` call
   * succeeded) OR a terminal state was reached. False when there was no
   * requestId to track, or every status poll threw — i.e. delivery is UNKNOWN,
   * not benignly pending. The handler fails closed on `false` rather than
   * emitting a phantom pending capture.
   */
  statusObserved: boolean;
}

/**
 * A single transaction pre-validated in PHASE 1 and ready to broadcast in PHASE
 * 2. `to`/`value` are already canonicalized (`getAddress`/`BigInt`), so PHASE 2
 * never re-parses untrusted quote fields — a parse failure aborts BEFORE any
 * broadcast, not between broadcasts.
 */
interface PlannedRelayTx {
  readonly stepId: string;
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data: Hex;
  readonly value: bigint;
}

/**
 * The intent request id is the ONLY handle to a bridge's terminal status. Relay
 * exposes it two ways (per docs.relay.link step-execution): directly on
 * `step.requestId`, and inside a step item's `check.endpoint` — the status URL
 * (`/intents/status/v3?requestId=<id>`) the wallet is told to poll. The id can
 * be present on the check endpoint even when the step omits `requestId`, so we
 * parse it out as a fallback rather than falsely treating the bridge as
 * untrackable.
 *
 * `check.endpoint` is UNTRUSTED external input, so we accept its `requestId`
 * ONLY when the endpoint is genuinely the Relay status endpoint: the pathname
 * must equal the documented status path EXACTLY (`RELAY_INTENT_STATUS_PATH`,
 * shared with the client so a version bump updates both), and — for absolute
 * URLs — the host must equal the configured Relay API host (`allowedBaseUrl`,
 * the SAME value the client polls; never a hardcoded second copy). A relative
 * endpoint resolves against that host so the exact-path check still applies.
 * Anything else (wrong host, wrong path, empty/absent id, malformed URL) → null,
 * which the caller treats as "no id" and fails closed before broadcast.
 */
export function parseRequestIdFromCheckEndpoint(endpoint: string, allowedBaseUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(allowedBaseUrl);
  } catch {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint, base);
  } catch {
    return null;
  }
  // An endpoint on a different host, or not the exact status path, is NOT a
  // trustworthy status source — do not associate its requestId with this bridge.
  if (parsed.host !== base.host) return null;
  if (parsed.pathname !== RELAY_INTENT_STATUS_PATH) return null;
  const requestId = parsed.searchParams.get("requestId");
  return requestId && requestId.length > 0 ? requestId : null;
}

/**
 * step.requestId (any step) → parsed from a step item's check.endpoint. The
 * allowed host is read from the SAME config the client polls, so the endpoint
 * check can never diverge from where status is actually fetched.
 */
function deriveRequestId(quote: RelayQuoteResponse): string | null {
  for (const step of quote.steps) {
    if (step.requestId) return step.requestId;
  }
  const allowedBaseUrl = loadConfig().services.relayApiUrl;
  for (const step of quote.steps) {
    for (const item of step.items) {
      const endpoint = item.check?.endpoint;
      const derived = endpoint ? parseRequestIdFromCheckEndpoint(endpoint, allowedBaseUrl) : null;
      if (derived) return derived;
    }
  }
  return null;
}

/**
 * PHASE 1 — pre-validate EVERY step of the quote with ZERO broadcasts. Returns
 * the ordered list of transactions to broadcast plus the intent requestId. Any
 * invalid step (unsupported kind, chainId outside {origin, destination}, sender
 * mismatch, malformed calldata) THROWS here, so the caller never broadcasts a
 * partially-valid quote. A quote with NO trackable request id (neither on a step
 * nor derivable from a check endpoint) ALSO throws here — failing BEFORE any
 * broadcast is strictly safer than moving funds we could never verify.
 */
function planRelayBridge(
  quote: RelayQuoteResponse,
  expectedFrom: `0x${string}`,
  originChainId: number,
  destinationChainId: number,
): { planned: PlannedRelayTx[]; requestId: string } {
  const allowedChains = new Set([originChainId, destinationChainId]);
  const planned: PlannedRelayTx[] = [];

  for (const step of quote.steps) {
    if (step.kind !== "transaction") {
      throw new VexError(
        ErrorCodes.RELAY_UNSUPPORTED_STEP,
        `Relay step "${step.id}" (${step.kind}) is not supported. Only transaction steps are signed in v1.`,
      );
    }
    for (const item of step.items) {
      const data = item.data;
      if (!data) continue;
      if (!allowedChains.has(data.chainId)) {
        throw new VexError(
          ErrorCodes.RELAY_STEP_CHAIN_MISMATCH,
          `Relay step targets chain ${data.chainId}, which is neither the origin (${originChainId}) nor destination (${destinationChainId}).`,
        );
      }
      if (data.from && getAddress(data.from) !== expectedFrom) {
        throw new VexError(
          ErrorCodes.RELAY_BRIDGE_FAILED,
          "Relay step sender does not match the selected wallet.",
        );
      }
      // Canonicalize the calldata shape NOW (before any broadcast). A malformed
      // `to`/`value` throws here, aborting the whole bridge fail-closed rather
      // than after an earlier step has already moved funds.
      let to: `0x${string}`;
      let value: bigint;
      try {
        to = getAddress(data.to);
      } catch {
        throw new VexError(ErrorCodes.RELAY_BRIDGE_FAILED, `Relay step "${step.id}" has a malformed recipient address.`);
      }
      try {
        value = BigInt(data.value);
      } catch {
        throw new VexError(ErrorCodes.RELAY_BRIDGE_FAILED, `Relay step "${step.id}" has a malformed transaction value.`);
      }
      planned.push({ stepId: step.id, chainId: data.chainId, to, data: data.data as Hex, value });
    }
  }

  // Fail closed BEFORE any broadcast when the intent is untrackable: without a
  // request id there is no way to ever confirm delivery, so moving funds would
  // leave an unverifiable bridge. Real Relay quotes always carry the id (step or
  // check endpoint); this guards a degenerate/idless quote.
  const requestId = deriveRequestId(quote);
  if (!requestId) {
    throw new VexError(
      ErrorCodes.RELAY_BRIDGE_FAILED,
      "Relay quote carries no request id (neither on a step nor a check endpoint) — the bridge status could never be verified. Refusing to broadcast an untrackable bridge.",
      "Re-quote before retrying.",
    );
  }

  return { planned, requestId };
}

/**
 * Validate the WHOLE quote (PHASE 1), broadcast every pre-validated transaction
 * in order (PHASE 2), then poll to a terminal state (bounded). Returns the
 * broadcast tx hashes + the intent requestId + the final status observed. A
 * PHASE-1 validation failure produces a clean error with ZERO broadcasts.
 */
export async function executeRelayBridge(args: RelayExecuteArgs): Promise<RelayExecuteResult> {
  const { quote, signer, originChainId, destinationChainId } = args;
  if (signer.family !== "eip155") {
    throw new VexError(ErrorCodes.RELAY_BRIDGE_FAILED, "Relay bridge requires an EVM signing wallet.");
  }
  const privateKey = signer.privateKey as Hex;
  const expectedFrom = getAddress(signer.address);

  // ── PHASE 1: pre-validate every step. No broadcasts happen until this returns. ──
  const { planned, requestId } = planRelayBridge(quote, expectedFrom, originChainId, destinationChainId);

  // ── PHASE 2: broadcast the pre-validated transactions strictly in order. ──
  const transactions: RelayTransaction[] = [];
  for (const tx of planned) {
    const { publicClient, walletClient } = await resolveStepClients(tx.chainId, privateKey);
    const hash = await walletClient.sendTransaction({
      account: walletClient.account,
      chain: walletClient.chain,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    });
    await waitForSuccessfulReceipt(publicClient, hash, {
      code: ErrorCodes.RELAY_BRIDGE_FAILED,
      what: `Relay step "${tx.stepId}"`,
      hint: "No further steps were broadcast. Check the transaction hash before re-quoting or retrying.",
    });
    // Pair each hash with the chain it was broadcast on (fund safety already
    // constrained tx.chainId to {origin, destination} in PHASE 1).
    transactions.push({ chainId: tx.chainId, hash });
    logger.info("relay.bridge.step_broadcast", { stepId: tx.stepId, chainId: tx.chainId });
  }

  // requestId is guaranteed non-null here (planRelayBridge fails closed
  // otherwise). Poll to a terminal state; `observed` distinguishes a real
  // last-seen status from a window where EVERY status request threw (status API
  // unreachable) — the handler fails closed on the latter rather than emitting a
  // phantom pending capture.
  const poll = await pollToTerminal(requestId);
  return {
    txHashes: transactions.map((t) => t.hash),
    transactions,
    requestId,
    finalStatus: poll.status,
    statusObserved: poll.observed,
  };
}
