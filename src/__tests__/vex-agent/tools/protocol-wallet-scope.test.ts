/**
 * Protocol wallet-scope deny-guard (puzzle 5 phase 5B).
 *
 * Under `source:"session"`, protocol tools that sign with the user wallet
 * (actionKind user_wallet_broadcast OR external_post) are hard-denied BEFORE
 * the handler — until 5D-protocols migrates them to session resolution. The
 * guard keys on `manifest.actionKind` so a preview/dryRun is denied too.
 * `source:"default"` (CLI/MCP) and `read` tools are never denied.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

vi.mock("@vex-agent/tools/protocols/capture-validator.js", () => ({
  isPreviewExecution: vi.fn(() => false),
  validateCaptureContract: vi.fn(() => true),
}));
vi.mock("@vex-agent/tools/protocols/catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/catalog.js")>();
  return { ...actual, getProtocolManifest: vi.fn(), getProtocolHandler: vi.fn() };
});
vi.mock("@vex-agent/tools/protocols/lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/lifecycle.js")>();
  return { ...actual, isExecutableNamespace: vi.fn(() => true) };
});
vi.mock("@vex-agent/tools/protocols/capture-pipeline.js", () => ({
  extractExternalRefs: vi.fn(() => ({})),
  populateCaptureItems: vi.fn(),
}));
vi.mock("@vex-agent/db/repos/executions.js", () => ({ recordExecution: vi.fn().mockResolvedValue(0) }));
vi.mock("@vex-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn(),
}));
vi.mock("@vex-agent/db/params.js", () => ({ sanitizeJsonbValue: (v: unknown) => v }));

const { executeProtocolTool } = await import("@vex-agent/tools/protocols/runtime.js");
const catalog = await import("@vex-agent/tools/protocols/catalog.js");
const captureValidator = await import("@vex-agent/tools/protocols/capture-validator.js");

function makeManifest(overrides: Partial<ProtocolToolManifest> = {}): ProtocolToolManifest {
  return {
    toolId: "test.fake",
    namespace: "khalani",
    lifecycle: "active",
    description: "fake",
    mutating: false,
    actionKind: "read",
    params: [],
    exampleParams: {},
    ...overrides,
  };
}

const SESSION_CTX = {
  sessionPermission: "full" as const,
  approved: true,
  sessionId: "s1",
  walletResolution: { source: "session" as const, evm: null, solana: null },
  walletPolicy: { kind: "none" as const },
};
const DEFAULT_CTX = {
  sessionPermission: "full" as const,
  approved: true,
  sessionId: "s1",
  walletResolution: { source: "default" as const },
  walletPolicy: { kind: "none" as const },
};

beforeEach(() => {
  vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(false);
  vi.mocked(catalog.getProtocolManifest).mockReset();
  vi.mocked(catalog.getProtocolHandler).mockReset();
});

describe("protocol wallet-scope deny-guard", () => {
  for (const actionKind of ["user_wallet_broadcast", "external_post"] as const) {
    it(`denies ${actionKind} under source:session, before the handler`, async () => {
      vi.mocked(catalog.getProtocolManifest).mockReturnValue(
        makeManifest({ toolId: "x.sign", mutating: true, actionKind }),
      );
      const handler = vi.fn();
      vi.mocked(catalog.getProtocolHandler).mockReturnValue(handler);

      const result = await executeProtocolTool({ toolId: "x.sign", params: {} }, SESSION_CTX);

      expect(result.success).toBe(false);
      expect(result.output).toContain("wallet-scoped session");
      expect(handler).not.toHaveBeenCalled();
    });
  }

  it("denies a PREVIEW of a signing tool under session (keyed on manifest.actionKind)", async () => {
    vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(true);
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({ toolId: "x.sign", mutating: true, actionKind: "user_wallet_broadcast" }),
    );
    const handler = vi.fn();
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(handler);

    const result = await executeProtocolTool({ toolId: "x.sign", params: {} }, SESSION_CTX);

    expect(result.success).toBe(false);
    expect(result.output).toContain("wallet-scoped session");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT deny a read tool under session", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({ toolId: "x.read", actionKind: "read" }),
    );
    const handler = vi.fn().mockResolvedValue({ success: true, output: "ok" });
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(handler);

    const result = await executeProtocolTool({ toolId: "x.read", params: {} }, SESSION_CTX);

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT deny a signing tool under source:default (CLI/MCP)", async () => {
    vi.mocked(catalog.getProtocolManifest).mockReturnValue(
      makeManifest({ toolId: "x.sign", mutating: true, actionKind: "user_wallet_broadcast" }),
    );
    const handler = vi.fn().mockResolvedValue({ success: true, output: "ok" });
    vi.mocked(catalog.getProtocolHandler).mockReturnValue(handler);

    const result = await executeProtocolTool({ toolId: "x.sign", params: {} }, DEFAULT_CTX);

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
