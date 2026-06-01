import { describe, it, expect } from "vitest";
import {
  MAX_AUTO_RETRIES,
  AUTO_RETRY_WAKE_TRIGGER,
  snapshotAutoRetryEnabled,
} from "../../../../vex-agent/engine/core/runner/mission-auto-retry-policy.js";

const enabledSnapshot = {
  version: 1,
  frozenMission: { constraintsJson: { autoRetryEnabled: true } },
};

describe("auto-retry policy", () => {
  it("constants", () => {
    expect(MAX_AUTO_RETRIES).toBe(5);
    expect(AUTO_RETRY_WAKE_TRIGGER).toBe("error_retry");
  });

  describe("snapshotAutoRetryEnabled (fail-closed)", () => {
    it("true only when frozenMission.constraintsJson.autoRetryEnabled === true", () => {
      expect(snapshotAutoRetryEnabled(enabledSnapshot)).toBe(true);
    });

    it("false for every missing / malformed / non-true level", () => {
      expect(snapshotAutoRetryEnabled(null)).toBe(false);
      expect(snapshotAutoRetryEnabled(undefined)).toBe(false);
      expect(snapshotAutoRetryEnabled({})).toBe(false);
      expect(snapshotAutoRetryEnabled({ frozenMission: null })).toBe(false);
      expect(snapshotAutoRetryEnabled({ frozenMission: {} })).toBe(false);
      expect(
        snapshotAutoRetryEnabled({ frozenMission: { constraintsJson: null } }),
      ).toBe(false);
      expect(
        snapshotAutoRetryEnabled({ frozenMission: { constraintsJson: {} } }),
      ).toBe(false);
      // Non-boolean / falsey values never enable.
      expect(
        snapshotAutoRetryEnabled({
          frozenMission: { constraintsJson: { autoRetryEnabled: false } },
        }),
      ).toBe(false);
      expect(
        snapshotAutoRetryEnabled({
          frozenMission: { constraintsJson: { autoRetryEnabled: "true" } },
        }),
      ).toBe(false);
      expect(
        snapshotAutoRetryEnabled({
          frozenMission: { constraintsJson: { autoRetryEnabled: 1 } },
        }),
      ).toBe(false);
    });
  });
});
