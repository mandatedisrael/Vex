/**
 * token-name-sanitizer -- the ASCII-allowlist trust boundary for the
 * human-readable token NAME (wider grammar than the symbol sanitizer:
 * internal spaces and ordinary name punctuation are allowed so real names
 * like "USD Coin" survive).
 *
 * Spoofing fixtures use explicit \uXXXX escapes (never raw invisible
 * bytes) so the exact character under test stays reviewable in a diff.
 */

import { describe, it, expect } from "vitest";
import {
  TOKEN_NAME_MAX_LENGTH,
  sanitizeTokenName,
} from "../token-name-sanitizer.js";

describe("sanitizeTokenName", () => {
  it("preserves a real-world name with an internal space", () => {
    expect(sanitizeTokenName("USD Coin")).toBe("USD Coin");
  });

  it("trims surrounding ASCII whitespace on an otherwise valid name", () => {
    expect(sanitizeTokenName("  Wrapped Ether  ")).toBe("Wrapped Ether");
  });

  it("accepts ordinary name punctuation", () => {
    expect(sanitizeTokenName("Dai Stablecoin")).toBe("Dai Stablecoin");
    expect(sanitizeTokenName("Bridged USDC (Arbitrum)")).toBe(
      "Bridged USDC (Arbitrum)",
    );
    expect(sanitizeTokenName("Wrapped BTC & Co.")).toBe("Wrapped BTC & Co.");
    expect(sanitizeTokenName("Trader's Token")).toBe("Trader's Token");
  });

  it("rejects non-string, empty, and over-length values without truncating", () => {
    expect(sanitizeTokenName(null)).toBe(null);
    expect(sanitizeTokenName(undefined)).toBe(null);
    expect(sanitizeTokenName(42)).toBe(null);
    expect(sanitizeTokenName("")).toBe(null);
    expect(sanitizeTokenName("   ")).toBe(null);
    expect(sanitizeTokenName("x".repeat(TOKEN_NAME_MAX_LENGTH))).toBe(
      "x".repeat(TOKEN_NAME_MAX_LENGTH),
    );
    // Over-length is NULL, never a truncated 64-char prefix.
    expect(sanitizeTokenName("x".repeat(TOKEN_NAME_MAX_LENGTH + 1))).toBe(
      null,
    );
  });

  it("rejects control characters", () => {
    expect(sanitizeTokenName("BAD\nNAME")).toBe(null); // LF
    expect(sanitizeTokenName("BAD\tNAME")).toBe(null); // TAB
    expect(sanitizeTokenName("BAD\u0000NAME")).toBe(null); // NUL
    expect(sanitizeTokenName("BAD\u007fNAME")).toBe(null); // DEL
  });

  it("rejects zero-width and bidi-control spoofing characters spliced into a real name", () => {
    expect(sanitizeTokenName("USD\u200bCoin")).toBe(null); // zero-width space
    expect(sanitizeTokenName("USD\u200cCoin")).toBe(null); // zero-width non-joiner
    expect(sanitizeTokenName("USD\u200dCoin")).toBe(null); // zero-width joiner
    expect(sanitizeTokenName("\ufeffUSD Coin")).toBe(null); // BOM / ZWNBSP
    expect(sanitizeTokenName("USD Coin\u202e")).toBe(null); // right-to-left override
    expect(sanitizeTokenName("\u202aUSD Coin")).toBe(null); // left-to-right embedding
    expect(sanitizeTokenName("\u2066USD Coin\u2069")).toBe(null); // bidi isolate pair
    expect(sanitizeTokenName("\u061cUSD Coin")).toBe(null); // Arabic letter mark
  });

  it("rejects Unicode confusable homoglyphs of well-known names", () => {
    expect(sanitizeTokenName("\u0405OL Token")).toBe(null); // Cyrillic Es for Latin S
    expect(sanitizeTokenName("U\uff33D Coin")).toBe(null); // fullwidth Latin capital S
  });
});
