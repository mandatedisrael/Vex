import { describe, expect, it } from "vitest";
import { runtimeStatusSchema } from "../../../lib/diagnostics/bug-report-schema.js";
import { MISSION_RUN_STATUSES } from "../../../vex-agent/engine/types.js";

describe("runtimeStatusSchema (lib) ↔ MISSION_RUN_STATUSES (engine) drift guard", () => {
  it("enum members match the canonical engine const, ordering-independent", () => {
    // Codex acceptance criterion: use `.options` (public Zod API), not
    // `_def.values` (internal). The two arrays MUST stay in sync; this
    // test fails CI the moment a status is added to engine without
    // mirroring in `src/lib/diagnostics/bug-report-schema.ts`.
    const libValues = [...runtimeStatusSchema.options].sort();
    const engineValues = [...MISSION_RUN_STATUSES].sort();
    expect(libValues).toEqual(engineValues);
  });

  it("paused_user is present in both runtime status schemas", () => {
    expect(runtimeStatusSchema.options).toContain("paused_user");
    expect(MISSION_RUN_STATUSES).toContain("paused_user");
  });
});
