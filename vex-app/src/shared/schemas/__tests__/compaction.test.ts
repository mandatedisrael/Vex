import { describe, expect, it } from "vitest";
import {
  COMPACT_JOB_STATUSES,
  compactionStatusDtoSchema,
  compactionStatusInputSchema,
  compactionStatusResultSchema,
} from "../compaction.js";

const SESSION = "00000000-0000-4000-8000-000000000007";
const ISO = "2026-05-21T10:00:00.000Z";

describe("compaction schemas", () => {
  it("input requires a uuid sessionId and is strict", () => {
    expect(
      compactionStatusInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(
      compactionStatusInputSchema.safeParse({ sessionId: "nope" }).success,
    ).toBe(false);
    expect(
      compactionStatusInputSchema.safeParse({ sessionId: SESSION, extra: 1 })
        .success,
    ).toBe(false);
  });

  it("accepts a DTO with a latest job + active count", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: { status: "running", checkpointGeneration: 2, updatedAt: ISO },
        activeCount: 1,
      }).success,
    ).toBe(true);
  });

  it("accepts a DTO with no jobs (latest null, zero active)", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: null,
        activeCount: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown job status and a negative activeCount", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: { status: "bogus", checkpointGeneration: 0, updatedAt: ISO },
        activeCount: 0,
      }).success,
    ).toBe(false);
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: null,
        activeCount: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict) on the DTO and the latest job", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: null,
        activeCount: 0,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: {
          status: "running",
          checkpointGeneration: 0,
          updatedAt: ISO,
          extra: 1,
        },
        activeCount: 0,
      }).success,
    ).toBe(false);
  });

  it("result accepts null (missing/deleted/out-of-scope session)", () => {
    expect(compactionStatusResultSchema.safeParse(null).success).toBe(true);
  });

  it("mirrors the engine's five compact-job statuses", () => {
    expect([...COMPACT_JOB_STATUSES]).toEqual([
      "pending",
      "running",
      "completed",
      "failed",
      "permanently_failed",
    ]);
  });
});
