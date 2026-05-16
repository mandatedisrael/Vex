/**
 * Local types for the migrations bootstrap state machine.
 *
 * `Phase` is driven by the `MigrateResult.kind` IPC discriminator plus
 * a transient `running` state seeded on mount and updated by progress
 * push events. The orchestrator's progress callback uses a functional
 * setState that ONLY mutates `current` while `kind === "running"`, so
 * late events can't regress a terminal state (codex plan v2 SHOULD-FIX
 * #3).
 */

import type { MigrateProgress } from "@shared/schemas/database.js";

export interface FailedAt {
  readonly version: number;
  readonly file: string;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "running"; current: MigrateProgress | null }
  | { kind: "noop" }
  | { kind: "ready"; appliedCount: number }
  | {
      kind: "error";
      message: string;
      failedAt: FailedAt | null;
      appliedBeforeFailure: readonly string[];
    };
