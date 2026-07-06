/**
 * wallet_track_token — explicit pinning for local chains (Robinhood launch).
 *
 * Pins: local-chain-only scope (Khalani chains rejected), address-only token
 * input, checksummed storage, seed-set short-circuit (no duplicate pin rows
 * for always-scanned seeds), idempotent pin, unpin, and the list view
 * (seed + pinned sets side by side).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────

const mockPin = vi.fn();
const mockUnpin = vi.fn();
const mockList = vi.fn();
vi.mock("@vex-agent/db/repos/tracked-tokens.js", () => ({
  pinTrackedToken: (...a: unknown[]) => mockPin(...a),
  unpinTrackedToken: (...a: unknown[]) => mockUnpin(...a),
  listTrackedTokens: (...a: unknown[]) => mockList(...a),
}));

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddressForRead: () => "0xWALLET",
}));

const { handleWalletTrackToken } = await import(
  "../../../../../vex-agent/tools/internal/wallet/track.js"
);

// ── Fixtures ────────────────────────────────────────────────────

// Robinhood seed VEX (from the real local registry) and a new lowercase token.
const SEED_VEX = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b";
const NEW_TOKEN_LOWER = "0x1111111111111111111111111111111111111111";

const CONTEXT = {
  walletResolution: { source: "default" },
  walletPolicy: { kind: "none" },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockPin.mockResolvedValue({ inserted: true });
  mockUnpin.mockResolvedValue(1);
  mockList.mockResolvedValue([]);
});

// ── Tests ───────────────────────────────────────────────────────

describe("handleWalletTrackToken", () => {
  it("pins a new token on robinhood, checksummed, source 'agent'", async () => {
    const res = await handleWalletTrackToken(
      { action: "pin", chain: "robinhood", token: NEW_TOKEN_LOWER },
      CONTEXT,
    );
    expect(res.success).toBe(true);
    expect(mockPin).toHaveBeenCalledWith({
      walletAddress: "0xWALLET",
      chainId: 4663,
      tokenAddress: "0x1111111111111111111111111111111111111111",
      source: "agent",
    });
    expect((res.data as Record<string, unknown>).pinned).toBe(true);
  });

  it("accepts the numeric chain id ('4663')", async () => {
    const res = await handleWalletTrackToken(
      { action: "pin", chain: "4663", token: NEW_TOKEN_LOWER },
      CONTEXT,
    );
    expect(res.success).toBe(true);
    expect(mockPin).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a seed token (always scanned — no pin row written)", async () => {
    const res = await handleWalletTrackToken(
      { action: "pin", chain: "robinhood", token: SEED_VEX.toLowerCase() },
      CONTEXT,
    );
    expect(res.success).toBe(true);
    expect(mockPin).not.toHaveBeenCalled();
    expect((res.data as Record<string, unknown>).pinned).toBe(false);
    expect(String((res.data as Record<string, unknown>).note)).toContain("seed set");
  });

  it("rejects a Khalani (non-local) chain with actionable guidance", async () => {
    const res = await handleWalletTrackToken(
      { action: "pin", chain: "base", token: NEW_TOKEN_LOWER },
      CONTEXT,
    );
    expect(res.success).toBe(false);
    expect(res.output).toContain("not a local chain");
    expect(mockPin).not.toHaveBeenCalled();
  });

  it("rejects a symbol where an address is required", async () => {
    const res = await handleWalletTrackToken(
      { action: "pin", chain: "robinhood", token: "VEX" },
      CONTEXT,
    );
    expect(res.success).toBe(false);
    expect(res.output).toContain("contract ADDRESS");
  });

  it("unpins case-insensitively and reports removal", async () => {
    const res = await handleWalletTrackToken(
      { action: "unpin", chain: "robinhood", token: NEW_TOKEN_LOWER },
      CONTEXT,
    );
    expect(res.success).toBe(true);
    expect(mockUnpin).toHaveBeenCalledWith({
      walletAddress: "0xWALLET",
      chainId: 4663,
      tokenAddress: "0x1111111111111111111111111111111111111111",
    });
    expect((res.data as Record<string, unknown>).unpinned).toBe(true);
  });

  it("lists the seed set alongside pinned rows", async () => {
    mockList.mockResolvedValue([
      { walletAddress: "0xWALLET", chainId: 4663, tokenAddress: NEW_TOKEN_LOWER, source: "bridge", createdAt: "2026-07-06T00:00:00.000Z" },
    ]);
    const res = await handleWalletTrackToken({ action: "list", chain: "robinhood" }, CONTEXT);
    expect(res.success).toBe(true);
    const data = res.data as { seedTokens: Array<{ label: string }>; pinned: Array<{ source: string }> };
    expect(data.seedTokens.map((t) => t.label)).toContain("VEX");
    expect(data.pinned[0]!.source).toBe("bridge");
  });
});
