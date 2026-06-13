# Vex Memory System — Master Correctness Test Plan (2026-06-12)

Source: 10-subagent (Fable 5) test-design workflow over the as-built code (S0–S10 +
DOPIECIA + F31 judge-format fix, all committed) + synthesis. Companion to
`audit-findings-v2.md` (findings) and the live eval harness at
`src/__tests__/integration/eval/`. Per-domain detailed specs in `test-specs/` (10 domains).

Owner emphasis: prove the memory behaves CORRECTLY — supersession lineage, the graph
(anti-scam), and the rest — not merely that it runs. Supersession + graph are WAVE 0/1.

## OVERVIEW
The Vex memory test strategy is a three-layer pyramid, each layer owning a distinct truth.

LAYER 1 — DETERMINISTIC UNIT (pure/mock-pg, no DB, no LLM). Owns: pure-function correctness and control-flow ordering. The deterministic stage D-rule precedence (FIRST-terminal-wins), clampSourceTier matrix, planFromVerdict verdict→plan mapping (incl. the F7 fallback/downgrade), judgeVerdictSchema/reconcileVerdictSchema fail-closed parsing, normalizeEntityName homoglyph semantics, decision-hash semantic-only idempotency, redact()/scanLiveState/english-check/exclusion math, the write-path ordering gauntlet on mocked IO, maturity FSM math, retrieval ranking (blendAndRank), memLog allowlist filter, inspector .strict() DTO rejection. These are fast GATES — any drift fails CI. Lives in src/__tests__/vex-agent/**.

LAYER 2 — DETERMINISTIC INTEGRATION (real testcontainers pgvector, synthetic dim-8 vectors via randVector, STUB judge / forced verdicts). Owns: SQL-predicate and ledger-derived truth that only real Postgres can prove — supersede INSERT+UPDATE atomicity in one tx, the reverse-join supersededBy, getLineageChain CTE order, recall/hot-context WHERE-clause exclusion, edge bi-temporal invalidation, the guarded maturity CAS (no lost update), incremental decay anchor, worker concurrency (owner-check ClaimLost, dual-worker single-reservation, idempotent-close), the reconcile job FSM + lost-wake matrix, export/import round-trip + tamper-reject, outcome resolver against a real projector. These are GATES, divorced from the live model by injecting fixed verdicts. Lives in src/__tests__/integration/{repos,memory,engine}/ and the deterministic half of eval/.

LAYER 3 — LIVE-LLM EVAL (real Gemma embeddings + real DeepSeek judge, ephemeral testcontainers pg, describe.skipIf(!OPENROUTER_API_KEY)). Owns: MEASURED metrics only, never gates. Judge valid-rate (F31 headline ≈0% today on deepseek-v4-flash), verdict distribution/quality, target fidelity (does previousKnowledgeId match the conflict id), regime classification quality, extraction in-vocab rate, recall precision@k, same-lesson cosine. Recorded via reportCard.recordJudge/recordJudgeAttempt/recordCheck/recordPrecision/recordFinding to a disk-backed report card. The HARD post-conditions OF a valid verdict (clamp ≤ ceiling, advisory scope, no-promotion-on-invalid) are asserted conditionally on captured.verdictValid; when invalid the suite asserts ONLY the safety invariant (zero knowledge written). Lives in src/__tests__/integration/eval/.

THE GOVERNING SPLIT: gate on what the PIPELINE GUARANTEES regardless of the model (atomicity, lineage, redaction, fail-closed, SQL exclusion, the deterministic clamp); measure what the MODEL SAYS (verdict quality, extraction quality, English-ness, precision). The single most important architectural move in this plan is force-driven verdicts: every supersede/graph/reconcile MECHANIC is proven deterministically by injecting a fixed verdict, so the highest-risk owner-flagged behaviors stay green even while F31 keeps the live judge at ~0% valid.

## COVERAGEMATRIX
| Subsystem | Correctness property | Current coverage | Where it should live |
|---|---|---|---|
| **Supersession/lineage** | Supersede atomicity (INSERT successor + FLIP predecessor in ONE real tx) | **none** (mock-pg only: knowledge-lifecycle.test.ts) | NEW integration eval/supersede-lineage.int.test.ts (det, real pg) |
| Supersession/lineage | Single-successor / 2nd-supersede rejects on real pg | none (mock-only) | same file |
| Supersession/lineage | getLineageChain root→head order, head=active invariant | partial (lineage-suite.ts mock rows) | same file (real pg) |
| Supersession/lineage | get redirect + history reinforcement-of-requested-id (tool surface) | none | same file (det) |
| Supersession/lineage | superseded never in recall/hot-context/graph on real data | none | same file + retrieval-precision ext (det) |
| Supersession/lineage | planFromVerdict null→retain downgrade | partial (null case only, consolidate-decision.test.ts:159) | consolidate-decision.test.ts (add fallback+precedence) |
| Supersession/lineage | F7 cross-kind/arbitrary-target supersede (no kind/cosine guard) | **none** | NEW supersede-targeting.int.test.ts (det, recordFinding F7) |
| Supersession/lineage | edge bi-temporal invalidation on supersede (P10) | none | graph.int.test.ts ext (det) |
| Supersession/lineage | redaction-anomaly aborts atomically (not silent-downgrade) | none | promote-mapping.test.ts (unit) |
| **Graph** | normalizeEntityName no-NFKC homoglyph distinctness | **none** (real protection, unproven) | memory-entity.test.ts (pure) |
| Graph | buildGraphPlan keeps homoglyphs as 2 entities (no fuzzy-merge) | none | entity-extraction.test.ts (unit) |
| Graph | 2 homoglyph promotions → 2 active identities at DB | none | graph-v1.int.test.ts ext (det) |
| Graph | closed-vocab fail-open through buildGraphPlan→null | partial (schema+throw, not the null outcome) | entity-extraction.test.ts (unit) |
| Graph | extraction-gate called on supersede / not on expire/bookkeep | partial (promote yes, retain/reject no) | consolidate-decision.test.ts (unit) |
| Graph | predecessor edge valid_until untouched / superseded_by_edge_id NULL | partial (invalidated_at only) | graph-v1.int.test.ts ext (det) |
| Graph | invalidate ≠ delete (row counts unchanged) | none | graph-v1.int.test.ts ext (det) |
| Graph | expansion dedupe vs TRUNCATED direct id; positional precedence | partial (returned-id only) | long-memory-search.test.ts (unit) |
| Graph | live extraction in-vocab/$-canonical/no-fuzzy quality | partial (bare count) | graph.int.test.ts ext (LIVE measured) |
| **Consolidation/judge** | D-rule terminal ORDERING (first-wins precedence) | none (individual rules only) | NEW deterministic-stage-ordering.test.ts (pure) |
| Consolidation/judge | fail-closed: judge throw ⇒ no promotion, candidate pending | partial (recorded not asserted) | concurrency int + eval (det gate + measured) |
| Consolidation/judge | F6 isUserAffirmed hard-coded-false gap | **none** | consolidate-decision.test.ts (unit canary) |
| Consolidation/judge | clamp weak/strong ceiling end-to-end | partial (observed-ceiling only) | consolidation-clamp eval + unit |
| Consolidation/judge | judge timeout/rubric-range/strict-key/null-usage | partial | judge.test.ts (unit) |
| **Concurrency** | dual-worker single-reservation; owner-check ClaimLost write-block | partial (single-worker only) | NEW memory-manager-concurrency.int.test.ts (det) |
| Concurrency | retry revives own items only; idempotent-close no double-promote | partial | same file (det) |
| **Outcome (S5)** | claim-vs-ledger poisoning (prose claims win, ledger says loss) | **none** | outcome-s5.int.test.ts ext (det ADV) |
| Outcome (S5) | LP venue through seam + action!="withdraw" lineage mismatch | none | NEW seedFaithfulLp + outcome-s5 ext (det+finding) |
| Outcome (S5) | real-projector shortfall (no strong); null-boundary degrade | partial (injected-null unit) | outcome-s5 + consolidate (det) |
| **Maturity/decay** | guarded CAS no-lost-update on real concurrent mutation | **none** (stub-false only) | knowledge-maturity-events.int.test.ts ext (det) |
| Maturity/decay | incremental anchor no-compounding at real DB | partial (stub shell) | same + decay-sweep.int.test.ts (det) |
| Maturity/decay | F4 decay-sweep starvation (afterId=0, id-ASC, cap 2000) | **none** (ACTIVE BUG) | NEW decay-sweep.int.test.ts (char + skip-target) |
| Maturity/decay | recall does NOT reinforce (anti popularity-bias) | none | memory-manager-reinforce.int.test.ts ext (det) |
| **Reconcile (S7)** | F11 permanently_failed reconcile silent dead-end | **none** | reconcile.int.test.ts ext (char + reset-target) |
| Reconcile (S7) | judge privilege-escalation (user_confirmed/supersede) fail-closed | none | reconcile.test.ts + reconcile-judge.test.ts |
| Reconcile (S7) | wake negative-space (pending cand / inactive entry / look-alike) | partial (happy map only) | reconcile.int.test.ts ext (det) |
| Reconcile (S7) | positionKey-only bridge; DB tier-raise clamp | none | reconcile.int.test.ts ext (det) |
| **Write-path** | content-hash from REDACTED text (loop-prevention foundation) | **none** | long-memory-suggest.test.ts (unit) |
| Write-path | gate PRECEDENCE (secret>live-state>english) + full no-downstream | partial (english path only) | long-memory-suggest.test.ts (unit) |
| Write-path | F5 redactor blind spots (Solana b58 / raw 64-hex / pg-URI / mnemonic) | partial (live eval char only) | text-redaction.test.ts (pure pin + skip-target) |
| **Retrieval/hot-context** | F1 count-vs-list asymmetry (NULL-TTL counted but absent) | **none deterministic** (live-gated lifecycle only) | NEW hot-context-list.int.test.ts (det) |
| Retrieval/hot-context | recall status/expiry/pinned-expired exclusion on real pg | partial (dual-trace + Gemma only) | NEW knowledge-recall-lifecycle.int.test.ts (det) |
| **Compaction/session** | Track 1 atomicity rollback (failure path) | **none** (no-double-bump only) | NEW compact-atomicity.int.test.ts (det) |
| Compaction/session | chunk-processing redaction/exclusion/exact-body/theme-fallback | none direct (indirect eval only) | NEW chunk-processing.test.ts (unit) |
| Compaction/session | session_memory_search/resolve_item handlers | **none** (no test files) | NEW handler int tests (det) |
| Compaction/session | chunker throw-not-[] guard | none | NEW chunker-call.test.ts (unit) |
| **Cross-cutting** | advisory-only grep-gate (enum can't express execution scope) | **none** (comments only) | NEW arch grep-gate (det) |
| Cross-cutting | decision-hash semantic-only/order-independent | none (no unit file) | NEW decision-hash.test.ts (pure) |
| Cross-cutting | memLog F5 shapes dropped by logger backstop | partial | logger.test.ts ext (pure) |
| Cross-cutting | export/import tamper-reject / bad-field-reject (FIX-2) | partial (happy path) | knowledge-roundtrip.int.test.ts ext (det) |
| Cross-cutting | inspector .strict() rejects forbidden field; last_error never leaks | partial (SQL absence only) | memory-inspector.test.ts ext (det) |

## PRIORITIZEDBACKLOG
Smallest-effective-first, grouped into waves. DET = deterministic gate; LIVE = measured metric. Effort: S(≤30min) / M(~1h) / L(>2h).

═══ WAVE 1 — OWNER-FLAGGED CRITICAL (supersession + graph + fail-closed). Build these first; they close the single biggest holes and stay green regardless of F31. ═══

1. **Supersede real-DB atomicity + lineage** [Supersession] DET, M. NEW src/__tests__/integration/eval/supersede-lineage.int.test.ts (force-driven verdict, no live judge). Pins: A1 same-tx flip (predecessor→superseded + successor active + reverse-join supersededBy); A3 second-supersede rejects (predecessor_already_superseded); B1 3-hop chain root→head order + exactly-one-active head. Closes the #1 gap (atomicity proven only against mock-pg).

2. **F7 cross-kind / arbitrary-target supersede** [Supersession] DET, S. Same file or NEW supersede-targeting.int.test.ts. Pins the EXACT current constraint set (predecessor active + content-differs + single-successor) and that a steered supersede of a cosine-distant, different-KIND active entry SUCCEEDS today → recordFinding({code:"F7", manifested:true}). Flip to assert-refused when a guard lands. Owner's central adversarial concern.

3. **Homoglyph anti-scam (pure + plan)** [Graph] DET, S. memory-entity.test.ts: normalizeEntityName(Latin "USDC") ≠ normalizeEntityName(Cyrillic "USDС"); "USDC " collapses (whitespace merges, homoglyphs don't). entity-extraction.test.ts F2: buildGraphPlan keeps the two as 2 distinct entities, 2 embed calls. Owner's #1 graph ask; zero coverage; cheapest high-value gate.

4. **Fail-closed: judge throw ⇒ no promotion** [Consolidation/Concurrency] DET, M. NEW memory-manager-concurrency.int.test.ts with an injected throwing judge stub: consolidateCandidate throws → markItemFailed → candidate stays pending → ZERO knowledge rows. The strongest safety assertion; must not depend on the live model. Plus C6 unit (judge-throw propagates out of consolidateCandidate).

═══ WAVE 2 — SUPERSESSION/GRAPH COMPLETION + ACTIVE BUGS ═══

5. **Tool surface: get redirect + history** [Supersession] DET, S. Same supersede-lineage file: D1 get on superseded → fail w/ "current version is entry {B}"; D3 get active head; D4 history full chain + reinforcement-of-REQUESTED-id (not head). Agent-recovery navigation contract.

6. **Superseded never recalled/hot-context** [Supersession/Retrieval] DET, S. retrieval-precision.int.test.ts ext: predecessor absent from recall + search + getActiveEntriesByIds; successor excluded from hot-context while probationary. Memory-poisoning surface.

7. **Edge invalidation on supersede (P10)** [Graph] DET, M. graph-v1.int.test.ts / graph.int.test.ts ext: predecessor edges invalidated_at NOT NULL + valid_until UNTOUCHED + superseded_by_edge_id NULL + entry↔entity links survive + successor gets fresh edges; idempotency (2nd call returns 0); invalidate ≠ delete (row counts unchanged).

8. **F4 decay-sweep starvation** [Maturity] DET, M. NEW decay-sweep.int.test.ts: characterize current behavior (afterId resets to 0 each run, id-ASC, cap 2000) + recordFinding({code:"F4", manifested:true}) + an it.skip TARGET (cursor persists OR last_decayed_at ASC NULLS FIRST). The only ACTIVE data-correctness bug in the domain, completely unguarded.

9. **F1 count-vs-list asymmetry** [Retrieval] DET, S. NEW hot-context-list.int.test.ts: NULL-TTL matured observed lesson is COUNTED but ABSENT from listActiveForHotContext. Promotes the live-gated lifecycle characterization into a cheap LLM-independent repo test. #1 user-visible memory bug.

10. **Guarded CAS no-lost-update** [Maturity] DET, M. knowledge-maturity-events.int.test.ts ext: read entry, mutate row out-of-band, drive reinforceEntry/decayEntry with stale expected state → precondition_miss + ZERO audit rows + concurrent write survives. The claim the whole CAS design exists for; zero real-DB coverage.

═══ WAVE 3 — CHEAP PURE/UNIT GATES (high value/effort) ═══

11. **D-rule terminal ORDERING** [Consolidation] DET, S. NEW deterministic-stage-ordering.test.ts: multi-trip inputs proving FIRST-terminal-wins (D1>D2>D4>D5>D8>D9>D10) + D8/D9/D10 boundary tables + D4-vs-D5 reinforce-id distinction. Locks the deterministic backbone.

12. **planFromVerdict fallback + precedence + redaction-anomaly** [Supersession] DET, S. consolidate-decision.test.ts: conflict-id fallback (verdict null + conflictKnowledgeId present → supersede), verdict-id-wins precedence; promote-mapping.test.ts: supersedeFromCandidate propagates PromoteRedactionAnomalyError (no partial write, asymmetry vs promote).

13. **content-hash from REDACTED text** [Write-path] DET, S. long-memory-suggest.test.ts: two suggests differing only by an EVM address masking identically → SAME content_hash. Loop-prevention/supersession identity foundation.

14. **gate PRECEDENCE + full no-downstream chain** [Write-path] DET, S. long-memory-suggest.test.ts: secret>live-state>english on a multi-trip payload; secret/live-state/zod rejects assert findByContentHash + embed + insert + enqueue ALL not-called.

15. **F5 redactor blind-spot pins** [Write-path] DET, S. text-redaction.test.ts: redact(shape).hardRedactCount===0 for Solana b58 / raw 64-hex / pg-URI / comma-mnemonic (pin the gap byte-exact) + it.skip target asserting they MUST reject once fixed.

16. **decision-hash semantic-only** [Cross-cutting] DET, S. NEW decision-hash.test.ts: order-independent evidenceRefs, null-vs-0, anchorKind disambiguation, length-prefix collision resistance. Audit-integrity substrate, no unit file today.

17. **advisory-only grep-gate** [Cross-cutting] DET, S. NEW arch test: INFLUENCE_SCOPES===["advisory","retrieval_boost"], source has no execution_constraint/sizing_hint token, no sizing/approval/wallet module imports knowledge/influence_scope/searchKnowledge. Closes the memory-poisoning-into-execution silent-regression door.

═══ WAVE 4 — CONCURRENCY + LINEAGE + RECONCILE DEPTH ═══

18. **Dual-worker + retry-revive** [Concurrency] DET, M. memory-manager-concurrency.int.test.ts: two-jobs-one-candidate single-reservation (uniq_mji_active_candidate); two-workers-one-item owner-checked markItemProcessing→false; retry revives own released/failed items only.

19. **Supersede lineage via executor + adversarial** [Consolidation] DET, M. concurrency file: stub supersede verdict → predecessor superseded (preserved, not deleted), successor carries supersedes_id, probationary/advisory; supersede of already-superseded predecessor FAILS tx (candidate pending, lineage intact).

20. **F11 reconcile dead-end** [Reconcile] DET, M. reconcile.int.test.ts ext: throwing judge → permanently_failed; same-version wake = no-op; recoverStaleRunning doesn't touch it; entry never invalidated (the wrong lesson silently survives) → recordFinding + resetReconcileJob repair target.

21. **judge privilege-escalation fail-closed** [Reconcile] DET, S. reconcile.test.ts + reconcile-judge.test.ts: verdict minting user_confirmed / supersede action / unknown key → schema rejects → markFailed, NO tx.

22. **wake negative-space + positionKey bridge + tier-raise** [Reconcile] DET, M. reconcile.int.test.ts ext: pending-candidate/inactive-entry/scam-look-alike → 0 matches; positionKey-only close bridge; inferred→observed F2 raise persists upward-only + clamped.

═══ WAVE 5 — OUTCOME + COMPACTION + CROSS-CUTTING COMPLETION ═══

23. **claim-vs-ledger poisoning trio** [Outcome S5] DET, M. outcome-s5.int.test.ts ext (ADV-1/2/3): prose claims win, ledger says loss/shortfall/no-match → evidenceQuality≠strong, lessonSignal follows the LEDGER. Core anti-poisoning guard for the outcome subsystem.

24. **LP venue + action mismatch** [Outcome S5] DET, M. NEW seedFaithfulLp seeder: withdraw→closed/medium; zap-out→does-NOT-close → recordFinding (real lineage bug surfaced).

25. **Track 1 compaction atomicity** [Compaction] DET, M. NEW compact-atomicity.int.test.ts: spy archivePrefix to throw mid-tx → summary/generation/token_count/archive/job ALL unchanged (all-or-nothing rollback). Half-committed compaction = silent data corruption.

26. **chunk-processing unit + handlers** [Compaction] DET, M. NEW chunk-processing.test.ts (redaction every field, exclusion incl. outstanding, exact-body embed, theme fallback, claim-lost) + session_memory_search/resolve_item handler int tests (empty-store short-circuit, 0.30 floor, wrong-session reject, embed-fail durability, hash-race).

27. **export/import tamper + inspector strict** [Cross-cutting] DET, M. knowledge-roundtrip.int.test.ts ext (tampered hash no-op, bad-field→failed-not-defaulted, missing-predecessor fail-loud) + memory-inspector.test.ts ext (.strict() rejects forbidden field, last_error never surfaces).

═══ WAVE 6 — LIVE MEASURED (after deterministic gates are green) ═══

28. **Judge fail-closed + clamp eval** [Consolidation] LIVE, M. consolidation-judge ext: F5 (verdictValid=false ⇒ zero knowledge — turn the F31 capture into a safety assert on the invalid branch); weak-ceiling clamp hard-assert on the valid branch.

29. **Supersede/reconcile flip target-fidelity** [Supersession/Reconcile] LIVE, M. record whether the live judge picks the deterministic conflict id; second flip direction (neg→pos) so valid-rate isn't single-prompt.

30. **Extraction + compaction + precision quality** [Graph/Compaction/Retrieval] LIVE, M. graph.int.test.ts (in-vocab rate, $-canonical, no-fuzzy look-alike), NEW compaction eval (English-ness measured + redaction-held HARD), retrieval precision@3. All recordCheck/recordPrecision, soft floors only.

## HARNESSEXTENSIONS
CONCRETE wiring against the existing harness (src/__tests__/integration/eval/* + integration/unit suites).

**Reuse the report-card API as-is** (_report-card.ts, verified): recordCheck(suite, {label, pass, note}), recordJudge(JudgeSample), recordJudgeAttempt({scenario, reached, valid, invalidReason}), recordPrecision({k, ...}), recordFinding({code, manifested, summary}). Every NEW finding (F7, F4, F11, F1, F5, F30, LP action-mismatch) goes through recordFinding so the gap is tracked, not silently green. Live measurements go through recordJudgeAttempt/recordJudge/recordCheck/recordPrecision.

**Reuse the seeders as-is** (_eval-fixtures.ts, verified): seedPromotedLessonDirect (predecessor for supersede + reconcile + already_known), seedGemmaCandidate / seedGemmaKnowledgeEntry, seedFaithfulConfirmedSpotTrade / seedClosedPerpsPosition / seedFaithfulClosingTradeForWake (outcome + flip), driveConsolidateWithRealJudge (live path), driveConsolidateCapturingJudge (F31-aware, swallows memory_judge_* so a broken judge never reds the suite), measureSameLessonCosine, promoteLessonForReconcile.

**NEW eval files (deterministic, force-driven verdicts — no live judge dependency, run green regardless of F31):**
- eval/supersede-lineage.int.test.ts — the single highest-value new file. Seed a predecessor via seedPromotedLessonDirect, build a candidate, drive a FORCED supersede plan via applyDecision/supersedeEntry inside withTransaction. Closes atomicity + tool-surface + recall-exclusion gaps. Start with A1+B1.
- eval/supersede-targeting.int.test.ts (or fold into above) — F7: two unrelated active entries, steered cross-kind supersede plan, assert the constraint set + recordFinding(F7).
- eval/consolidation-clamp.int.test.ts — weak-ceiling clamp HARD on the valid branch + F31 measured.
- eval/invariants.int.test.ts — advisory-only behavioral + judge-context redaction (deterministic half runs without a key) + fail-closed-⇒-no-promotion recordCheck.
- eval/compaction.int.test.ts — NEW SUITE="compaction", describe.skipIf(!OPENROUTER_API_KEY): chunker English-ness measured + theme-validity/exact-body/no-live-state-stored/redaction-held HARD + recordFinding(F30).

**NEW deterministic integration files (real testcontainers pg, synthetic dim-8 / randVector, STUB judge):**
- integration/memory/memory-manager-concurrency.int.test.ts — dual-worker, owner-check, idempotent-close, retry-revive, injected-throwing-judge fail-closed, supersede lineage via executor.
- integration/repos/hot-context-list.int.test.ts — F1 asymmetry, hot-list ordering, maturity-vs-observed exclusion (pure SQL, no key).
- integration/repos/knowledge-recall-lifecycle.int.test.ts — recall status/expiry/pinned-expired exclusion + getActiveEntriesByIds parity (dim-8).
- integration/memory/decay-sweep.int.test.ts — F4 characterization + skip-target + population idempotency.
- integration/engine/compact-atomicity.int.test.ts — Track 1 rollback (vi.spyOn archivePrefix to throw).
- integration/repos/session-memory-search-handler.int.test.ts + session-memory-resolve-handler.int.test.ts — the two untested agent-facing tool handlers.

**EXTEND existing files (do not duplicate):**
- consolidate-decision.test.ts — D-rule ordering (or new deterministic-stage-ordering.test.ts), planFromVerdict fallback/precedence, F6 isUserAffirmed canary, extraction-gate on supersede.
- promote-mapping.test.ts — supersede redaction-anomaly asymmetry.
- graph-v1.int.test.ts / eval/graph.int.test.ts — homoglyph DB identities, edge valid_until untouched, invalidate≠delete, live extraction quality.
- memory-entity.test.ts + entity-extraction.test.ts — homoglyph pure + plan.
- knowledge-maturity-events.int.test.ts — guarded CAS, incremental anchor, regime dwell→reactivation.
- memory-manager-reinforce.int.test.ts — recall-does-not-reinforce, superseded-entry no-op.
- reconcile.int.test.ts + reconcile.test.ts + reconcile-judge.test.ts — F11 dead-end, wake negative-space, privilege-escalation, positionKey bridge, DB tier-raise.
- outcome-s5.int.test.ts — claim-vs-ledger trio, LP venue, real-projector shortfall.
- long-memory-suggest.test.ts + text-redaction.test.ts — content-hash, gate precedence, F5 pins.
- knowledge-roundtrip.int.test.ts — export/import tamper-reject.
- memory-inspector.test.ts / memory-inspector-db.test.ts — .strict() rejection, last_error.
- logger.test.ts — F5 shapes through the allowlist.

**NEW pure unit files:** deterministic-stage-ordering.test.ts, decision-hash.test.ts, chunk-processing.test.ts, chunker-call.test.ts, the advisory-only grep-gate arch test.

**Fixtures to ADD:** seedFaithfulLp (drives recordLpEconomics with zapDetails — both a true "withdraw" event and a "zap-out" event to surface the action-vocabulary mismatch); a standalone-sell shortfall branch on seedFaithfulConfirmedSpotTrade; a generalized seedClosedPerpsPosition that takes productType (perps/prediction/order) to complete the venue-dispatch matrix.

## DETERMINISMGUIDANCE
THE RULE: a test is a HARD GATE if and only if its outcome is derivable WITHOUT asking the live model anything — i.e. from SQL row state, a pure function, a hash, a ledger read, a grep, or a Zod parse. A test is a MEASURED METRIC (recorded, never red) if its outcome depends on what the LLM chose to say.

HARD GATES (must pass; any drift fails CI):
- Supersede SQL: INSERT-successor + FLIP-predecessor atomicity, reverse-join supersededBy, single-successor index, getLineageChain CTE order, head=active, valid_from carry, MAX_LINEAGE_HOPS.
- F7 repo behavior: cross-kind supersede succeeds/refuses — pure repo, no judge (force the verdict).
- planFromVerdict null→retain downgrade + conflict-id fallback + verdict-id precedence — pure function.
- D-rule terminal ordering + boundaries (==floor, ==now), clampSourceTier matrix, Graphiti differsOnNumberOrDate — pure.
- judgeVerdictSchema / reconcileVerdictSchema / candidateSuggestInputSchema — pure Zod (5-verdict, merge-reject, F31 nullish-vs-fail-closed, .strict() key rejection, privilege-escalation rejection).
- callJudge/callReconcileJudge THROW paths (malformed/schema/config/timeout-with-injected-timer) — stubbed provider, deterministic.
- normalizeEntityName homoglyph/whitespace, canonicalizeDollarName, buildGraphPlan dedup/fail-open-to-null — pure.
- redact()/scanLiveState/checkLongMemorySuggestEnglish/computeContentHash — pure regex/heuristic/sha256 (incl. the F5 hardRedactCount===0 characterizations and the content-hash-from-redacted-text identity).
- All recall/hot-context/expiry/kind/source/maturity SQL exclusion, getActiveEntriesByIds parity, F1 count-vs-list asymmetry, mixed-dim exclusion — real pg, deterministic predicates with synthetic dim-8 vectors (the EMBEDDING VALUES are seeded, so only relative-similarity GEOMETRY would need a real model; the FILTERS do not).
- Edge bi-temporal invalidation (invalidated_at set / valid_until untouched / superseded_by_edge_id NULL / links survive / idempotency / invalidate≠delete).
- Worker concurrency: owner-check ClaimLost, idempotent-close, dual-worker single-reservation, retry-revive, stale recovery, the reconcile job FSM + lost-wake matrix, wake_pending consumption.
- Guarded maturity CAS (no lost update), incremental decay anchor (no compounding), quench/reinforce/tier-raise math at the DB, F4 cursor/ordering.
- Outcome resolver fields against a real projector, replay-stability after TRUNCATE+regenerate, claim-vs-ledger (ledger always wins), null-boundary strong-degrade.
- Track 1 compaction atomicity, chunk redaction/exclusion/exact-body, chunker throw-not-[], session-memory handler control-flow.
- decision-hash semantic-only, memLog allowlist filter, export/import tamper-reject, inspector .strict() rejection, advisory-only grep-gate.
- THE SAFETY GATE: judge-throw ⇒ no promotion ⇒ candidate pending, asserted with an INJECTED throwing judge stub (NOT the live model). This is the strongest assertion and must never depend on the model being healthy.

MEASURED METRICS (recordCheck/recordJudge/recordJudgeAttempt/recordPrecision/recordFinding; never gate; use driveConsolidateCapturingJudge so memory_judge_* failures are swallowed):
- Judge valid-rate (F31 headline ≈0% on deepseek-v4-flash), verdict distribution, verdict QUALITY (is supersede the right call vs retain), target FIDELITY (previousKnowledgeId == conflict id).
- Reconcile flip verdict (invalidate vs quench vs retain), tier-raise proposal under a live judge.
- Regime worker classification quality (schema-validity IS gateable via the pure Zod parse; the labels are measured; the F4 confidence CAP is a pure-function HARD assert even on a live verdict).
- Extraction quality (in-vocab type/relation rate, $-canonical compliance, no-fuzzy look-alike), chunker English-ness (F30 honor-system), recall precision@k, same-lesson cosine.

THE HYBRID PATTERN (preserve the existing consolidation-judge.int.test.ts shape): the HARD post-conditions that ride ON a live verdict (clamp ≤ ceiling, advisory scope, no-raw-pnl, audited) are asserted CONDITIONALLY on captured.verdictValid===true; when verdictValid===false the suite records F31 and asserts ONLY the safety invariant (zero knowledge written, candidate pending). A model regression must move the F31 metric, never red a deterministic gate. The mechanism that makes this work everywhere: FORCE-DRIVE the verdict (inject a fixed promote/supersede/reconcile verdict) to test the MECHANICS deterministically, divorcing the gate from the live model.

## RISKS
Highest-risk untested behaviors — where a regression is a correctness or safety INCIDENT, not a flaky test. Build these FIRST (they are Wave 1-2).

R1 (CRITICAL — silent data corruption / memory poisoning) — **Supersede atomicity + the head=active invariant are proven ONLY against a mock pg client.** The real INSERT-successor + FLIP-predecessor in one tx, the partial unique index, and getById's reverse-join supersededBy have never been exercised together on real Postgres. A real INSERT/UPDATE ordering bug, an FK/index regression, or a partial commit would pass every existing test and leave a successor pointing at a still-active predecessor (two competing heads) or a superseded row with no successor (a dangling lineage). This is the owner's #1 ask and the single biggest hole. → Backlog #1.

R2 (CRITICAL — silent retirement of unrelated lessons) — **F7: the judge's previousKnowledgeId is unconstrained by kind, cosine, or near-dup membership.** A steered/poisoned judge (or an injected verdict) can retire ANY active entry of ANY kind by emitting its id; the repo only checks predecessor-active + content-differs + single-successor. Nothing pins the absent guard, so the blast radius — silent retirement of a high-value unrelated lesson while the poisoned successor takes the head — is completely untested. → Backlog #2.

R3 (CRITICAL — the cardinal fail-closed rule) — **Judge-failure-⇒-no-promotion is recorded but never ASSERTED as a gate.** judge.ts throws on timeout/malformed/schema-invalid and there is no promoting fallback, but the only coverage RECORDS verdictValid=false; nothing asserts ZERO knowledge written + candidate stays pending. A regression adding a promoting default would pass today, and with F31 keeping the live judge at ~0% valid, EVERY escalation hits the failure path — so a broken fail-closed contract would promote nothing-or-everything in production. → Backlog #4 (injected throwing stub, deterministic).

R4 (HIGH — scam-token poisoning of the graph) — **Unicode homoglyph distinctness is real but UNPROVEN.** normalizeEntityName does trim+lowercase+collapse only (no NFKC/NFC, confirmed at memory-entity.ts), so Cyrillic "USDС" and Latin "USDC" stay distinct — but a future "add NFKC for robustness" refactor would silently merge a scam token into the real token's entity (inheriting its edges/links) with zero test failing. → Backlog #3.

R5 (HIGH — wrong lesson silently survives forever) — **F11: a permanently_failed reconcile is a dead-end with no production revival path.** resetReconcileJob has zero callers; the executor recovery only calls recoverStaleRunning; a same-version wake leaves permanently_failed untouched. Combined with F31 (the live judge fails every flip), a contradicted/flipped lesson that exhausts retries is NEVER invalidated and keeps being recalled as if valid. → Backlog #20.

R6 (HIGH — retired lessons resurface into the always-on prompt) — **Superseded-never-recalled/hot-context (P8) is untested on real data.** A recall/hot-context WHERE-clause regression would resurface a retired lesson into the always-on # Memory prompt section — a direct memory-poisoning surface. Same class: the F1 count-vs-list asymmetry (a matured lesson the banner claims exists but the agent can never see) has zero deterministic coverage. → Backlog #6, #9.

R7 (HIGH — secret exfiltration into durable memory / logs) — **F5 redactor blind spots (Solana b58 keys, unlabelled raw 64-hex, postgres:// creds, comma-punctuated mnemonics) are ACCEPTED today** and pinned only in the live eval. There is no pure pin of the gap and no skipped target, so a redactor refactor could change F5 behavior silently. The memLog backstop for these shapes is also unverified. A secret reaching memory_candidates.body_md or a structured log field is a real exfil incident. → Backlog #15, plus logger.test.ts ext.

R8 (HIGH — lost update / double-promote under concurrency) — **The guarded maturity CAS and dual-worker anti-double-promote machinery are only single-worker-tested.** The CAS is proven only with a stubbed applyMaturityTransition returning false; no test mutates a real row between read and apply. Two-jobs-one-candidate and two-workers-one-item are untested. A lost update silently halves an activation or phantom-audits; a double-reservation double-promotes. → Backlog #10, #18.

R9 (HIGH — memory poisoning reaches execution) — **Advisory-only is enforced ONLY by comments and the enum shape.** No grep-gate asserts INFLUENCE_SCOPES cannot express an execution/sizing/approval scope or that no sizing/approval/wallet module imports the knowledge store. A PR wiring influence_scope into a sizing multiplier would pass CI — the worst-case memory-poisoning blast radius. → Backlog #17.

R10 (MED-HIGH — claim overrides ledger) — **No "claim vs ledger" outcome test exists.** Nothing seeds a candidate whose prose claims a win against a ledger that says loss/shortfall/no-match. P1 (outcome derived ONLY from the ledger, never the agent's declaration) is the central anti-poisoning invariant of S5 and is only implicitly covered by the resolver not reading title/summary. → Backlog #23.

