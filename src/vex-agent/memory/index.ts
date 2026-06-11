/**
 * Memory module barrel — the intentional front door for the isolated memory
 * subsystem (`src/vex-agent/memory/*`).
 *
 * Re-exports ONLY the public memory primitives. New consumers (S1+) may import
 * from `@vex-agent/memory`; existing leaf imports stay as-is during gradual
 * migration.
 *
 * Intentionally NOT re-exported:
 * - context-pressure policy — engine-owned, lives at
 *   `@vex-agent/engine/core/context-pressure-policy.js`.
 * - compact-jobs worker constants — live at
 *   `@vex-agent/engine/compact-jobs/policy.js`.
 */

export * from "./redaction.js";
export * from "./exclusion-rules.js";
export * from "./theme-validation.js";
export * from "./session-memory-policy.js";
export * from "./long-memory-source-policy.js";
export * from "./turn-context.js";
export * from "./kind-catalog.js";
