import { describe, expect, it } from "vitest";
import {
  assertNever,
  err,
  ok,
  VEX_DOMAINS,
  VEX_ERROR_CODES,
  type VexError,
} from "../result.js";

describe("Result helpers", () => {
  it("ok wraps data with ok=true", () => {
    const r = ok({ x: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ x: 1 });
  });

  it("err wraps a VexError with ok=false", () => {
    const e: VexError = {
      code: "validation.invalid_input",
      domain: "preload",
      message: "no",
      retryable: false,
      userActionable: false,
      redacted: true,
      correlationId: "test-correlation-id",
    };
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(e);
  });

  it("assertNever throws on any value", () => {
    expect(() => assertNever("unexpected" as never)).toThrow();
  });
});

describe("VEX_DOMAINS / VEX_ERROR_CODES bridge coverage", () => {
  it("includes the agent-integration bridge domains + the sessions domain", () => {
    // Closed-union exhaustiveness assertion at the bottom of result.ts
    // already prevents the union from drifting from the runtime array.
    // This runtime check gives a readable error when grepping CI logs.
    const required = [
      "messages",
      "runtime",
      "mission",
      "approvals",
      "wallets",
      "models",
      "usage",
      "compaction",
      "knowledge",
      "memory",
      "sessions",
    ] as const;
    for (const domain of required) {
      expect(VEX_DOMAINS).toContain(domain);
    }
  });

  it("includes per-domain feature_unavailable codes for fail-closed mutations", () => {
    const required = [
      "runtime.feature_unavailable",
      "mission.feature_unavailable",
      "approvals.feature_unavailable",
      "wallets.feature_unavailable",
    ] as const;
    for (const code of required) {
      expect(VEX_ERROR_CODES).toContain(code);
    }
  });

  it("does NOT add codes that no handler emits yet (closed union = public contract)", () => {
    // Codex review constraint: closed VexErrorCode union is a public
    // contract, not a parking lot. The renderer treats `feature_unavailable`
    // codes as final UI states — adding unused variants would prompt the
    // UI to render disabled paths that the runtime never reaches.
    const forbidden = [
      "messages.feature_unavailable",
      "models.feature_unavailable",
      "usage.unavailable",
      "runtime.invalid_state",
      "mission.invalid_state",
      "mission.contract_violation",
      "approvals.invalid_state",
      // Removed with the cancelled per-session model write (`setModel` was
      // the only producer) — must not linger as dead public contract.
      "sessions.feature_unavailable",
    ] as const;
    for (const code of forbidden) {
      expect(VEX_ERROR_CODES).not.toContain(code as never);
    }
  });
});
