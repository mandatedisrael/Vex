/**
 * wallet/send.ts — puzzle 5 phase 4 unit tests.
 *
 * Pinned invariants:
 *   - prepare creates DB row with full fields + 10-min TTL
 *   - confirm session-scoped getById (cross-session yields not found)
 *   - confirm approval gate: !approved && restricted → pendingApproval, NO consume
 *   - confirm expired / cancelled / wrong status → fail BEFORE approval gate
 *   - all 4 ExecuteOutcome paths route to correct repo write:
 *     confirmed → markExecuted, chain_failed → markFailed(txHash set),
 *     confirmation_unknown → markFailed(txHash set),
 *     pre_broadcast_failed → markFailed(txHash=null)
 *   - PATH D-AUDIT: markExecuted throws → markAuditFailed best-effort,
 *     ToolResult still success (tx real)
 *   - structural-only output: secret in error → no raw, only ErrorKind+hash
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue(undefined);
const mockGetById = vi.fn();
const mockConsumeIfPending = vi.fn();
const mockMarkExecuted = vi.fn();
const mockMarkFailed = vi.fn();
const mockMarkAuditFailed = vi.fn();

vi.mock("@vex-agent/db/repos/wallet-intents.js", () => ({
  create: (...a: unknown[]) => mockCreate(...a),
  getById: (...a: unknown[]) => mockGetById(...a),
  consumeIfPending: (...a: unknown[]) => mockConsumeIfPending(...a),
  markExecuted: (...a: unknown[]) => mockMarkExecuted(...a),
  markFailed: (...a: unknown[]) => mockMarkFailed(...a),
  markAuditFailed: (...a: unknown[]) => mockMarkAuditFailed(...a),
}));

const mockExecuteSolana = vi.fn();
const mockExecuteEvm = vi.fn();

vi.mock("../../../../../vex-agent/tools/internal/wallet/send-execute-solana.js", () => ({
  executeSolanaTransfer: (...a: unknown[]) => mockExecuteSolana(...a),
}));

vi.mock("../../../../../vex-agent/tools/internal/wallet/send-execute-evm.js", () => ({
  executeEvmTransfer: (...a: unknown[]) => mockExecuteEvm(...a),
}));

// Phase 5B: send.ts resolves the wallet via the engine resolver (resolve.ts),
// not the zero-arg multi-auth primitives. Mock that boundary. Returned signer
// addresses match the fixture intents so the confirm address-assert passes
// (walletAddressesEqual is real).
vi.mock("../../../../../vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: vi.fn((_r: unknown, _p: unknown, family: string) =>
    family === "solana"
      ? "SoLanaAddr1111111111111111111111111111111"
      : "0xabcdef1234567890abcdef1234567890abcdef12"),
  resolveSigningWallet: vi.fn((_r: unknown, _p: unknown, family: string) =>
    family === "solana"
      ? { family: "solana", address: "SoLanaAddr1111111111111111111111111111111", secretKey: new Uint8Array(64) }
      : { family: "eip155", address: "0xabcdef1234567890abcdef1234567890abcdef12", privateKey: "0x" + "1".repeat(64) }),
  walletScopeErrorToResult: (err: unknown) => { throw err; },
}));

vi.mock("@utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { handleWalletSendPrepare, handleWalletSendConfirm } = await import(
  "../../../../../vex-agent/tools/internal/wallet/send.js"
);

const SESSION_ID = "00000000-0000-4000-8000-000000000001";

interface FixtureIntent {
  intentId: string;
  sessionId: string;
  walletAddress: string;
  network: "eip155" | "solana";
  chainAlias: string | null;
  toAddress: string;
  amount: string;
  token: string | null;
  status:
    | "pending"
    | "consuming"
    | "executed"
    | "failed"
    | "audit_failed"
    | "cancelled"
    | "expired";
  expiresAt: string;
  consumedAt: string | null;
  cancelledAt: string | null;
  txHash: string | null;
  failureReason: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  previewJson: Record<string, unknown>;
}

function pendingIntent(overrides: Partial<FixtureIntent> = {}): FixtureIntent {
  return {
    intentId: "intent-test-1",
    sessionId: SESSION_ID,
    walletAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
    network: "eip155",
    chainAlias: "base",
    toAddress: "0xfedcba0987654321fedcba0987654321fedcba09",
    amount: "1.5",
    token: null,
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumedAt: null,
    cancelledAt: null,
    txHash: null,
    failureReason: null,
    idempotencyKey: "intent-test-1",
    createdAt: "2026-05-24T20:00:00.000Z",
    previewJson: { label: "test", criticalArgs: {} },
    ...overrides,
  };
}

function makeContext(overrides: Partial<{ sessionPermission: "restricted" | "full"; approved: boolean; sessionId: string }> = {}) {
  return {
    sessionId: SESSION_ID,
    loadedDocuments: new Map(),
    sessionPermission: "restricted" as const,
    approved: false,
    role: "parent" as const,
    missionRunId: null,
    missionId: null,
    sessionKind: "agent" as const,
    contextUsageBand: "normal" as const,
    sourceSurface: "vex_agent" as const,
    sourceSession: SESSION_ID,
    walletResolution: { source: "default" as const },
    walletPolicy: { kind: "none" as const },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── handleWalletSendPrepare ─────────────────────────────────────────────

describe("handleWalletSendPrepare", () => {
  it("creates a DB intent row with 10-min TTL + structured preview", async () => {
    const result = await handleWalletSendPrepare(
      { network: "eip155", chain: "base", to: "0xfedcba0987654321fedcba0987654321fedcba09", amount: "1.5" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs).toMatchObject({
      sessionId: SESSION_ID,
      walletAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
      network: "eip155",
      chainAlias: "base",
      toAddress: "0xfedcba0987654321fedcba0987654321fedcba09",
      amount: "1.5",
      token: null,
    });
    expect(createArgs.intentId).toMatch(/^intent-[0-9a-f-]+$/);
    expect(createArgs.idempotencyKey).toBe(createArgs.intentId);

    const expiresAt = new Date(createArgs.expiresAt).getTime();
    const now = Date.now();
    expect(expiresAt - now).toBeGreaterThan(8 * 60_000);
    expect(expiresAt - now).toBeLessThan(11 * 60_000);

    expect(createArgs.previewJson).toMatchObject({
      label: expect.any(String),
      criticalArgs: {
        network: "eip155",
        chain: "base",
        to: "0xfedcba0987654321fedcba0987654321fedcba09",
        amount: "1.5",
        token: null,
      },
    });
  });

  it("rejects missing required fields", async () => {
    const result = await handleWalletSendPrepare(
      { network: "eip155", to: "0xfed", amount: "" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects eip155 without chain", async () => {
    const result = await handleWalletSendPrepare(
      { network: "eip155", to: "0xfed", amount: "1.0" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid numeric amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "SoLAdr", amount: "abc" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("uses solana wallet address for solana network", async () => {
    await handleWalletSendPrepare(
      { network: "solana", to: "SoLAdr11111111111111111111111111111111", amount: "0.5" },
      makeContext(),
    );
    expect(mockCreate.mock.calls[0][0].walletAddress).toBe(
      "SoLanaAddr1111111111111111111111111111111",
    );
    expect(mockCreate.mock.calls[0][0].chainAlias).toBeNull();
  });
});

// ── handleWalletSendConfirm — preconditions ─────────────────────────────

describe("handleWalletSendConfirm — preconditions", () => {
  it("session-scoped getById call (cross-session miss returns 'Intent not found')", async () => {
    mockGetById.mockResolvedValueOnce(null);
    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Intent not found");
    expect(mockGetById).toHaveBeenCalledWith("intent-test-1", SESSION_ID);
    expect(mockConsumeIfPending).not.toHaveBeenCalled();
  });

  it("network mismatch returns fail without consume", async () => {
    mockGetById.mockResolvedValueOnce(pendingIntent({ network: "solana" }));
    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Network mismatch");
    expect(mockConsumeIfPending).not.toHaveBeenCalled();
  });

  it("non-pending status returns fail with current status", async () => {
    mockGetById.mockResolvedValueOnce(pendingIntent({ status: "cancelled" }));
    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("is cancelled");
    expect(mockConsumeIfPending).not.toHaveBeenCalled();
  });

  it("expired intent returns fail with expiry time, no consume", async () => {
    mockGetById.mockResolvedValueOnce(
      pendingIntent({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("expired");
    expect(mockConsumeIfPending).not.toHaveBeenCalled();
  });

  it("approval gate: !approved && restricted → pendingApproval, intent stays pending (no consume)", async () => {
    mockGetById.mockResolvedValueOnce(pendingIntent());
    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: false, sessionPermission: "restricted" }),
    );
    expect(result.success).toBe(false);
    expect((result as { pendingApproval?: boolean }).pendingApproval).toBe(true);
    expect(mockConsumeIfPending).not.toHaveBeenCalled();
  });

  it("CAS-consume race miss → fail with current status, NO executor invoked", async () => {
    mockGetById.mockResolvedValueOnce(pendingIntent());
    mockConsumeIfPending.mockResolvedValueOnce(null);
    // Second getById call (after CAS miss) reveals current status
    mockGetById.mockResolvedValueOnce(pendingIntent({ status: "consuming" }));

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("status=consuming");
    expect(mockExecuteEvm).not.toHaveBeenCalled();
  });

  it("resolved signer != intent wallet → fail closed, NO consume, NO markFailed (intent stays pending)", async () => {
    // Mocked resolveSigningWallet returns EVM signer 0xabcdef…; this intent
    // records a DIFFERENT wallet → the pre-consume assert fails closed without
    // mutating the intent.
    mockGetById.mockResolvedValueOnce(
      pendingIntent({ walletAddress: "0x9999999999999999999999999999999999999999" }),
    );
    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("does not match this intent");
    expect(mockConsumeIfPending).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });
});

// ── handleWalletSendConfirm — ExecuteOutcome paths ──────────────────────

describe("handleWalletSendConfirm — ExecuteOutcome routing", () => {
  beforeEach(() => {
    mockGetById.mockResolvedValueOnce(pendingIntent());
    mockConsumeIfPending.mockResolvedValueOnce(
      pendingIntent({ status: "consuming" }),
    );
  });

  it("PATH 'confirmed': markExecuted called, success ToolResult with data", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "confirmed",
      txHash: "0xtx123",
      data: { txHash: "0xtx123", chain: "base" },
    });
    mockMarkExecuted.mockResolvedValueOnce(
      pendingIntent({ status: "executed", txHash: "0xtx123" }),
    );

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(true);
    expect(mockMarkExecuted).toHaveBeenCalledWith(
      "intent-test-1",
      SESSION_ID,
      "0xtx123",
    );
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockMarkAuditFailed).not.toHaveBeenCalled();
  });

  it("PATH 'chain_failed': markFailed with tx_hash set + structural output", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "chain_failed",
      txHash: "0xtxRev",
      errorKind: "ChainRevert",
      errorHash: "abcd1234abcd1234",
    });

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("reverted on-chain");
    expect(result.output).toContain("0xtxRev");
    expect(result.output).toContain("abcd1234abcd1234");
    expect(mockMarkFailed).toHaveBeenCalledWith(
      "intent-test-1",
      SESSION_ID,
      "ChainRevert:abcd1234abcd1234",
      "0xtxRev",
    );
    expect(mockMarkExecuted).not.toHaveBeenCalled();
  });

  it("PATH 'confirmation_unknown': markFailed with ConfirmationUnknown: prefix + tx_hash", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "confirmation_unknown",
      txHash: "0xtxUnk",
      errorKind: "TimeoutError",
      errorHash: "deadbeef12345678",
    });

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("confirmation unknown");
    expect(result.output).toContain("0xtxUnk");
    expect(mockMarkFailed).toHaveBeenCalledWith(
      "intent-test-1",
      SESSION_ID,
      "ConfirmationUnknown:deadbeef12345678",
      "0xtxUnk",
    );
  });

  it("PATH 'pre_broadcast_failed': markFailed with txHash=null, structural output", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "pre_broadcast_failed",
      errorKind: "Error",
      errorHash: "01234567abcdef00",
    });

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("before broadcast");
    expect(result.output).toContain("01234567abcdef00");
    expect(mockMarkFailed).toHaveBeenCalledWith(
      "intent-test-1",
      SESSION_ID,
      "Error:01234567abcdef00",
      null,
    );
  });

  it("PATH 'confirmed' + markExecuted throws → markAuditFailed best-effort, ToolResult still success", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "confirmed",
      txHash: "0xtxReal",
      data: { txHash: "0xtxReal" },
    });
    mockMarkExecuted.mockRejectedValueOnce(new Error("DB connection lost"));
    mockMarkAuditFailed.mockResolvedValueOnce(
      pendingIntent({ status: "audit_failed", txHash: "0xtxReal" }),
    );

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    // Tx is real on-chain — ToolResult success despite audit failure
    expect(result.success).toBe(true);
    expect(mockMarkAuditFailed).toHaveBeenCalledWith(
      "intent-test-1",
      SESSION_ID,
      "0xtxReal",
      expect.stringMatching(/^Error:[a-f0-9]{16}$/),
    );
  });

  it("PATH 'confirmed' + both audit writes throw → still ToolResult success (cascading swallow)", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "confirmed",
      txHash: "0xtxStranded",
      data: { txHash: "0xtxStranded" },
    });
    mockMarkExecuted.mockRejectedValueOnce(new Error("first DB throw"));
    mockMarkAuditFailed.mockRejectedValueOnce(new Error("cascading DB throw"));

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(true);
    // Both audit writes attempted
    expect(mockMarkExecuted).toHaveBeenCalledTimes(1);
    expect(mockMarkAuditFailed).toHaveBeenCalledTimes(1);
  });

  // ── mark* CAS-miss handling (Codex puzzle-5 phase-4 final review #1) ──

  it("PATH 'confirmed' + markExecuted resolves null (status mismatch) → markAuditFailed with StatusMismatch reason, ToolResult success", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "confirmed",
      txHash: "0xtxRaceLost",
      data: { txHash: "0xtxRaceLost" },
    });
    // CAS miss — repo returned null because status was not 'consuming'
    // (concurrent cancel / race lost). Tx is real on-chain.
    mockMarkExecuted.mockResolvedValueOnce(null);
    mockMarkAuditFailed.mockResolvedValueOnce(
      pendingIntent({ status: "audit_failed", txHash: "0xtxRaceLost" }),
    );

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(true);
    expect(mockMarkAuditFailed).toHaveBeenCalledWith(
      "intent-test-1",
      SESSION_ID,
      "0xtxRaceLost",
      "StatusMismatch:no_consuming_row",
    );
  });

  it("PATH 'confirmed' + markExecuted null + markAuditFailed null → still ToolResult success, two structural log warnings", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "confirmed",
      txHash: "0xtxDoubleNull",
      data: { txHash: "0xtxDoubleNull" },
    });
    // Both writes report CAS miss — the row is stuck in an unrecognised
    // status. Tx on-chain still real; ToolResult success preserved.
    mockMarkExecuted.mockResolvedValueOnce(null);
    mockMarkAuditFailed.mockResolvedValueOnce(null);

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.success).toBe(true);
    expect(mockMarkExecuted).toHaveBeenCalledTimes(1);
    expect(mockMarkAuditFailed).toHaveBeenCalledTimes(1);
  });

  it("PATH 'chain_failed' + markFailed resolves null → ToolResult still surfaces the failure, structural log", async () => {
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "chain_failed",
      txHash: "0xtxRev",
      errorKind: "ChainRevert",
      errorHash: "abcd1234abcd1234",
    });
    // markFailed CAS miss — status was already non-consuming (race).
    mockMarkFailed.mockResolvedValueOnce(null);

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    // Original outcome surfaces regardless of audit drift.
    expect(result.success).toBe(false);
    expect(result.output).toContain("reverted on-chain");
    expect(result.output).toContain("0xtxRev");
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
  });
});

// ── Secret leak prevention ──────────────────────────────────────────────

describe("handleWalletSendConfirm — secret redaction", () => {
  beforeEach(() => {
    mockGetById.mockResolvedValueOnce(pendingIntent());
    mockConsumeIfPending.mockResolvedValueOnce(
      pendingIntent({ status: "consuming" }),
    );
  });

  it("pre_broadcast_failed → output structural only, never raw error message", async () => {
    // The executor would summarize secrets internally; here we simulate
    // an outcome where errorKind/errorHash are structural (no raw msg).
    mockExecuteEvm.mockResolvedValueOnce({
      kind: "pre_broadcast_failed",
      errorKind: "Error",
      // hash of a hypothetical secret-laden message
      errorHash: "feedbeefcafe1234",
    });

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId: "intent-test-1" },
      makeContext({ approved: true }),
    );

    expect(result.output).toMatch(/^Wallet transfer failed before broadcast\. Error hash: [a-f0-9]{16}\.$/);
    expect(result.output).not.toContain("sk_live");
    expect(result.output).not.toContain("Bearer");
    expect(result.output).not.toContain("supersecret");

    // failure_reason persisted to DB is also structural-only
    const reasonArg = mockMarkFailed.mock.calls[0][2];
    expect(reasonArg).toMatch(/^Error:[a-f0-9]{16}$/);
    expect(reasonArg).not.toContain("sk_live");
  });
});
