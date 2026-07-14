/**
 * Relay bridge executor — FAIL-CLOSED two-phase ordering (Item 1, fund safety).
 *
 * `executeRelayBridge` MUST pre-validate the WHOLE quote before broadcasting any
 * step: a single invalid step — even the LAST one — aborts the bridge with ZERO
 * `sendTransaction` calls, so a valid early step can never leave funds mid-bridge
 * on a quote that is rejected further down. A fully-valid quote broadcasts every
 * transaction strictly in order.
 *
 * No live network: the inclusive chain resolver + local client factory are mocked
 * so `sendTransaction` is a spy. Quotes carry NO `requestId`, so the bounded
 * status poll never runs (finalStatus = "pending").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAddress } from "viem";

const sendTransaction = vi.fn();
const waitForTransactionReceipt = vi.fn();

const resolveInclusiveEvmChain = vi.fn();
vi.mock("@tools/evm-chains/resolver.js", () => ({
  resolveInclusiveEvmChain: (...a: unknown[]) => resolveInclusiveEvmChain(...a),
}));

const getLocalEvmClients = vi.fn();
vi.mock("@tools/evm-chains/evm-client.js", () => ({
  getLocalEvmClients: (...a: unknown[]) => getLocalEvmClients(...a),
}));

// Khalani client factories are only hit on the non-local branch — stub so the
// import resolves without pulling the real viem clients.
vi.mock("@tools/khalani/evm-client.js", () => ({
  createDynamicPublicClient: vi.fn(),
  createDynamicWalletClient: vi.fn(),
}));

// getRelayClient is used only by the terminal-status poll. Quotes without a
// requestId never poll; the cadence tests below feed a requestId + drive this
// controllable spy.
const getIntentStatus = vi.fn();
vi.mock("@tools/relay/client.js", () => ({
  getRelayClient: () => ({ getIntentStatus: (...a: unknown[]) => getIntentStatus(...a) }),
  // Shared status-path constant the parser matches against.
  RELAY_INTENT_STATUS_PATH: "/intents/status/v3",
}));

// Hermetic Relay host for the requestId-derivation test (independent of any
// local config file) — this is the SAME value the client would poll.
vi.mock("@config/store.js", () => ({
  loadConfig: () => ({ services: { relayApiUrl: "https://api.relay.link" } }),
}));

import { executeRelayBridge, parseRequestIdFromCheckEndpoint } from "@tools/relay/execute.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import type { RelayQuoteResponse } from "@tools/relay/types.js";

const ORIGIN = 8453; // Base
const DESTINATION = 4663; // Robinhood Chain
const APPROVE_TO = "0x2222222222222222222222222222222222222222";
const DEPOSIT_TO = "0x3333333333333333333333333333333333333333";

const signer = {
  family: "eip155",
  address: "0x1111111111111111111111111111111111111111",
  privateKey: `0x${"22".repeat(32)}`,
} as unknown as ChainWallet;

function step(id: string, chainId: number, to: string, value = "0", data = "0x", requestId?: string) {
  return { id, kind: "transaction", requestId, items: [{ data: { to, value, data, chainId } }] };
}

beforeEach(() => {
  sendTransaction.mockReset();
  waitForTransactionReceipt.mockReset();
  resolveInclusiveEvmChain.mockReset();
  getLocalEvmClients.mockReset();
  getIntentStatus.mockReset();

  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  resolveInclusiveEvmChain.mockImplementation(async (input: string) => ({
    source: "local",
    family: "eip155",
    chainId: Number(input),
    config: { chainId: Number(input) },
  }));
  getLocalEvmClients.mockReturnValue({
    publicClient: { waitForTransactionReceipt },
    walletClient: { account: { address: signer.address }, chain: { id: ORIGIN }, sendTransaction },
  });
});

describe("executeRelayBridge — fail-closed pre-validation (PHASE 1)", () => {
  it("(a) LAST step invalid (chainId outside origin/destination) → ZERO broadcasts", async () => {
    const quote = {
      steps: [
        step("approve", ORIGIN, APPROVE_TO), // valid first step
        step("deposit", 999, DEPOSIT_TO, "1000", "0xabcd"), // INVALID last step
      ],
    } as unknown as RelayQuoteResponse;

    await expect(
      executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION }),
    ).rejects.toMatchObject({ code: "RELAY_STEP_CHAIN_MISMATCH" });

    // The whole point: the valid first step must NOT have broadcast.
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("(a2) LAST step is a non-transaction (signature) kind → ZERO broadcasts", async () => {
    const quote = {
      steps: [
        step("approve", ORIGIN, APPROVE_TO),
        { id: "permit", kind: "signature", items: [{}] }, // unsupported LAST step
      ],
    } as unknown as RelayQuoteResponse;

    await expect(
      executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION }),
    ).rejects.toMatchObject({ code: "RELAY_UNSUPPORTED_STEP" });
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("(a3) LAST step sender != selected wallet → ZERO broadcasts", async () => {
    const quote = {
      steps: [
        step("approve", ORIGIN, APPROVE_TO),
        {
          id: "deposit",
          kind: "transaction",
          items: [{ data: { from: "0x9999999999999999999999999999999999999999", to: DEPOSIT_TO, value: "1000", data: "0xabcd", chainId: DESTINATION } }],
        },
      ],
    } as unknown as RelayQuoteResponse;

    await expect(
      executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION }),
    ).rejects.toMatchObject({ code: "RELAY_BRIDGE_FAILED" });
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});

describe("executeRelayBridge — ordered broadcast (PHASE 2)", () => {
  it("(b) valid multi-step quote → every tx broadcast strictly in order", async () => {
    vi.useFakeTimers();
    try {
      sendTransaction.mockResolvedValueOnce("0xaaa").mockResolvedValueOnce("0xbbb");
      getIntentStatus.mockResolvedValue({ status: "success" });
      const quote = {
        steps: [
          step("approve", ORIGIN, APPROVE_TO, "0", "0x"),
          // requestId present → planRelayBridge accepts the quote (a quote with
          // NO id anywhere fails pre-broadcast, covered separately below).
          step("deposit", DESTINATION, DEPOSIT_TO, "1000", "0xabcd", "0xreq"),
        ],
      } as unknown as RelayQuoteResponse;

      const promise = executeRelayBridge({
        quote,
        signer,
        originChainId: ORIGIN,
        destinationChainId: DESTINATION,
      });
      await vi.advanceTimersByTimeAsync(0); // flush broadcasts + receipts
      await vi.advanceTimersByTimeAsync(1_000); // first poll → success
      const result = await promise;

      expect(sendTransaction).toHaveBeenCalledTimes(2);
      // Order preserved: approve leg first, deposit leg second.
      expect(sendTransaction.mock.calls[0]![0].to).toBe(getAddress(APPROVE_TO));
      expect(sendTransaction.mock.calls[1]![0].to).toBe(getAddress(DEPOSIT_TO));
      expect(sendTransaction.mock.calls[1]![0].value).toBe(1000n);
      // Each broadcast waits for its receipt before the next.
      expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
      expect(result.txHashes).toEqual(["0xaaa", "0xbbb"]);
      // Per-hop records pair each hash with the chain it broadcast on (origin
      // approve → ORIGIN, deposit → DESTINATION); txHashes[i] === transactions[i].hash.
      expect(result.transactions).toEqual([
        { chainId: ORIGIN, hash: "0xaaa" },
        { chainId: DESTINATION, hash: "0xbbb" },
      ]);
      expect(result.finalStatus).toBe("success");
      expect(result.statusObserved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts before the next broadcast when a mined step reverted", async () => {
    sendTransaction.mockResolvedValueOnce("0xaaa").mockResolvedValueOnce("0xbbb");
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    const quote = {
      steps: [
        step("approve", ORIGIN, APPROVE_TO, "0", "0x"),
        step("deposit", DESTINATION, DEPOSIT_TO, "1000", "0xabcd", "0xreq"),
      ],
    } as unknown as RelayQuoteResponse;

    // Step 1's receipt reverts before step 2 broadcasts and before any poll.
    await expect(
      executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION }),
    ).rejects.toMatchObject({ code: "RELAY_BRIDGE_FAILED" });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("executeRelayBridge — request id resolution (step → check.endpoint → fail closed)", () => {
  it("derives the request id from item.check.endpoint when the step omits requestId → bridges normally", async () => {
    vi.useFakeTimers();
    try {
      sendTransaction.mockResolvedValue("0xaaa");
      getIntentStatus.mockResolvedValue({ status: "success" });
      // No step.requestId — the id lives only on the status check endpoint.
      const quote = {
        steps: [
          {
            id: "deposit",
            kind: "transaction",
            items: [{
              data: { to: DEPOSIT_TO, value: "1000", data: "0xabcd", chainId: DESTINATION },
              check: { endpoint: "https://api.relay.link/intents/status/v3?requestId=0xDERIVED", method: "GET" },
            }],
          },
        ],
      } as unknown as RelayQuoteResponse;

      const promise = executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      // The derived id is what gets polled — a legitimate bridge is NOT falsely
      // failed just because the step omitted requestId.
      expect(getIntentStatus).toHaveBeenCalledWith("0xDERIVED");
      expect(result.requestId).toBe("0xDERIVED");
      expect(result.finalStatus).toBe("success");
      expect(result.statusObserved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no request id anywhere (no step.requestId, no check endpoint) → throws BEFORE any broadcast", async () => {
    const quote = {
      steps: [
        step("approve", ORIGIN, APPROVE_TO, "0", "0x"),
        step("deposit", DESTINATION, DEPOSIT_TO, "1000", "0xabcd"),
      ],
    } as unknown as RelayQuoteResponse;

    await expect(
      executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION }),
    ).rejects.toMatchObject({ code: "RELAY_BRIDGE_FAILED" });
    // Fund safety: an untrackable bridge never moves funds.
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("a check.endpoint with no parseable requestId is treated as no id → throws pre-broadcast", async () => {
    const quote = {
      steps: [
        {
          id: "deposit",
          kind: "transaction",
          items: [{
            data: { to: DEPOSIT_TO, value: "1000", data: "0xabcd", chainId: DESTINATION },
            check: { endpoint: "https://api.relay.link/intents/status/v3", method: "GET" }, // no requestId param
          }],
        },
      ],
    } as unknown as RelayQuoteResponse;

    await expect(
      executeRelayBridge({ quote, signer, originChainId: ORIGIN, destinationChainId: DESTINATION }),
    ).rejects.toMatchObject({ code: "RELAY_BRIDGE_FAILED" });
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});

describe("parseRequestIdFromCheckEndpoint", () => {
  const BASE = "https://api.relay.link";

  it("extracts requestId from an absolute status URL on the Relay host + exact path", () => {
    expect(parseRequestIdFromCheckEndpoint("https://api.relay.link/intents/status/v3?requestId=0xABC", BASE)).toBe("0xABC");
  });
  it("extracts requestId from a relative status URL (resolved against the Relay host)", () => {
    expect(parseRequestIdFromCheckEndpoint("/intents/status/v3?requestId=0xDEF&foo=bar", BASE)).toBe("0xDEF");
  });

  // ── Narrowing: untrusted endpoints must NOT be trusted as a status source ──
  it("returns null for an absolute URL on the WRONG host (even with the right path + requestId)", () => {
    expect(parseRequestIdFromCheckEndpoint("https://evil.example.com/intents/status/v3?requestId=0xABC", BASE)).toBeNull();
  });
  it("returns null for the right host but the WRONG path", () => {
    expect(parseRequestIdFromCheckEndpoint("https://api.relay.link/some/other/path?requestId=0xABC", BASE)).toBeNull();
  });
  it("returns null for a relative URL with the WRONG path", () => {
    expect(parseRequestIdFromCheckEndpoint("/intents/status/v2?requestId=0xABC", BASE)).toBeNull();
  });
  it("returns null for the right host + path but an EMPTY requestId", () => {
    expect(parseRequestIdFromCheckEndpoint("https://api.relay.link/intents/status/v3?requestId=", BASE)).toBeNull();
  });
  it("returns null when the requestId param is absent", () => {
    expect(parseRequestIdFromCheckEndpoint("https://api.relay.link/intents/status/v3", BASE)).toBeNull();
  });
  it("returns null for a malformed endpoint", () => {
    expect(parseRequestIdFromCheckEndpoint("::::not a url::::", BASE)).toBeNull();
  });
});

// A step with a requestId arms the bounded status poll. `waitForSuccessfulReceipt`
// calls the (mocked) `waitForTransactionReceipt` once with NO internal timers, so
// the only fake-timer consumer is pollToTerminal's 1s `delay`.
function depositStepWithRequestId() {
  return {
    steps: [
      { id: "deposit", kind: "transaction", requestId: "0xreq", items: [{ data: { to: DEPOSIT_TO, value: "1000", data: "0xabcd", chainId: DESTINATION } }] },
    ],
  } as unknown as RelayQuoteResponse;
}

describe("executeRelayBridge — bounded status poll (1s cadence per Relay docs)", () => {
  it("polls getIntentStatus at a 1s cadence and returns the terminal status", async () => {
    vi.useFakeTimers();
    try {
      sendTransaction.mockResolvedValue("0xaaa");
      getIntentStatus
        .mockResolvedValueOnce({ status: "waiting" })
        .mockResolvedValueOnce({ status: "success" });

      const promise = executeRelayBridge({
        quote: depositStepWithRequestId(), signer, originChainId: ORIGIN, destinationChainId: DESTINATION,
      });
      // Flush the broadcast + receipt microtasks before the first 1s delay.
      await vi.advanceTimersByTimeAsync(0);
      expect(getIntentStatus).not.toHaveBeenCalled();
      // First poll lands at t=1s (non-terminal "waiting").
      await vi.advanceTimersByTimeAsync(1_000);
      expect(getIntentStatus).toHaveBeenCalledTimes(1);
      // Second poll lands at t=2s (terminal "success") and resolves the bridge.
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(getIntentStatus).toHaveBeenCalledTimes(2);
      expect(result.finalStatus).toBe("success");
      expect(result.statusObserved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the last OBSERVED non-terminal status when the 60s budget is exhausted (never blocks forever)", async () => {
    vi.useFakeTimers();
    try {
      sendTransaction.mockResolvedValue("0xaaa");
      getIntentStatus.mockResolvedValue({ status: "submitted" }); // never terminal

      const promise = executeRelayBridge({
        quote: depositStepWithRequestId(), signer, originChainId: ORIGIN, destinationChainId: DESTINATION,
      });
      await vi.advanceTimersByTimeAsync(0);
      // Drive the whole 60s budget.
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;
      expect(result.finalStatus).toBe("submitted");
      expect(result.statusObserved).toBe(true); // a real status WAS observed
      // 1s cadence over 60s ≈ ~60 polls — far more than the old 2s→8s backoff
      // (which stopped near t=54s after ~13 polls, missing late terminal flips).
      expect(getIntentStatus.mock.calls.length).toBeGreaterThan(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports statusObserved:false when EVERY status poll throws (status API unreachable, not benign pending)", async () => {
    vi.useFakeTimers();
    try {
      sendTransaction.mockResolvedValue("0xaaa");
      getIntentStatus.mockRejectedValue(new Error("status API down"));

      const promise = executeRelayBridge({
        quote: depositStepWithRequestId(), signer, originChainId: ORIGIN, destinationChainId: DESTINATION,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;
      // Every poll threw → nothing observed. finalStatus stays the "pending"
      // seed, but statusObserved is FALSE so the handler can fail closed.
      expect(result.statusObserved).toBe(false);
      expect(getIntentStatus.mock.calls.length).toBeGreaterThan(50);
    } finally {
      vi.useRealTimers();
    }
  });
});
