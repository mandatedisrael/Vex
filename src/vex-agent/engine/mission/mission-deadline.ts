/**
 * Hard mission deadline — the agent-independent time-box.
 *
 * Missions run for a fixed duration (default 60 min) and then auto-finalize.
 * The hard boundary is computed purely from FROZEN, run-immutable inputs:
 *   - the run's `started_at` (immutable once the run row exists), and
 *   - the per-mission `durationMinutes` read from the FROZEN run contract
 *     snapshot (`frozenMission.draft.durationMinutes`, see
 *     `frozenDurationMinutes`), NOT from the live mission row.
 * Reading the frozen value is what keeps the box pinned across wakes/resumes:
 * the live mission row can be edited (or moved back to draft after a failed
 * run and re-edited before recovery), so a post-start mutation must never be
 * able to move the enforced deadline mid-run. This mirrors how
 * `resolveWalletPolicy` reads `allowedWallets` and `snapshotAutoRetryEnabled`
 * reads its opt-in — both from the same frozen snapshot.
 *
 * Enforcement lives at the turn-loop boundary (see turn-loop.ts): once
 * `now >= deadline`, the loop stops with `deadline_reached` before spending
 * another inference call, regardless of what the agent is doing.
 *
 * DURATION CONTRACT — integer minutes only. Both the per-mission
 * `durationMinutes` field (sanitized in `patch-parser.ts`) and the
 * `VEX_MISSION_HARD_DEADLINE_MIN` env override are normalized to a WHOLE
 * minute in `[1, 1440]`: a fractional value TRUNCATES toward zero (5.9 -> 5)
 * and a sub-1-minute value (0.5) is rejected -> the next fallback applies.
 * The env override exists to run short (e.g. 2-minute) test boxes without
 * waiting an hour; the repo's own usages are all whole minutes, so a
 * fractional test box is intentionally NOT supported (it would diverge from
 * the per-mission field's contract).
 *
 * This module has NO trading surface — it only computes when a run must
 * finalize. What happens to open positions at that point is a presentation /
 * ledger concern (see mission-results work), never a trade instruction here.
 */

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 1440; // 24h ceiling — a guard against a fat-fingered override or draft value
const MIN_MINUTES = 1; // whole-minute floor — a sub-1-minute box is rejected, not truncated to 0

/**
 * Normalize a raw minute count to a whole minute in `[MIN_MINUTES, MAX_MINUTES]`,
 * or `null` when it is not a usable box (non-finite, or truncates below 1).
 * The single source of the integer-minute contract shared by the per-mission
 * field and the env override.
 */
function clampWholeMinutes(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  if (whole < MIN_MINUTES) return null;
  return Math.min(whole, MAX_MINUTES);
}

/** Resolve the hard-deadline duration in minutes (default 60, env-overridable). */
export function hardDeadlineMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.VEX_MISSION_HARD_DEADLINE_MIN;
  if (raw === undefined || raw === "") return DEFAULT_MINUTES;
  return clampWholeMinutes(Number(raw)) ?? DEFAULT_MINUTES;
}

/**
 * Resolve the box duration for a specific mission: the mission's own
 * `durationMinutes` (a structured contract field the agent sets — "5-minute
 * box" -> 5, "one hour" -> 60) when present and valid, else the env
 * override, else the 60-minute default. Fractional/​sub-minute values follow
 * the integer-minute contract (see `clampWholeMinutes`).
 */
export function resolveDurationMinutes(
  missionMinutes?: number | null,
  env: Record<string, string | undefined> = process.env,
): number {
  if (typeof missionMinutes === "number") {
    const clamped = clampWholeMinutes(missionMinutes);
    if (clamped !== null) return clamped;
  }
  return hardDeadlineMinutes(env);
}

/**
 * Read the per-mission `durationMinutes` from a FROZEN run contract snapshot
 * (`frozenMission.draft.durationMinutes`) — the same immutable source
 * `resolveWalletPolicy` reads `allowedWallets` from. The live mission row is
 * intentionally NOT consulted so a post-start mutation can never move the
 * enforced deadline. FAIL-OPEN to `null` (-> env -> 60) on any
 * missing/malformed level or a non-positive value.
 */
export function frozenDurationMinutes(snapshot: unknown): number | null {
  if (snapshot === null || typeof snapshot !== "object") return null;
  const frozen = (snapshot as Record<string, unknown>).frozenMission;
  if (frozen === null || typeof frozen !== "object") return null;
  const draft = (frozen as Record<string, unknown>).draft;
  if (draft === null || typeof draft !== "object") return null;
  const raw = (draft as Record<string, unknown>).durationMinutes;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * The absolute hard-deadline epoch (ms) for a run: `started_at + duration`.
 * Returns null when `started_at` is unparseable — fail-open, so a bad
 * timestamp never manufactures a spurious deadline that kills a run early.
 */
export function computeHardDeadlineMs(
  startedAtIso: string,
  durationMin: number = hardDeadlineMinutes(),
): number | null {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) return null;
  return startMs + durationMin * 60_000;
}

/**
 * Resolve the frozen hard-deadline epoch (ms) for a run from its IMMUTABLE
 * inputs: the run's `started_at` + the `durationMinutes` frozen in the run
 * contract snapshot (-> env override -> 60-min default). Returns null when
 * `started_at` is missing/unparseable (fail-open: no false early stop). This
 * is the single resolver both the start and the resume paths use, so the box
 * is identical across the run's whole life.
 */
export function resolveFrozenDeadlineMs(
  startedAtIso: string | null | undefined,
  contractSnapshot: unknown,
): number | null {
  if (!startedAtIso) return null;
  return computeHardDeadlineMs(
    startedAtIso,
    resolveDurationMinutes(frozenDurationMinutes(contractSnapshot)),
  );
}
