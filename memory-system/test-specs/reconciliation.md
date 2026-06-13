## domain
Outcome Reconciliation + Ledger Wakes (S7): enqueueLedgerWake seam, processReconcileJob worker, reconcile-judge + reconcile-policy, findPromotedWakeTargets GIN containment, enqueueReconcileJob wake_pending re-arm, and the F11 permanently_failed dead-end.

## correctnessProperties
Each property is a testable claim with the file:line that enforces it.

P1 — SINGLE SEAM / NO STORM. The wake fires from exactly one place: the tail of `populateCaptureItems` (capture-pipeline.ts:112-119). `replayActivityFromCapture` (capture-pipeline.ts:127-141) never calls `enqueueLedgerWake`. Property: a confirmed trade through `populateCaptureItems` produces wake jobs; the same data replayed produces ZERO new jobs.

P2 — SEMANTIC-KEY ANCHOR BRIDGE. A CLOSING execution has a NEW executionId, so only `instrumentKey`/`positionKey` bridge old lesson↔new fact. `findPromotedWakeTargets` (memory-candidates/crud.ts:289-309) matches `mc.evidence_refs @> [probe]::jsonb` with `mc.status='promoted' AND mc.promoted_knowledge_id IS NOT NULL AND ke.status='active'`. Property: a wake whose ONLY probe is the semantic key still finds the lesson anchored on a different executionId; a non-promoted candidate or non-active entry is NOT matched.

P3 — ONE JOB PER (ENTRY, CURRENT outcome_version). `enqueueLedgerWake` (ledger-wake.ts:108-131) DISTINCTs targets and enqueues `enqueueReconcileJob(entryId, target.outcomeVersion)`; the SELECT DISTINCT in crud.ts:299 dedupes multiple candidates/probes hitting one entry. Property: N capture items repeating the same instrument → 1 probe per distinct value (buildWakeProbes ledger-wake.ts:77-99) → 1 job per entry.

P4 — IDEMPOTENT RE-ARM MATRIX. `enqueueReconcileJob` (memory-jobs/crud.ts:109-149) ON CONFLICT CASE: completed→pending+attempt0+wake_pending FALSE (re-arm); running→wake_pending TRUE; pending/failed→untouched no-op; permanently_failed→untouched. `markCompleted` (crud.ts:291-316) consumes wake_pending into pending+attempt0 instead of completed. `recoverStaleRunning` (crud.ts:402-459) PRESERVES wake_pending (R1). Property: every lost-wake interleaving converges to exactly one more post-wake pass; the flag survives a crash.

P5 — STALE-VERSION NEVER LOSES INFO. `processReconcileJob` step 1 (reconcile.ts:244-250) and the tx re-check (reconcile.ts:351-353,428-430): when `entry.outcomeVersion !== jobVersion`, re-enqueue at the CURRENT version then complete the stale job. Property: information never dies; the loop catches up to the ledger version.

P6 — DELTA GATE. `outcomeDelta` (reconcile-policy.ts:59-70) compares ONLY status/lessonSignal/evidenceQuality/pnlSource(none-default)/needsReconciliation(false-default), EXCLUDING version/audit stamps. `unchanged` → complete WITHOUT a decision row and WITHOUT a tx (reconcile.ts:281-284). Property: a bookkeeping re-run is a true no-op; no decision-row loop.

P7 — CONSEQUENCE MAP (F1, ordered, closed). `consequenceFor` (reconcile-policy.ts:113-130): rule1 flip+terminal→flip_judge; rule2 positive+closed/settled→reinforce; rule3 negative+closed/settled/failed→quench; default→bookkeep. Property: the full 4×4×status matrix is closed; a terminal flip NEVER resolves as reinforce/quench.

P8 — QUENCH MATH. `quenchedActivation` (reconcile-policy.ts:140-143) = max(DECAY_FLOOR, min(current, 0.15)); never raises an already-suppressed lesson, repairs sub-floor up, degrades NaN to floor. `OUTCOME_QUENCH_ACTIVATION=0.15` (reconcile-policy.ts:44) is BELOW DECAY_TO_DECAYED_THRESHOLD(0.2) and ABOVE DECAY_FLOOR(0.03) (asserted in reconcile-policy.test.ts:51-56). Property: a quench tips to `decayed` tier in the SAME step, stays recallable, never deletes; `bumpLastDecayedAt:true` (reconcile.ts:540) marks it an applied decay step.

P9 — REINFORCE MATH. `reinforcedActivation`/`nextStateOnReinforce` (maturity-policy.ts:254-281): +0.25 capped at 1.0; decayed→REACTIVATION 0.6; FSM prob→est→reinf→reinf. Property: a confirmed profit advances the FSM and bumps activation upward-only-clamped, event = matured/reinforced/reactivated (reinforceEventFor maturity-policy.ts:289-293).

P10 — TIER RAISE: STRONG-CEILING, UPWARD-ONLY, CLAMPED. `shouldConsultTierRaise` (reconcile-policy.ts:154-159): only ceiling `strong` AND source hypothesis/inferred. Worker derives ceiling with `recurrenceCount:0, anchorExists:true` (reconcile.ts:292-297) so `strong` is reachable ONLY via the trade-closed-strong-PIT path (evidence-deref.ts:128-136). `tierRaiseTarget` (reconcile-policy.ts:182-192): clamp to ceiling first, then strictly upward; observed/user_confirmed → null. Property: the LLM can never out-claim the evidence ceiling nor demote; observed entries never consult the judge.

P11 — FLIP IS FAIL-CLOSED. `callReconcileJudge` (reconcile-judge.ts:153-210) THROWS on config/timeout/malformed/schema-invalid; the worker rethrows → markFailed → retry (reconcile.ts:316-322). `reconcileVerdictSchema.strict()` (reconcile-policy.ts:234-240) rejects unknown keys / out-of-enum action. A flip without a verdict throws (resolveFinalAction reconcile-policy.ts:269). Property: a judge failure NEVER promotes a guessed consequence; the consequence is computed only from a validated verdict.

P12 — LOCK ORDER entry→candidate→job, disjoint from consolidate. `lockEntryForReconcile` is taken FIRST in the tx (reconcile.ts:349, knowledge/crud.ts:458-487 doc), then candidate outcome rewrite, then recordDecision re-locks the job last. Consolidate's order is jobs→pending-candidate→entry on DISJOINT candidate sets (consolidate.ts:636-646 owner-check `FOR UPDATE OF i,j`). Property: no shared lock edge → no deadlock cycle.

P13 — INVALIDATE RETRACTS EDGES + STAMPS BI-TEMPORAL. `invalidateEntryOnReconcile` (knowledge/crud.ts:498-514) sets status='invalidated', valid_until=NOW(), status_reason=rationale, guarded status='active'; `invalidateEdgesForOrigin` runs in the SAME tx (reconcile.ts:572). No maturity event (invalidate is a status transition). The outcome_version bump lands even on invalidate (bumpOutcomeVersion has no status guard, knowledge/crud.ts:546-559). Property: a dead lesson leaves the recall predicate atomically and its graph claims are retracted together.

P14 (GAP/F11) — PERMANENTLY_FAILED IS A SILENT DEAD-END. `resetReconcileJob` (memory-jobs/crud.ts:158-205) is the ONLY revive for a permanently_failed reconcile row, and it has ZERO production callers (confirmed: only referenced in crud.ts, index.ts re-export, and an enum comment memory-job-enums.ts:38). The worker only calls `recoverStaleRunning` at bootstrap (executor.ts:111) which sends an exhausted stale running job to permanently_failed (crud.ts:413-427). Property (current, characterized): a reconcile job exhausting max_attempts (e.g. the F31 flip-judge failure) is stranded forever; the lesson keeps its stale outcome.

## scenarios
All scenarios cite the seeders/helpers in src/__tests__/integration/repos/reconcile.int.test.ts (seedExecution/seedActiveEntry/seedPromotedCandidate/seedRealizedClose/readEntry/reconcileJobCount/testDeps/claimReconcile) and src/__tests__/integration/eval/_eval-fixtures.ts (seedFaithful*). Unit scenarios reuse makeDeps/makeEntry/outcome/promotedCandidate from reconcile.test.ts and makeDeps from ledger-wake.test.ts. New file targets are named per scenario.

=== DETERMINISTIC — unit (new cases in src/__tests__/vex-agent/memory/ledger-wake.test.ts) ===

S-W1 positionKey-only bridge probe
SEED: keys=[{executionId:50, positionKey:"perp-1"}] (NO instrumentKey).
ACTION: buildWakeProbes(keys).
EXPECTED/ASSERT: toEqual([{executionId:50},{positionKey:"perp-1"}]) — perps path emits a positionKey probe (existing test only covers instrumentKey).

S-W2 mixed valid+invalid in one key
SEED: keys=[{executionId:0, instrumentKey:"BONK", positionKey:""}].
ASSERT: toEqual([{instrumentKey:"BONK"}]) — invalid executionId (0) and empty positionKey dropped, valid instrumentKey kept (current tests only test all-valid or all-invalid).

S-W3 enqueue is sequential per target, version forwarded verbatim
SEED: makeDeps targets=[{entryId:7,outcomeVersion:0},{entryId:7... no, distinct},{entryId:9,outcomeVersion:99}].
ASSERT: enqueue called with (9,99) — the entry's CURRENT version (not jobVersion+1) is the key. Already partially covered; add a high-version target to prove no off-by-one.

=== DETERMINISTIC — unit (new cases in reconcile.test.ts) ===

S-R1 reinforce of a DECAYED entry → reactivation
SEED: makeDeps entry=makeEntry({maturityState:"decayed", activationStrength:0.05}); candidate=promotedCandidate(outcome()); resolved=outcome({status:"settled", lessonSignal:"positive", evidenceQuality:"medium", pnlSource:"open_position"}).
ACTION: processReconcileJob.
ASSERT: applyMaturityTransition called with nextMaturityState:"established", nextActivation:0.6 (REACTIVATION, not 0.05+0.25), bumpLastReinforcedAt:true; recordMaturityEvent event:"reactivated". (Existing reinforce case only covers probationary→established; the decayed reactivation branch reconcile.ts:498-502 via reinforcedActivation is untested.)

S-R2 reinforce at reinforced ceiling stays reinforced, activation clamps at 1.0
SEED: entry=makeEntry({maturityState:"reinforced", activationStrength:0.9}); resolved closed+positive+medium.
ASSERT: nextMaturityState:"reinforced", nextActivation:1.0 (0.9+0.25 clamped); event:"reinforced".

S-R3 tier raise CLAMP downgrade — judge over-proposes, ceiling limits it
SEED: entry=makeEntry({source:"hypothesis"}); resolved closed+positive+strong+PIT (ceiling strong by evidence-deref); judge verdict {action:"retain", sourceTier:"observed", rationale}. Note: ceiling is strong here so clamp keeps "observed". To prove clamping, ALSO add S-R3b where a separate unit test of tierRaiseTarget("hypothesis","observed","weak")→"inferred" (already in reconcile-policy.test.ts:199) — at the WORKER level assert raiseEntrySourceTier is called with the CLAMPED tier, not the raw proposal, by constructing resolved as closed+positive+MEDIUM (ceiling NOT strong) — but then shouldConsultTierRaise is false. So the clamp-at-worker case is only reachable at ceiling=strong; assert raiseEntrySourceTier(ENTRY_ID,"observed",TX) and that a hypothesis→observed jump is allowed under strong. (Confirms reconcile.ts:359-364 wiring.)

S-R4 tier raise PROPOSAL ABSENT → no raise, deterministic consequence still runs
SEED: entry source inferred; resolved closed+positive+strong+PIT; judge verdict {action:"retain", rationale} (NO sourceTier).
ASSERT: judge consulted (tierRaiseEligible true), raiseEntrySourceTier NOT called, reinforce still applied, decidedBy "manager" (judge participated). Covers reconcile.ts:359 undefined-branch.

S-R5 tier raise on an entry the SAME tx invalidates is a benign no-op
SEED: flip scenario where judge returns {action:"invalidate", sourceTier:"observed", rationale} on an inferred entry at ceiling strong (flip + tierRaiseEligible both true). 
ASSERT: raiseEntrySourceTier called BEFORE invalidate (order per reconcile.ts:357-373 comment); raiseEntrySourceTier returns false (status flipped) is tolerated — tierRaised flag may be true/false but the job still completes; invalidateEntryOnReconcile + invalidateEdgesForOrigin both called. Characterizes the "raise on a row this tx retires" comment.

S-R6 judge cost/llmCalls accounting on a tier-only consult
SEED: F2 consult, judge verdict {action:"retain", sourceTier:"observed", rationale}, llmCalls:1, costUsd:0.003.
ASSERT: bumpJobInference(jobId,{llmCalls:1,costUsd:0.003}); decision carries inferenceProvider/inferenceModel/costUsd. (Existing flip-invalidate covers cost; add the F2-consult cost path.)

S-R7 judge returns llmCalls:0 → no bumpJobInference
SEED: flip, judge {verdict, llmCalls:0, costUsd:null}.
ASSERT: bumpJobInference NOT called (reconcile.ts:323 guard), decision still decidedBy "manager".

S-R8 claimLost before tx → early return, no writes, no completion
SEED: heartbeat stub returns false on first tick so claimLost flips; force the heartbeat by making the judge slow OR set claimLost via a heartbeat mock that returns false synchronously. Practically: mock heartbeat→false and use fake timers to fire the interval before the tx. resolved = reinforce-eligible.
ASSERT: withTransaction NOT called (reconcile.ts:344 `if (claimLost) return`), markCompleted NOT called, markFailed NOT called. (The claim-lost-before-tx guard is currently untested.)

S-R9 error-code mapping table
SEED: judge rejects with Error("...schema_invalid..."), then separately "...config...", "...malformed...", "...timeout...", and a generic.
ASSERT: markFailed called with "judge_schema_invalid"/"provider_config"/"judge_malformed"/"judge_timeout"/"job_error" respectively (mapReconcileErrorCode reconcile.ts:589-596). Existing test only covers timeout.

=== DETERMINISTIC — integration (new cases; extend src/__tests__/integration/repos/reconcile.int.test.ts) ===

S-I1 perps positionKey wake bridge (e2e, real repos)
SEED: makeSession; seed a promoted candidate whose evidenceRefs carry {executionId:openExec, positionKey:"perp-1"} (NOT instrumentKey); a CLOSED perps position via seedClosedPerpsPosition (from _eval-fixtures, or raw SQL mirror) with a signed MTM loss; old outcome open/neutral.
ACTION: enqueueLedgerWake([{executionId:closeExec, positionKey:"perp-1"}]) where closeExec is a NEW id.
ASSERT: matchedEntries:1; claimReconcile → entry.maturity_state per quench (negative MTM); decision row at v1. Proves the positionKey probe (currently only instrumentKey is exercised e2e).

S-I2 wake does NOT match a NON-promoted candidate
SEED: a PENDING candidate (never promoted) with evidenceRefs {executionId:E, instrumentKey:I}; plus a separate promoted candidate on a different instrument.
ACTION: enqueueLedgerWake([{instrumentKey:I}]).
ASSERT: matchedEntries:0; reconcileJobCount for any entry = 0. Proves the `status='promoted'` filter (crud.ts:301).

S-I3 wake does NOT match an INACTIVE entry
SEED: a promoted candidate whose entry is set status='invalidated'.
ACTION: enqueueLedgerWake on its key.
ASSERT: matchedEntries:0. Proves `ke.status='active'` (crud.ts:303).

S-I4 BitmapOr multi-probe hits one entry once (DISTINCT)
SEED: a promoted candidate with evidenceRefs [{executionId:E1,instrumentKey:I},{executionId:E2,instrumentKey:I}].
ACTION: enqueueLedgerWake([{executionId:E1},{executionId:E2},{instrumentKey:I}]) (3 probes, all hit the same entry).
ASSERT: matchedEntries:1, enqueued:1, reconcileJobCount:1. Proves SELECT DISTINCT (crud.ts:299) collapses multi-probe hits.

S-I5 LOST-WAKE matrix — completed re-arm vs running flag vs pending no-op (repo-level, extend memory-jobs-crud.int.test.ts)
This file already covers completed→re-arm, running→flag+consume, pending/failed→no-op, permfail→untouched, recover preserves flag, race-safe. ADD:
  (a) running→flag→recoverStaleRunning(stale)→pending(flag kept)→claim→markCompleted CONSUMES flag → one more pending pass. SEED: enqueue, claim, enqueue (flag), set heartbeat stale, recoverStaleRunning, claim again (attempt now 1), markCompleted → ASSERT status pending + wake_pending FALSE; claim third, markCompleted → completed. Proves the crash+flag+consume chain end-to-end (currently the recover-preserves test STOPS at flag-preserved; it never drives the recovered run's completion to prove the flag is still consumed).
  (b) DOUBLE wake while running raises the flag idempotently (two enqueues during running → wake_pending stays TRUE, still ONE row, attempt unchanged).

S-I6 full D-REARM convergence with a SECOND ledger move (extends the existing cycle test)
SEED: as the existing cycle test through v1, BUT before the third (v1) pass, seed a SECOND realized close that changes the outcome again (e.g. an additional matched loss flipping the aggregate).
ASSERT: the v1 pass now detects a real delta → produces a v2 decision (2 decisions total), and the queue drains. Proves the loop tracks a moving ledger across versions, not just converges to unchanged.

S-I7 stale-version pre-read re-enqueue lands a NEW row at the current version (e2e)
SEED: promoted candidate, entry outcome_version manually advanced to 2 AFTER a v0 job is enqueued (simulate a concurrent reconcile).
ACTION: claim the v0 job, processReconcileJob.
ASSERT: a NEW reconcile row exists at v2 (reconcileJobCount = 2), the v0 row is completed, resolveOutcome was effectively skipped (no decision at v0). Proves reconcile.ts:247.

=== F11 CHARACTERIZATION + TARGET (new file: src/__tests__/integration/repos/reconcile-deadend.int.test.ts) ===

S-F11a CHARACTERIZATION (asserts the CURRENT broken behavior, must pass today)
SEED: seedKnowledgeEntry; enqueueReconcileJob(entry,0); exhaustAttempts (claim+markFailed×3) → permanently_failed.
ACTION: fire enqueueLedgerWake / enqueueReconcileJob(entry,0) again (a fresh wake on the same key).
ASSERT: the row stays permanently_failed, wake_pending FALSE, NOT re-armed (crud.ts CASE leaves permfail untouched); claimNextDueJob returns null (the entry is now un-reconcilable). Document: "the ledger truth for this entry can never land until resetReconcileJob is wired." Record a reportCard finding {code:"F11", manifested:true, summary:"permanently_failed reconcile is unreachable by any production caller"}.

S-F11b TARGET (the fix's acceptance test — skipped/xfail until wired)
SEED: same permanently_failed row.
ACTION: the intended periodic revive (whatever wires resetReconcileJob — e.g. a bounded sweep in the executor bootstrap or a wake-time revive).
ASSERT: resetReconcileJob flips it to a clean pending (attempt 0, all audit fields nulled, wake_pending false — crud.ts:166-190), it becomes claimable, and a subsequent process run lands the ledger truth (decision at the current version). Mark `it.skip` / `it.fails` with a comment referencing F11 so the suite documents the intended target without going red before the fix.

=== LIVE-LLM — eval (extend src/__tests__/integration/eval/reconcile-s7.int.test.ts, behind describe.skipIf(!hasKey)) ===

S-E1 FLIP VERDICT QUALITY (measured, not gated)
The existing eval seeds a positive→negative flip and records whether the reconcile judge produced ANY valid verdict (F31). EXTEND: when the judge IS valid (job completed), record WHICH action it chose (invalidate/quench/retain) into reportCard.recordJudge verdict field, and a recordCheck whether the chosen action is "defensible" (invalidate or quench on a direct realized-loss-contradicts-the-win flip; retain is recorded as a soft-miss, never a hard fail). This is a MEASURED metric — never expect()'d red — because the verdict is model-dependent (per the live-LLM split).

S-E2 REINFORCE/QUENCH require NO judge (already deterministic) — add a recordCheck that on the reinforce eval path llmCallCount==0 on the job, proving the math path never burns an LLM call (cost guard).

## adversarial
A1 — SCAM-TOKEN FUZZY MERGE (must NOT happen at reconcile). The reconcile judge verdict schema (reconcile-policy.ts:210, RECONCILE_VERDICT_ACTIONS = invalidate|quench|retain) has NO supersede/content-bearing action and NO candidate to write (comment reconcile.ts FIX-4 / reconcile-policy.ts:204-210). Adversarial test: feed the judge stub a verdict carrying an extra `mergeInto`/`content` key → `reconcileVerdictSchema.strict()` rejects it → job fails closed. The reconciler can NEVER mint or merge a lesson; a contradicted lesson is invalidated (bi-temporal), never rewritten. ASSERT: no path in processReconcileJob writes a new candidate or knowledge entry; the only knowledge writes are tier-raise/maturity/status on the EXISTING entry.

A2 — WAKE PROBE INJECTION via a poisoned semantic key. A malicious capture could carry an instrumentKey crafted to match an unrelated victim lesson's anchor. Mitigation under test: the wake only matches candidates whose evidence_refs ALREADY contain that exact key (containment, crud.ts:295) AND that are promoted+active; it cannot create a NEW link. ASSERT: a wake with instrumentKey="X" does NOT touch a lesson anchored on "Y" even if both share an executionId namespace; matching is per-field containment, not substring/fuzzy.

A3 — JUDGE HALLUCINATES A TIER PROMOTION FROM THIN EVIDENCE. The judge proposes sourceTier:"observed" on a lesson whose ledger outcome is only `medium` quality (ceiling not strong). Mitigation: shouldConsultTierRaise is FALSE for non-strong ceilings (reconcile-policy.ts:158), so the judge is NEVER asked; even if it were, tierRaiseTarget clamps to ceiling (reconcile-policy.ts:189). ADVERSARIAL ASSERT: with resolved=closed+positive+MEDIUM, judge is NOT consulted and source is unchanged — the LLM cannot upgrade provenance beyond evidence.

A4 — JUDGE PROPOSES user_confirmed (minting a human affirmation). RECONCILE_TIER_PROPOSALS excludes user_confirmed (reconcile-policy.ts:218-222) and the schema enum rejects it; tierRaiseTarget's clamp returns null for it (reconcile-policy.ts:190). ASSERT: a verdict {sourceTier:"user_confirmed"} fails the strict schema → job fails closed; the reconciler can never fabricate a user-verified tier.

A5 — DELETION-VIA-QUENCH. A flood of realized losses must SUPPRESS but never DELETE. quenchedActivation floors at DECAY_FLOOR>0 (reconcile-policy.ts:142) and the entry stays status='active', maturity 'decayed', still recallable/reactivatable. ASSERT: after a quench the entry row still exists, activation==0.15 (or floor), and a later confirmed profit reactivates it to 0.6 (S-R1). Decay/quench is influence erosion, never a row delete (D-DECAY invariant).

A6 — REPLAY STORM. A historical replay/backfill re-projecting thousands of capture items must NOT enqueue thousands of reconcile jobs. replayActivityFromCapture structurally bypasses the seam (capture-pipeline.ts:127). ASSERT (already partially in reconcile.int.test.ts:391): a replay of any size produces ZERO reconcile jobs. Strengthen with N>1 items.

A7 — FAIL-OPEN ON WAKE ERROR MUST NOT FAIL-OPEN ON CONSEQUENCE. A wake failure is swallowed (capture-pipeline.ts:115-119, best-effort) so sync never breaks — CORRECT. But the reconcile CONSEQUENCE must be fail-CLOSED: a judge failure on a flip must NEVER apply a default action. ASSERT: the two error policies are distinct — wake error → caught+logged+continue; judge error → throw → markFailed → retry (no consequence). A test that conflates them (e.g. swallowing a judge error) is a regression.

## determinismSplit
DETERMINISTIC (hard-assertable gates):
- Wake mapping: buildWakeProbes dedup/skip (S-W1,S-W2,S-W3), findPromotedWakeTargets containment + promoted/active filters + DISTINCT (S-I2,S-I3,S-I4), single-seam vs replay (A6).
- Re-arm matrix: every enqueueReconcileJob CASE arm + markCompleted consumption + recoverStaleRunning preservation (S-I5a/b) — all ledger-derived, fully deterministic.
- Stale-version re-enqueue / version tracking (S-R… pre-read, S-I7, S-I6).
- Quench/reinforce/tier math: quenchedActivation, reinforcedActivation, nextStateOnDecay/Reinforce, tierRaiseTarget clamp+upward (S-R1,S-R2,S-R3,S-R4), and the consequence map 4×4 matrix (already pinned in reconcile-policy.test.ts).
- Lock-order disjointness (static/characterization — assert the documented order via the call sequence; no live concurrency needed).
- Fail-closed plumbing: schema.strict rejection (A1,A4), error-code mapping (S-R9), claim-lost guard (S-R8).
- F11 characterization (S-F11a) is deterministic and MUST pass today; the target (S-F11b) is a skipped acceptance gate.

LIVE-LLM (measured metrics, never red expect()):
- The FLIP VERDICT itself (invalidate vs quench vs retain) — model-dependent (S-E1). Recorded via reportCard.recordJudge/recordJudgeAttempt as the F31 valid-rate + chosen-action distribution. Defensibility is a soft metric, not a gate.
- Reconcile-judge OUTPUT-VALID RATE under the configured model (already the F31 headline). The wake+enqueue+re-resolve around it are deterministic HARD assertions even when the verdict is invalid (the existing eval already splits this correctly).
- The deterministic reinforce/quench paths in eval assert llmCallCount==0 (S-E2) — a cost gate, deterministic.

## currentCoverage
UNIT (deterministic, no DB):
- src/__tests__/vex-agent/memory/ledger-wake.test.ts: buildWakeProbes (dedup, single-field shapes, all-invalid skip), enqueueLedgerWake (zero-probe short-circuit, one-job-per-entry at current version, fresh-insert counting, deps-error propagation). Gaps: positionKey-only probe, MIXED valid+invalid in one key.
- src/__tests__/vex-agent/engine/memory-manager/reconcile.test.ts: every no-op branch (stale pre-read, inactive, no-candidate/no-outcome, unresolvable, unchanged, corrupt job), deterministic reinforce(prob→est)/quench/bookkeep, flip→judge invalidate/retain/quench, judge-failure→markFailed(timeout only), F2 tier-raise consult (inferred→observed) + observed-never-consults, tx version-race re-enqueue. Gaps: decayed→reactivation reinforce, reinforced-ceiling clamp@1.0, tier proposal-absent, tier-raise-on-invalidated-row, F2 cost accounting, llmCalls:0 path, claim-lost-before-tx, full error-code table.
- src/__tests__/vex-agent/memory/manager/reconcile-policy.test.ts: FULL 4×4×status consequence matrix, outcomeDelta (incl. version/audit exclusion), quenchedActivation (all edges incl. NaN/Inf/sub-floor), shouldConsultTierRaise, tierRaiseTarget (clamp+upward+observed-null), resolveFinalAction. This is thorough; no material gap.
- src/__tests__/vex-agent/memory/manager/reconcile-judge.test.ts (read by signature): judge call parsing/throwing. maturity-policy.test.ts: reinforce/decay/reactivation math.

INTEGRATION (real pgvector):
- src/__tests__/integration/repos/reconcile.int.test.ts: e2e reinforce (instrumentKey bridge), e2e quench, flip→stub-judge→invalidate (+recall predicate + edge note), real populateCaptureItems wake vs replay-no-storm, 2×wake→1job, completed→re-arm, full D-REARM cycle (flag→pending→stale→v1→unchanged). STRONG. Gaps: positionKey/perps bridge, non-promoted/non-active no-match, multi-probe DISTINCT, crash+flag+CONSUME chain, a moving second ledger across versions, stale-pre-read new-row.
- src/__tests__/integration/repos/memory-jobs-crud.int.test.ts: every enqueueReconcileJob CASE arm, markCompleted consume, recoverStaleRunning PRESERVES flag (gate R1), race-safe upsert, resetReconcileJob reset/guards, CHECK/uniqueness, cascade. STRONG. Gap: the recover→claim→COMPLETE-consume chain (test stops at flag-preserved), double-wake-during-running idempotency.

EVAL (live Gemma + DeepSeek):
- src/__tests__/integration/eval/reconcile-s7.int.test.ts: faithful flip via production seam, HARD asserts wake-matched + job-enqueued + re-resolve-negative, MEASURES the reconcile-judge valid-rate (F31). Gap: chosen-verdict distribution/defensibility, deterministic-path cost gate.

NOT COVERED ANYWHERE: F11 permanently_failed dead-end (no characterization test exists), claim-lost-before-tx guard, the perps positionKey wake e2e, the crash→recover→consume full chain, error-code mapping table beyond timeout, tier-raise-on-a-row-this-tx-invalidates.

## gaps
Ranked by risk:

G1 (HIGH) — F11 permanently_failed reconcile is a silent dead-end and is COMPLETELY UNTESTED. resetReconcileJob has zero production callers (verified: only crud.ts def, index.ts re-export, enum comment). A flip-judge failure that exhausts max_attempts (entirely plausible given the live F31 judge-format issue) strands the lesson with its STALE outcome forever — the ledger truth never lands. No test asserts this, and no test exists for the intended fix. This is the highest-value gap: it is a correctness hole in the always-on advisory memory.

G2 (HIGH) — Crash + wake_pending + CONSUME is only HALF tested. memory-jobs-crud.int.test.ts proves recoverStaleRunning PRESERVES the flag, but never drives the recovered run's markCompleted to prove the flag is still CONSUMED into one more pass after a crash. A regression that clears the flag on recovery would pass today. Must close the loop (S-I5a).

G3 (MED) — positionKey/perps wake bridge is untested e2e. Every existing wake test uses instrumentKey; the positionKey probe (the perps settlement case, the whole reason FIX-1 keeps positionKey) is never exercised through findPromotedWakeTargets on a real DB. A broken positionKey containment would ship green (S-I1).

G4 (MED) — Negative-space matching: a NON-promoted candidate or NON-active entry sharing a semantic key must NOT match. The filters exist (crud.ts:301-303) but no test seeds a poisoned/pending/invalidated neighbor to prove they hold. Adversarial relevance (A2) (S-I2,S-I3).

G5 (MED) — claim-lost-before-tx guard (reconcile.ts:344) is untested. A worker that lost its claim mid-judge must NOT start the tx. Currently no assertion (S-R8).

G6 (LOW) — Reinforce of a DECAYED entry (reactivation to 0.6) and reinforced-ceiling clamp@1.0 are untested at the worker level (only the pure maturity-policy math is). The worker-level wiring of reinforcedActivation for decayed could regress silently (S-R1,S-R2).

G7 (LOW) — error-code mapping table only covers timeout; schema_invalid/malformed/config/generic are unverified at the worker (S-R9). Affects telemetry/observability fidelity, not correctness.

G8 (LOW) — Tier-raise on a row the SAME tx invalidates (the documented benign-no-op, reconcile.ts:357-364) and F2 cost accounting are untested (S-R5,S-R6).

G9 (LOW, MEASURE) — flip-verdict QUALITY is recorded as F31 valid-rate but the chosen-action distribution (invalidate/quench/retain) is not captured, so we cannot tell a fail-closed-on-garbage from a confidently-wrong invalidate (S-E1).

## priority
Smallest-effective-first, top 5 must-build:

1. S-F11a — F11 CHARACTERIZATION (new src/__tests__/integration/repos/reconcile-deadend.int.test.ts). ~30 lines reusing seedKnowledgeEntry + exhaustAttempts from memory-jobs-crud.int.test.ts. Asserts the permanently_failed reconcile is unreachable by any wake/enqueue, records the F11 finding. HIGHEST VALUE: it is the only test that surfaces the live correctness hole, and it pairs with S-F11b (it.skip) as the fix's acceptance gate. Pure deterministic.

2. S-I5a — CRASH→RECOVER→CONSUME full chain (extend memory-jobs-crud.int.test.ts). Closes G2 by driving the recovered run's markCompleted to prove the flag is still consumed. ~20 lines added to the existing recover-preserves test. Deterministic, no LLM.

3. S-R8 + S-R9 — claim-lost-before-tx guard + full error-code mapping table (extend reconcile.test.ts). Stubbed-IO unit cases, no DB. Closes G5 + G7. ~25 lines. The claim-lost guard is a fail-closed safety property; the error map is telemetry fidelity.

4. S-I1 + S-I2 + S-I3 — positionKey perps bridge + non-promoted/non-active negative matches (extend reconcile.int.test.ts). Closes G3 + G4 and the A2 adversarial. ~60 lines reusing the existing seeders + a positionKey variant of seedPromotedCandidate. Real-DB deterministic.

5. S-R1 + S-R2 — decayed→reactivation and reinforced-ceiling clamp at the worker (extend reconcile.test.ts). Closes G6. ~20 lines, stubbed IO. Proves the worker wires reinforcedActivation correctly for the resurrection branch.

(Stretch, lower priority: S-E1 flip-verdict distribution as a measured metric in the eval; S-I6 moving-ledger-across-versions; S-R5/S-R6 tier-on-invalidate + F2 cost.)

