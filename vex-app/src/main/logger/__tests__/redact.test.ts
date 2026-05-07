import { describe, expect, it } from "vitest";
import { redact } from "../redact.js";

describe("redact", () => {
  it("redacts sensitive object keys regardless of value", () => {
    const input = {
      password: "hunter2",
      mnemonic: "abandon abandon abandon",
      privateKey: "0x" + "f".repeat(64),
      secret: { nested: "still hidden" },
      ok: "kept",
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.mnemonic).toBe("[REDACTED]");
    expect(out.privateKey).toBe("[REDACTED]");
    expect(out.secret).toBe("[REDACTED]");
    expect(out.ok).toBe("kept");
  });

  it("scrubs inline secret patterns from string values", () => {
    const evmKey = "0x" + "a".repeat(64);
    const evmAddr = "0x" + "b".repeat(40);
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJ";
    const text = `key=${evmKey} addr=${evmAddr} jwt=${jwt}`;
    const out = redact({ message: text }) as { message: string };
    expect(out.message).not.toContain(evmKey);
    expect(out.message).not.toContain(evmAddr);
    expect(out.message).not.toContain(jwt);
    expect(out.message).toContain("[REDACTED]");
  });

  it("unwraps Errors to {name, message, stack} with scrubbed components", () => {
    const evmKey = "0x" + "a".repeat(64);
    const e = new Error(`leaked ${evmKey}`);
    const out = redact(e) as { name: string; message: string; stack?: string };
    expect(out.name).toBe("Error");
    expect(out.message).not.toContain(evmKey);
    expect(out.message).toContain("[REDACTED]");
  });

  it("handles circular references without throwing", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b", a };
    a.b = b;
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe("a");
    expect((out.b as Record<string, unknown>).name).toBe("b");
  });

  it("truncates very long strings", () => {
    const big = "x".repeat(10_000);
    const out = redact({ blob: big }) as { blob: string };
    expect(out.blob.length).toBeLessThan(big.length);
    expect(out.blob).toContain("[truncated");
  });

  it("preserves non-sensitive values verbatim", () => {
    const out = redact({
      n: 42,
      b: true,
      s: "hello",
      arr: [1, 2, 3],
      nested: { ok: "yes" },
    }) as Record<string, unknown>;
    expect(out).toEqual({
      n: 42,
      b: true,
      s: "hello",
      arr: [1, 2, 3],
      nested: { ok: "yes" },
    });
  });
});
