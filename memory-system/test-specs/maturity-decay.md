## domain
Maturity FSM + Decay + Reinforcement + Regime (S6a/S6b) — memory/manager/maturity.ts, maturity-policy.ts, engine/memory-manager/decay-sweep.ts, engine/regime/{regime-worker,policy}.ts, db/repos/knowledge-maturity-events/*, db/repos/knowledge/crud.ts (FSM transition), db/repos/regime-snapshots.ts, reinforcement seam in memory/manager/consolidate.ts

## correctnessProperties
Each phrased as a testable claim with file:line evidence of where it is ENFORCED (so a test can target the enforcement site):

P1 — DECAY NEVER DELETES, NEVER below floor. `decayedActivation` returns `Math.max(DECAY_FLOOR, current * 0.5^(days/halfLife))` (maturity-policy.ts:227-228, DECAY_FLOOR=0.03 :68); `decayEntry` floors UP-FRONT and Math.max-repairs sub-floor rows (maturity.ts:293-296). No DELETE statement exists in the maturity path; `applyMaturityTransition` is UPDATE-only (crud.ts:275-290).

P2 — GUARDED COMPARE-AND-SWAP / no lost update. `applyMaturityTransition` UPDATE is gated `WHERE id=$3 AND status='active' AND maturity_state=$4 AND activation_strength=$5` and returns `count===1` (crud.ts:280-291). A concurrent transition that already moved the row → 0 rows updated → false → caller returns `precondition_miss` WITHOUT an audit write (maturity.ts:140, :249, :321).

P3 — EXACTLY ONE append-only audit row per real transition; ZERO on a no-op. `recordMaturityEvent` is a plain INSERT, only write path (knowledge-maturity-events/crud.ts:40-87). reinforce records once after a successful apply (maturity.ts:142-156); decay records once after apply (maturity.ts:334-347); reactivation records once (maturity.ts:251-264). A `not_found`/`precondition_miss`/`below_delta` path records nothing (maturity.ts:121,140,249,306,321).

P4 — REINFORCEMENT ONLY ON RECURRENCE AT CONSOLIDATION, NEVER ON RECALL (anti popularity-bias). The only caller of `reinforceEntry` is `applyReinforcement` inside `applyDecisionAtomically`, gated `if (reinforce && args.plan.type === "reject")` for a `duplicate` reject (consolidate.ts:702-704, :719-734); `reinforcementTargetFor` returns null unless verdict is reject+duplicate (consolidate.ts:574). No recall/read path imports `reinforceEntry`. `last_reinforced_at` is bumped ONLY on reinforce/reactivation (`bumpLastReinforcedAt:true` at maturity.ts:135, :244), NEVER on decay (`false` at :316) or recall.

P5 — INCREMENTAL DECAY ANCHOR / idempotent re-sweep, no compounding. Anchor = `laterOf(lastReinforcedAt ?? firstPromotedAt, lastDecayedAt)` (maturity.ts:285); an applied decay stamps `last_decayed_at=NOW()` (`bumpLastDecayedAt:true` :317, crud.ts:272). An immediate re-run sees Δt≈0 → factor≈1 → `lowered < DECAY_AUDIT_MIN_DELTA` → `below_delta` no-op (maturity.ts:304-307). Exponential composition `0.5^(a/h)·0.5^(b/h)=0.5^((a+b)/h)` makes per-interval quanta sum to the same curve.

P6 — FSM EDGES. probationary→established→reinforced (cap), decayed→established reactivation (nextStateOnReinforce maturity-policy.ts:266-281); any non-decayed tier → decayed once activation ≤ DECAY_TO_DECAYED_THRESHOLD=0.2 (nextStateOnDecay :237-244); decayed stays decayed under decay (:241).

P7 — REGIME HALF-LIFE: match 60d / mismatch 15d / neutral 30d, within hard bounds. `regimeHalfLifeDays` (maturity-policy.ts:445-458) = 30×{2.0 match, 0.5 mismatch, 1 neutral}; import-time asserts factors ∈ mismatch[0.25,1] match[1,4] (:174-189). Only `regime_aware` policy under non-null regime gets a non-neutral kind (maturity.ts:221-224).

P8 — DWELL F3 fail-closed. `effectiveRegime` returns null on <2 snapshots, newest stale >3d, pair gap >48h, unparseable ts (maturity-policy.ts:367-383). Per axis: agree→value, disagree→'unknown' (:386-393). confidence=min(pair) (:394, minRegimeConfidence). `low` effective confidence → ALWAYS neutral matchKind (:420).

P9 — REACTIVATION ONLY match+HIGH+decayed, checked BEFORE below_delta skip. `decayEntry` reactivation branch requires `maturityState==='decayed' && matchKind==='match' && regime!==null && regime.confidence==='high'` (maturity.ts:236), ordered before the below_delta skip so a floor-sitting decayed row resurrects (:228-273). Bumps `last_reinforced_at` (restart decay clock), writes `reactivated`/`regime_decay`/`{regimeSnapshotId}` (:251-264).

P10 — AUDIT REASON/REFS CORRECTNESS. regime-driven step (match OR mismatch) → reason `regime_decay` + `{regimeSnapshotId}`; neutral → `time_decay` + `{}` (maturity.ts:328-332). reinforce → `recurrence_confirmation` + `{candidateId}` (maturity.ts:148-150). trigger_refs is `.strict()` pointer-only (knowledge-maturity-event.ts:82-91). entry_id is a non-FK anchor (types.ts:6-8, DDL: no FK on knowledge_maturity_events).

P11 — RERANK FACTOR bounded [0.88,1.0], proven §7 bound. `activationFactor(a)=0.88+(1−0.88)·a` (maturity-policy.ts:306-309); import assert ACTIVATION_MIN_FACTOR ≥ 0.857 (:165-169). Decay never drops activation below DECAY_FLOOR so factor never < 0.88+0.12·(0.03)≈0.8836.

P12 — REGIME WORKER fail-closed F4 cap. <2 usable sources caps confidence at medium via `minRegimeConfidence(verdict.confidence,'medium')` (regime-worker.ts:326-330); no heuristic fallback (throw on malformed/timeout :306-323); cadence gate 20h (:223-228); source string hybrid/tavily/twitter (:331-332). Snapshot is the ONLY thing the worker writes and feeds ONLY decay (OD-1 advisory-only).

P13 — `none` decay policy is FROZEN. `listDecayableEntries` excludes `decay_policy='none'` (crud.ts:336); `decayEntry` defensively no-ops on `none` (maturity.ts:212-214); `decayedActivation` returns current unchanged for `none` (maturity-policy.ts:223).

## scenarios
## A. DETERMINISTIC INTEGRATION — extend src/__tests__/integration/repos/knowledge-maturity-events.int.test.ts (real pgvector, raw-SQL seed of `first_promoted_at`/`last_reinforced_at`/`last_decayed_at`, `decayEntry(entry, fixedNow, regime)` with INJECTED now). These are HARD GATES.

### A1 — Guarded CAS: concurrent transition is a precondition miss (no lost update, no audit)
SEED: one `established`/activation=0.5/`regime_aware` entry id=E (existing `seedEntry`).
ACTION: read `getMaturityEntry(E)` → entry. Then OUT-OF-BAND mutate the live row: `UPDATE knowledge_entries SET activation_strength=0.7, maturity_state='reinforced' WHERE id=E` (simulates a concurrent reinforce committing between read and apply). Now call `reinforceEntry(E, {candidateId}, tx, deps)` using the STALE entry snapshot (force the stale read by calling `applyMaturityTransition` with `expectedActivation=0.5`).
EXPECTED: precondition miss.
ASSERT: result `{ok:true, applied:false, reason:"precondition_miss"}`; `getMaturityEventsForEntry(E)` length === 0 (NO phantom audit); the row still reads 0.7/reinforced (the concurrent write survived, not overwritten by 0.5).

### A2 — Incremental anchor idempotency: a real applied decay then an immediate re-sweep is a DB-level no-op (regression for the compounding bug)
SEED: `established`/0.8/`regime_aware`, `last_reinforced_at` = now−30d, `last_decayed_at`=NULL, `first_promoted_at`=now−30d.
ACTION: `decayEntry(getMaturityEntry(E), NOW, null)` → applied (0.8→~0.4), stamps `last_decayed_at`. Re-read `getMaturityEntry(E)` and `decayEntry(...)` again at the SAME NOW.
ASSERT: first call applied=true, activationAfter≈0.4, DB `last_decayed_at` is set (not null); second call `{applied:false, reason:"below_delta"}`; DB activation UNCHANGED at ~0.4 (NOT 0.2 — compounding regression). `getMaturityEventsForEntry(E)` length === 1 (only the first decay audited). This is the bit the fixed-bug commit must keep green.

### A3 — Incremental anchor across two genuine intervals sums to one curve (no double-erosion)
SEED: `established`/0.8, `last_reinforced_at`=now−60d, `last_decayed_at`=now−30d (a prior applied step already eroded 0.8→~0.4 over the first 30d, stored as 0.4).  Set activation=0.4 to model post-first-step state.
ACTION: `decayEntry(.., NOW, null)`.
ASSERT: only the 30d quantum since the ANCHOR (last_decayed_at) erodes: 0.4×0.5^(30/30)=0.2; activationAfter≈0.2 (NOT 0.8×0.5^2=0.2 by coincidence — to disambiguate use last_reinforced_at=now−90d so anchor-on-reinforce would give 0.4×0.5^3=0.05 while correct incremental gives 0.2). Assert ≈0.2.

### A4 — Floor self-repair on an imported sub-floor row
SEED raw SQL: activation=0.01 (BELOW DECAY_FLOOR 0.03 — but note ke_activation_strength_range allows ≥0, so 0.01 is legal), `established`, `regime_aware`, `last_reinforced_at`=now−1d.
ACTION: `decayEntry(.., NOW, null)`.
ASSERT: `lowered = 0.01 − 0.03 = −0.02 < 0`, so NOT skipped (the `lowered >= 0` skip guard, maturity.ts:305); applied=true; DB activation === DECAY_FLOOR (0.03), i.e. repaired UP. One audit row, reason time_decay, activationBefore=0.01 activationAfter=0.03.

### A5 — Tier-change is always persisted even when Δactivation is sub-threshold
SEED: activation = 0.205 (just above threshold 0.2), `established`, `last_reinforced_at`=now−2d, base half-life → tiny erosion to ~0.195 (Δ≈0.01, sub-DECAY_AUDIT_MIN_DELTA) but crosses 0.2.
ACTION: `decayEntry`.
ASSERT: even though |Δ|<0.01, tierChanged=true so NOT skipped (maturity.ts:305 `!tierChanged` guard); DB maturity_state='decayed'; exactly one audit row event='decayed'. (Tune the seed activation/age so Δ truly < 0.01 while crossing — pick activation=0.2009, age small.)

### A6 — Regime-driven mismatch decay + reactivation, real DB, deterministic now
SEED: two regime_snapshots via RAW SQL with explicit `created_at` (the repo cannot set created_at): latest `bull/high/high` at now−4h, previous `bull/high/high` at now−28h (gap 24h ≤48h, fresh ≤3d). Build `effectiveRegime(getLatestTwoRegimeSnapshots(), NOW)` → non-null bull/high/high snapshotId=latest.
SEED entry-A: `established`/0.8/`regime_aware`/tags=['bear'] (mismatch), `last_reinforced_at`=now−15d.
SEED entry-B: `decayed`/0.03/`regime_aware`/tags=['bull'] (match), `last_reinforced_at`=now−400d.
ACTION: `decayEntry(A, NOW, regime)` and `decayEntry(B, NOW, regime)`.
ASSERT A: 15d on 15d mismatch half-life → 0.8×0.5=0.4; DB activation≈0.4; audit reason='regime_decay' triggerRefs={regimeSnapshotId: latest.id}. ASSERT B: reactivated; DB maturity_state='established', activation===0.6 (REACTIVATION_ACTIVATION); `last_reinforced_at` bumped to ~NOW; audit event='reactivated'/reason='regime_decay'/{regimeSnapshotId}. Length-1 history each.

### A7 — DB CHECK rejects out-of-enum audit (boundary defense-in-depth)
ACTION: call `recordMaturityEvent({...event:"matured", reasonCode:"recurrence_confirmation", fromState:"established", toState:"established"...})` — valid; then attempt a raw INSERT into knowledge_maturity_events with `reason_code='invented_reason'`.
ASSERT: the Zod boundary throws on a bad enum via `recordMaturityEvent` (programmer-error path), AND the raw INSERT violates `kme_reason_code_valid`. (Pins the lockstep contract beyond the existing enum drift test.)

## B. DETERMINISTIC INTEGRATION — NEW FILE src/__tests__/integration/memory/decay-sweep.int.test.ts (real DB, default deps with injected `getEffectiveRegime`, seed N entries, run `runDecaySweep(NOW)`). The unit decay-sweep.test.ts stubs everything; these wire the REAL `listDecayableEntries` + REAL `decayEntry`.

### B1 — End-to-end sweep decays a real population, skips `none`, audits each applied
SEED: 5 `regime_aware` entries (ages now−30d..now−5d) + 1 `none` entry + 1 already-`decayed` floor entry. Inject `getEffectiveRegime: async()=>null`.
ACTION: `runDecaySweep(NOW, depsWithRealListAndDecay)`.
ASSERT: scanned === 6 (the `none` excluded by `listDecayableEntries`); decayed counts only rows whose Δ≥delta or tier moved; the floor/decayed entry is a `below_delta` no-op (not in decayed count); each applied entry has exactly one new knowledge_maturity_events row; the `none` entry's activation unchanged in DB.

### B2 — CHARACTERIZATION of the F4 starvation bug (decay-sweep.ts:94 `afterId=0`, crud.ts:338 `ORDER BY id ASC`, cap 2000)
NOTE: F4 is STILL PRESENT in as-built code (verified: no cursor persistence, id-ASC ordering, cap 2000). This is a characterization test that asserts the CURRENT (wrong) behavior + records the finding, paired with a SKIPPED target test.
SEED: lower the cap surface for a fast test — seed `DECAY_SWEEP_MAX_ENTRIES`-sensitive population is infeasible at 2000 rows in CI; instead test the PRIMITIVE: assert `listDecayableEntries` orders by id ASC and `runDecaySweep` starts at afterId=0 each run by seeding 3 decayable rows ids low→high all aged, then constructing a deps wrapper that records the `afterId` of every `listDecayableEntries` call across TWO sequential `runDecaySweep` runs.
EXPECTED (characterization, current behavior): both runs' first page call has `afterId===0` (cursor NOT persisted); the lowest-id rows are re-scanned every run.
ASSERT: `firstAfterIdRun1 === 0 && firstAfterIdRun2 === 0`; record `reportCard.recordFinding({code:"F4", manifested:true, summary:"decay sweep resets afterId=0 each run + id-ASC + cap 2000 → tail beyond cap starves"})`. PLUS a `it.skip` TARGET test documenting the fix contract: after the fix, either (a) the cursor persists across runs (run2 afterId > 0 until exhaustion) OR (b) `listDecayableEntries` orders `last_decayed_at ASC NULLS FIRST` so the stalest rows are always in the first page — assert that the row with the OLDEST `last_decayed_at` appears in page 1 regardless of its id. This skipped test is the executable spec the fix must flip to green.

### B3 — Sweep idempotency at the population level (no compounding across two runs same-day)
SEED: 4 `regime_aware` entries aged now−30d.
ACTION: `runDecaySweep(NOW)` then immediately `runDecaySweep(NOW)` again (same NOW).
ASSERT: run1 decayed===4; run2 decayed===0 (every row is now a below_delta no-op via the incremental anchor); each entry has exactly ONE decay audit row total (run2 wrote none). This is the population-level regression for the compounding bug.

## C. DETERMINISTIC INTEGRATION — extend memory-manager-reinforce.int.test.ts (anti popularity-bias + lifecycle).

### C1 — Recall does NOT reinforce (anti popularity-bias)
SEED: one `established`/0.6 active entry. ACTION: call `recallLongMemoryTopK` (or `handleLongMemorySearch`) targeting it MANY times.
ASSERT: DB activation_strength UNCHANGED (still 0.6); `last_reinforced_at` UNCHANGED; `getMaturityEventsForEntry` length === 0. (Pins that no recall path touches the FSM — the seam is consolidation-only.)

### C2 — A duplicate that confirms a SUPERSEDED/archived entry is a benign no-op (not a phantom reinforce)
SEED: an entry with content_hash H but `status='superseded'` (NOT active), plus an active entry with a different hash. Drive a candidate whose content_hash=H through the reinforce seam (D4 path → `findActiveByContentHash(H)` returns null).
ASSERT: `applyReinforcement` returns without calling reinforceEntry (consolidate.ts:732); the superseded row is untouched (no activation bump, no audit); the candidate is still recorded as a duplicate reject.

### C3 — Full reinforce ladder probationary→established→reinforced→(decay)→reactivated, audit completeness
SEED: probationary/0.4 entry. ACTION sequence in separate txns: reinforce (→established, matured), reinforce (→reinforced, matured), `decayEntry` with ancient last_reinforced (→decayed, decayed/time_decay), reinforce (→established, reactivated).
ASSERT: `getMaturityEventsForEntry` history (newest-first) events === ["reactivated","decayed","matured","matured"]; reasonCodes === ["recurrence_confirmation","time_decay","recurrence_confirmation","recurrence_confirmation"]; DB final state established/0.6; activation monotonic per step matches REINFORCE_STEP / REACTIVATION_ACTIVATION.

## D. LIVE-LLM — extend the eval harness (src/__tests__/integration/eval/). MEASURED, not gated. New file maturity-regime.int.test.ts under `describe.skipIf(!hasKey)`.

### D1 — Regime worker classifies real evidence into a valid schema verdict + F4 cap (live Gemma/DeepSeek via the worker's provider)
ACTION: run `runRegimeTick` with REAL `makeProvider` but STUBBED `searchWeb`/`searchTweets` returning a faithful fixed bullish evidence block (deterministic input, live classification) and `getLatestSnapshot:()=>null`, `insertSnapshot` capturing. Run twice: once with BOTH sources used, once with only one (twitter stub returns []).
MEASURED ASSERT (record, not gate): verdict validates against `regimeVerdictSchema`; with one usable source the persisted `confidence` is capped ≤ medium (deterministic-gateable: `minRegimeConfidence` is pure, so the CAP itself is a HARD assert even though the raw verdict is live); record `reportCard.recordCheck("regime", {label:"single-source caps confidence ≤ medium", pass})`. record `recordJudgeAttempt` with reached/valid.

### D2 — End-to-end: reinforcement quality on a live-judged duplicate (extend lifecycle eval)
Use `seedPromotedLessonDirect` + `seedGemmaCandidate` of the SAME lesson; `driveConsolidateWithRealJudge`. MEASURE: the judge's verdict resolves to a duplicate reject and the seam reinforced the active entry (DB activation rose, one matured audit). Record whether the live judge correctly identified the duplicate (quality metric) vs. the deterministic D4/D5 gate firing first (which would be the deterministic path — record which fired).

## adversarial
Scenarios specific to this subsystem and what must NOT happen:

ADV1 — POPULARITY-BIAS POISONING. An attacker who can make the agent recall a lesson repeatedly (e.g. by repeating a query) must NOT be able to inflate its activation/maturity. MUST NOT: any recall path bump activation or write a maturity event. Test C1 is the guard. The ONLY reinforcement trigger is a genuine 2nd CONFIRMATION at consolidation (a new candidate that is a true content/near duplicate of an ACTIVE entry), gated by `plan.type==='reject' && reason==='duplicate'` (consolidate.ts:702, :574).

ADV2 — SCAM-TOKEN / WRONG-ENTRY REINFORCE. A duplicate candidate must reinforce ONLY the entry it genuinely confirms. MUST NOT: reinforce an arbitrary or superseded entry. `findActiveByContentHash` requires `status='active'` (crud.ts:362), so a superseded/archived row with the same hash is NOT reinforced (benign no-op, C2). The near-dup path carries the explicit `reinforcesKnowledgeId` from the judge verdict (consolidate.ts:575) — a poisoned verdict pointing at an unrelated id would reinforce it, BUT the guarded CAS still requires that row to be active and at its expected state; design an adversarial test where `reinforcesKnowledgeId` points at a non-existent/non-active id → `getMaturityEntry` returns null → `not_found` no-op (maturity.ts:121), no audit, no cross-entry contamination.

ADV3 — DECAY-AS-DELETE. A regime-mismatch storm or extreme age must NOT erase a lesson. MUST NOT: activation reach 0 or the row be deleted. Mismatch caps at 4× faster (factor floor 0.25, asserted maturity-policy.ts:175-181) and DECAY_FLOOR(0.03) is untouched by the factor (the floor is applied AFTER the exponential, maturity.ts:293-296). Tests A4/A6/B1 + the existing floor property test guard this. Adversarial extension: a malicious/corrupt regime snapshot pushing every lesson to mismatch still floors at 0.03 — assert across activation∈{0.03..1.0}, age∈{0..10000d}.

ADV4 — FAKE REGIME / SNAPSHOT FORGERY drives reactivation. A single forged HIGH-confidence snapshot must NOT resurrect decayed lessons. The dwell rule requires TWO snapshots agreeing within 48h with min-confidence (maturity-policy.ts:367-394); confidence=min(pair) so one high + one low → low → neutral → NO reactivation (reactivation needs effective high, which needs high in BOTH, maturity.ts:236). Adversarial test: seed latest=bull/high + previous=bull/low → effective confidence low → a decayed+match entry is NOT reactivated (stays decayed, below_delta no-op). Also: a stale forged snapshot (>3d) → effectiveRegime null → pure time decay, no regime influence.

ADV5 — AUDIT FORGERY / FREE-TEXT LEAK. trigger_refs is `.strict()` (knowledge-maturity-event.ts:90) so an attacker cannot smuggle free-text/secret into the audit via an unknown key (Zod rejects); reason_code is a closed enum (DB CHECK kme_reason_code_valid); rationale is never logged (crud.ts:75-84). Test A7 + an adversarial test passing `triggerRefs:{evil:"0xKEY..."}` → Zod parse throws, no row written.

ADV6 — REGIME WORKER PROMPT INJECTION promotes confidence/heuristic fallback. Untrusted web/tweet evidence must NOT cause a heuristic regime when classification fails. MUST NOT: any fallback verdict on malformed/timeout — the worker THROWS (regime-worker.ts:306-323), no snapshot lands (fail-closed). Adversarial test: stub provider returning non-JSON / a verdict failing schema → `runRegimeTick` throws, `insertSnapshot` NEVER called. And a verdict claiming `confidence:'high'` with only one usable source → capped to medium (regime-worker.ts:326-330).

ADV7 — CONCURRENT REINFORCE + DECAY race on the same row (lost update). Two transitions racing must NOT both commit on the same precondition. The CAS (`AND maturity_state=$4 AND activation_strength=$5`, crud.ts:281-282) makes the second a 0-row no-op. Test A1 is the single-row guard; an adversarial extension runs reinforce and decay against the SAME stale snapshot concurrently in two real txns and asserts exactly ONE applies, exactly ONE audit row, final state self-consistent.

## determinismSplit
DETERMINISTIC (hard-assertable gates — ledger/predicate/math/lineage, simulate timestamps via injected `now`):
- ALL of the FSM transition math: `decayedActivation` half-life curve, floor, `reinforcedActivation`, `nextStateOnDecay`/`nextStateOnReinforce`, `activationFactor` bound, `regimeHalfLifeDays`, `regimeMatchKind` aggregation, `effectiveRegime` dwell guards, `minRegimeConfidence` — all pure (already 100% deterministic-covered).
- The guarded CAS (A1, ADV7): row-count outcome is deterministic given seeded state.
- Audit-row COUNT and shape (P3, A2/A3/B3/C3): deterministic — exactly-one / exactly-zero per outcome, closed enums, trigger_refs pointers.
- Incremental anchor / no-compounding (A2/A3/B3): deterministic given injected `now` and seeded `last_decayed_at`.
- Floor self-repair, tier-change-always-persisted (A4/A5): deterministic.
- Regime-modulated decay & reactivation (A6): deterministic — `effectiveRegime` and `decayEntry` are pure given the seeded snapshot pair + injected `now`. The regime SNAPSHOT CONTENT is the only non-deterministic input, and here it is SEEDED, not classified.
- F4 starvation characterization + target (B2): deterministic — about cursor/ordering, no LLM.
- The F4 confidence CAP itself (D1): the cap is `minRegimeConfidence(verdict, 'medium')` — a pure function, HARD-assertable even though the verdict is live.
- `none`-policy frozen, recall-does-not-reinforce (B1, C1): deterministic.

LIVE-LLM (measured metrics, recorded to report-card, NEVER a gate — flaky model output must not fail CI):
- The regime worker's CLASSIFICATION of evidence into trend/vol/confidence (D1): quality of the verdict, not its schema-validity (schema-validity IS gateable via the Zod parse). Record valid/invalid + the resulting labels.
- The live JUDGE deciding a candidate is a duplicate vs. distinct (D2): whether the judge correctly recognizes the recurrence is a quality metric. The DETERMINISTIC D4 (content-hash) / D5 (near-dup) gates fire BEFORE the judge for exact/near dups, so for those the reinforce path is deterministic; the live-judge measurement is for the gray-zone semantic duplicates the gate does not catch — record which path fired.
- F31 judge-format health: record `recordJudgeAttempt` (reached/valid/invalidReason) on every escalation, per the existing collector.

## currentCoverage
HONEST inventory of what already exists:

PURE UNIT (maturity-policy.test.ts, 356 lines): EXHAUSTIVE on the pure layer — half-life math (1/2 half-lives, floor, none, regime/outcome=time, clock-skew clamp), FSM edges (all 4 reinforce transitions + decay tip + decayed-stays + reactivation), `reinforcedActivation` cap+reset, `reinforceEventFor` derivation, `activationFactor` bounds + §7 proven bound, `daysSince` (fractional/null/skew), `effectiveRegime` (all 4 fail-closed guards + per-axis disagree + min-confidence + mis-order resort), `regimeMatchKind` full matrix (match/mismatch/mixed/empty/unknown-axis/low-conf/out-of-vocab), `regimeHalfLifeDays` + a PROPERTY test over kind×horizon×activation asserting [DECAY_FLOOR, activation], 4th-param compat. This layer needs NO new tests.

SHELL UNIT (maturity.test.ts, 442 lines): EXHAUSTIVE on the imperative shell with STUBBED IO — reinforce (mature/reactivate/top-tier/not_found/precondition_miss with no audit), decay (erode/floor/tip/anti-spam/none-noop), INCREMENTAL ANCHOR (immediate re-run no-op + per-quantum erosion — the compounding regression), and S6b regime (mismatch 15d / match 60d / neutral 30d / regime=null bit-for-bit / time-policy ignores regime / floor under mismatch / reactivation match+high with full audit / NOT on medium / NOT on mismatch+neutral / NOT on non-decayed). Strong.

SWEEP UNIT (decay-sweep.test.ts, 152 lines): STUBBED IO — paging, decayed-vs-scanned counts, per-run cap, non-fatal per-entry failure, empty no-op, ONE regime resolution per run, regime-read-throw degrades to null. Does NOT test the REAL `listDecayableEntries`/`decayEntry` wiring, and does NOT characterize the F4 starvation bug.

INTEGRATION (knowledge-maturity-events.int.test.ts, 256 lines, real pgvector): audit row + non-FK anchor proof, reinforce ladder prob→est→reinf, decay lowers/floors/tips/never-deletes + row-survives, decayed→established reactivation via reinforce, recall surfaces activationStrength, sweep query skips none. Solid baseline.

INTEGRATION reinforce seam (memory-manager-reinforce.int.test.ts, 119 lines): D4 exact-dup reinforces active entry + audits + candidate rejected. Only the D4 happy path.

REGIME (regime-worker.test.ts 10.8KB, regime-prompt.test.ts, regime-snapshots.int.test.ts 13KB): worker tick gates + classification + cap, prompt building, snapshot CRUD + latest-two ordering. (Did not deep-read these — assume worker gating is covered; the GAP is the cap-as-pure-assert under live classification and the dwell-pair end-to-end into decayEntry.)

EVAL HARNESS (eval/*, lifecycle.int.test.ts): live Gemma + DeepSeek on ephemeral pg, F1/F2/F3 characterized as MEASURED what-IS with reportCard.recordFinding. NO maturity/decay/regime eval exists yet.

NOT COVERED anywhere: (1) guarded CAS under a REAL concurrent DB mutation (A1/ADV7) — the precondition-miss is only tested with a stubbed `applyMaturityTransition` returning false; (2) incremental anchor idempotency at the REAL-DB level (A2/A3/B3) — only stubbed; (3) F4 starvation — NOT characterized, the false comment is unguarded; (4) real-wiring sweep (B1); (5) recall-does-not-reinforce as an explicit negative (C1); (6) superseded-entry reinforce no-op (C2); (7) regime dwell pair seeded into a real `decayEntry` reactivation (A6 at integration level); (8) the F4 confidence cap asserted as a pure gate under live classification (D1); (9) tier-change-always-persisted-despite-sub-delta (A5); (10) floor self-repair on imported sub-floor row at integration (A4).

## gaps
Ranked by risk:

GAP-1 (HIGH, data-correctness, ACTIVE BUG) — F4 decay-sweep starvation is UNTESTED and STILL PRESENT. decay-sweep.ts:94 resets `afterId=0` every run; `listDecayableEntries` orders `id ASC` (crud.ts:338) with no cursor persistence; cap 2000 (decay-sweep.ts:50). Above 2000 decayable entries, the tail NEVER decays — stays at full activation, hot-context-eligible, never reaches `decayed`. The code comment (decay-sweep.ts:47-48) claims "remainder is picked up on the next tick" — FALSE. No test guards this. Needs B2 (characterization asserting current behavior + recordFinding + a skipped target spec).

GAP-2 (HIGH, concurrency/lost-update) — the guarded CAS is only tested with a STUBBED `applyMaturityTransition` returning false (maturity.test.ts:132). No test mutates a REAL row between read and apply to prove the WHERE-clause precondition actually blocks a lost update and writes no audit. A1/ADV7 close it. This is the single most load-bearing correctness claim (no lost update, no phantom audit) and it has zero real-DB coverage.

GAP-3 (HIGH, regression of a previously-fixed bug) — the compounding-decay fix (incremental `last_decayed_at` anchor) is only tested at the STUBBED shell level (maturity.test.ts:217-259). At the real-DB level there is no test that an applied decay STAMPS `last_decayed_at` and that an immediate re-sweep is a true DB no-op (activation unchanged, no second audit). A2/A3/B3 close it. A regression here silently halves every lesson per sweep.

GAP-4 (MEDIUM, anti popularity-bias — the headline doctrine) — there is NO explicit negative test that recall does NOT reinforce. The claim rests on "no recall path imports reinforceEntry", which is true today but unguarded against a future edit. C1 closes it cheaply.

GAP-5 (MEDIUM, adversarial reinforce) — only the D4 exact-dup HAPPY path is integration-tested. The superseded/archived-entry no-op (C2) and the points-at-non-active-id no-op (ADV2) are untested — these are the "never reinforce the wrong entry" guards.

GAP-6 (MEDIUM, regime end-to-end) — `effectiveRegime` (pure) and `decayEntry` (shell) are well-covered separately, but the dwell PAIR seeded into a real `getLatestTwoRegimeSnapshots` → `effectiveRegime` → real `decayEntry` reactivation has no integration test (A6). The fail-closed forged-snapshot reactivation block (ADV4) is also untested at integration level.

GAP-7 (LOW-MEDIUM, sweep real wiring) — decay-sweep.test.ts stubs `listDecayableEntries` AND `decayEntry`; the REAL wiring (real list + real decay + real audit per entry, none-exclusion, floor no-op) has no integration test (B1).

GAP-8 (LOW, boundary) — tier-change-always-persisted-despite-sub-delta (A5) and floor self-repair of an imported sub-floor row (A4) are shell-covered conceptually but not pinned at the DB CHECK / real-row level.

GAP-9 (LIVE, measured) — no eval-harness coverage of the regime worker's live classification or the live-judged duplicate-reinforce; the F4 confidence-cap-as-pure-gate under a live verdict (D1) is unmeasured.

## priority
Top 5 must-build, smallest-effective-first:

1. **A1 + ADV7 — Guarded CAS no-lost-update (real DB).** Extend knowledge-maturity-events.int.test.ts. Seed one entry, mutate the row out-of-band, drive `reinforceEntry`/`decayEntry` with the stale expected state, assert `precondition_miss` + ZERO audit rows + the concurrent write survives. Highest risk (lost update / phantom audit), smallest diff (one seed + one out-of-band UPDATE), and it is the claim the whole CAS design exists for. DETERMINISTIC GATE.

2. **A2 + B3 — Incremental-anchor idempotency at real-DB level (compounding regression).** Same file + a small decay-sweep.int.test.ts. Apply a real decay, re-read, decay again at the same injected `now`; assert the second is a DB no-op (activation unchanged, exactly one audit row total). Guards the previously-fixed compounding bug at the wiring level where the unit test cannot see `last_decayed_at` actually being stamped. DETERMINISTIC GATE.

3. **B2 — F4 starvation characterization + skipped target spec.** New decay-sweep.int.test.ts. Record the CURRENT (wrong) behavior (`afterId` resets to 0 each run / id-ASC ordering) with `reportCard.recordFinding({code:"F4", manifested:true})`, plus an `it.skip` executable contract for the fix (cursor persists OR `last_decayed_at ASC NULLS FIRST` so the stalest row is in page 1). This is the only ACTIVE data-correctness bug in the domain and it is completely unguarded. DETERMINISTIC (no LLM).

4. **C1 + C2 — anti popularity-bias + wrong-entry reinforce guards.** Extend memory-manager-reinforce.int.test.ts. C1: recall N times → activation/last_reinforced_at unchanged, zero maturity events. C2: a duplicate confirming a SUPERSEDED entry is a benign no-op. Cheap negatives that pin the two doctrines (reinforce-only-on-recurrence, never-reinforce-the-wrong-entry) against future drift. DETERMINISTIC GATE.

5. **A6 — Regime dwell-pair → real decayEntry reactivation + ADV4 forged-snapshot block.** Extend knowledge-maturity-events.int.test.ts. Seed a real agreeing snapshot pair (raw SQL for created_at), build effectiveRegime, drive mismatch decay (15d) and decayed+match+high reactivation; then ADV4: a high+low pair (effective low) does NOT reactivate. The only end-to-end regime test that exercises snapshot repo → effectiveRegime → decayEntry → audit with the snapshotId trigger_ref. DETERMINISTIC GATE (snapshots are seeded, not classified).

(D1/D2 live-LLM eval extensions are valuable but lower priority — they are MEASURED metrics, not gates; build them after the deterministic gates above are green.)

