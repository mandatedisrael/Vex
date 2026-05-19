/**
 * Tests for the shared bug-report Zod schemas.
 */

import { describe, it, expect } from "vitest";
import {
  SUPPORT_CATEGORY_REGEX,
  bugReportCategorySchema,
  createBugReportInputSchema,
  createBugReportResultSchema,
} from "../../../lib/diagnostics/bug-report-schema.js";

describe("SUPPORT_CATEGORY_REGEX", () => {
  it("accepts snake_case identifiers within the SQL CHECK bounds", () => {
    expect(SUPPORT_CATEGORY_REGEX.test("user_reported_bug")).toBe(true);
    expect(SUPPORT_CATEGORY_REGEX.test("compact_unable_at_critical")).toBe(true);
    expect(SUPPORT_CATEGORY_REGEX.test("ab1")).toBe(true);
  });

  it("rejects bad shapes", () => {
    expect(SUPPORT_CATEGORY_REGEX.test("Bug")).toBe(false); // uppercase
    expect(SUPPORT_CATEGORY_REGEX.test("user-reported")).toBe(false); // hyphen
    expect(SUPPORT_CATEGORY_REGEX.test("ab")).toBe(false); // too short
    expect(SUPPORT_CATEGORY_REGEX.test("1foo")).toBe(false); // leading digit
    expect(SUPPORT_CATEGORY_REGEX.test("x".repeat(82))).toBe(false); // too long
  });
});

describe("bugReportCategorySchema", () => {
  it("parses valid categories", () => {
    expect(bugReportCategorySchema.parse("user_reported_bug")).toBe("user_reported_bug");
  });
  it("rejects invalid categories", () => {
    expect(() => bugReportCategorySchema.parse("Not-A-Category")).toThrow();
  });
});

describe("createBugReportInputSchema", () => {
  const base = {
    reportKind: "manual" as const,
    source: "user" as const,
    category: "user_reported_bug",
    severity: "error" as const,
    title: "Something broke",
    description: "",
    context: {},
    refs: {},
  };

  it("accepts a minimal valid manual report", () => {
    const result = createBugReportInputSchema.parse(base);
    expect(result.title).toBe("Something broke");
    expect(result.severity).toBe("error");
  });

  it("trims title and rejects empty after trim", () => {
    const trimmed = createBugReportInputSchema.parse({ ...base, title: "  hi  " });
    expect(trimmed.title).toBe("hi");
    expect(() =>
      createBugReportInputSchema.parse({ ...base, title: "    " }),
    ).toThrow();
  });

  it("rejects oversized description", () => {
    expect(() =>
      createBugReportInputSchema.parse({
        ...base,
        description: "x".repeat(8001),
      }),
    ).toThrow();
  });

  it("rejects oversized title", () => {
    expect(() =>
      createBugReportInputSchema.parse({ ...base, title: "x".repeat(161) }),
    ).toThrow();
  });

  it("rejects malformed category", () => {
    expect(() =>
      createBugReportInputSchema.parse({ ...base, category: "Bug" }),
    ).toThrow();
  });

  it("rejects foreign top-level keys (strict)", () => {
    expect(() =>
      createBugReportInputSchema.parse({
        ...base,
        extraField: "leaked",
      }),
    ).toThrow();
  });

  it("rejects foreign refs keys (strict)", () => {
    expect(() =>
      createBugReportInputSchema.parse({
        ...base,
        refs: { sneakyKey: "x" },
      }),
    ).toThrow();
  });

  it("defaults severity, description, context, refs", () => {
    const minimal = createBugReportInputSchema.parse({
      reportKind: "manual",
      source: "user",
      category: "user_reported_bug",
      title: "x",
    });
    expect(minimal.severity).toBe("error");
    expect(minimal.description).toBe("");
    expect(minimal.context).toEqual({});
    expect(minimal.refs).toEqual({});
  });
});

describe("createBugReportResultSchema", () => {
  it("accepts a well-formed result", () => {
    const r = createBugReportResultSchema.parse({
      reportId: "00000000-0000-0000-0000-000000000000",
      recorded: true,
      uploadState: "not_configured",
    });
    expect(r.recorded).toBe(true);
  });

  it("rejects non-uuid reportId", () => {
    expect(() =>
      createBugReportResultSchema.parse({
        reportId: "not-a-uuid",
        recorded: true,
        uploadState: "not_configured",
      }),
    ).toThrow();
  });
});
