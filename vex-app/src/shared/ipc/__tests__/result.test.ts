import { describe, expect, it } from "vitest";
import { assertNever, err, ok, type VexError } from "../result.js";

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
    };
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(e);
  });

  it("assertNever throws on any value", () => {
    expect(() => assertNever("unexpected" as never)).toThrow();
  });
});
