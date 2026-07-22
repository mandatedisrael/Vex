/**
 * Judge-decision benchmark — CORPUS (Wave 0 scaffold). TEST-ONLY pure data.
 *
 * SEPARATE from the 130-item `_world-corpus.ts` correctness eval. That corpus
 * deliberately routes many items AWAY from the judge (door-rejects, seeded-
 * direct, reconcile-only, D7-blocked); only 48/130 reach `callJudge`. THIS
 * benchmark inverts the design: every item is engineered to survive D1–D11 and
 * reach the LIVE judge, so the metric denominator is the JUDGE ITSELF — a
 * decision-quality benchmark, not a pipeline-routing benchmark.
 *
 * ── OPAQUE IDS (structural non-circularity; design §99) ──────────────────────
 * Ids are OPAQUE sequential codes `M001`, `M002`, … — they encode NO cluster,
 * verdict, or kind semantics, and neither do any comments visible alongside the
 * agent-facing text. The companion oracle (`_judge-oracle.ts`) and its Wave-2
 * authoring agents receive only `{ id, kind, agent-facing text, evidence-
 * shape }` — never the corpus author's intent NOR the `stratum` (which correlates
 * with the expected verdict; it was removed from `judgeItemFacing()` to close that
 * circularity leak) — so corpus and oracle are authored by DISJOINT minds and a
 * disagreement is a REAL signal.
 *
 * ── ESCALATION RECIPE (design §1; every item MUST escalate) ──────────────────
 *   seedGemmaCandidate (bypass door) + clean text (no live secrets/state) +
 *   ≥1 live execution anchor + (generalization kinds) ≥2 OWN distinct executionId
 *   anchors (clears D7 recurrence) + unique content_hash + cosine managed +
 *   importance ≥3 + confidence ≥0.30 + future/NULL TTL ⇒ escalate → live judge.
 * The build-time escalation gate (`judge-benchmark.int.test.ts`) runs the REAL
 * `runDeterministicStage` over REAL Gemma embeddings and FAILS THE BUILD if any
 * item terminates deterministically (D5/D6/D7/D8/…), naming the gate + constant.
 *
 * ── CORPUS ASSEMBLY ──────────────────────────────────────────────────────────
 * The full 134-item matrix is authored by FIVE disjoint cluster authors, each in
 * its own `_judge-corpus-{a..e}.ts` file exporting `CLUSTER_{A..E}`. This module
 * imports and concatenates them (append-only by opaque id range) into the single
 * `JUDGE_CORPUS`. The Wave-0 stub items are gone; this file now owns only the
 * shared types, the oracle-safe accessor, the id list, and the module-load
 * shape asserts. The cluster files contribute item CONTENT only.
 *
 * Pure module: typed const data + a module-load coverage assert. No DB, no
 * embeddings, no I/O, no `as any`, no policy imports.
 */

import type {
  CorpusSuggest,
  CorpusEvidenceRef,
} from "./_world-corpus.js";
import { CLUSTER_A } from "./_judge-corpus-a.js";
import { CLUSTER_B } from "./_judge-corpus-b.js";
import { CLUSTER_C } from "./_judge-corpus-c.js";
import { CLUSTER_D } from "./_judge-corpus-d.js";
import { CLUSTER_E } from "./_judge-corpus-e.js";

/**
 * Repetition stratum (design §ADVERSARIAL Q3). Drives the per-item run count:
 * clean/easy items run ONCE (N=1); trap/supersede/gray items run N=3 with
 * modal-verdict aggregation + a `verdict_instability` capture, because live-LLM
 * jitter is highest exactly where the safety-critical decisions live. The runner
 * reads the stratum FROM THIS FIELD (never from the id), so the id stays opaque.
 */
export type BenchStratum = "clean" | "trap" | "supersede" | "gray";

/** N (run count) per stratum — the stratified repetition protocol. */
export const STRATUM_REPEAT: Readonly<Record<BenchStratum, number>> = {
  clean: 1,
  trap: 3,
  supersede: 3,
  gray: 3,
};

/**
 * How an item reaches the judge. The benchmark is 100% `seedGemmaCandidate`
 * (door bypassed) for the SCORED corpus so the judge is isolated; a small
 * gate-only real-`suggest` smoke (no judge call) lives in the test shell as an
 * external-validity probe. `seedPredecessorDirect` pre-plants an ACTIVE entry
 * the item is meant to supersede (never itself a scored item).
 */
export type BenchEntryVia = "seedGemmaCandidate" | "seedPredecessorDirect";

/**
 * One benchmark corpus item. Reuses `CorpusSuggest`/`CorpusEvidenceRef` from the
 * world corpus (the same agent-facing shape that validates against the candidate
 * suggest schema). `predecessor`, when present, is the ACTIVE entry seeded BEFORE
 * this item so a supersede/conflict probe has something to point at — authored
 * here as raw text, NOT as a cross-id reference, so the oracle never reads it.
 */
export interface JudgeCorpusItem {
  /** Opaque sequential id (`M001`…). NO semantics. */
  readonly id: string;
  /** Free-form snake_case ASCII kind (validates via the candidate schema). */
  readonly kind: string;
  /** Always a real-Gemma candidate for the scored set (door bypassed). */
  readonly entryVia: BenchEntryVia;
  /** Repetition stratum — drives N and modal aggregation (read by the runner). */
  readonly stratum: BenchStratum;
  /** The agent-facing payload (title/summary/contentMd/importance/confidence/refs). */
  readonly suggest: CorpusSuggest;
  /**
   * Number of DISTINCT synthetic execution anchors to seed for this item and bind
   * into its OWN evidence_refs (clears D7 recurrence for generalization kinds).
   * The runner seeds this many `protocol_executions` rows in a live session and
   * sets evidence_refs to all of them. Generalization kinds REQUIRE ≥2.
   */
  readonly ownAnchorCount: number;
  /**
   * Optional ACTIVE predecessor to seed BEFORE this item (supersede/conflict
   * probe). Raw text only — the oracle never sees it; it reasons from the item
   * text alone. The numeric difference is what the deterministic conflict flag
   * (D6) keys off (same kind, cosine ≥ CONFLICT_COSINE, differs on a number).
   */
  readonly predecessor?: {
    readonly kind: string;
    readonly title: string;
    readonly summary: string;
  };
}

/** The whole benchmark corpus — pure, version-controlled. */
export interface JudgeCorpus {
  readonly items: readonly JudgeCorpusItem[];
}

// ════════════════════════════════════════════════════════════════════════════
//  ASSEMBLED CORPUS — five disjoint clusters concatenated by opaque id range.
//    CLUSTER_A  M001–M026  (26)   CLUSTER_B  M027–M054  (28)
//    CLUSTER_C  M055–M078  (24)   CLUSTER_D  M079–M114  (36)
//    CLUSTER_E  M115–M134  (20)                          total 134
//  Order is id-ascending and append-only; the module-load asserts below verify
//  opaque-id form, uniqueness, and the per-item escalation floors.
// ════════════════════════════════════════════════════════════════════════════

const ALL_ITEMS: readonly JudgeCorpusItem[] = [
  ...CLUSTER_A,
  ...CLUSTER_B,
  ...CLUSTER_C,
  ...CLUSTER_D,
  ...CLUSTER_E,
];

/** The benchmark corpus — the concatenation of the five authored clusters. */
export const JUDGE_CORPUS: JudgeCorpus = {
  items: ALL_ITEMS,
};

/** Every corpus id, in order (the oracle's coverage source-of-truth). */
export const JUDGE_CORPUS_IDS: readonly string[] = JUDGE_CORPUS.items.map((i) => i.id);

/**
 * The agent-facing text accessor the oracle (and only it) imports. Returns ONLY
 * what an oracle author may see: the kind + suggest payload + evidence shape —
 * NEVER the corpus author's intent, predecessor text, the `stratum` (which
 * CORRELATES with the expected verdict and would be a circularity leak), or any
 * other verdict hint. This is the non-circularity firewall in code form. The
 * runner reads `item.stratum` DIRECTLY off the corpus item for the N-run count;
 * the oracle-facing accessor must never expose it.
 */
export interface JudgeItemFacing {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly summary: string;
  readonly contentMd: string | null;
  readonly importance: number | null;
  readonly confidence: number | null;
  /** Count of own evidence anchors (shape only — no execution ids). */
  readonly ownAnchorCount: number;
}

/** Resolve the agent-facing view of one item (oracle-safe; no intent leak). */
export function judgeItemFacing(item: JudgeCorpusItem): JudgeItemFacing {
  return {
    id: item.id,
    kind: item.kind,
    title: item.suggest.title,
    summary: item.suggest.summary,
    contentMd: item.suggest.contentMd ?? null,
    importance: item.suggest.importance ?? null,
    confidence: item.suggest.confidence ?? null,
    ownAnchorCount: item.ownAnchorCount,
  };
}

// ── Module-load coverage / shape asserts (fail fast on an authoring slip) ──

/** Distinct opaque ids — no duplicates, sequential `M\d{3}` form. */
function assertCorpusShape(): void {
  const seen = new Set<string>();
  for (const item of JUDGE_CORPUS.items) {
    if (!/^M\d{3}$/.test(item.id)) {
      throw new Error(`_judge-corpus: id "${item.id}" is not opaque sequential (M\\d{3})`);
    }
    if (seen.has(item.id)) {
      throw new Error(`_judge-corpus: duplicate id "${item.id}"`);
    }
    seen.add(item.id);

    // Generalization-kind items MUST carry ≥2 own anchors (clears D7 recurrence).
    if (isGeneralizationKindLocal(item.kind) && item.ownAnchorCount < 2) {
      throw new Error(
        `_judge-corpus: ${item.id} is a generalization kind "${item.kind}" but ownAnchorCount=${item.ownAnchorCount} (<2) — would terminate at D7`,
      );
    }
    // Importance/confidence floors (clears D8/D9) — sanity, not a policy import.
    const imp = item.suggest.importance ?? 0;
    if (imp < 3) {
      throw new Error(`_judge-corpus: ${item.id} importance=${imp} (<3) — risks D8 mundane terminal`);
    }
    const conf = item.suggest.confidence ?? 1;
    if (conf < 0.3) {
      throw new Error(`_judge-corpus: ${item.id} confidence=${conf} (<0.30) — risks D9 low-confidence terminal`);
    }
  }
}

/**
 * LOCAL generalization-kind list — HAND-RE-TYPED, NOT imported from
 * `kind-families.ts` (the corpus must not couple to the policy that gates D7).
 * Mirrors the generalization family (strategy/risk/lesson/pattern/heuristic).
 * Used ONLY for the authoring sanity assert above.
 */
function isGeneralizationKindLocal(kind: string): boolean {
  return /strategy|risk|lesson|pattern|heuristic/.test(kind);
}

assertCorpusShape();
