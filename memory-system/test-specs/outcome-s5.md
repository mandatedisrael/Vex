## domain
Outcome Resolution + Point-in-Time + Bi-Temporal (S5) — ledger-derived trade/decision outcome that the memory_manager computes from the LOCAL ledger before promote, never from the agent's declaration.

## correctnessProperties
Each property below is a testable invariant with file:line evidence of where it is enforced. Where a property is NOT enforced as I expected, I flag it.

P1 — D-OUTCOME-SRC (facts, never the claim). The outcome is derived ONLY from ledger reads (executions→activities→matches/positions/lp_events). The agent's title/summary/declaration is never an input to status/lessonSignal/evidenceQuality. Enforced: outcome-resolver.ts:300-345 — `resolveOutcome` takes only `candidate.evidenceRefs` (for the anchor) and the injected ledger deps; nothing reads `candidate.title/summary`. signalFromPnl (outcome-resolver.ts:102-106) is fed ONLY `realizedTotal` from `proj_pnl_matches.realized_pnl_usd`.

P2 — Spot CLOSED+STRONG requires ≥1 matched row with non-null realized_pnl_usd. evidenceQuality 'strong' on a spot anchor is reachable ONLY when `matchKind === "matched" && pnl !== null` for ≥1 row. Enforced: outcome-resolver.ts:131-151 (`matchedRows>0` gate; shortfall rows with null realizedPnlUsd are skipped at line 135). A shortfall-only sell → weak/none (outcome-resolver.ts:169-177).

P3 — Only the PnL SIGN enters the lesson; no raw amounts. The summary carries `lessonSignal` ∈ {positive,negative,neutral,mixed}, never a number. The schema is `.strict()` and has NO monetary field. Enforced: memory-outcome.ts:80-93 (`.strict()`, no amount key), signalFromPnl returns only an enum (outcome-resolver.ts:102-106). Persisted prose must not contain the realized number — the promoted entry's title/summary derive from the candidate text, not the outcome (consolidate.ts:653-667; the outcome JSONB is written separately to memory_candidates.outcome, never into knowledge title/summary).

P4 — Perps/prediction/order → medium ceiling + needsReconciliation, NEVER strong. A CLOSED position resolves to evidenceQuality 'medium', needsReconciliation true. Enforced: outcome-resolver.ts:214-224 (closed → medium + needsReconciliation:true). POSITION_PRODUCTS = {perps,prediction,order} (outcome-resolver.ts:63). 'strong' is structurally unreachable for these because resolvePositionOutcome never returns 'strong'.

P5 — LP → medium via a withdraw event; otherwise open. `closed` is true iff some event has `action === "withdraw"`; evidenceQuality is always 'medium' when events exist, 'weak'/none when empty. Enforced: outcome-resolver.ts:259-286 (line 269 `events.some(e=>e.action==="withdraw")`). FLAG: the production projector writes `proj_lp_events.action` from `meta.action` = zap-in/zap-out/zap-migrate (lp.ts:65,82), NOT "withdraw" — so a faithfully-seeded zap-out would resolve OPEN, not closed. This is a real lineage mismatch the eval must surface (see gaps).

P6 — Thin/uncovered venue → honest weak/neutral/none/needsReconciliation. Any product_type not in {spot,lp,perps,prediction,order}, or no activity row, returns status open, lessonSignal neutral, evidenceQuality weak, pnlSource none, needsReconciliation true. Enforced: classifyVenue default→"thin" (outcome-resolver.ts:66-71) and the thin branch (outcome-resolver.ts:325-332).

P7 — No-lookahead: strong requires a derivable as-of boundary. `pointInTimeChecked` is true iff the boundary is non-null; a null boundary degrades strong (the ceiling check requires pointInTimeChecked===true). Enforced: checkNoLookahead (point-in-time.ts:84-86) and deriveEvidenceStrengthCeiling (evidence-deref.ts:128-135 — the strong branch requires `outcome.pointInTimeChecked === true`). consolidate.ts:441-465 wires boundary→pit→outcome→ceiling in that order.

P8 — Boundary = eventTime else earliest surviving anchor created_at else null. Enforced: deriveDecisionBoundary (point-in-time.ts:51-72). A null boundary is stamped as available_at_decision_time NULL and degrades, never rejects (consolidate.ts:442-446; updateCandidateOutcome passes null through, crud.ts via memory-candidates-outcome.test.ts:73-78).

P9 — Replay-stability: deref by immutable executionId, never a proj_* serial. The only stable key is protocol_executions.id (anchor.executionId); the spot path links sell via `getMatchesBySell(activity.id)` where `proj_pnl_matches.sell_activity_id = proj_activity.id` (spot.ts:110 writes `activity.id`). After TRUNCATE+regenerate of proj_* the same anchor re-derives an identical summary. Enforced: outcome-resolver.ts:305-313 (iterates `candidate.evidenceRefs[].executionId`), and the existing replay test (memory-manager-outcome.int.test.ts:250-269) proves byte-equality.

P10 — valid_from = the as-of boundary; outcome_version=0 at promote. On a trade-family promote the boundary becomes knowledge_entries.valid_from and outcome_version is explicitly 0. Enforced: applyDecisionAtomically (consolidate.ts:662-667 passes `validFrom: boundary, outcomeVersion: 0` only when an outcome exists), promote.ts:183-185,289-290.

P11 — Outcome only for trade-family kinds. resolveOutcome runs ONLY when isTradeKind(candidate.kind) (consolidate.ts:438-458); non-trade kinds leave outcome null and stay at the S4 ceiling (max 'moderate'). isTradeKind matches substrings {trade,strategy,risk,position,entry,exit} (kind-families.ts:21,41-43).

P12 — Resolver reads the FIRST surviving anchor's activities only. It picks the first anchor whose execution exists (outcome-resolver.ts:306-311) and reads `getActivitiesByExecution(exec.id)` for that ONE execution (outcome-resolver.ts:313). Consequence: for the faithful spot seeder where buy and sell are SEPARATE executions, the candidate MUST anchor the SELL execution first for the resolver to see a sell activity (the eval relies on this — _eval-fixtures.ts:815-818 orders sell before buy).

P13 — outcomeComputedBy='memory_manager', outcomeVersion 0 at S5 init, pointInTimeChecked carried through. Enforced: outcome-resolver.ts:340-342.

## scenarios
All scenarios are DETERMINISTIC hard-assertions unless tagged [LIVE]. Two homes: (A) unit-level on the pure resolver with injected deps (extend src/__tests__/vex-agent/memory/manager/outcome-resolver.test.ts and point-in-time.test.ts); (B) eval-level through the production capture seam (extend src/__tests__/integration/eval/outcome-s5.int.test.ts using the faithful seeders + ledgerDeps()). Prefer (B) where the lineage/projector linkage is the risk.

### S5-OR-1 — Spot win: closed+strong+positive via a matched realized row (production seam) [DETERMINISTIC]
SEED: makeSession(); seedFaithfulConfirmedSpotTrade({instrumentKey:"solana:S5WIN", wallet:WALLET, buyQtyRaw:"1000000000", buyValueUsd:"50.00", sellQtyRaw:"1000000000", sellValueUsd:"75.00"}). seedGemmaCandidate(kind:"trade_outcome", evidenceRefs:[{executionId:sellExec},{executionId:buyExec}], eventTime:now).
ACTION: countMatchedRealized(instrument,WALLET); resolveOutcome(candidate, true, ledgerDeps()).
EXPECTED: a matched non-null realized row exists; outcome closed/strong/positive/pnl_matches, needsReconciliation:false.
ASSERT: countMatchedRealized > 0; outcome.status==="closed"; evidenceQuality==="strong"; lessonSignal==="positive"; pnlSource==="pnl_matches"; needsReconciliation===false; productType==="spot". (This largely exists at outcome-s5.int.test.ts:47-100 — keep, do not duplicate; the NEW value is the boundary/loss/shortfall cases below.)

### S5-OR-2 — Spot LOSS: closed+strong+negative [DETERMINISTIC]
SEED: same seeder with buyValueUsd:"75.00", sellValueUsd:"50.00" (realized -25).
ACTION: resolveOutcome(candidate,true,ledgerDeps()).
ASSERT: status==="closed"; evidenceQuality==="strong"; lessonSignal==="negative"; pnlSource==="pnl_matches". Proves signFromPnl on a real losing ledger through the seam (only the unit test covers negative today, outcome-resolver.test.ts:215).

### S5-OR-3 — Spot break-even: closed+strong+neutral [DETERMINISTIC]
SEED: buyValueUsd === sellValueUsd ("50.00"/"50.00").
ASSERT: status==="closed"; evidenceQuality==="strong"; lessonSignal==="neutral" (realizedTotal===0 → signalFromPnl returns "neutral", outcome-resolver.ts:105). Boundary case: a real, grounded, strong outcome whose signal is neutral — proves neutral is NOT the thin-fallback signal.

### S5-OR-4 — Shortfall-only sell: NO strong, weak/none (production seam) [DETERMINISTIC]
SEED: a SELL with NO prior buy lot for the instrument: seedFaithfulConfirmedSpotTrade is buy-then-sell; instead drive a standalone sell (sellQtyRaw with no buy) so the projector writes a `match_kind='shortfall'` row with realized_pnl_usd NULL (spot.ts:121-149). Anchor candidate on the sell execution.
ACTION: resolveOutcome.
EXPECTED: matchedRows===0 (shortfall excluded), no open lot → thin fallback.
ASSERT: evidenceQuality==="weak"; pnlSource==="none"; status==="open"; needsReconciliation===true. CRITICAL: assert evidenceQuality !== "strong" (a shortfall must NEVER fabricate a realized result). Today only a unit test with an injected null-pnl shortfall covers this (outcome-resolver.test.ts:245-256); this proves the PROJECTOR actually writes null realized on a real shortfall.

### S5-OR-5 — Open spot exposure: buy with an open lot, no sell → open/weak/open_position [DETERMINISTIC]
SEED: seed ONLY a buy (open lot), anchor candidate on the buy execution.
ASSERT: status==="open"; lessonSignal==="neutral"; evidenceQuality==="weak"; pnlSource==="open_position"; needsReconciliation===true. Proves the open-lot branch (outcome-resolver.ts:154-167) fires through the seam and never reaches strong.

### S5-OR-6 — sell_activity_id ↔ proj_activity.id linkage regression [DETERMINISTIC]
SEED: faithful spot win.
ACTION: read proj_pnl_matches.sell_activity_id and proj_activity.id for the sell execution; resolveOutcome.
ASSERT: the matched row's sell_activity_id EQUALS the sell activity's id (spot.ts:110); and getMatchesBySell(sellActivity.id) returns it. This pins the join the resolver depends on (outcome-resolver.ts:132). If a future refactor changes either side, strong-spot silently degrades to weak — this test catches it.

### S5-OR-7 — Closed perps: medium, never strong, signed MTM [DETERMINISTIC]
SEED: seedClosedPerpsPosition(positionKey:"perp:S5:1", closedPnlUsd:"-12.50"); candidate anchored on closeExecution. (Exists at outcome-s5.int.test.ts:102-138 — keep.) ADD a sibling case closedPnlUsd:"+30.00" → positive, and a case where the post-close MTM is left NULL (skip the UPDATE in the seeder) → lessonSignal neutral but still closed/medium (outcome-resolver.ts:218-223).
ASSERT each: status==="closed"; evidenceQuality==="medium"; evidenceQuality!=="strong"; needsReconciliation===true; lessonSignal matches the sign (or neutral when MTM null).

### S5-OR-8 — Prediction and Order venues route to the position resolver [DETERMINISTIC]
SEED: two faithful position seeders parameterized to product_type "prediction" and "order" (generalize seedClosedPerpsPosition to take a productType/positionType; closeCapture.type accordingly). Closed with signed MTM.
ASSERT: both resolve status closed / evidenceQuality medium / needsReconciliation true; neither reaches strong. This closes the venue-dispatch matrix (today only perps is exercised through the seam; prediction/order only via injected unit deps at outcome-resolver.test.ts:295-308).

### S5-OR-9 — LP closed via withdraw: medium + fee sign (NEW faithful LP seeder) [DETERMINISTIC]
SEED: NEW seedFaithfulLpRoundTrip — drive a deposit (zap-in) then a withdraw event through the capture seam so proj_lp_events lands rows. CRITICAL DESIGN NOTE: the resolver keys on action==="withdraw" (outcome-resolver.ts:269) but recordLpEconomics writes meta.action verbatim (lp.ts:65,82) which is "zap-out". The seeder must drive an activity whose meta.action serializes to exactly "withdraw" AND carries zapDetails so extractFeeCollectedUsd yields a fee — OR the test must assert the mismatch (see ADV/gap). Provide BOTH: (a) a positive-fee withdraw event with action="withdraw" → closed/medium/positive/lp_events; (b) a zap-out event → assert it does NOT resolve closed (documents the lineage gap).
ASSERT (a): status==="closed"; evidenceQuality==="medium"; lessonSignal==="positive"; pnlSource==="lp_events". ASSERT (b): status==="open" (the withdraw substring is not matched) — recordCheck this as a finding, not a silent pass.

### S5-OR-10 — LP no events: thin weak/none [DETERMINISTIC]
SEED: an lp-product activity with a position_key but NO proj_lp_events rows (skip recordLpEconomics by omitting zapDetails). resolveOutcome.
ASSERT: evidenceQuality==="weak"; pnlSource==="none"; needsReconciliation true (outcome-resolver.ts:259-267).

### S5-OR-11 — Null boundary degrades strong end-to-end (no eventTime, anchor gone after deref) [DETERMINISTIC]
SEED: faithful spot win → strong-eligible. Insert candidate with eventTime NULL. Then DELETE the anchored executions (or anchor a non-existent executionId) so deriveDecisionBoundary returns null but the resolver's first-surviving-anchor still finds a different surviving anchor that yields a closed/strong fact. Simpler deterministic construction: candidate.eventTime=null AND evidenceRefs anchor an execution that EXISTS for the outcome but whose created_at deref is forced null in a unit test. Best done as a unit/consolidate test: drive consolidateCandidate with getExecutionTime→null but resolveOutcome→closed/strong.
ACTION: consolidateCandidate (stub judge) or directly call deriveEvidenceStrengthCeiling({isTradeKind:true, outcome:{status:closed,evidenceQuality:strong,pointInTimeChecked:false}, anchorExists:true, recurrenceCount:5}).
ASSERT: ceiling !== "strong" (evidence-deref.ts:128-135 requires pointInTimeChecked===true); it falls back to recurrence-based moderate. Pins P7: a strong ledger fact with an undeterminable as-of is NOT promoted as strong.

### S5-OR-12 — Boundary = earliest anchor created_at when no eventTime [DETERMINISTIC]
SEED: faithful spot win across two executions with distinct created_at; candidate eventTime null, anchors both executions.
ACTION: deriveDecisionBoundary with the real getExecutionTime; promote via applyDecisionAtomically.
ASSERT: available_at_decision_time === MIN(created_at) across the two executions; knowledge_entries.valid_from equals that boundary; outcome_version===0. Extends the existing eventTime-supplied path (memory-manager-outcome.int.test.ts:147-191) to the anchor-derived path through the seam.

### S5-OR-13 — Replay-stability through the PRODUCTION seam [DETERMINISTIC]
SEED: faithful spot win; resolveOutcome → first. TRUNCATE proj_pnl_matches, proj_activity, proj_pnl_lots RESTART IDENTITY CASCADE; re-run populateCaptureItems for the SAME buy+sell executions (re-drive the projector, not re-seed new executions). resolveOutcome → second.
ASSERT: second === first (deep equal). Stronger than the existing test (memory-manager-outcome.int.test.ts:250-269 re-seeds a raw match) because it regenerates via the real projector so the proj_* serials genuinely change while the executionId is stable.

### S5-OR-14 — outcome_version and computedBy init on the candidate JSONB [DETERMINISTIC]
SEED: faithful spot win → promote via decideOne with stub judge.
ASSERT: memory_candidates.outcome.outcomeVersion===0; outcomeComputedBy==="memory_manager"; pointInTimeChecked===true; AND knowledge_entries.outcome_version===0. (Candidate-side covered partially at memory-manager-outcome.int.test.ts:177; add the computedBy assertion which is currently unchecked.)

### S5-OR-15 — No raw PnL number leaks into stored prose or JSONB [DETERMINISTIC]
SEED: faithful spot win realized +25; promote.
ASSERT: knowledge_entries.title/summary contain no /\d/-money token and not "25" /"75"/"50"; memory_candidates.outcome JSONB keys are exactly the schema set (no extra key) — parse with memoryOutcomeSummarySchema.strict() and expect success, then assert Object.keys excludes any amount-like key. Extends containsRawPnl (outcome-s5.int.test.ts:36-40) to also validate the JSONB shape with the Zod boundary.

### S5-OR-16 — [LIVE] Strong-spot trade lesson reaches the judge; promote preserves ledger fields. 
This already exists (outcome-s5.int.test.ts:140-263) and correctly treats the verdict as MEASURED (F31). Keep as-is; the deterministic post-conditions (outcome_version 0, valid_from=event_time, no-raw-pnl, candidate outcome closed/strong/pnl_matches) are hard-asserted only on a valid promote. Do not convert the verdict itself to a hard gate.

## adversarial
ADV-1 — "I won" with no ledger match. SEED: a candidate whose title/summary claim a big win ("Nailed a 10x on this name, banked huge gains") but whose anchored execution has NO matched realized row (only a buy lot, or a shortfall, or no activity). EXPECTED: resolveOutcome must derive weak/none (or open/weak), lessonSignal neutral — it must NEVER read the claim. ASSERT: evidenceQuality !== "strong"; lessonSignal !== "positive"; pnlSource ∈ {none, open_position}. MUST NOT: promote at 'strong' on the strength of the prose. This is the core poisoning guard for P1 and is currently untested through the seam.

ADV-2 — "I won" but the ledger says LOSS. SEED: prose claims a win; ledger has realized -40. EXPECTED: lessonSignal==="negative" (the ledger wins). ASSERT: lessonSignal==="negative", not "positive". MUST NOT: let the declared direction override the ledger sign.

ADV-3 — Shortfall masquerading as a realized close. SEED: a sell larger than inventory → projector writes shortfall (realized_pnl_usd NULL). EXPECTED: matchedRows===0 → no strong. ASSERT: evidenceQuality weak/none. MUST NOT: count a shortfall row as a matched realized result (the matchKind/non-null guard at outcome-resolver.ts:135 is the wall).

ADV-4 — Lookahead injection via a future eventTime. SEED: candidate.eventTime set to a timestamp AFTER the anchor's created_at AND after now. EXPECTED: deriveDecisionBoundary returns that eventTime (point-in-time.ts:55-58) and pointInTimeChecked is true. CLARIFY/ASSERT: the design intentionally trusts agent eventTime as the as-of; the no-lookahead guarantee comes from the outcome being LEDGER-derived (the future eventTime cannot inject a future market fact because the outcome reads only the immutable ledger). The test must DOCUMENT this: assert the outcome fields are still ledger-derived and identical regardless of eventTime value (vary eventTime ±1yr → same status/quality/signal). MUST NOT: have a future eventTime change the resolved status/quality.

ADV-5 — Cross-instrument open-lot bleed. SEED: instrument A has a sell with no lot; instrument B (same wallet) has an unrelated open lot. EXPECTED: the open-lot probe keys on the BUY activity's own instrumentKey+wallet (outcome-resolver.ts:155-157), so an unrelated B lot must NOT make A resolve open/open_position. ASSERT: A resolves thin (none), not open_position. MUST NOT: a foreign instrument's lot upgrade an unrelated candidate.

ADV-6 — proj_* serial collision after replay. SEED: faithful win → promote → record outcome. TRUNCATE+regenerate so a DIFFERENT instrument now occupies the old proj_pnl_matches serial id. EXPECTED: re-deref by executionId still resolves the ORIGINAL instrument's outcome. ASSERT: re-derived outcome equals the original (proves no proj serial is cached anywhere — P9). MUST NOT: re-derive a different lesson because a serial got reused.

ADV-7 — Soft-deleted-session anchor must not yield strong. SEED: anchor execution belongs to a soft-deleted session (OD-3). EXPECTED: derefAnchorExistence flags softDeleted → deterministic reject upstream (evidence-deref.ts:68-71, consolidate.ts:485). ASSERT: the candidate is rejected before any strong promote; the resolver may still compute a fact but the decision must not promote. MUST NOT: promote a lesson grounded on a deleted session's trade.

## determinismSplit
DETERMINISTIC (hard-assert; these are GATES — ledger-derived, math, lineage):
- Every outcome FIELD (status, lessonSignal, evidenceQuality, pnlSource, needsReconciliation, productType, outcomeComputedBy, outcomeVersion, pointInTimeChecked) for a given seeded ledger. These are pure functions of the ledger (outcome-resolver.ts) and the boundary (point-in-time.ts).
- The strong-evidence preconditions: matched-non-null realized row AND closed/settled AND quality 'strong' AND pointInTimeChecked (evidence-deref.ts:128-135).
- venue dispatch (spot/position/lp/thin) by product_type (outcome-resolver.ts:66-71).
- sell_activity_id ↔ proj_activity.id linkage (spot.ts:110).
- boundary derivation (eventTime / earliest anchor / null) and the degrade-not-reject behavior.
- valid_from=boundary and outcome_version=0 on promote (consolidate.ts:662-667).
- replay-stability deep-equality after TRUNCATE+regenerate.
- no-raw-number leak (string + Zod-strict shape).
- ALL adversarial scenarios (ledger always wins over the claim).

LIVE-LLM (measured metric, NOT a gate; record to reportCard, never fail the suite on the verdict):
- Whether the judge PROMOTES the strong-spot single-anchor lesson, and whether the verdict validates (F31). Only the deterministic post-conditions OF a valid promote are asserted (outcome-s5.int.test.ts:215-249). The verdict itself is reportCard.recordJudgeAttempt/recordJudge + recordFinding(F31).
- Judge latency/cost. Metric only.
The split must stay: a model regression must move the F31 metric, never red the deterministic ledger gates.

## currentCoverage
UNIT (pure, injected deps) — src/__tests__/vex-agent/memory/manager/outcome-resolver.test.ts: spot closed+strong (positive 198-213, negative 215-227), open-lot weak (229-243), null-pnl shortfall→weak/none (245-256); position open→weak (260-275), closed→medium (277-293), missing-row→thin (295-308); lp withdraw→closed/medium/positive (311-331), no-events→thin (333-346); thin/unmapped product (350-363), no-activity→productType undefined (365-373); anchor-null→null (179-182); pit/version/computedBy carry (184-194). point-in-time.test.ts: eventTime-wins (18-31), earliest-anchor (33-44), skip-missing-anchor (46-56), null boundary x2 (58-72), checkNoLookahead true/false (75-83). memory-outcome.test.ts (schema) and memory-candidates-outcome.test.ts (SQL mapping incl. null-boundary passthrough 73-78, precondition status='pending' 56-71).

INTEGRATION (real pgvector, STUB judge) — src/__tests__/integration/memory/memory-manager-outcome.int.test.ts: spot closed realized→strong + valid_from=eventTime + outcome_version 0 + no-12.5-in-prose (147-191); open position→weak/not-strong (193-226); thin bridge→weak/needsReconciliation/none (228-248); replay-stability via re-seeded raw match (250-269).

EVAL (real Gemma + real DeepSeek, faithful seam) — src/__tests__/integration/eval/outcome-s5.int.test.ts: faithful spot→matched realized row + resolver closed/strong/positive/pnl_matches (47-100); faithful closed perps→medium/negative (102-138); [LIVE] strong-spot promote with F31-aware verdict + deterministic post-conditions (140-263). Faithful seeders: seedFaithfulConfirmedSpotTrade, seedClosedPerpsPosition, seedFaithfulClosingTradeForWake (_eval-fixtures.ts).

HONEST NOT-COVERED: spot break-even (neutral on a strong outcome); spot LOSS through the seam (only unit); REAL shortfall through the projector (only injected-null unit); open-spot-exposure through the seam; prediction/order venues through the seam (only injected unit); ANY LP venue through the production seam (no faithful LP seeder exists); the action!=="withdraw" LP lineage mismatch; anchor-derived boundary (only eventTime-supplied is integration-tested); null-boundary-degrade end-to-end (only the schema null passthrough + checkNoLookahead unit); replay via the REAL projector regeneration; outcomeComputedBy on the persisted candidate; the sell_activity_id↔activity.id join as an explicit regression; and EVERY adversarial "claim vs ledger" scenario (ADV-1..7).

## gaps
Ranked by risk:

G1 (HIGH, poisoning) — No "claim vs ledger" adversarial coverage. Nothing seeds a candidate whose PROSE claims a win against a ledger that says otherwise (loss / shortfall / no match). P1 (D-OUTCOME-SRC) is the central anti-poisoning invariant and is only implicitly covered by the resolver never reading title/summary. ADV-1/2/3 must be added.

G2 (HIGH, lineage) — LP venue is untested through the production seam, AND there is a concrete action-vocabulary mismatch: resolver matches action==="withdraw" (outcome-resolver.ts:269) but the projector writes meta.action="zap-out" (lp.ts:65,82). Today a real LP round-trip driven through the seam would resolve OPEN, never closed — a silent correctness hole. No test would catch a regression here because no faithful LP path exists. Needs a NEW seedFaithfulLp seeder plus an explicit finding.

G3 (HIGH) — Real shortfall through the projector is unverified. The only shortfall test injects a null-pnl row by hand (outcome-resolver.test.ts:245). If the projector's shortfall branch (spot.ts:121-149) ever wrote a non-null realized_pnl_usd, a shortfall would masquerade as strong and nothing would catch it. S5-OR-4 + ADV-3 close this.

G4 (MED) — Anchor-derived boundary (no eventTime) is integration-untested. Only the agent-supplied eventTime path is exercised end-to-end (memory-manager-outcome.int.test.ts:147). The earliest-anchor-created_at fallback feeding valid_from is unit-only (point-in-time.test.ts:33). S5-OR-12.

G5 (MED) — Null-boundary strong-degrade is not proven end-to-end. checkNoLookahead and the schema null passthrough are unit-tested, but no test drives a strong-eligible ledger with a null boundary through deriveEvidenceStrengthCeiling/consolidate to assert the ceiling drops below strong. S5-OR-11.

G6 (MED) — prediction and order venues are not exercised through the seam; only injected-deps unit tests touch them. The POSITION_PRODUCTS set (outcome-resolver.ts:63) is the dispatch contract; a typo there would silently route prediction/order to thin. S5-OR-8.

G7 (LOW) — sell_activity_id↔proj_activity.id join is load-bearing for strong-spot (outcome-resolver.ts:132 ↔ spot.ts:110) but has no explicit regression test; a projector refactor could silently degrade every strong-spot to weak. S5-OR-6.

G8 (LOW) — Break-even neutral on a STRONG outcome is untested; risk of confusing the thin-fallback neutral with a genuine grounded neutral. S5-OR-3.

G9 (LOW) — outcomeComputedBy on the persisted candidate JSONB is asserted nowhere in integration (only on the in-memory return value, outcome-resolver.test.ts:193). S5-OR-14.

## priority
Top must-build, smallest-effective-first:

1. ADV-1/2/3 — "claim vs ledger" trio (the poisoning gate). Add to the eval suite using the existing faithful spot seeder + a deliberately mismatched prose candidate; one new standalone-sell (shortfall) seeder branch. Hard-assert ledger sign/quality wins over the prose. Highest correctness value, low effort (reuses seedFaithfulConfirmedSpotTrade + seedGemmaCandidate).

2. NEW seedFaithfulLp seeder + S5-OR-9/10 (LP venue + the action!=="withdraw" mismatch finding). Closes the single largest untested venue and surfaces a real lineage bug. Medium effort (new seeder driving recordLpEconomics with zapDetails); assert BOTH the withdraw-positive path and the zap-out-doesn't-close path, recording the latter as a finding.

3. S5-OR-4 + S5-OR-6 — real projector shortfall (no strong) and the sell_activity_id↔activity.id join regression. Both pin the strong-spot precondition against silent projector drift. Low effort, reuse faithful spot.

4. S5-OR-11 + S5-OR-12 — null-boundary strong-degrade (ceiling drops below strong) and anchor-derived boundary→valid_from. Pins the no-lookahead and bi-temporal init invariants end-to-end. Low-medium effort, mostly consolidate/applyDecisionAtomically wiring already used in memory-manager-outcome.int.test.ts.

5. S5-OR-8 — prediction + order venues through the seam (generalize seedClosedPerpsPosition to a productType param). Completes the venue-dispatch matrix as deterministic gates. Low effort.

