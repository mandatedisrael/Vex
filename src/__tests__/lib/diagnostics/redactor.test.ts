/**
 * Tests for the composite diagnostic redactor.
 *
 * Covers:
 *   - key-name redaction (sensitive field names → [REDACTED])
 *   - two-tier text redaction on every string leaf
 *   - Error instances unwrapped BEFORE plain-object branch (so name/message/
 *     stack are scrubbed; Object.entries(Error) would have missed them)
 *   - depth limit
 *   - circular detection
 *   - per-string size cap with `…[truncated N chars]` suffix
 *   - counts proof for the `redaction_*_count` insert columns
 */

import { describe, it, expect } from "vitest";
import { redactBugPayload } from "../../../lib/diagnostics/redactor.js";

describe("redactBugPayload — key-name redaction", () => {
  it("replaces sensitive field values with [REDACTED] regardless of content", () => {
    const r = redactBugPayload({
      apiKey: "this would otherwise be allowed through",
      privateKey: "x",
      password: 12345,
      harmless: "stay",
    });
    expect(r.value.apiKey).toBe("[REDACTED]");
    expect(r.value.privateKey).toBe("[REDACTED]");
    expect(r.value.password).toBe("[REDACTED]");
    expect(r.value.harmless).toBe("stay");
    expect(r.hardRedactCount).toBeGreaterThanOrEqual(3);
  });
});

describe("redactBugPayload — Error handling", () => {
  it("scrubs name/message/stack BEFORE plain-object branch", () => {
    const err = new Error(
      "leaked: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e", // EVM addr
    );
    err.stack =
      "Error: leaked\n    at fn (file:1) private_key: 0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const r = redactBugPayload({ failure: err });
    const failure = r.value.failure as {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
    };
    expect(failure.name).toBe("Error");
    expect(failure.message).toContain("0x742d…f44e");
    expect(failure.stack).toContain("[REDACTED:private_key]");
    expect(r.maskCount).toBeGreaterThanOrEqual(1);
    expect(r.hardRedactCount).toBeGreaterThanOrEqual(1);
  });
});

describe("redactBugPayload — guards", () => {
  it("returns [depth-limit] beyond depth 8", () => {
    let nested: unknown = "leaf";
    for (let i = 0; i < 12; i++) {
      nested = { wrap: nested };
    }
    const r = redactBugPayload({ deep: nested });
    // Walk down the chain — we should hit `[depth-limit]` before reaching "leaf".
    const json = JSON.stringify(r.value);
    expect(json).toContain("depth-limit");
    expect(json).not.toContain("leaf");
  });

  it("detects circular references", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const r = redactBugPayload({ root: cyclic });
    expect(JSON.stringify(r.value)).toContain("[circular]");
  });

  it("truncates strings beyond MAX_STRING_LEN with a suffix", () => {
    const huge = "x".repeat(5000);
    const r = redactBugPayload({ blob: huge });
    expect((r.value.blob as string).length).toBeLessThan(huge.length);
    expect(r.value.blob).toContain("[truncated");
  });
});

describe("redactBugPayload — JSON serialisability", () => {
  it("normalises bigint to a decimal string so JSON.stringify survives", () => {
    const r = redactBugPayload({ amount: 12_345_678_901_234n });
    expect(r.value.amount).toBe("12345678901234");
    // The DB layer JSON.stringifies sanitized context before INSERT — this
    // would throw on a raw bigint. Asserting that the round-trip works keeps
    // the contract honest.
    expect(() => JSON.stringify(r.value)).not.toThrow();
  });

  it("keeps the rest of the JSON-safe primitives intact", () => {
    const r = redactBugPayload({
      n: 42,
      b: true,
      s: "ok",
      nil: null,
    });
    expect(r.value.n).toBe(42);
    expect(r.value.b).toBe(true);
    expect(r.value.s).toBe("ok");
    expect(r.value.nil).toBe(null);
  });
});

describe("redactBugPayload — counts proof", () => {
  it("aggregates counts across nested structures for the redaction_*_count columns", () => {
    const r = redactBugPayload({
      description:
        "tx 0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 from 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      context: {
        breadcrumb: "Bearer eyJhbGciOiJIUzI1NiJ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.aaaaaaaaaaaaaaaa",
        token: "sk-ant-api03-zzzzzzzzzzzzzzzzzzzz", // key-name match → [REDACTED]
      },
    });
    expect(r.maskCount).toBeGreaterThanOrEqual(2);
    expect(r.hardRedactCount).toBeGreaterThanOrEqual(2);
    expect(
      (r.value.context as Record<string, unknown>).token,
    ).toBe("[REDACTED]");
  });
});
