/**
 * knowledge-import — fail-loud audit field validators.
 *
 * Missing fields (undefined / null) are OK and map to defaults via SQL
 * COALESCE in insertEntry. Present-but-bad values throw — caught by the
 * per-row try/catch in the orchestrator, counted as `failed`, and surfaced
 * in the report. Silently coercing garbage to NOW() / 'active' would falsify
 * history exactly where the importer should be most strict.
 */

import type { KnowledgeStatus } from "@vex-agent/knowledge/policy.js";
import {
  isKnowledgeSource,
  KNOWLEDGE_SOURCES,
  type KnowledgeSource,
} from "@vex-agent/memory/long-memory-source-policy.js";
import {
  DECAY_POLICIES,
  INFLUENCE_SCOPES,
  MATURITY_STATES,
  decayPolicySchema,
  influenceScopeSchema,
  maturityStateSchema,
  type DecayPolicy,
  type InfluenceScope,
  type MaturityState,
} from "@vex-agent/memory/schema/long-memory-enums.js";

export interface ImportedRow {
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags?: string[];
  source_refs?: Record<string, unknown>;
  confidence?: number | null;
  status?: string;
  pinned?: boolean;
  valid_from?: string;
  valid_until?: string | null;
  // content_hash is read but ignored — recomputed locally
  content_hash?: string;
  created_at?: string;
  updated_at?: string;
  // ── v2 provenance fields (undefined on v1 input; optional on v2)
  source_surface?: string;
  source_session?: string | null;
  // ── v2 lifecycle fields (undefined on v1 input)
  supersedes_content_hash?: string | null;
  status_reason?: string | null;
  change_summary?: string | null;
  what_failed?: string | null;
  // ── v3 provenance classification + memory-v2 influence (undefined on v1/v2)
  source?: string;
  maturity_state?: string;
  activation_strength?: number;
  influence_scope?: string;
  decay_policy?: string;
  regime_tags?: string[];
  first_promoted_at?: string | null;
  last_reinforced_at?: string | null;
  next_review_at?: string | null;
  outcome_version?: number;
}

export type ManifestVersion = 1 | 2 | 3;

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isKnowledgeStatus(s: unknown): s is KnowledgeStatus {
  return (
    s === "active" || s === "superseded" || s === "invalidated" || s === "archived"
  );
}

export function requireValidStatusOrUndefined(
  s: unknown,
  lineNumber: number,
): KnowledgeStatus | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: status must be a string, got ${typeof s}`);
  }
  if (!isKnowledgeStatus(s)) {
    throw new Error(
      `line ${lineNumber}: status="${s}" is not a valid KnowledgeStatus ` +
        `(active|superseded|invalidated|archived)`,
    );
  }
  return s;
}

export function requireValidDateOrUndefined(
  s: unknown,
  field: string,
  lineNumber: number,
): Date | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string ISO date, got ${typeof s}`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`line ${lineNumber}: ${field}="${s}" is not a parseable ISO date`);
  }
  return d;
}

export function requireValidValidUntil(s: unknown, lineNumber: number): Date | null {
  // Special-case: explicit null is meaningful (evergreen / pinned).
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") {
    throw new Error(
      `line ${lineNumber}: valid_until must be a string ISO date or null, got ${typeof s}`,
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`line ${lineNumber}: valid_until="${s}" is not a parseable ISO date`);
  }
  return d;
}

export function requireOptionalStringOrNull(
  s: unknown,
  field: string,
  lineNumber: number,
): string | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string or null, got ${typeof s}`);
  }
  return s;
}

/** sha256 hex format — 64 hex chars. Rejects tampered / non-hex strings. */
export function requireValidHashOrNull(
  s: unknown,
  field: string,
  lineNumber: number,
): string | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string or null, got ${typeof s}`);
  }
  if (!/^[a-f0-9]{64}$/.test(s)) {
    throw new Error(`line ${lineNumber}: ${field}="${s}" is not a valid sha256 hex`);
  }
  return s;
}

/**
 * source_surface enum — `vex_agent` or `mcp_local` are valid. `echo_agent`
 * is also accepted for backward compatibility with pre-rebrand backup files
 * (they will be treated as `vex_agent` by the DB default / COALESCE).
 * Absence maps to undefined → default `vex_agent` via COALESCE in insertEntry.
 */
export function requireValidSourceSurfaceOrUndefined(
  s: unknown,
  lineNumber: number,
): "vex_agent" | "mcp_local" | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: source_surface must be a string, got ${typeof s}`);
  }
  // Accept legacy echo_agent value from pre-rebrand backups (treated as vex_agent).
  if (s === "echo_agent") return "vex_agent";
  if (s !== "vex_agent" && s !== "mcp_local") {
    throw new Error(
      `line ${lineNumber}: source_surface="${s}" is not valid (expected vex_agent | mcp_local)`,
    );
  }
  return s;
}

/**
 * Provenance classification (`source`). Absent → undefined → insertEntry default
 * `'observed'`. FIX-2: a present-but-invalid value must reject rather than be
 * silently coerced, otherwise `inferred`/`hypothesis` could be re-tiered to a
 * hot-context source on restore.
 */
export function requireValidSourceOrUndefined(
  s: unknown,
  lineNumber: number,
): KnowledgeSource | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: source must be a string, got ${typeof s}`);
  }
  if (!isKnowledgeSource(s)) {
    throw new Error(
      `line ${lineNumber}: source="${s}" is not valid (expected ${KNOWLEDGE_SOURCES.join("|")})`,
    );
  }
  return s;
}

/**
 * maturity_state — validated against the lockstep `z.enum` so SQL CHECK, TS and
 * import agree. Absent → undefined → insertEntry default `'established'`.
 */
export function requireValidMaturityStateOrUndefined(
  s: unknown,
  lineNumber: number,
): MaturityState | undefined {
  if (s === undefined || s === null) return undefined;
  const parsed = maturityStateSchema.safeParse(s);
  if (!parsed.success) {
    throw new Error(
      `line ${lineNumber}: maturity_state="${String(s)}" is not valid (expected ${MATURITY_STATES.join("|")})`,
    );
  }
  return parsed.data;
}

/** influence_scope — advisory | retrieval_boost only. Absent → default `'advisory'`. */
export function requireValidInfluenceScopeOrUndefined(
  s: unknown,
  lineNumber: number,
): InfluenceScope | undefined {
  if (s === undefined || s === null) return undefined;
  const parsed = influenceScopeSchema.safeParse(s);
  if (!parsed.success) {
    throw new Error(
      `line ${lineNumber}: influence_scope="${String(s)}" is not valid (expected ${INFLUENCE_SCOPES.join("|")})`,
    );
  }
  return parsed.data;
}

/** decay_policy — none | time | regime_aware | outcome_aware. Absent → default `'none'`. */
export function requireValidDecayPolicyOrUndefined(
  s: unknown,
  lineNumber: number,
): DecayPolicy | undefined {
  if (s === undefined || s === null) return undefined;
  const parsed = decayPolicySchema.safeParse(s);
  if (!parsed.success) {
    throw new Error(
      `line ${lineNumber}: decay_policy="${String(s)}" is not valid (expected ${DECAY_POLICIES.join("|")})`,
    );
  }
  return parsed.data;
}

/** activation_strength — finite number in [0,1]. Absent → undefined → default 1.0. */
export function requireValidActivationStrengthOrUndefined(
  v: unknown,
  lineNumber: number,
): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(
      `line ${lineNumber}: activation_strength must be a finite number, got ${typeof v}`,
    );
  }
  if (v < 0 || v > 1) {
    throw new Error(`line ${lineNumber}: activation_strength=${v} is out of range [0,1]`);
  }
  return v;
}

/** outcome_version — non-negative integer. Absent → undefined → default 0. */
export function requireValidOutcomeVersionOrUndefined(
  v: unknown,
  lineNumber: number,
): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`line ${lineNumber}: outcome_version must be an integer, got ${typeof v}`);
  }
  if (v < 0) {
    throw new Error(`line ${lineNumber}: outcome_version=${v} must be >= 0`);
  }
  return v;
}

/** regime_tags — array of strings (no null elements). Absent → undefined → default []. */
export function requireValidRegimeTagsOrUndefined(
  v: unknown,
  lineNumber: number,
): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isStringArray(v)) {
    throw new Error(`line ${lineNumber}: regime_tags must be an array of strings`);
  }
  return v;
}
