/**
 * Knowledge layer policy — pure TS constants and helpers.
 *
 * No DB, no embeddings, no I/O. Tested as plain unit tests.
 *
 * Design notes:
 * - `kind` is free-form, agent-defined snake_case. The code never enumerates kinds —
 *   the agent organically grows its own taxonomy and the prompt shows "Known kinds"
 *   so the agent can reuse instead of creating variants.
 * - TTL is a single default for all kinds. Agent decides per entry via `ttl_hours`
 *   override or `pinned: true` (which bypasses TTL entirely).
 * - This module owns the recall constants (k caps, inline cap, cache TTL/folder/space)
 *   so they have one source of truth.
 */

// ── TTL ──────────────────────────────────────────────────────────

/** Default TTL for any new knowledge entry without an override (7 days in hours). */
export const DEFAULT_TTL_HOURS = 7 * 24;

/** Lower bound on per-entry TTL override (1 hour). */
export const MIN_TTL_HOURS = 1;

/** Upper bound on per-entry TTL override (1 year in hours). */
export const MAX_TTL_HOURS = 365 * 24;

/**
 * Compute `valid_until` for a new entry.
 *
 * - `pinned=true` → returns `null` (entry is evergreen, bypasses TTL filter in hot context)
 * - `overrideHours` provided → uses that value (after bounds clamp)
 * - otherwise → uses DEFAULT_TTL_HOURS
 *
 * Note: `kind` is intentionally NOT a parameter — see module header.
 */
export function computeValidUntil(
  overrideHours: number | undefined,
  pinned: boolean,
  now: Date,
): Date | null {
  if (pinned) return null;

  const hours = overrideHours !== undefined ? clampTtlHours(overrideHours) : DEFAULT_TTL_HOURS;
  const result = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return result;
}

/** Clamp `ttl_hours` override to [MIN_TTL_HOURS, MAX_TTL_HOURS]. */
export function clampTtlHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_TTL_HOURS;
  if (hours < MIN_TTL_HOURS) return MIN_TTL_HOURS;
  if (hours > MAX_TTL_HOURS) return MAX_TTL_HOURS;
  return Math.floor(hours);
}

// ── Status ───────────────────────────────────────────────────────

export type KnowledgeStatus = "active" | "superseded" | "invalidated" | "archived";

const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  "active",
  "superseded",
  "invalidated",
  "archived",
] as const;

/** True iff `value` is a valid KnowledgeStatus literal. */
export function isKnowledgeStatus(value: unknown): value is KnowledgeStatus {
  return typeof value === "string" && (KNOWLEDGE_STATUSES as readonly string[]).includes(value);
}

/**
 * Statuses that an agent is allowed to set via knowledge_update_status.
 *
 * `active` is the initial state on insert and cannot be set via update — entries
 * never "come back" from invalidated/archived; the agent writes a new entry instead.
 *
 * `superseded` is intentionally **NOT** in this set in MVP. The schema enum keeps
 * it (so a future steward/distiller can write `superseded` directly), but the tool
 * surface does not expose it because the recall query filters hardcoded
 * `WHERE status = 'active'` — exposing `superseded` would lie to the agent about
 * having a soft lifecycle the code does not actually respect. When a distiller is
 * added in a follow-up plan, recall query and this enum can be expanded together.
 */
export type UpdatableKnowledgeStatus = "invalidated" | "archived";

export function isUpdatableKnowledgeStatus(value: unknown): value is UpdatableKnowledgeStatus {
  return value === "invalidated" || value === "archived";
}

// ── Kind sanity ──────────────────────────────────────────────────

/**
 * Allowed `kind` shape: snake_case ASCII, must start with a-z, may contain
 * a-z 0-9 _ afterwards, max 64 chars. Rejects:
 *   - camelCase ("pumpFun")
 *   - kebab-case ("pump-fun")
 *   - PascalCase ("Pump_Fun")
 *   - leading digit ("1pump")
 *   - non-ASCII ("pumpfün")
 */
const KIND_REGEX = /^[a-z][a-z0-9_]*$/;
export const MAX_KIND_LENGTH = 64;

export function isValidKind(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_KIND_LENGTH) return false;
  return KIND_REGEX.test(value);
}

// ── Recall constants ─────────────────────────────────────────────

/** Default `k` for knowledge_recall when caller does not specify. */
export const RECALL_DEFAULT_K = 8;

/** Hard upper bound on `k` (caller may not request more). */
export const RECALL_MAX_K = 15;

/** Maximum number of entries returned inline in the recall response. */
export const RECALL_INLINE_CAP = 10;

/** Maximum total chars across all inline `content_md` payloads. */
export const RECALL_INLINE_CHARS_CAP = 50_000;

/** Cache TTL for recall overflow entries (minutes). */
export const RECALL_CACHE_TTL_MIN = 15;

/** Folder slug used for recall overflow cache documents. */
export const RECALL_CACHE_FOLDER = "tmp/retrieval";

/** `documents.space` value reserved for recall overflow cache. System-only. */
export const RECALL_CACHE_SPACE = "cache";

/** Maximum number of distinct kinds shown in the Active Knowledge "Known kinds" section. */
export const KNOWN_KINDS_LIMIT = 30;

/** Maximum total chars devoted to the Active Knowledge hot-context entries block. */
export const ACTIVE_KNOWLEDGE_HOT_CHARS_CAP = 3000;

/** Maximum total chars devoted to the Active Knowledge "Known kinds" line. */
export const ACTIVE_KNOWLEDGE_KINDS_CHARS_CAP = 500;

/** Per-entry summary truncation in the Active Knowledge hot-context block. */
export const ACTIVE_KNOWLEDGE_SUMMARY_TRUNCATE = 200;

/** Maximum number of hot-context entries shown in Active Knowledge. */
export const ACTIVE_KNOWLEDGE_ENTRY_LIMIT = 12;

/** Clamp a caller-supplied `k` to the allowed range, falling back to default. */
export function clampRecallK(k: number | undefined): number {
  if (k === undefined || !Number.isFinite(k) || k <= 0) return RECALL_DEFAULT_K;
  if (k > RECALL_MAX_K) return RECALL_MAX_K;
  return Math.floor(k);
}
