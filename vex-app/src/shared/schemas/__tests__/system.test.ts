import { describe, expect, it } from "vitest";
import { healthReportSchema } from "../system.js";

const report = {
  os: {
    platform: "darwin",
    arch: "arm64",
    release: "25.0.0",
    distro: null,
    homedir: "/Users/test",
    userDataDir: "/Users/test/Library/Application Support/vex",
    appVersion: "1.0.0",
    electronVersion: "42.0.0",
    nodeVersion: "24.0.0",
  },
  network: {
    online: true,
    latencyMs: 10,
    probedAt: "2026-07-10T00:00:00.000Z",
  },
  translocated: true,
  setupComplete: false,
  overall: "degraded",
} as const;

describe("healthReportSchema translocation contract", () => {
  it("accepts the required boolean and remains strict", () => {
    expect(healthReportSchema.safeParse(report).success).toBe(true);
    expect(
      healthReportSchema.safeParse({ ...report, translocated: undefined }).success,
    ).toBe(false);
    expect(
      healthReportSchema.safeParse({ ...report, extra: true }).success,
    ).toBe(false);
  });
});
