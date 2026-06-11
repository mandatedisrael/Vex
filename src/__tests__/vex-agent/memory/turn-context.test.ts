/**
 * memory.getTurnContext — the single pre-inference memory read (D-FACADE).
 *
 * Branch-nullability contract: `null` = fetch FAILED, which is NOT the same
 * as an empty database. Each branch fails soft INDEPENDENTLY (knowledge
 * throw leaves sessionStats live and vice versa) and a failure never throws
 * out of the façade. `hasSessionMemory` derivation consistency with the
 * memory section is covered in turn-loop/prompt-stack suites; here we pin
 * the façade itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListActive = vi.fn();
const mockListKinds = vi.fn();
const mockCountActive = vi.fn();
const mockGetStats = vi.fn();

vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  listActiveForHotContext: (...a: unknown[]) => mockListActive(...a),
  listKnownKinds: (...a: unknown[]) => mockListKinds(...a),
  countActiveHotContextEntries: (...a: unknown[]) => mockCountActive(...a),
}));

vi.mock("@vex-agent/db/repos/session-memories/index.js", () => ({
  getSessionMemoryStats: (...a: unknown[]) => mockGetStats(...a),
}));

const { getTurnContext } = await import("@vex-agent/memory/turn-context.js");

const STATS = {
  activeCount: 3,
  compactCount: 2,
  unresolvedOutstandingCount: 1,
  recentThemes: ["kyber_route_debug"],
};

const ENTRY = {
  id: 42,
  kind: "risk_rule",
  title: "no leverage",
  summary: "Never use leverage on memecoins",
  pinned: true,
  validUntil: null,
  updatedAt: "2026-06-01T00:00:00Z",
};

describe("memory.getTurnContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActive.mockResolvedValue([ENTRY]);
    mockListKinds.mockResolvedValue([{ kind: "risk_rule", count: 5 }]);
    mockCountActive.mockResolvedValue(7);
    mockGetStats.mockResolvedValue(STATS);
  });

  it("happy path: both branches populated from the repos", async () => {
    const ctx = await getTurnContext({ sessionId: "session-1" });

    expect(ctx.knowledge).not.toBeNull();
    expect(ctx.knowledge!.hotEntries).toEqual([ENTRY]);
    expect(ctx.knowledge!.knownKinds).toEqual([{ kind: "risk_rule", count: 5 }]);
    expect(ctx.knowledge!.activeCount).toBe(7);
    expect(ctx.sessionStats).toEqual(STATS);
  });

  it("uses the pinned fetch limits (12 hot entries, 30 known kinds)", async () => {
    await getTurnContext({ sessionId: "session-1" });
    expect(mockListActive).toHaveBeenCalledWith({ limit: 12 });
    expect(mockListKinds).toHaveBeenCalledWith({ limit: 30 });
  });

  it("knowledge branch throw ⇒ knowledge null, sessionStats stays live", async () => {
    mockListKinds.mockRejectedValueOnce(new Error("DB unavailable"));
    const ctx = await getTurnContext({ sessionId: "session-1" });

    expect(ctx.knowledge).toBeNull();
    expect(ctx.sessionStats).toEqual(STATS);
  });

  it("stats branch throw ⇒ sessionStats null, knowledge stays live", async () => {
    mockGetStats.mockRejectedValueOnce(new Error("DB unavailable"));
    const ctx = await getTurnContext({ sessionId: "session-1" });

    expect(ctx.knowledge).not.toBeNull();
    expect(ctx.knowledge!.activeCount).toBe(7);
    expect(ctx.sessionStats).toBeNull();
  });

  it("both branches throw ⇒ both null, never rejects", async () => {
    mockListActive.mockRejectedValueOnce(new Error("down"));
    mockGetStats.mockRejectedValueOnce(new Error("down"));
    const ctx = await getTurnContext({ sessionId: "session-1" });

    expect(ctx.knowledge).toBeNull();
    expect(ctx.sessionStats).toBeNull();
  });

  it("true-zero success is NOT null (fail ≠ empty)", async () => {
    mockListActive.mockResolvedValueOnce([]);
    mockListKinds.mockResolvedValueOnce([]);
    mockCountActive.mockResolvedValueOnce(0);
    mockGetStats.mockResolvedValueOnce({
      activeCount: 0,
      compactCount: 0,
      unresolvedOutstandingCount: 0,
      recentThemes: [],
    });
    const ctx = await getTurnContext({ sessionId: "session-1" });

    expect(ctx.knowledge).toEqual({ hotEntries: [], knownKinds: [], activeCount: 0 });
    expect(ctx.sessionStats).not.toBeNull();
    expect(ctx.sessionStats!.activeCount).toBe(0);
  });
});
