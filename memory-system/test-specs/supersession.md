## domain
Supersession & Lineage (memory v2): supersede transaction atomicity, the lineage state machine (root→head, multi-hop, MAX_LINEAGE_HOPS), the chain-head FSM invariant, the no-blind-supersede downgrade, probationary successor + valid_from carry, long_memory_get redirect, long_memory_history version+reinforcement timeline, superseded-never-in-recall/hot-context, the F7 cross-kind targeting gap, and graph-edge bi-temporal invalidation on supersede.

## correctnessProperties
P1 ATOMICITY — a supersede flips predecessor→status='superseded' in the SAME tx that inserts the successor (active). Enforced: `runSupersedeStatements` (db/repos/knowledge-lifecycle/supersede.ts:35-201): INSERT successor at L126-188, UPDATE predecessor at L193-201, both inside one BEGIN/COMMIT (knowledge-lifecycle.ts:81-93). Testable: there is NEVER a successor row whose predecessor is still 'active', nor a predecessor 'superseded' with no successor.

P2 SINGLE-SUCCESSOR LINEAGE — at most one successor per predecessor. Enforced 4x: in-tx pre-check supersede.ts:102-113, partial unique index `idx_ke_supersedes_id`, race-loss mapping supersede.ts:224-231, and the active-status guard supersede.ts:47-71. Testable: a 2nd supersede of the same predecessor → SupersedeError(predecessor_already_superseded), never a second active successor.

P3 CHAIN-HEAD = ACTIVE INVARIANT — the chain head is the unique active entry; every non-head node is non-active. Enforced by P1 (predecessor flipped on each hop) + recall filter status='active' (recall.ts:71). Testable via getLineageChain (knowledge/lineage.ts:99-106): exactly one chain node has status='active' and it is `head` (chain[last]); headStatus mirrors it.

P4 NO-BLIND-SUPERSEDE — a supersede verdict with no resolvable predecessor downgrades to retain. Enforced: planFromVerdict (consolidate.ts:317-329) `previousKnowledgeId = verdict.previousKnowledgeId ?? conflictKnowledgeId`; null/undefined → `{type:'retain'}`. Testable: judge supersede + null id + null conflict → plan.type==='retain', nothing superseded.

P5 SUCCESSOR PROBATIONARY + VALID_FROM — successor is born probationary/advisory/activation=PROBATION_ACTIVATION; honours options.validFrom (else NOW()). Enforced: buildPromotionInsert (promote.ts:160-186) sets maturityState='probationary', influenceScope='advisory', activationStrength=PROBATION_ACTIVATION; validFrom passed via supersedeFromCandidate (promote.ts:289) → supersede.ts:186 `COALESCE($29,NOW())`. Testable: successor.maturityState==='probationary', validFrom==boundary.

P6 GET REDIRECT — long_memory_get on a superseded entry FAILS with a redirect to the successor id. Enforced: get.ts:42-47 (`entry.status!=='active' && entry.supersededBy!==null`). supersededBy resolved by reverse-join getById (crud.ts:166-178). Testable: success===false, message contains `entry {succId}`.

P7 HISTORY COMPLETENESS — long_memory_history returns the full root→head chain + reinforcement timeline (firstPromotedAt/lastReinforcedAt/outcomeVersion/maturityState) for the REQUESTED id. Enforced: history.ts:27-54 (getLineageChain + getById(id) merge). Testable: chainLength==N, chain ids ordered root→head, reinforcement belongs to requested id not head.

P8 SUPERSEDED NEVER RECALLED / HOT — a superseded predecessor never surfaces in recall, graph expansion, or hot-context. Enforced: recall.ts:71 (status='active'), getActiveEntriesByIds crud.ts:415-417 (status='active'), hot-context.ts:55-58 (status='active'). Testable: predecessor id absent from all three after supersede.

P9 IDENTICAL/COLLISION REFUSAL — supersede refuses if successor content_hash == predecessor (supersede.ts:74-80) or collides with any other row (supersede.ts:84-96). Testable: SupersedeError(identical_content|content_hash_collision), no INSERT.

P10 EDGE RETRACTION ON SUPERSEDE — the predecessor's active edges are bi-temporally retracted (invalidated_at=NOW(), valid_until untouched) in the SAME tx, under a savepoint. Enforced: consolidate.ts:675 (predecessorId), :763-765 invalidateEdgesForOrigin inside SAVEPOINT graph_plan; crud.ts:441-456 sets invalidated_at only, guarded invalidated_at IS NULL (idempotent). Entry↔entity links survive (comment crud.ts:435-439). Testable: predecessor edges invalidated_at NOT NULL, valid_until unchanged, memory_entry_entities rows preserved.

P11 MAX_LINEAGE_HOPS BOUND — getLineageChain recursion is capped at 100 hops each direction (lineage.ts:25,69,82). Testable: a chain longer than the cap does not error and returns a bounded window.

## scenarios
### A. ATOMICITY (real-DB, DETERMINISTIC) — new file `src/__tests__/integration/eval/supersede-lineage.int.test.ts` (or `integration/memory/`)
**A1 supersede flips predecessor in the same tx**
- SEED: `seedPromotedLessonDirect({kind:'risk_rule', title:'cap 10%', summary:'pos size <=10%', source:'observed', maturityState:'established'})` → predId. Build a candidate (real Gemma) on the SAME topic with DIFFERENT number ("cap 5%").
- ACTION: call `supersedeEntry({previousId:predId, contentHash:<new>, ...successor fields})` directly (own-tx path), OR drive via `applyDecision(candidate,{type:'supersede',previousKnowledgeId:predId,...},jobId,tx)` inside one `withTransaction`.
- EXPECT: result.successor active w/ supersedesId===predId; result.predecessor status==='superseded'.
- ASSERT: `getById(predId).status==='superseded'` AND `.supersededBy===successor.id`; `getById(successor.id).status==='active'` AND `.supersedesId===predId`; a single `SELECT count(*) WHERE supersedes_id=predId` ===1.

**A2 atomicity rollback (no half-state)**
- SEED: predId as A1. Inject a successor INSERT that violates a constraint AFTER predecessor lock (e.g. pass embeddingDim mismatch is pre-tx; instead force the predecessor UPDATE to fail by racing — simpler: assert the documented invariant by SQL after a FORCED throw using an external tx the test rolls back).
- ACTION: open `withTransaction` running supersedeEntry(client) then `throw`; let the tx roll back.
- ASSERT: after rollback predecessor is STILL 'active', NO successor row exists (`count WHERE supersedes_id=predId`===0). Proves the two writes are bound to one tx.

**A3 second supersede on same predecessor rejects**
- SEED: predId; perform one successful supersede → succ1.
- ACTION: attempt a second `supersedeEntry({previousId:predId,...})` with different content.
- EXPECT/ASSERT: throws `SupersedeError` code `predecessor_already_superseded`, details.supersededBy===succ1.id; still exactly one successor; predecessor unchanged.

**A4 supersede of a non-active predecessor rejects**
- SEED: predId, then directly mark it 'invalidated' (or supersede it once → 'superseded').
- ACTION: supersedeEntry on the now-non-active id.
- ASSERT: SupersedeError code `predecessor_not_active` (invalidated) / `predecessor_already_superseded` (superseded). Never a blind chain fork.

### B. LINEAGE STATE MACHINE (real-DB, DETERMINISTIC)
**B1 multi-hop chain integrity** — extends `lineage-suite.ts` (which is mock-only) into real DB.
- SEED: build a 3-version chain by two real supersedes: A(cap10)→B(cap5)→C(cap3). Capture ids.
- ACTION: `getLineageChain(B)` (queried from the MIDDLE), `getLineageChain(A)` (root), `getLineageChain(C)` (head).
- ASSERT (each): `chain.map(c=>c.id)===[A,B,C]` root→head order; `headId===C`; `headStatus==='active'`; exactly ONE node active (=C); A,B status 'superseded'; `requestedId` matches input.

**B2 head FSM invariant after a terminal head** — supersede A→B, then `invalidateEntryOnReconcile(B)` (crud.ts:498). 
- ASSERT: `getLineageChain(A).headId===B`, `headStatus==='invalidated'`; NO node is active; recall/hot-context return neither A nor B.

**B3 MAX_LINEAGE_HOPS** — SEED a chain of >100 versions (loop supersede with distinct content). 
- ACTION: getLineageChain(root). 
- ASSERT: returns without error; chain length bounded (<= 1 + 100 per the down/up window); no recursion blow-up. (Effort note: 100 supersedes is heavy — alternatively assert the SQL passes `MAX_LINEAGE_HOPS` param and unit-cover the cap via the existing mock suite; keep the real-DB version at a smaller cap if a test-only cap is exposed.)

**B4 valid_from carry onto successor** — drive a trade-family supersede via `applyDecisionAtomically` with an outcome+boundary; 
- ASSERT successor `valid_from` === boundary ISO (not NOW()), `outcome_version===0`, `maturity_state==='probationary'`.

### C. NO-BLIND-SUPERSEDE (unit, DETERMINISTIC) — extend `consolidate-decision.test.ts` & `promote-mapping.test.ts`
**C1** already covered (consolidate-decision.test.ts:159) for null id. ADD: judge supersede + null previousKnowledgeId BUT a deterministic `conflictKnowledgeId=77` present → plan.type==='supersede', previousKnowledgeId===77 (the fallback path, currently only the happy id=99 is tested at :184).
**C2** judge supersede + valid previousKnowledgeId + conflictKnowledgeId DIFFERENT → verdict id WINS (precedence): assert plan.previousKnowledgeId===verdict id, not the conflict id.

### D. TOOL SURFACE (real-DB, DETERMINISTIC) — extend retrieval-precision / new tool test
**D1 get redirect** — SEED A→B supersede. `handleLongMemoryGet({id:A}, ctx)`.
- ASSERT: success===false; message includes `current version is entry {B}`; loadedDocuments NOT populated for A.
**D2 get on terminal-no-successor** — SEED an invalidated entry with no successor. ASSERT message says "no longer current" / re-search, success===false.
**D3 get on active head** — `handleLongMemoryGet({id:B})` → success===true, data.supersedesId===A, data.supersededBy===null, loadedDocuments has `long_memory:B`.
**D4 history full chain + reinforcement** — SEED A→B→C, reinforce C once (`reinforceEntry`). `handleLongMemoryHistory({id:B})`.
- ASSERT: chainLength===3, chain ids [A,B,C], headStatus 'active'; reinforcement belongs to B (requested id) — firstPromotedAt/lastReinforcedAt/outcomeVersion/maturityState of B, NOT C.
**D5 history on missing id** → success===false, re-search hint.

### E. SUPERSEDED-NEVER-SURFACES (real-DB, DETERMINISTIC) — extend `retrieval-precision.int.test.ts`
**E1** SEED A (active, near a query vector), supersede A→B (B same neighborhood). Run `recallLongMemoryTopK(qvec)` and `handleLongMemorySearch`.
- ASSERT: A absent from results; B present. `getActiveEntriesByIds([A,B])` returns only B. `listActiveForHotContext` excludes A (and excludes B too while probationary — cross-check P5).
**E2** after B matures (set maturity_state='established'), B enters hot-context; A still excluded forever.

### F. ADVERSARIAL F7 — CROSS-KIND / ARBITRARY TARGET (unit + real-DB, DETERMINISTIC)
**F1 (pins the current gap)** SEED two unrelated active entries: P_riskrule (kind risk_rule) and P_marketnote (kind market_note), cosine-distant. Build a `risk_rule` candidate. Drive `applyDecision` with a STEERED supersede plan `{type:'supersede', previousKnowledgeId: P_marketnote.id}` (simulating a poisoned judge targeting a DIFFERENT kind).
- EXPECTED (as-built): the supersede SUCCEEDS at the repo layer — there is NO kind/cosine guard (judge-schema.ts:94-96 only checks positive int; planFromVerdict:318 passes it verbatim; supersede.ts only checks active+content-differs). This test must PIN that the ONLY constraints are: predecessor active, content differs, no existing successor.
- ASSERT (what currently holds): P_marketnote flips to superseded by a risk_rule successor. Then the test ASSERTS THE GAP EXPLICITLY (a `recordFinding({code:'F7', manifested:true, summary:'judge previousKnowledgeId is unconstrained by kind/cosine — a steered supersede can retire an arbitrary active entry'})`). If a guard is later added (e.g. require same-kind OR cosine≥CONFLICT_COSINE OR previousKnowledgeId ∈ nearDupTopK ids), flip this to assert the supersede is REFUSED/downgraded.
**F2 target validation against escalation signals** — assert (and propose as the fix surface) that a correct implementation constrains `verdict.previousKnowledgeId` to the set of `signals.nearDupTopK[].knowledgeId` (deterministic-stage.ts:237). Test: a previousKnowledgeId NOT in nearDupTopK should be rejected/ignored. Currently this is NOT enforced — the test documents the missing invariant.

### G. EDGE INVALIDATION ON SUPERSEDE (real-DB, DETERMINISTIC) — extend `graph.int.test.ts`
**G1** SEED predId via seedPromotedLessonDirect + applyGraphPlan giving predId 2 entities, 1 edge (origin_entry_id=predId), 1 entry↔entity link. Drive a real supersede of predId via `applyDecisionAtomically({plan:{type:'supersede',previousKnowledgeId:predId},graphPlan:<new>})`.
- ASSERT: predecessor edges `invalidated_at IS NOT NULL`; their `valid_until` UNCHANGED (still NULL); `memory_entry_entities` rows for predId PRESERVED (links survive); the NEW successor has its own fresh edges from graphPlan.
**G2 idempotency** — call `invalidateEdgesForOrigin(predId)` twice; second returns 0 (guard invalidated_at IS NULL).
**G3 savepoint isolation** — make the graphPlan apply throw (bad entity dim) AFTER predecessor-edge invalidation; ASSERT the promotion/supersede STILL commits (fail-open) and the predecessor-edge retraction is preserved (it ran before the failing applyGraphPlan inside the same savepoint — verify whether a ROLLBACK TO SAVEPOINT also undoes the retraction; this is a SUBTLE ordering test worth pinning: invalidateEdgesForOrigin runs at consolidate.ts:764 BEFORE applyGraphPlan:768 inside the SAME savepoint, so a graphPlan failure ROLLS BACK the retraction too — assert the as-built behavior and flag if undesired).

### H. LIVE-LLM (MEASURED, not gated) — extend the eval report
**H1** Drive a real same-topic-different-number candidate through `driveConsolidateCapturingJudge`; if the judge returns supersede, record whether previousKnowledgeId matches the deterministic conflict id (target-fidelity metric) and whether the predecessor actually flipped. Record via reportCard.recordJudge / recordFinding — never hard-assert verdict quality (F31 valid-rate ≈ 0 today).

## adversarial
THE central adversarial concern (owner-flagged F7): the judge's `previousKnowledgeId` is essentially UNCONSTRAINED. Evidence: judge-schema.ts:87,94-96 only requires it to be a positive int when verdict==='supersede'; `planFromVerdict` (consolidate.ts:318) takes `verdict.previousKnowledgeId ?? conflictKnowledgeId` with NO check that the id is the same KIND, in the near-dup top-K, above CONFLICT_COSINE, or even semantically related; `runSupersedeStatements` only enforces (a) predecessor exists, (b) status='active', (c) content_hash differs, (d) no existing successor. NET: a steered/poisoned judge can retire ANY active entry of ANY kind by emitting its id. What a test MUST pin: (1) the EXACT current constraint set (active + content-differs + single-successor) so a future tightening is a visible diff; (2) the GAP — supersede of a cross-kind, cosine-distant target currently SUCCEEDS — recorded as F7 manifested; (3) the proposed invariant: `previousKnowledgeId` MUST be a member of `signals.nearDupTopK[].knowledgeId` (or at minimum same-kind + cosine≥CONFLICT_COSINE). 

What must NOT happen (and tests must prove the existing guards hold): (i) NO blind supersede when the id is null/0/missing — must downgrade to retain (P4, consolidate.ts:319); a regression here would let an unresolved verdict silently fork lineage. (ii) NO supersede that OVERWRITES the predecessor in place — supersession is INSERT-successor + FLIP-predecessor, the predecessor row + its content_hash + embedding are PRESERVED (lineage/audit intact); a test must assert the predecessor body is byte-identical post-supersede. (iii) NO fuzzy/identical merge masquerading as supersede — identical content_hash is refused (P9), so a scam-token "update" that is actually the same text cannot create a phantom version. (iv) NO second active successor (P2) — prevents lineage branching / two competing heads. (v) Decay/maturity must NEVER delete or supersede — orthogonal but worth a guard assertion: the maturity FSM floors activation>0 and only touches status='active' rows (crud.ts:257-292 comment), it never flips status; a superseded row is invisible to the decay sweep (listDecayableEntries filters status='active', crud.ts:335). (vi) A poisoned candidate that trips defense-in-depth redaction during a supersede build must NOT store — currently `supersedeFromCandidate` (promote.ts:250) calls buildPromotionInsert which THROWS PromoteRedactionAnomalyError, but UNLIKE promote (promote.ts:390-403) the supersede branch does NOT catch it → it propagates and aborts the whole tx (no partial supersede). Test must pin: a redaction-tripping supersede aborts atomically (predecessor stays active), it does NOT silently downgrade to reject the way promote does — this asymmetry is worth an explicit assertion.

## determinismSplit
DETERMINISTIC (hard-assertable gates — ledger/SQL/predicate-derived, no LLM):
- ALL of A (atomicity/rollback/double-supersede/non-active), B (lineage chain order, head=active, headStatus, valid_from carry, MAX_LINEAGE_HOPS), C (planFromVerdict downgrade + fallback precedence — pure function), D (get/history tool DTO shapes + redirect strings), E (recall/hot-context exclusion via status='active' SQL), F (F7 cross-kind supersede succeeds/refuses — pure repo behavior, no judge), G (edge invalidated_at set, valid_until untouched, links survive, idempotency, savepoint isolation), P9 identical/collision refusal. These are all derivable from the supersede SQL, getLineageChain CTE, the recall/hot-context WHERE clauses, and planFromVerdict — zero LLM dependency. They belong in unit (mock-pg or pure-function) + testcontainers integration suites and are GATES (must pass).

LIVE-LLM (MEASURED metrics — recorded, never gated, F31 valid-rate≈0 today):
- H (does the real judge, when it returns supersede, pick the deterministic conflict id? does the predecessor flip end-to-end?). Verdict QUALITY (is supersede the RIGHT call vs retain), target FIDELITY (previousKnowledgeId == conflict id), and judge valid-rate are all live-LLM measured via reportCard.recordJudge/recordFinding. They must use `driveConsolidateCapturingJudge` (which swallows memory_judge_* failures) so a broken judge never reds the suite. The supersede MECHANICS once a verdict exists are deterministic and can be force-driven by injecting a fixed verdict (the F-series), divorcing the gate from the live model.

## currentCoverage
UNIT (well covered): `promote-mapping.test.ts` mocks the repos and pins applyDecision dispatch — promote mapping (probationary/advisory/activation<1/source/regimeTags), embedding+content-hash reuse, FIX-1 anchor nesting, redaction-anomaly→reject, supersede records both ids (supersedeEntry mocked returning {successor:{id:5678},predecessor:{id:99}}), retain/reject/expire flips. `consolidate-decision.test.ts:159-213` pins planFromVerdict: supersede→retain when id absent (only the null case), supersede→supersede with id=99 (only the verdict-id happy path), clampSourceTier ceiling+user_confirmed exemption. `knowledge-lifecycle.test.ts` exhaustively pins `supersedeEntry` with a MOCKED pg client: happy path (lock→collision-check→successor-check→INSERT→UPDATE→COMMIT), v2 successor field carry, all SupersedeError codes (not_found/not_active/already_superseded/identical_content/content_hash_collision), 23505 constraint discrimination, invalid id, embedding-dim mismatch. `lineage-suite.ts` pins getLineageChain with MOCKED query rows: null on bad id, single-node head, multi-step A→B→C from middle/head, terminated head status, metadata propagation, single CTE round-trip.

INTEGRATION (real testcontainers pg): `memory-manager-consolidate.int.test.ts` drives a real PROMOTE end-to-end (probationary entry, source_refs anchors, retain at n=1, OD-3 reject, hot-context exclusion of probationary, owner-check claim-lost, idempotent-close) — but NO real supersede. `reconcile.int.test.ts`/`reconcile-s7.int.test.ts` exercise invalidate (status flip) but NOT supersede. `memory-edges-crud.int.test.ts` / `graph-v1.int.test.ts` cover edge CRUD but the eval `graph.int.test.ts` only tests forward applyGraphPlan, NOT invalidateEdgesForOrigin on supersede.

EVAL HARNESS (live Gemma+DeepSeek, ephemeral pg): `lifecycle.int.test.ts` (F1/F2/F3 hot-context+cold-start+recurrence-TTL), `retrieval-precision`, `consolidation-judge`, `outcome-s5`, `reconcile-s7`, `graph`, `write-gates`, with `_eval-fixtures.ts` seeders (seedPromotedLessonDirect, seedGemmaCandidate, seedGemmaKnowledgeEntry, driveConsolidateWithRealJudge, driveConsolidateCapturingJudge) and the disk-backed `_report-card.ts`.

NOT COVERED (honest gaps): (1) NO real-DB supersede end-to-end test ANYWHERE — supersede atomicity/rollback is only proven against a MOCK pg client; the real INSERT+UPDATE-in-one-tx, the real partial unique index, and getById's reverse-join supersededBy are never exercised together on real pg. (2) NO test of the get/history TOOLS on a superseded entry (redirect string, history reinforcement-of-requested-id). (3) NO test that a superseded predecessor is excluded from recall/graph-expansion/hot-context on real data. (4) NO F7 adversarial test — cross-kind/arbitrary-target supersede is completely untested. (5) NO edge-invalidation-on-supersede test (P10) — the D-SUPERSEDE-WIRING path at consolidate.ts:763 has zero coverage. (6) The planFromVerdict conflict-id FALLBACK (verdict id null but conflictKnowledgeId present) and verdict-id-WINS precedence are untested. (7) The supersede redaction-anomaly asymmetry (aborts vs promote's downgrade) is untested. (8) MAX_LINEAGE_HOPS on real data untested.

## gaps
Ranked by risk:
1. (CRITICAL) NO real-DB supersede end-to-end — atomicity (P1), rollback (P2), the reverse-join supersededBy, and the head=active invariant are proven only against a MOCK client. A real INSERT+UPDATE ordering bug, FK/index regression, or partial-commit would pass every existing test. This is the owner's #1 ask and is the single biggest hole.
2. (CRITICAL) F7 cross-kind/arbitrary-target supersede entirely untested. A poisoned judge can retire any active entry of any kind; nothing pins the (absent) guard. The blast radius is silent retirement of unrelated lessons.
3. (HIGH) Edge bi-temporal invalidation on supersede (P10, D-SUPERSEDE-WIRING) — zero coverage. A supersede that fails to retract predecessor edges leaves stale graph claims live; a supersede that wrongly nukes entry↔entity links loses history.
4. (HIGH) Tool redirect (P6) + history reinforcement-of-requested-id (P7) untested — the agent-facing navigation contract (get steers to successor, history shows full chain) has no test; a redirect-string regression silently breaks agent recovery.
5. (HIGH) Superseded-never-recalled/hot-context (P8) untested on real data — a recall WHERE-clause regression would resurface retired lessons into the always-on prompt (memory-poisoning surface).
6. (MEDIUM) planFromVerdict fallback/precedence (conflict-id path, verdict-id-wins) untested — only null + verdict-id=99 covered. The deterministic conflict fallback at consolidate.ts:318 could break unnoticed.
7. (MEDIUM) supersede redaction-anomaly asymmetry — supersedeFromCandidate does NOT catch PromoteRedactionAnomalyError (unlike promote), so it aborts the whole tx. Untested; a future refactor could change this to a silent downgrade and fork lineage on poisoned input.
8. (LOW) MAX_LINEAGE_HOPS on real data; double-invalidateEdgesForOrigin idempotency; multi-hop chain queried from middle on real pg.

## priority
1. NEW `src/__tests__/integration/eval/supersede-lineage.int.test.ts` (testcontainers, DETERMINISTIC, force-driven verdicts — no live judge dependency so it runs green regardless of F31): cover A1 (same-tx flip), A3 (double-supersede rejects), B1 (3-hop chain root→head order + head=active + exactly-one-active), D1+D3+D4 (get redirect / get active head / history full chain + reinforcement-of-requested-id), E1 (predecessor absent from recall+search+getActiveEntriesByIds, B excluded from hot-context while probationary). This single file closes gaps 1, 4, 5 — the highest-risk holes — using existing seeders (seedPromotedLessonDirect → predecessor; a real Gemma candidate + forced supersede plan via applyDecision/supersedeEntry). Smallest-effective-first: start with A1+B1.

2. F7 adversarial (DETERMINISTIC) — add to the same new file OR a focused `supersede-targeting.int.test.ts`: F1 (cross-kind steered supersede SUCCEEDS today → assert the exact as-built constraint set + recordFinding F7 manifested) and F2 (previousKnowledgeId outside nearDupTopK is unconstrained — document the missing invariant). Closes gap 2. This is the owner-flagged adversarial case and must exist even if it currently asserts the GAP rather than a guard.

3. Edge-invalidation-on-supersede (DETERMINISTIC) — extend `graph.int.test.ts`: G1 (predecessor edges invalidated_at NOT NULL + valid_until untouched + links survive + successor gets fresh edges) and G2 (idempotency). Closes gap 3 / P10.

4. planFromVerdict fallback+precedence + supersede redaction-anomaly asymmetry (UNIT, pure/mock — fast) — extend `consolidate-decision.test.ts` (conflict-id fallback, verdict-id-wins) and `promote-mapping.test.ts` (supersedeFromCandidate propagates PromoteRedactionAnomalyError, no partial write). Closes gaps 6, 7 cheaply.

5. A2 rollback + A4 non-active-predecessor (DETERMINISTIC integration) — round out atomicity once 1-4 land.

