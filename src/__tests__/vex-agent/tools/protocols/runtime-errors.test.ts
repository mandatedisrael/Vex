/**
 * B-003 error summarisation + P0-1 VexError-hint surfacing.
 *
 * `summarizeProtocolError` is the single redaction owner for thrown protocol
 * errors. P0-1 folds a VexError's authored, agent-actionable `hint` (and a
 * `retryable` flag) into the agent-facing summary — but the hint MUST flow
 * through the SAME redact + internals-strip + 200-char cap as the message,
 * concatenated BEFORE the cap, never appended raw after it.
 */

import { describe, it, expect } from "vitest";

import { summarizeProtocolError } from "@vex-agent/tools/protocols/runtime/errors.js";
import { VexError } from "../../../../errors.js";

describe("summarizeProtocolError — VexError hint surfacing (P0-1)", () => {
  it("folds a VexError hint into the message so the agent sees the next action", () => {
    const err = new VexError(
      "KYBER_NO_ROUTE",
      "No route for this pair",
      "Pass the exact contract address the quote returned, then retry.",
    );
    const s = summarizeProtocolError(err);
    expect(s.message).toContain("No route for this pair");
    expect(s.message).toContain("Pass the exact contract address");
  });

  it("redacts internals embedded in the hint (URL/secret) BEFORE the cap", () => {
    const err = new VexError(
      "X",
      "boom",
      "see https://api.provider.com/v1?key=SECRETVALUE for details",
    );
    const s = summarizeProtocolError(err);
    expect(s.message).toContain("boom");
    // The exact placeholder ([url]/[body]/[auth]) depends on the redact+pattern
    // interaction; what matters is that the host, secret, and scheme never survive
    // and that SOME internals placeholder proves the hint was stripped, not raw.
    expect(s.message).not.toContain("api.provider.com");
    expect(s.message).not.toContain("SECRETVALUE");
    expect(s.message).not.toContain("https://");
    expect(s.message).toMatch(/\[(url|body|auth)\]/);
  });

  it("caps the COMBINED message+hint (never raw-appends past the 200-char cap)", () => {
    const err = new VexError("X", "m".repeat(180), "h".repeat(180));
    const s = summarizeProtocolError(err);
    // 200 chars + the single ellipsis marker.
    expect(s.message.length).toBeLessThanOrEqual(201);
    expect(s.message.endsWith("…")).toBe(true);
  });

  it("surfaces retryable=true for a retryable VexError", () => {
    const err = new VexError("X", "transient upstream blip", "retry shortly");
    err.retryable = true;
    const s = summarizeProtocolError(err);
    expect(s.retryable).toBe(true);
  });

  it("omits retryable for a non-retryable VexError", () => {
    const s = summarizeProtocolError(new VexError("X", "permanent failure"));
    expect(s.retryable).toBeUndefined();
  });

  it("leaves a non-VexError byte-unchanged (no hint, no retryable)", () => {
    const s = summarizeProtocolError(new Error("plain network down"));
    expect(s.message).toBe("plain network down");
    expect(s.retryable).toBeUndefined();
    expect(s.category).toBe("network");
  });

  it("a VexError without a hint behaves exactly like the bare message", () => {
    const s = summarizeProtocolError(new VexError("X", "just a message"));
    expect(s.message).toBe("just a message");
    expect(s.retryable).toBeUndefined();
  });

  it("classifies the category on the message alone, not the hint", () => {
    // Message is a permanent provider error; hint mentions 'timeout' — category
    // must NOT flip to 'timeout' because of the hint text.
    const err = new VexError("X", "invalid argument", "increase the timeout if this recurs");
    const s = summarizeProtocolError(err);
    expect(s.category).not.toBe("timeout");
  });
});
