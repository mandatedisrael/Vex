/**
 * Time-simulated memory eval — THE RUNNER (S4). TEST-ONLY imperative shell.
 *
 * Drives the `_world-corpus.ts` stream ONE ITEM AT A TIME through the REAL Vex
 * memory pipeline (handleLongMemorySuggest door → live DeepSeek judge →
 * consolidate/graph/decay/reconcile → Gemma retrieval) over SIMULATED time, and
 * CAPTURES the per-item + final state for the S5 oracle scorer. S4 only RUNS and
 * CAPTURES — it does NOT score against `_oracle.ts` (that is S5).
 *
 * ── EVENT MODEL ─────────────────────────────────────────────────────────────
 * The corpus is three pure streams (memories / trades / regimes) each tagged with
 * a sim-day. They are merged into ONE chronological event list, stable-sorted by
 * `(simDay, kindRank)` so that on the SAME sim-day:
 *   1. TRADES seed first (a trade-anchored memory needs its real executionId),
 *   2. REGIMES next (a regime snapshot must exist before that day's decay sweep),
 *   3. MEMORIES last (predecessors that are `seedPromotedLessonDirect` are
 *      authored on EARLIER days than their successors, so cross-day ordering is
 *      already correct; same-day memory order falls back to corpus order).
 *
 * ── TIME SIMULATION ─────────────────────────────────────────────────────────
 * Per `_sim-clock.ts`: there is no global clock seam, so a logical `simNowDay` is
 * projected onto the wall clock at each checkpoint. When the stream advances to a
 * NEW sim-day, FIRST advance the clock (re-backdate every active decayable row's
 * anchors + `runDecaySweep`) for the elapsed days, THEN process that day's events.
 * BINDING (per Codex): capture exactly ONE `wallNow = new Date()` per checkpoint
 * and thread the SAME instant into projection, runDecaySweep, AND simRegimeDeps —
 * never three fresh `new Date()`.
 *
 * ── CAPTURE ─────────────────────────────────────────────────────────────────
 * `RunCapture` accumulates one `ItemResult` per memory item (door-reject / judge /
 * seed / reconcile detail) plus the resolved trade/regime ids. S5 consumes it.
 */

import { runDecaySweep } from "@vex-agent/engine/memory-manager/decay-sweep.js";
import { listDecayableEntries } from "@vex-agent/db/repos/knowledge/crud.js";
import { insertRegimeSnapshot } from "@vex-agent/db/repos/regime-snapshots.js";
import {
  updateCandidateOutcome,
  updateCandidateStatus,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { memoryOutcomeSummarySchema } from "@vex-agent/memory/schema/memory-outcome.js";
import { query } from "@vex-agent/db/client.js";
import { handleLongMemorySuggest } from "@vex-agent/tools/internal/long-memory/suggest.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import type {
  DecayPolicy,
  InfluenceScope,
} from "@vex-agent/memory/schema/long-memory-enums.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import type { RegimeConfidence, RegimeVolLabel } from "@vex-agent/memory/schema/regime-enums.js";

import {
  WORLD_CORPUS,
  type MemoryItem,
  type TradeEvent,
  type RegimeEvent,
  type CorpusSuggest,
  type CorpusIntent,
} from "./_world-corpus.js";
import {
  claimNextDueJob,
  markCompleted,
  getJobById,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  processReconcileJob,
  defaultReconcileDeps,
} from "@vex-agent/engine/memory-manager/reconcile.js";

import {
  seedFaithfulConfirmedSpotTrade,
  seedFaithfulClosingTradeForWake,
  seedGemmaCandidate,
  seedPromotedLessonDirect,
  driveConsolidateCapturingJudge,
  type FaithfulSpotResult,
} from "./_eval-fixtures.js";
import {
  backdateCandidate,
  backdateKnowledgeEntry,
  backdateRegimeSnapshot,
  simRegimeDeps,
} from "./_sim-clock.js";

// ════════════════════════════════════════════════════════════════════════════
//  CAPTURE SHAPES (what S5 scores against the oracle)
// ════════════════════════════════════════════════════════════════════════════

/** Door-reject capture (N/O/P/Q/R adversarial + J near-dups that fail the door). */
export interface DoorRejectCapture {
  readonly kind: "door_reject";
  /** `handleLongMemorySuggest` success flag (false = rejected at the door). */
  readonly success: boolean;
  /** Steering message text (the human-readable reject reason), or null on success. */
  readonly steering: string | null;
  /** Whether a candidate row landed (a clean pass through the door inserts one). */
  readonly candidateId: string | null;
}

/** Judge-path capture (items that reach the live DeepSeek consolidation judge). */
export interface JudgeCapture {
  readonly kind: "judge";
  /** The candidate id that was driven through the judge. */
  readonly candidateId: string;
  /** Whether a judge call was attempted (the candidate escalated). */
  readonly reached: boolean;
  /** Whether a verdict validated against judgeVerdictSchema. */
  readonly verdictValid: boolean;
  /** Bounded failure category when reached-but-invalid (F31), else null. */
  readonly invalidReason: string | null;
  /** Resolved decision type (promote/retain/reject/supersede/…) or null on a thrown judge. */
  readonly decisionType: string | null;
  /** The supersede target the system picked (plan.previousKnowledgeId) or null. */
  readonly supersedesKnowledgeId: number | null;
  /** Resolved outcome lesson-signal (positive/negative/neutral) or null. */
  readonly outcomeSignal: string | null;
  /** Whether a graph write-plan was built (SOFT — F31-fragile). */
  readonly hasGraphPlan: boolean;
  /** Judge round-trip latency (ms), measured even on a timed-out verdict. */
  readonly latencyMs: number;
}

/** Deterministic seed capture (predecessors / reconcile targets / graph owners). */
export interface SeedCapture {
  readonly kind: "seed";
  /** Which seeder produced the row. */
  readonly via: "seedPromotedLessonDirect" | "seedGemmaCandidate";
  /** The knowledge entry id (direct-promote) or null (gemma candidate). */
  readonly knowledgeId: number | null;
  /** The candidate id (gemma candidate) or null (direct-promote). */
  readonly candidateId: string | null;
}

/** Reconcile capture (K flips: a closing trade re-resolves a promoted lesson). */
export interface ReconcileCapture {
  readonly kind: "reconcile";
  /** The reconcile job's terminal FSM status. */
  readonly terminalStatus: string;
  /** Bounded last_error code (judge_timeout / …) or null on a clean completion. */
  readonly lastError: string | null;
  /** "reconcile" when a consequence was applied (a decision row written), else null. */
  readonly decisionType: "reconcile" | null;
}

/** The per-item capture union the scorer reads. */
export type ItemResult =
  | DoorRejectCapture
  | JudgeCapture
  | SeedCapture
  | ReconcileCapture;

/**
 * The whole-run capture. `perItem` is keyed by the corpus memory id. `finalSnapshot`
 * is a stub here (S4) — S5 fills it from the real read paths. `tradeAnchors` maps a
 * TradeEvent id → its seeded executionIds so the scorer can cross-reference.
 */
export interface RunCapture {
  perItem: Map<string, ItemResult>;
  tradeAnchors: Map<string, FaithfulSpotResult>;
  regimeSnapshotIds: Map<string, number>;
  /** Corpus item ids that were processed this run (subset-aware). */
  processedItemIds: string[];
  finalSnapshot: null;
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT MERGE / SORT
// ════════════════════════════════════════════════════════════════════════════

type StreamEvent =
  | { readonly kind: "trade"; readonly simDay: number; readonly seq: number; readonly trade: TradeEvent }
  | { readonly kind: "regime"; readonly simDay: number; readonly seq: number; readonly regime: RegimeEvent }
  | { readonly kind: "memory"; readonly simDay: number; readonly seq: number; readonly item: MemoryItem };

/** Same-day ordering rank: trades → regimes → memories. */
const KIND_RANK: Record<StreamEvent["kind"], number> = {
  trade: 0,
  regime: 1,
  memory: 2,
};

/**
 * Merge the three corpus streams into ONE chronological event list, stable-sorted
 * by `(simDay, kindRank, seq)`. `seq` is the original within-stream index, so the
 * sort is stable for ties (authored order is preserved within a same-day kind).
 */
export function buildEventStream(
  memories: readonly MemoryItem[],
  trades: readonly TradeEvent[],
  regimes: readonly RegimeEvent[],
): StreamEvent[] {
  const events: StreamEvent[] = [];
  trades.forEach((trade, seq) => events.push({ kind: "trade", simDay: trade.simDay, seq, trade }));
  regimes.forEach((regime, seq) => events.push({ kind: "regime", simDay: regime.simDay, seq, regime }));
  memories.forEach((item, seq) => events.push({ kind: "memory", simDay: item.simDay, seq, item }));
  return events.sort((a, b) => {
    if (a.simDay !== b.simDay) return a.simDay - b.simDay;
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return a.seq - b.seq;
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  SUBSET SELECTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * The representative 10-item subset (S4 proof). Spans the funnel-critical classes:
 *   - A01  trade_lesson (judge path, WIF-anchored, graph cluster)     → judge
 *   - F01  supersession predecessor (seedPromotedLessonDirect)        → seed
 *   - F03  supersession successor (suggest → judge, supersedes F02)   → judge
 *   - K02  reconcile-flip (seed + linked promoted candidate → flip)   → reconcile
 *   - H01  graph-cluster owner (seedPromotedLessonDirect)             → seed
 *   - P04  secret door-reject (sk- key → tier1 hard reject)           → door reject
 *   - R01  prompt-injection (suggest → judge; must NOT be steered)    → judge
 *   - Q01  non-English door-reject                                    → door reject
 *   - M01  decay time-only (seedPromotedLessonDirect)                 → seed
 *   - B02  recurrence-2 (suggest → judge, anchored on a range loss)   → judge
 *
 * NOTE on the reconcile pick: K02 anchors BONK (`T-BONK-K2` → flipped by
 * `T-BONK-K2-CLOSE`). The closing-trade wake matches by instrumentKey, so the
 * reconcile target must be the ONLY BONK promoted entry in the subset — K02 is,
 * because no other subset item is a BONK wake target. (K01 anchors WIF, which
 * collides with A01's WIF promote — a real cross-item wake collision; choosing K02
 * keeps the S4 reconcile target unambiguous. The full-100 S6 run resolves all four
 * K flips and the scorer there must tolerate same-token wake fan-out.)
 */
export const SUBSET_IDS: readonly string[] = [
  "A01",
  "F01",
  "F03",
  "K02",
  "H01",
  "P04",
  "R01",
  "Q01",
  "M01",
  "B02",
] as const;

/**
 * Resolve the full closure of items + trades + regimes required to drive a chosen
 * memory-id subset end-to-end: the chosen memories, every trade those memories
 * anchor on (and the closing trades that flip them), and every regime snapshot up
 * to and including the latest chosen sim-day so the dwell/age guards see a sim
 * clock consistent with the run window.
 */
export function resolveSubset(subsetIds: readonly string[]): {
  memories: MemoryItem[];
  trades: TradeEvent[];
  regimes: RegimeEvent[];
} {
  const want = new Set(subsetIds);
  const memories = WORLD_CORPUS.memories.filter((m) => want.has(m.id));
  if (memories.length !== want.size) {
    const missing = [...want].filter((id) => !memories.some((m) => m.id === id));
    throw new Error(`resolveSubset: unknown corpus ids ${missing.join(", ")}`);
  }

  // Required trade ids: anchors + their closing trades.
  const tradeIds = new Set<string>();
  for (const m of memories) {
    if (m.intent.anchorTradeId) tradeIds.add(m.intent.anchorTradeId);
    if (m.intent.reconcileClosesTradeId) tradeIds.add(m.intent.reconcileClosesTradeId);
  }
  // A closing trade pulls in the original winner it closes (the buy lot it flips).
  for (const t of WORLD_CORPUS.trades) {
    if (tradeIds.has(t.id) && t.closesTradeId) tradeIds.add(t.closesTradeId);
  }
  const trades = WORLD_CORPUS.trades.filter((t) => tradeIds.has(t.id));

  // Regimes: include every snapshot at or before the latest chosen sim-day so the
  // effective-regime dwell pairs are present for any decay sweep in the window.
  const maxDay = Math.max(...memories.map((m) => m.simDay), ...trades.map((t) => t.simDay), 0);
  const regimes = WORLD_CORPUS.regimes.filter((r) => r.simDay <= maxDay);

  return { memories, trades, regimes };
}

// ════════════════════════════════════════════════════════════════════════════
//  ENUM MAPPERS (corpus literals → repo/schema literals)
// ════════════════════════════════════════════════════════════════════════════

/** Corpus `vol` (`high_vol`/`low_vol`) → regime `vol_label` (`high`/`low`). */
function mapVolLabel(vol: RegimeEvent["vol"]): RegimeVolLabel {
  return vol === "high_vol" ? "high" : "low";
}

/** Corpus `confidence` (`low`/`med`/`high`) → regime confidence (`low`/`medium`/`high`). */
function mapRegimeConfidence(conf: RegimeEvent["confidence"]): RegimeConfidence {
  if (conf === "med") return "medium";
  return conf; // "low" | "high" pass through
}

/** Map a corpus suggest payload to the snake_case `handleLongMemorySuggest` params. */
function mapToSuggestParams(
  item: MemoryItem,
  resolvedEvidenceRefs: readonly { executionId: number; instrumentKey?: string; positionKey?: string }[],
  eventTimeISO: string,
): Record<string, unknown> {
  const s: CorpusSuggest = item.suggest;
  const params: Record<string, unknown> = {
    kind: item.kind,
    title: s.title,
    summary: s.summary,
    event_time: eventTimeISO,
  };
  if (s.contentMd !== undefined) params["content_md"] = s.contentMd;
  if (s.entities !== undefined) params["entities"] = [...s.entities];
  if (s.tags !== undefined) params["tags"] = [...s.tags];
  if (s.importance !== undefined) params["importance"] = s.importance;
  if (s.confidence !== undefined) params["confidence"] = s.confidence;
  if (resolvedEvidenceRefs.length > 0) params["evidence_refs"] = resolvedEvidenceRefs.map((r) => ({ ...r }));
  return params;
}

/**
 * Whether a memory item is a door-reject class (its capture IS the door result —
 * it does NOT proceed to consolidation). N/O/P/Q/R adversarial items + the
 * door-routed J near-dups. The runner records the door outcome and stops.
 */
function isDoorClass(item: MemoryItem): boolean {
  return item.intent.adversarial !== undefined;
}

/**
 * Map a corpus `decayExpected` class → the concrete `decay_policy` enum value the
 * seeded entry must carry so the real sweep treats it correctly:
 *   - "time"   → "time"          (pure age half-life, regime-neutral)
 *   - "regime" → "regime_aware"  (regime-modulated decay; the L bull-only owners)
 *   - else     → "none"          (frozen — excluded by listDecayableEntries)
 */
function decayPolicyFor(intent: CorpusIntent): DecayPolicy {
  if (intent.decayExpected === "time") return "time";
  if (intent.decayExpected === "regime") return "regime_aware";
  return "none";
}

// ════════════════════════════════════════════════════════════════════════════
//  CONTEXT
// ════════════════════════════════════════════════════════════════════════════

/** The lifecycle.int.test.ts:46 context shape (a `full`/approved parent agent). */
export function makeContext(sessionId: string): InternalToolContext {
  return {
    sessionId,
    loadedDocuments: new Map<string, string>(),
    sessionPermission: "full",
    approved: true,
    role: "parent",
    missionRunId: null,
    missionId: null,
    sessionKind: "agent",
    contextUsageBand: "normal",
    planMode: false,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  RUNNER STATE
// ════════════════════════════════════════════════════════════════════════════

/** Per-entry sim anchors so a checkpoint advance can re-project them consistently. */
interface ActiveEntryAnchor {
  readonly promotedSimDay: number;
}

interface RunnerState {
  readonly sessionId: string;
  readonly capture: RunCapture;
  /** entryId → its sim-day anchors (for re-projection at each checkpoint). */
  readonly activeEntries: Map<number, ActiveEntryAnchor>;
  /** A monotonically increasing worker id suffix so each judge drive is distinct. */
  workerSeq: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  CHECKPOINT ADVANCE (decay over sim time)
// ════════════════════════════════════════════════════════════════════════════

/** Page through every active decayable entry (the sweep's exact eligibility set). */
async function listAllDecayableIds(): Promise<number[]> {
  const ids: number[] = [];
  let afterId = 0;
  // The sweep caps at 2000/page; for ≤100 items one page suffices, but page to be safe.
  for (;;) {
    const rows = await listDecayableEntries({ afterId, limit: 500 });
    if (rows.length === 0) break;
    for (const r of rows) ids.push(r.id);
    afterId = rows[rows.length - 1]!.id;
    if (rows.length < 500) break;
  }
  return ids;
}

/**
 * Advance the simulated clock from `priorDay` to `newDay`. Captures ONE `wallNow`,
 * re-projects every active decayable entry's anchors onto it (keeping
 * first_promoted_at / last_reinforced_at at their ORIGINAL sim-days and pinning
 * last_decayed_at to the PRIOR sim instant — the compounding fix), then runs the
 * real decay sweep with that SAME `wallNow`.
 */
async function advanceClock(state: RunnerState, priorDay: number, newDay: number): Promise<void> {
  const wallNow = new Date(); // ONE capture per checkpoint (load-bearing)
  const decayableIds = await listAllDecayableIds();
  for (const id of decayableIds) {
    const anchor = state.activeEntries.get(id);
    const promotedSimDay = anchor?.promotedSimDay ?? priorDay;
    await backdateKnowledgeEntry(
      id,
      {
        firstPromotedAt: promotedSimDay,
        lastReinforcedAt: promotedSimDay,
        // Pin last_decayed_at to the prior sim instant so the next sweep's Δt is
        // (newDay - priorDay), not ≈0 (else below_delta no-ops forever).
        lastDecayedAt: priorDay,
      },
      newDay,
      wallNow,
    );
  }
  await runDecaySweep(wallNow, simRegimeDeps(wallNow));
}

// ════════════════════════════════════════════════════════════════════════════
//  DISPATCH
// ════════════════════════════════════════════════════════════════════════════

/** Resolve the trade-anchored evidence refs for a memory item (SELL first). */
function resolveTradeAnchors(
  item: MemoryItem,
  tradeAnchors: Map<string, FaithfulSpotResult>,
): { executionId: number; instrumentKey?: string }[] {
  const tradeId = item.intent.anchorTradeId;
  if (!tradeId) {
    // NON-trade item: forward its literal evidenceRefs (FIXED_ANCHOR placeholders
    // remapped to a real execution would require a seeded execution; the corpus
    // only carries executionId=1 placeholders for these, which the suggest schema
    // accepts as int>0 but no real row exists. For S4 we forward them as-is for
    // non-door items that reach the judge — recurrence may stay low, which is the
    // honest pipeline behavior the scorer reads).
    return (item.suggest.evidenceRefs ?? []).map((r) => ({
      executionId: r.executionId,
      ...(r.instrumentKey !== undefined ? { instrumentKey: r.instrumentKey } : {}),
    }));
  }
  const seeded = tradeAnchors.get(tradeId);
  if (!seeded) {
    throw new Error(`resolveTradeAnchors: ${item.id} anchors trade ${tradeId} which was not seeded`);
  }
  const anchorOn = item.intent.anchorOn ?? "sell";
  const primary = anchorOn === "sell" ? seeded.sellExecutionId : seeded.buyExecutionId;
  const secondary = anchorOn === "sell" ? seeded.buyExecutionId : seeded.sellExecutionId;
  return [
    { executionId: primary, instrumentKey: seeded.instrumentKey },
    { executionId: secondary, instrumentKey: seeded.instrumentKey },
  ];
}

/** Process one TRADE event: seed the faithful spot trade, key the result by id. */
async function runTradeEvent(state: RunnerState, trade: TradeEvent): Promise<void> {
  if (trade.kind === "closing") {
    // A closing trade is fired at reconcile time (see runReconcile); a bare
    // closing event with no lesson to flip is still recorded as a ledger fact so
    // the ledger stays realistic, but for the subset we only fire closings that a
    // K item references (handled in runMemoryItem's reconcile branch). Skip here.
    return;
  }
  const result = await seedFaithfulConfirmedSpotTrade({
    sessionId: state.sessionId,
    instrumentKey: trade.instrumentKey,
    walletAddress: trade.walletAddress,
    buyQtyRaw: trade.buyQtyRaw ?? "1000000000",
    buyValueUsd: trade.buyValueUsd ?? "50.00",
    sellQtyRaw: trade.sellQtyRaw,
    sellValueUsd: trade.sellValueUsd,
  });
  state.capture.tradeAnchors.set(trade.id, result);
}

/** Process one REGIME event: insert the snapshot then backdate created_at to simDay. */
async function runRegimeEvent(state: RunnerState, regime: RegimeEvent, simNowDay: number): Promise<void> {
  const wallNow = new Date();
  const snapshot = await insertRegimeSnapshot({
    trendLabel: regime.trend,
    volLabel: mapVolLabel(regime.vol),
    confidence: mapRegimeConfidence(regime.confidence),
    source: "hybrid",
    rationale: regime.rationale,
  });
  await backdateRegimeSnapshot(snapshot.id, { createdAt: regime.simDay }, simNowDay, wallNow);
  state.capture.regimeSnapshotIds.set(regime.id, snapshot.id);
}

/** Process one MEMORY item: dispatch by entryVia + intent and capture the result. */
async function runMemoryItem(state: RunnerState, item: MemoryItem, simNowDay: number): Promise<void> {
  const wallNow = new Date();
  const eventTimeISO = new Date(wallNow.getTime()).toISOString();

  // ── Door-class adversarial items: the door result IS the capture. ──
  if (isDoorClass(item)) {
    const refs = resolveTradeAnchors(item, state.capture.tradeAnchors);
    const params = mapToSuggestParams(item, refs, eventTimeISO);
    const res = await handleLongMemorySuggest(params, makeContext(state.sessionId));
    const data = (res.data ?? {}) as { candidateId?: string };
    const candidateId = typeof data.candidateId === "string" ? data.candidateId : null;
    state.capture.perItem.set(item.id, {
      kind: "door_reject",
      success: res.success === true,
      // Steering text lives in `output` (ToolResult has no `message`); on a clean
      // pass it is the accept payload, which the scorer ignores for success items.
      steering: res.success === true ? null : res.output,
      candidateId,
    });
    return;
  }

  // ── seedPromotedLessonDirect: deterministic active entry (predecessors / ──
  // ── reconcile targets / graph owners / decay owners). Judge bypassed.    ──
  if (item.entryVia === "seedPromotedLessonDirect") {
    const decayPolicy = decayPolicyFor(item.intent);
    const influenceScope: InfluenceScope = "advisory";
    const source: KnowledgeSource = "observed";
    const seeded = await seedPromotedLessonDirect({
      kind: item.kind,
      title: item.suggest.title,
      summary: item.suggest.summary,
      ...(item.suggest.contentMd !== undefined ? { contentMd: item.suggest.contentMd } : {}),
      source,
      maturityState: "established",
      activationStrength: 1.0,
      influenceScope,
      decayPolicy,
      ...(item.intent.decayExpected === "regime" ? { regimeTags: ["bull"] } : {}),
      outcomeVersion: 0,
    });
    // Backdate the lifecycle anchors to the item's sim-day (first_promoted_at /
    // last_reinforced_at / valid_from), so age + validity read on the sim clock.
    await backdateKnowledgeEntry(
      seeded.id,
      {
        firstPromotedAt: item.simDay,
        lastReinforcedAt: item.simDay,
        validFrom: item.simDay,
        createdAt: item.simDay,
      },
      simNowDay,
      wallNow,
    );
    state.activeEntries.set(seeded.id, { promotedSimDay: item.simDay });
    state.capture.perItem.set(item.id, {
      kind: "seed",
      via: "seedPromotedLessonDirect",
      knowledgeId: seeded.id,
      candidateId: null,
    });

    // ── Reconcile (K): the entry must be a WAKE TARGET — i.e. backed by a ──
    // ── PROMOTED candidate whose evidence_refs carry the instrumentKey, with ──
    // ── a stored positive outcome to FLIP (findPromotedWakeTargets joins on a ──
    // ── promoted candidate, NOT on the entry's own refs). seedPromotedLessonDirect ──
    // ── alone leaves no such candidate, so we link one here using only existing ──
    // ── repo functions (the reconcile-s7.int.test.ts pattern), then fire the flip. ──
    if (item.intent.reconcileClosesTradeId) {
      await linkPromotedCandidateForReconcile(state, item, seeded.id);
      await runReconcileForItem(state, item, seeded.id);
    }
    return;
  }

  // ── seedGemmaCandidate: reach the judge deterministically (not door-scored). ──
  if (item.entryVia === "seedGemmaCandidate") {
    const refs = resolveTradeAnchors(item, state.capture.tradeAnchors);
    const { candidateId } = await seedGemmaCandidate({
      sessionId: state.sessionId,
      kind: item.kind,
      title: item.suggest.title,
      summary: item.suggest.summary,
      ...(item.suggest.contentMd !== undefined ? { contentMd: item.suggest.contentMd } : {}),
      ...(refs.length > 0 ? { evidenceRefs: refs } : {}),
      ...(item.suggest.importance !== undefined ? { importance: item.suggest.importance } : {}),
      ...(item.suggest.confidence !== undefined ? { confidence: item.suggest.confidence } : {}),
      eventTime: new Date(wallNow.getTime()),
    });
    await backdateCandidate(
      candidateId,
      {
        recordedAt: item.simDay,
        eventTime: item.simDay,
        observedAt: item.simDay,
      },
      simNowDay,
      wallNow,
    );
    state.capture.perItem.set(item.id, {
      kind: "seed",
      via: "seedGemmaCandidate",
      knowledgeId: null,
      candidateId,
    });
    return;
  }

  // ── suggest → real door → judge (the scored-verdict path: A/B-second/C/D/E- ──
  // ── second/F-successor/G-second/H-member/I/K? — all NON-door 'suggest').    ──
  const refs = resolveTradeAnchors(item, state.capture.tradeAnchors);
  const params = mapToSuggestParams(item, refs, eventTimeISO);
  const doorRes = await handleLongMemorySuggest(params, makeContext(state.sessionId));
  const doorData = (doorRes.data ?? {}) as { candidateId?: string; duplicate?: boolean };
  const candidateId = typeof doorData.candidateId === "string" ? doorData.candidateId : null;

  if (doorRes.success !== true || candidateId === null) {
    // A NON-door-class 'suggest' item that the door nonetheless rejected (e.g. an
    // unexpected redaction) — record the door result so the run never loses the
    // item; it does NOT proceed to the judge.
    state.capture.perItem.set(item.id, {
      kind: "door_reject",
      success: doorRes.success === true,
      steering: doorRes.success === true ? null : doorRes.output,
      candidateId,
    });
    return;
  }

  // Backdate the freshly-inserted candidate to the item's sim-day before driving.
  await backdateCandidate(
    candidateId,
    {
      recordedAt: item.simDay,
      eventTime: item.simDay,
      observedAt: item.simDay,
    },
    simNowDay,
    wallNow,
  );

  const workerId = `e2e-w${state.workerSeq++}`;
  const captured = await driveConsolidateCapturingJudge(candidateId, workerId);
  const drive = captured.drive;
  // `previousKnowledgeId` only exists on the supersede variant of the discriminated
  // DecisionPlan — narrow before reading it.
  const supersedesKnowledgeId =
    drive && drive.plan.type === "supersede" ? drive.plan.previousKnowledgeId : null;
  state.capture.perItem.set(item.id, {
    kind: "judge",
    candidateId,
    reached: captured.reached,
    verdictValid: captured.verdictValid,
    invalidReason: captured.invalidReason,
    decisionType: drive?.decisionType ?? null,
    supersedesKnowledgeId,
    outcomeSignal: drive?.outcome?.lessonSignal ?? null,
    hasGraphPlan: drive?.graphPlan != null,
    latencyMs: captured.latencyMs,
  });

  // If the judge promoted a NEW active entry, track it for decay re-projection.
  if (drive?.promotedKnowledgeId != null) {
    state.activeEntries.set(drive.promotedKnowledgeId, { promotedSimDay: item.simDay });
  }
}

/**
 * Make a directly-seeded K entry a genuine reconcile WAKE TARGET. Seeds a Gemma
 * candidate anchored on the K winner's SELL execution + instrumentKey, stores a
 * POSITIVE outcome (the recorded win the later loss will flip against,
 * `outcome_version` 0 to match the entry), and links it as a `promoted` candidate
 * to the entry. Uses only existing repos (the reconcile-s7.int.test.ts shape) — no
 * production change, no new fixture. After this, the closing trade's instrumentKey
 * wake matches THIS candidate → THIS entry, so the reconcile drive claims the right
 * reconcile job.
 */
async function linkPromotedCandidateForReconcile(
  state: RunnerState,
  item: MemoryItem,
  entryId: number,
): Promise<void> {
  const tradeId = item.intent.anchorTradeId;
  if (!tradeId) throw new Error(`linkPromotedCandidateForReconcile: ${item.id} has no anchorTradeId`);
  const seeded = state.capture.tradeAnchors.get(tradeId);
  if (!seeded) throw new Error(`linkPromotedCandidateForReconcile: ${item.id} winner ${tradeId} not seeded`);

  // A pending candidate anchored on the SELL execution + the instrumentKey, so the
  // wake's instrumentKey probe finds it once it is marked promoted.
  const { candidateId } = await seedGemmaCandidate({
    sessionId: state.sessionId,
    kind: item.kind,
    title: item.suggest.title,
    summary: item.suggest.summary,
    evidenceRefs: [
      { executionId: seeded.sellExecutionId, instrumentKey: seeded.instrumentKey },
      { executionId: seeded.buyExecutionId, instrumentKey: seeded.instrumentKey },
    ],
    importance: item.suggest.importance ?? 7,
    eventTime: new Date(),
  });

  // Store the POSITIVE old outcome (the recorded win) the negative re-resolve flips.
  const positiveOutcome = memoryOutcomeSummarySchema.parse({
    status: "closed",
    lessonSignal: "positive",
    evidenceQuality: "strong",
    pointInTimeChecked: true,
    outcomeComputedBy: "memory_manager",
    pnlSource: "pnl_matches",
    outcomeVersion: 0,
  });
  const outRes = await updateCandidateOutcome(candidateId, positiveOutcome, new Date());
  if (!outRes.ok) {
    throw new Error(`linkPromotedCandidateForReconcile: ${item.id} updateCandidateOutcome failed`);
  }

  // Link the candidate → the active entry as the wake-target shape.
  const statusRes = await updateCandidateStatus(candidateId, "promoted", {
    expectedFromStatus: "pending",
    promotedKnowledgeId: entryId,
  });
  if (!statusRes.ok) {
    throw new Error(`linkPromotedCandidateForReconcile: ${item.id} updateCandidateStatus failed`);
  }
}

/**
 * Fire the closing trade a K item references and drive the reconcile for its
 * promoted entry. Captures the terminal status (F31-aware — never throws on a
 * judge failure). Stored under the SAME corpus item id as a `reconcile` result
 * (overwriting the transient `seed` capture, since the reconcile is what the
 * oracle scores for a K item).
 */
async function runReconcileForItem(
  state: RunnerState,
  item: MemoryItem,
  entryId: number,
): Promise<void> {
  const closingId = item.intent.reconcileClosesTradeId;
  if (!closingId) return;
  const closing = WORLD_CORPUS.trades.find((t) => t.id === closingId);
  if (!closing) throw new Error(`runReconcileForItem: ${item.id} closing trade ${closingId} not found`);

  // The closing sell carries the SAME instrumentKey → enqueueLedgerWake fires.
  await seedFaithfulClosingTradeForWake({
    sessionId: state.sessionId,
    instrumentKey: closing.instrumentKey,
    walletAddress: closing.walletAddress,
    sellValueUsd: closing.sellValueUsd,
    sellQtyRaw: closing.sellQtyRaw,
  });

  // Verify a reconcile job was enqueued for this entry before draining it.
  const enqueued = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM memory_jobs
       WHERE job_kind = 'reconcile' AND reconcile_entry_id = $1`,
    [entryId],
  );
  if (Number(enqueued[0]!.n) === 0) {
    // No wake matched — record it as a reconcile capture with a sentinel status so
    // the scorer sees the (mis)behavior rather than the run crashing.
    state.capture.perItem.set(item.id, {
      kind: "reconcile",
      terminalStatus: "not_enqueued",
      lastError: null,
      decisionType: null,
    });
    return;
  }

  // The reconcile job is the OLDEST due job ONLY if no stale pending consolidate
  // jobs precede it. Each judge-path drive enqueues a fresh consolidate job and
  // claims the oldest, so empty consolidate jobs can pile up created BEFORE this
  // reconcile job. `claimNextDueJob` is FIFO by created_at, so drain those empty
  // consolidate jobs (claim → markCompleted no-op, exactly what the executor does
  // for an empty queue) until the reconcile job for THIS entry is the one claimed.
  const workerId = `e2e-recon-w${state.workerSeq++}`;
  await processReconcileForEntry(state, item, entryId, workerId);
}

/**
 * Claim due jobs FIFO, draining any stale (empty) consolidate jobs as no-op
 * completions, until the reconcile job for `entryId` is claimed; then process it
 * with `processReconcileJob` (self-finalizing, never throws — F31 lands as a
 * failed/perm-failed status with a bounded last_error) and capture the terminal
 * state. Bounded by a claim budget so a harness bug can never spin forever.
 */
async function processReconcileForEntry(
  state: RunnerState,
  item: MemoryItem,
  entryId: number,
  workerId: string,
): Promise<void> {
  const MAX_CLAIMS = 64;
  for (let i = 0; i < MAX_CLAIMS; i++) {
    const job = await claimNextDueJob(workerId);
    if (!job) {
      // No due job at all — the reconcile job was not claimable (a harness bug).
      state.capture.perItem.set(item.id, {
        kind: "reconcile",
        terminalStatus: "no_due_job",
        lastError: null,
        decisionType: null,
      });
      return;
    }
    if (job.jobKind === "consolidate") {
      // A stale, empty consolidate job (its candidates are already terminal) —
      // finalize it as a no-op completion and keep draining.
      await markCompleted(job.id, workerId);
      continue;
    }
    if (job.jobKind !== "reconcile" || job.reconcileEntryId !== entryId) {
      // A reconcile job for a DIFFERENT entry would be a cross-item wake collision
      // (not expected in the subset). Record it rather than crash the run.
      state.capture.perItem.set(item.id, {
        kind: "reconcile",
        terminalStatus: `wrong_target:${job.jobKind}:${job.reconcileEntryId ?? "null"}`,
        lastError: null,
        decisionType: null,
      });
      return;
    }

    // The reconcile job for THIS entry — process it (self-finalizing, never throws).
    await processReconcileJob(job, workerId, defaultReconcileDeps());
    const after = await getJobById(job.id);
    const status = after?.status ?? "unknown";
    const decisionRows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memory_decisions
         WHERE decision_type = 'reconcile' AND reconcile_entry_id = $1`,
      [entryId],
    );
    const decisionType: "reconcile" | null = Number(decisionRows[0]!.n) > 0 ? "reconcile" : null;
    state.capture.perItem.set(item.id, {
      kind: "reconcile",
      terminalStatus: status,
      lastError: after?.lastError ?? null,
      decisionType,
    });
    return;
  }
  // Exhausted the claim budget without reaching the reconcile job.
  state.capture.perItem.set(item.id, {
    kind: "reconcile",
    terminalStatus: "drain_budget_exhausted",
    lastError: null,
    decisionType: null,
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  THE STREAM LOOP
// ════════════════════════════════════════════════════════════════════════════

export interface RunStreamArgs {
  readonly sessionId: string;
  readonly memories: readonly MemoryItem[];
  readonly trades: readonly TradeEvent[];
  readonly regimes: readonly RegimeEvent[];
}

/**
 * Run the merged event stream ONE ITEM AT A TIME over simulated time, advancing
 * the clock at each new sim-day checkpoint BEFORE processing that day's events.
 * Returns the populated `RunCapture` for the S5 scorer. Never throws on a judge
 * failure (F31) — those land in the per-item capture as invalid/failed.
 */
export async function runStream(args: RunStreamArgs): Promise<RunCapture> {
  const capture: RunCapture = {
    perItem: new Map(),
    tradeAnchors: new Map(),
    regimeSnapshotIds: new Map(),
    processedItemIds: [],
    finalSnapshot: null,
  };
  const state: RunnerState = {
    sessionId: args.sessionId,
    capture,
    activeEntries: new Map(),
    workerSeq: 1,
  };

  const events = buildEventStream(args.memories, args.trades, args.regimes);

  let simNowDay = events.length > 0 ? events[0]!.simDay : 0;
  for (const event of events) {
    // Checkpoint boundary: advance the clock for the elapsed days FIRST.
    if (event.simDay > simNowDay) {
      await advanceClock(state, simNowDay, event.simDay);
      simNowDay = event.simDay;
    }

    switch (event.kind) {
      case "trade":
        await runTradeEvent(state, event.trade);
        break;
      case "regime":
        await runRegimeEvent(state, event.regime, simNowDay);
        break;
      case "memory":
        await runMemoryItem(state, event.item, simNowDay);
        capture.processedItemIds.push(event.item.id);
        break;
      default: {
        const _exhaustive: never = event;
        throw new Error(`runStream: unhandled event ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  return capture;
}
