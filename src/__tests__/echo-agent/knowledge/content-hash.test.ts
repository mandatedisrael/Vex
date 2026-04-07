import { describe, it, expect } from "vitest";
import { computeContentHash } from "@echo-agent/knowledge/content-hash.js";

describe("computeContentHash", () => {
  // ── Determinism ──────────────────────────────────────────────

  it("is deterministic — same input produces the same hash", () => {
    const a = computeContentHash({
      kind: "memo",
      title: "low-holder pump",
      summary: "Tokens with under 50 holders show momentum",
      contentMd: "## body\n\ndetails",
    });
    const b = computeContentHash({
      kind: "memo",
      title: "low-holder pump",
      summary: "Tokens with under 50 holders show momentum",
      contentMd: "## body\n\ndetails",
    });
    expect(a).toBe(b);
  });

  // ── Format ───────────────────────────────────────────────────

  it("returns a 64-char lowercase hex string (sha256)", () => {
    const hash = computeContentHash({
      kind: "memo",
      title: "t",
      summary: "s",
      contentMd: "c",
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── Field independence (length-prefix protects against collision) ─

  it("differs across kind (single field change)", () => {
    const a = computeContentHash({ kind: "memo", title: "t", summary: "s", contentMd: "c" });
    const b = computeContentHash({ kind: "risk_rule", title: "t", summary: "s", contentMd: "c" });
    expect(a).not.toBe(b);
  });

  it("differs across title (single field change)", () => {
    const a = computeContentHash({ kind: "memo", title: "alpha", summary: "s", contentMd: "c" });
    const b = computeContentHash({ kind: "memo", title: "beta", summary: "s", contentMd: "c" });
    expect(a).not.toBe(b);
  });

  it("differs across summary (single field change)", () => {
    const a = computeContentHash({ kind: "memo", title: "t", summary: "one", contentMd: "c" });
    const b = computeContentHash({ kind: "memo", title: "t", summary: "two", contentMd: "c" });
    expect(a).not.toBe(b);
  });

  it("differs across contentMd (single field change)", () => {
    const a = computeContentHash({ kind: "memo", title: "t", summary: "s", contentMd: "one" });
    const b = computeContentHash({ kind: "memo", title: "t", summary: "s", contentMd: "two" });
    expect(a).not.toBe(b);
  });

  // ── Length-prefix collision protection (the whole reason for length prefixing) ─

  it("does not collide when fields border-shift (length-prefix prevents this)", () => {
    // Without length prefixing, "ab|" + "c" would collide with "a|" + "bc".
    const a = computeContentHash({ kind: "ab", title: "c", summary: "x", contentMd: "y" });
    const b = computeContentHash({ kind: "a", title: "bc", summary: "x", contentMd: "y" });
    expect(a).not.toBe(b);
  });

  it("does not collide when content_md contains the separator character", () => {
    // `|` is the field delimiter — must not allow content fields to forge a boundary.
    const a = computeContentHash({
      kind: "memo",
      title: "t",
      summary: "s",
      contentMd: "real|content",
    });
    const b = computeContentHash({
      kind: "memo|t",
      title: "",
      summary: "s",
      contentMd: "real|content",
    });
    expect(a).not.toBe(b);
  });

  it("does not collide when content_md contains newlines (the original raw-separator bug)", () => {
    // The previous design used `\n` as a delimiter; content_md always contains
    // newlines, so any newline-based scheme could collide.
    const a = computeContentHash({
      kind: "memo",
      title: "t",
      summary: "first line",
      contentMd: "second line\nthird line",
    });
    const b = computeContentHash({
      kind: "memo",
      title: "t",
      summary: "first line\nsecond line",
      contentMd: "third line",
    });
    expect(a).not.toBe(b);
  });

  // ── Empty fields ─────────────────────────────────────────────

  it("handles empty content_md", () => {
    const hash = computeContentHash({
      kind: "memo",
      title: "t",
      summary: "s",
      contentMd: "",
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
