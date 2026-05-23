/**
 * `execute_tool` taxonomy propagation — protocol target derivation +
 * `ToolResult.actionKind` stamp on every known-manifest return path.
 *
 * Puzzle 5 phase 1A (2026-05-23). Two surfaces under test:
 *
 *  1. `deriveProtocolActionKind(manifest, params)` — pure heuristic that
 *     maps `(mutating, discovery.sideEffectLevel, isPreviewExecution)` to
 *     an `ActionKind`. Phase 1B will REPLACE this with a direct
 *     `manifest.actionKind` read; this suite pins the bridge behavior so
 *     the swap is observable in the diff (the test ids that match
 *     heuristic-only cases will need updating in 1B).
 *
 *  2. `executeProtocolTool` propagation — every code path that returns
 *     a `ToolResult` with a known manifest stamps `actionKind`. The unknown-
 *     manifest path intentionally omits the field so the dispatcher /
 *     policy layer can treat absent `actionKind` as the conservative
 *     "unknown" signal.
 *
 * Heuristic rules (Codex GREEN LIGHT puzzle 5/1A):
 *   - preview (`dryRun:true` on a previewSupport=true tool) → `read`
 *   - `!mutating` → `read`
 *   - `mutating + sideEffectLevel="high"` → `user_wallet_broadcast`
 *   - `mutating + sideEffectLevel="low"` → `external_post`
 *   - `mutating + (sideEffectLevel="none" | undefined)` → `external_post`
 *     (conservative default — 1B replaces with explicit per-manifest classification)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

// ── Mock surface ──────────────────────────────────────────────────────
//
// `isPreviewExecution` is read by `deriveProtocolActionKind` AND by the
// approval-gate inside `executeProtocolTool` — controlling it per-test keeps
// each case independent of `MUTATION_MATRIX` state.
//
// `validateCaptureContract` defaults to true (we don't exercise capture
// pipeline in these tests).
vi.mock("@vex-agent/tools/protocols/capture-validator.js", () => ({
  isPreviewExecution: vi.fn(() => false),
  validateCaptureContract: vi.fn(() => true),
}));

// Catalog lookups — per-test override of which manifest / handler is returned.
// Partial mock via `importOriginal` so dependents that import other exports
// (e.g. `PROTOCOL_TOOLS` from lexical-score) still resolve them.
vi.mock("@vex-agent/tools/protocols/catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/catalog.js")>();
  return {
    ...actual,
    getProtocolManifest: vi.fn(),
    getProtocolHandler: vi.fn(),
  };
});

// Namespace lifecycle — pretend the test namespace is always executable.
vi.mock("@vex-agent/tools/protocols/lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/lifecycle.js")>();
  return {
    ...actual,
    isExecutableNamespace: vi.fn(() => true),
  };
});

// Capture pipeline + DB writes — no-ops in unit tests. We use partial mocks
// only where leaving real exports in place would force a DB connection;
// elsewhere these full replacements are safe (no other module imports them
// for type-only or pure-helper purposes that we exercise here).
vi.mock("@vex-agent/tools/protocols/capture-pipeline.js", () => ({
  extractExternalRefs: vi.fn(() => ({})),
  populateCaptureItems: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(0),
}));

vi.mock("@vex-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn(),
}));

vi.mock("@vex-agent/db/params.js", () => ({
  sanitizeJsonbValue: (v: unknown) => v,
}));

// ── Dynamic imports after mocks are registered ───────────────────────

const { deriveProtocolActionKind, executeProtocolTool } = await import(
  "@vex-agent/tools/protocols/runtime.js"
);
const catalog = await import("@vex-agent/tools/protocols/catalog.js");
const captureValidator = await import("@vex-agent/tools/protocols/capture-validator.js");

// ── Fixtures ─────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<ProtocolToolManifest> = {}): ProtocolToolManifest {
  return {
    toolId: "test.fake.tool",
    namespace: "khalani",
    lifecycle: "active",
    description: "fake",
    mutating: false,
    params: [],
    exampleParams: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(false);
  vi.mocked(catalog.getProtocolManifest).mockReset();
  vi.mocked(catalog.getProtocolHandler).mockReset();
});

// ── deriveProtocolActionKind — pure heuristic cells ──────────────────

describe("deriveProtocolActionKind", () => {
  it("returns 'read' when isPreviewExecution(...) is true (regardless of mutating + sideEffectLevel)", () => {
    vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(true);
    const manifest = makeManifest({
      mutating: true,
      discovery: { sideEffectLevel: "high" },
    });
    expect(deriveProtocolActionKind(manifest, { dryRun: true })).toBe("read");
  });

  it("returns 'read' when manifest is not mutating", () => {
    const manifest = makeManifest({ mutating: false });
    expect(deriveProtocolActionKind(manifest, {})).toBe("read");
  });

  it("returns 'user_wallet_broadcast' for mutating + sideEffectLevel='high'", () => {
    const manifest = makeManifest({
      mutating: true,
      discovery: { sideEffectLevel: "high" },
    });
    expect(deriveProtocolActionKind(manifest, {})).toBe("user_wallet_broadcast");
  });

  it("returns 'external_post' for mutating + sideEffectLevel='low'", () => {
    const manifest = makeManifest({
      mutating: true,
      discovery: { sideEffectLevel: "low" },
    });
    expect(deriveProtocolActionKind(manifest, {})).toBe("external_post");
  });

  it("returns 'external_post' (conservative default) for mutating + sideEffectLevel='none'", () => {
    const manifest = makeManifest({
      mutating: true,
      discovery: { sideEffectLevel: "none" },
    });
    expect(deriveProtocolActionKind(manifest, {})).toBe("external_post");
  });

  it("returns 'external_post' (conservative default) for mutating + undefined sideEffectLevel", () => {
    const manifest = makeManifest({ mutating: true });
    expect(deriveProtocolActionKind(manifest, {})).toBe("external_post");
  });

  it("returns 'external_post' for mutating + undefined discovery object entirely", () => {
    const manifest = makeManifest({ mutating: true, discovery: undefined });
    expect(deriveProtocolActionKind(manifest, {})).toBe("external_post");
  });

  it("never returns 'provider_action_request' in phase 1A (reserved for phase 6 backend signer)", () => {
    // Cell-by-cell sanity check that the heuristic does not surface the
    // provider category. Phase 6 will introduce this via explicit per-protocol
    // mapping in 1B, NOT via the heuristic.
    const cells: ReadonlyArray<readonly [boolean, "none" | "low" | "high" | undefined]> = [
      [false, undefined], [false, "none"], [false, "low"], [false, "high"],
      [true, undefined], [true, "none"], [true, "low"], [true, "high"],
    ];
    for (const [mutating, sideEffectLevel] of cells) {
      const manifest = makeManifest({
        mutating,
        discovery: sideEffectLevel === undefined ? undefined : { sideEffectLevel },
      });
      expect(deriveProtocolActionKind(manifest, {})).not.toBe("provider_action_request");
    }
  });
});

// ── executeProtocolTool — stamp propagation per return path ──────────

const ctx = {
  sessionPermission: "restricted" as const,
  approved: false,
  sessionId: "test-session",
};

describe("executeProtocolTool — actionKind propagation", () => {
  it("omits actionKind when manifest is unknown (conservative undefined)", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(undefined);

    const result = await executeProtocolTool(
      { toolId: "unknown.tool", params: {} },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.actionKind).toBeUndefined();
  });

  it("stamps derived actionKind on missing-required-param return path", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({
        toolId: "test.high",
        mutating: true,
        discovery: { sideEffectLevel: "high" },
        params: [{ key: "to", type: "string", required: true, description: "" }],
      }),
    );

    const result = await executeProtocolTool(
      { toolId: "test.high", params: {} }, // missing `to`
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/Missing required parameter/);
    expect(result.actionKind).toBe("user_wallet_broadcast");
  });

  it("stamps derived actionKind on approval-required path (mutating + restricted + !approved)", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({
        toolId: "test.low.mut",
        mutating: true,
        discovery: { sideEffectLevel: "low" },
      }),
    );
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(async () => ({
      success: true, output: "should not be called",
    }));

    const result = await executeProtocolTool(
      { toolId: "test.low.mut", params: {} },
      ctx, // restricted + !approved
    );

    expect(result.pendingApproval).toBe(true);
    expect(result.actionKind).toBe("external_post");
  });

  it("stamps derived actionKind on pressure-denied path (mutating + barrier)", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({
        toolId: "test.high.barrier",
        mutating: true,
        discovery: { sideEffectLevel: "high" },
      }),
    );

    const result = await executeProtocolTool(
      { toolId: "test.high.barrier", params: {} },
      { ...ctx, contextUsageBand: "barrier" },
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/blocked at context pressure/);
    expect(result.actionKind).toBe("user_wallet_broadcast");
  });

  it("stamps derived actionKind on successful handler return", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({ toolId: "test.read", mutating: false }),
    );
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(async () => ({
      success: true, output: "ok",
    }));

    const result = await executeProtocolTool(
      { toolId: "test.read", params: {} },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.actionKind).toBe("read");
  });

  it("stamps derived actionKind on handler-thrown failure", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({
        toolId: "test.throw",
        mutating: true,
        discovery: { sideEffectLevel: "high" },
      }),
    );
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(async () => {
      throw new Error("network down");
    });

    const result = await executeProtocolTool(
      { toolId: "test.throw", params: {} },
      { ...ctx, approved: true }, // bypass approval gate so we reach the handler
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/network down/);
    expect(result.actionKind).toBe("user_wallet_broadcast");
  });

  it("handler-set actionKind cannot override the derived classifier (manifest is authoritative)", async () => {
    // Codex final review puzzle 5/1A (2026-05-23): for protocol tools the
    // manifest-driven classifier is the source of truth. A buggy or
    // malicious handler returning `actionKind: "read"` on a mutating high-
    // side-effect tool MUST NOT downgrade the policy classification.
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({
        toolId: "test.override",
        mutating: true,
        discovery: { sideEffectLevel: "high" },
      }),
    );
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(async () => ({
      success: true,
      output: "lying about kind",
      actionKind: "read", // handler tries to downgrade
    }));

    const result = await executeProtocolTool(
      { toolId: "test.override", params: {} },
      { ...ctx, approved: true }, // bypass approval gate so we reach the handler
    );

    expect(result.success).toBe(true);
    expect(result.actionKind).toBe("user_wallet_broadcast"); // derived wins
  });

  it("stamps 'read' on preview-execution return path even when manifest is mutating", async () => {
    // The approval gate also skips preview, so an approved-or-not call with
    // dryRun=true on a mutating manifest returns success and should still
    // be classified `read`.
    vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(true);
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({
        toolId: "test.preview",
        mutating: true,
        discovery: { sideEffectLevel: "high" },
      }),
    );
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(async () => ({
      success: true, output: "simulated", data: { dryRun: true },
    }));

    const result = await executeProtocolTool(
      { toolId: "test.preview", params: { dryRun: true } },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.actionKind).toBe("read");
  });
});
