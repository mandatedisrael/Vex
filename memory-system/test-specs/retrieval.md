## domain
Retrieval + Hot-Context (long_memory_search / get / history, dual-trace recall, graph expansion, hot-context auto-inject, the # Memory section)

## correctnessProperties
Each property below is the testable invariant + where it is enforced in the as-built code:

1. CONFIRMED-OUTRANKS-CANDIDATE (the doctrine). A confirmed knowledge entry ALWAYS outranks an equal-similarity dual-trace candidate, even in the worst case (hypothesis tier × min activation). Enforced numerically by `SOURCE_SOFT_WEIGHT=0.7` / `CANDIDATE_DUAL_TRACE_WEIGHT=0.6` / `ACTIVATION_MIN_FACTOR=0.88` with the import-time asserts at long-memory-retrieval-policy.ts:104-127 (`0.7 × 0.88 = 0.616 ≥ 0.6`) and maturity-policy.ts:165-168. The blend that realizes it: blendAndRank merges knowledge-first then stable-sorts score-DESC (long-memory-retrieval-policy.ts:296-333); scoreKnowledge = rerankScore × tierWeight × activationFactor (lines 223-229); scoreCandidate = similarity × 0.6 with NO boosts (lines 271-273).

2. CANDIDATE IS A SOFT SIGNAL, NEVER A HARD CONSTRAINT. A much-higher-similarity fresh candidate MAY surface above a weak knowledge entry (0.95×0.6=0.57 > 0.2×1) — long-memory-retrieval-policy.ts:296-333; proven in the unit test today.

3. GRAPH ENRICHES, NEVER DOMINATES OR DISPLACES. Every 1-hop neighbor scores strictly below its seed (graphScore = seedScore × GRAPH_HOP_DECAY(0.5) × neighborTier × neighborActivation, all ≤1, decay<1 — long-memory-retrieval-policy.ts:257-264, asserted 0<decay<1 at lines 95-99). Expansion fills ONLY the inline slots the direct results left free and NEVER evicts a direct result (search.ts:506-531, remainingSlots = LONG_MEMORY_INLINE_CAP − direct.inline.length). Seeds with score≤0 are skipped (search.ts:176-181).

4. GRAPH DEDUPE vs TRUNCATED IDS. Dedupe is against EVERY directly-recalled entry id (returned OR truncated), so a direct hit that was truncated can never resurface mislabeled as a graph lead (search.ts:513-520 builds directKnowledgeIds from `blended.results`, not from the post-cap `direct.inline`; expandViaGraph honors alreadyReturnedIds at search.ts:240).

5. EXCLUSION INVARIANT (S3 read). superseded / invalidated / expired / non-active entries NEVER surface in recall. recallLongMemoryTopK filters `status='active' AND (pinned OR valid_until IS NULL OR valid_until > now())` and the model/dim pair (recall.ts:55-77). getActiveEntriesByIds (graph-side) applies the same gate (crud.ts:412-417).

6. DUAL-TRACE TTL + TERMINAL EXCLUSION. Fresh `not_consolidated` candidates surface within TTL; suppressed / expired / promoted / rejected / superseded / merged candidates never do. recallCandidatesTopK: `status IN ('pending','retained') AND retrieval_visibility='not_consolidated' AND (retrieval_until IS NULL OR retrieval_until > now())` + model/dim (crud.ts:599-611).

7. MIXED-DIM CRASH GUARD. Every recall is filtered by `embedding_model=$ AND embedding_dim=$` (BOTH stores) because the pgvector column has no typmod — a cross-dim `<=>` crashes the query (recall.ts:6-8, 71-74; crud.ts:557-567, 605-611). The handler always passes providerModel + embedding.length to BOTH stores (search.ts:442-474). recallLongMemoryTopK also throws on a query/filter dim mismatch BEFORE touching SQL (recall.ts:34-38).

8. INLINE CAPS WITH NO SILENT LOSS. Direct results capped at LONG_MEMORY_INLINE_CAP=10 (always) and, for detailed only, LONG_MEMORY_INLINE_CHARS_CAP=50000 chars (first result always kept) — capInline (search.ts:309-330). Concise NEVER applies the chars cap (search.ts:504). Dropped counts are reported (droppedDirect / droppedExpansion / droppedCount + steering), never hidden (search.ts:531-568).

9. CONCISE vs DETAILED SHAPES. concise omits summary/contentMd/tags; detailed includes them; both carry the via_graph marker on expansion results (toConcise/toDetailed search.ts:346-386).

10. long_memory_get REDIRECTS, never serves a terminal entry. A non-active entry → fail with successor pointer when supersededBy is set, else terminal explanation; an active entry injects contentMd into loadedDocuments (get.ts:42-54).

11. HOT-CONTEXT AUTO-INJECT GATE. Only `source IN ('observed','user_confirmed') AND maturity_state NOT IN ('probationary','decayed')` AND `(pinned OR valid_until > now())` is auto-injected into the always-on prompt (hot-context.ts:37-70). probationary/decayed/inferred/hypothesis are excluded even if source passes.

12. FAIL ≠ EMPTY. A DB hiccup makes turn-context return `knowledge:null` / `sessionStats:null` (turn-context.ts:53-81); buildMemorySection OMITS the affected lines and NEVER renders "Skip long_memory_search — nothing to find" on a failed fetch (memory-section.ts:38-58). Empty-state guidance renders ONLY on a successful fetch with true-zero counts.

13. F1 CHARACTERIZATION. The hot-context COUNT (countActiveHotContextEntries: no valid_until predicate, hot-context.ts:113-121) counts a matured observed/established NULL-TTL unpinned lesson, but the hot LIST (listActiveForHotContext: `pinned OR valid_until > now()`, hot-context.ts:57) EXCLUDES it — banner N>0 but the entry is absent from Active Memory.

14. F2 CHARACTERIZATION. With only dual-trace candidates present, the cold-start banner says "Skip long_memory_search — nothing to find" (memory-section.ts:99) while handleLongMemorySearch(include_candidates) returns those candidates — the banner steers away from a search that would succeed.

## scenarios
All new live scenarios are `describe.skipIf(!process.env.OPENROUTER_API_KEY)` in `src/__tests__/integration/eval/` and use seedPromotedLessonDirect / seedGemmaCandidate / seedGemmaKnowledgeEntry (real Gemma dim-768 vectors). All new deterministic scenarios that need a real pgvector but NOT a live LLM go in `src/__tests__/integration/repos/` (synthetic randVector, no skipIf). Constants asserted by reference, never hardcoded.

═══ A. DETERMINISTIC — new repo test `knowledge-recall.int.test.ts` (the missing recallLongMemoryTopK pgvector suite; mirrors memory-candidates-recall.int.test.ts) ═══

A1 — happy path returns active rows ordered by cosine.
  SEED: 3 entries via insertEntry, EMBEDDING_DIM=8 randVector, source='observed', status='active', distinct vectors; query = the vector of entry B.
  ACTION: recallLongMemoryTopK(qB, {embeddingModel, embeddingDim:8, includeExpired:false}, 8).
  EXPECTED: B first (distance 0); all 3 returned; similarity ∈ [0,1].
  ASSERT: results[0].id === B.id; results.length === 3; every similarity in range.

A2 — superseded/invalidated/archived excluded; active surfaces (DETERMINISTIC twin of the live exclusion test, no LLM).
  SEED: active control + one each status='superseded','invalidated','archived' (UPDATE after insert), same vector neighborhood.
  ACTION: recall k=20.
  ASSERT: ids.has(active)===true; superseded/invalidated/archived all absent.

A3 — expired excluded, pinned-expired KEPT.
  SEED: (a) unpinned valid_until in the past, (b) pinned valid_until in the past, (c) valid_until NULL unpinned, (d) valid_until future.
  ACTION: recall includeExpired:false, k=20.
  ASSERT: (a) absent; (b) present (pinned overrides expiry — recall.ts:56); (c) present (NULL passes); (d) present.

A4 — MIXED-DIM CRASH GUARD on the knowledge store (THE gap — only candidates have this today).
  SEED: entry X embedded dim-8 model "m8"; entry Y embedded dim-4 model "m4" (insert both rows; pgvector column has no typmod so both coexist).
  ACTION: recall with a dim-8 query + filter {embeddingModel:"m8", embeddingDim:8}.
  ASSERT: returns only X; the call does NOT throw (Y is filtered out in SQL, never reaches `<=>`). Then call with {embeddingModel:"m8", embeddingDim:4} + a dim-4 query → the repo throws `does not match filter dim` BEFORE SQL (recall.ts:34-38). Then a dim-4 query against {…,embeddingDim:8} → throws. This proves the guard that prevents a real pgvector dimension-mismatch crash.

A5 — embedding_model isolation. Two entries identical vector/dim, different embedding_model. ASSERT recall with model A returns only the A row.

A6 — kind filter. Entries of kind k1,k2. recall {kind:'k1'} → only k1 rows.

A7 — k=0 / negative ⇒ [] (recall.ts:33); headroom: seed 30 rows, k=5 → repo SELECTs k*2=10 but caller-visible count bounded by the fetched set (assert ≤ k*2 returned, ordering by distance).

═══ B. LIVE-GEMMA — extend retrieval-precision.int.test.ts (cross-store ranking that the unit blend cannot prove with REAL vectors) ═══

B1 — WORST-CASE confirmed-outranks-candidate on REAL Gemma. The existing test uses an `inferred` candidate; add the HARDEST case: a `hypothesis`-tier knowledge entry vs an equal-text candidate, AND a `decayed`-activation knowledge entry vs a max-similarity candidate.
  SEED: resetDb; knowledge entry via seedPromotedLessonDirect({source:'hypothesis', activationStrength: DECAY_FLOOR}) with title/summary T; a seedGemmaCandidate({source:'observed'}) with the SAME T (so raw similarity to the query is ~equal).
  ACTION: handleLongMemorySearch({query: paraphrase-of-T, include_candidates:true, k:10}).
  EXPECTED: the knowledge entry still ranks above the candidate (0.7×0.88×rerank ≥ 0.6×sim because rerank≥sim).
  ASSERT (HARD): indexOf(knowledge) < indexOf(candidate); record check + note knowledgeRank/candidateRank. This is the doctrine's most adversarial point and is NOT currently exercised on real vectors.

B2 — much-stronger candidate DOES surface (soft-signal property, real vectors).
  SEED: a weak-similarity `observed` knowledge entry (title far from the query) + a candidate whose title is a near-exact paraphrase of the query.
  ACTION: search include_candidates:true.
  ASSERT: the candidate appears at rank 0 (memory_candidate), proving candidates are not hard-suppressed. Measured, but assert candidate present in top-2.

B3 — candidate gate + cap on real vectors. Seed 5 candidates: 2 below LONG_MEMORY_CANDIDATE_MIN_SIMILARITY (unrelated topic), 3 above. ASSERT response candidateCount===min(3, surviving) and droppedCandidates reflects the cap; below-min ones absent (cross-checks blendAndRank gating end-to-end through embedQuery).

B4 — precision@k EXTENSION: add precision@3 and Recall@5 over the SAME golden set (today only p@1). For each golden query, recall k=5; hit if expectedId ∈ top-3 (p@3) and ∈ top-5 (recall@5). recordPrecision({k:3,…}) and {k:5,…}. Soft floor: p@3 > p@1 floor (monotonic sanity). Also add 3 ADVERSARIAL near-duplicate corpus rows (e.g. two stop-loss lessons) and assert the query still surfaces the intended id at p@1 OR records the confusion as a measured metric (no hard fail — distinguishes precision from a brittle gate).

═══ C. LIVE-GEMMA — new `retrieval-interaction.int.test.ts` (the end-to-end behaviors the mocked handler test cannot prove) ═══

C1 — graph expansion never displaces a direct hit, on a REAL graph.
  SEED: seedPromotedLessonDirect A (the direct hit for query Q) + B (a neighbor). Write a real graph: applyGraphPlan linking A→entity e1, B→e2, edge e1↔e2 (reuse graph.int.test.ts pattern). 
  ACTION: handleLongMemorySearch({query:Q, expand_graph:true}).
  ASSERT (HARD): results[0].id===A.id and results[0].via is undefined; B appears later with via==='via_graph(<entity>)' and score < results[0].score. Proves S8 enrichment on real recall + real edges (today only stubbed).

C2 — graph dedupe vs TRUNCATED direct id (the subtle correctness point in scenario #4).
  SEED: 11 direct-hit knowledge entries for Q (above inline cap 10) where the 11th (truncated) entry is ALSO a graph neighbor of one of the top-10 via a real edge.
  ACTION: search expand_graph:true.
  ASSERT (HARD): the truncated entry's id does NOT reappear as a via_graph result; droppedDirect>0; the entry is steered by truncation, not resurfaced. (This is the only place the returned-vs-truncated dedupe set (search.ts:513-520) is exercised with a real truncation.)

C3 — expired direct entry is not resurrected via the graph. SEED an EXPIRED (past valid_until, unpinned) entry that is a graph neighbor of an active seed. ASSERT it never appears (getActiveEntriesByIds gate, crud.ts:412-417) — graph cannot bypass the expiry gate.

C4 — long_memory_get redirect chain on REAL rows. SEED entry old, then a successor new; UPDATE old SET status='superseded', superseded_by=new.id. handleLongMemoryGet({id:old}) → success:false, message names `entry <new.id>`. handleLongMemoryGet({id:new}) → success, injects loadedDocuments.get('long_memory:<new>'). An invalidated entry with supersededBy NULL → terminal message, no successor.

C5 — long_memory_history lineage + reinforcement on REAL rows. Build a 2-link chain (old superseded → new active) via the real supersede path; assert chainLength===2, headId===new, headStatus==='active', reinforcement.outcomeVersion present. (Today only mocked.)

═══ D. DETERMINISTIC — extend `knowledge-source-filter.int.test.ts` with the MATURITY gate (the F1-adjacent gap) ═══

D1 — maturity gate excludes probationary + decayed even at source='observed'.
  SEED via seedGemmaKnowledgeEntry/insert: (a) observed+established, (b) observed+probationary, (c) observed+decayed, (d) user_confirmed+reinforced.
  ACTION: listActiveForHotContext({limit:50}); countActiveHotContextEntries().
  ASSERT (HARD): list contains a,d; excludes b,c (hot-context.ts:38). count===2. This pins the genesis invariant that probationary/decayed stay out of the always-on prompt — currently UNTESTED at the repo level (only the source dimension is).

D2 — recurrence reactivation re-enables hot-context. SEED a decayed entry; UPDATE maturity_state='established'. ASSERT it now appears in listActiveForHotContext (proves the gate is state-driven, hot-context.ts:33-35 doctrine).

D3 — listActiveKindCounts is NOT source/maturity-filtered (judge census). SEED observed+established, inferred, hypothesis, probationary. ASSERT listActiveKindCounts(limit) includes ALL kinds (hot-context.ts:94-110) while listKnownKinds excludes the non-hot ones — the two consumers diverge by design.

═══ E. DETERMINISTIC — new `hot-context-divergence.int.test.ts` (target test that would REGRESS-PROVE the F1 fix when it lands) ═══

E1 — CHARACTERIZATION (asserts what-IS today, like lifecycle F1): a matured observed/established/NULL-valid_until/unpinned entry is COUNTED but absent from the hot LIST. Same as eval lifecycle F1 but DETERMINISTIC (synthetic dim-8 vector, no LLM, runs in the integration suite) so it gates on every PR, not just live runs. ASSERT count>0 && !inList; record finding F1.
E2 — TARGET (xit/skipped until fix): when F1 is fixed (the COUNT and LIST predicates align — either count drops NULL-TTL unpinned, or list keeps them), assert count === hotList.length for an all-eligible corpus including a NULL-TTL unpinned matured entry. Leave as a documented `it.todo`/skipped target so the fix has a ready gate.
E3 — getActiveEntriesByIds vs listActiveForHotContext NULL-TTL divergence (the precise asymmetry): seed one observed/established NULL-valid_until unpinned entry; ASSERT listActiveForHotContext EXCLUDES it (predicate `pinned OR valid_until > now()`, hot-context.ts:57) but getActiveEntriesByIds([id]) INCLUDES it (predicate `pinned OR valid_until IS NULL OR valid_until > NOW()`, crud.ts:416). Documents that the graph path and the hot path disagree on NULL-TTL — a real divergence reviewers must know about.

═══ F. DETERMINISTIC — extend `memory-section.test.ts` (pure, no DB) for the F2 boundary + remaining cap edges ═══

F1 — chars-cap boundary on the Active Memory hot block: entries whose summaries sum just over ACTIVE_KNOWLEDGE_HOT_CHARS_CAP; assert rendered hot block length ≤ cap and the dropped entries are simply not rendered (no crash, no partial line). (Today only a loose `< 5000` bound.)
F2 — F2 unit-level characterization: build a MemoryTurnContext with knowledge.activeCount===0 (hot empty) and assert buildMemorySection contains "Skip long_memory_search — nothing to find" — the static counterpart to the live F2, so the banner text is regression-pinned at the unit level too.
F3 — first-result-always-kept on the chars cap: in the handler test, a single detailed result whose contentMd alone exceeds LONG_MEMORY_INLINE_CHARS_CAP is still returned (capInline keeps inline[0], search.ts:317-324). Add as a handler unit case (mirror of the existing concise case but detailed, count===1, truncated:false).

## adversarial
Subsystem-specific abuse / poisoning scenarios and the MUST-NOTs:

1. SCAM-TOKEN / FRESH-CANDIDATE PROMOTION BY RANK. A fresh, un-vetted `not_consolidated` candidate (e.g. "ape into $SCAM, it always pumps") must NEVER outrank a confirmed `observed`/`user_confirmed` lesson at equal similarity, and must NEVER auto-inject into the always-on prompt. Adversarial test: seed a high-similarity candidate with source='hypothesis' or 'observed' (candidates are flat-weighted at 0.6 regardless of their claimed source — long-memory-retrieval-policy.ts:193-194) against a confirmed lesson; assert the confirmed lesson wins (B1) AND that the candidate never appears in listActiveForHotContext (candidates are a separate store, never in hot-context at all). MUST NOT: a candidate's self-asserted `source='user_confirmed'` give it hot-context weight — only promoted knowledge_entries enter hot context, and even there only after the maturity gate (D1).

2. EXPIRED / TERMINAL RESURRECTION VIA THE GRAPH. An attacker-aged or superseded "lesson" (e.g. a deprecated rug-pull heuristic) must not re-enter results through graph expansion. Tests C3 (expired neighbor) + A2/A3 prove getActiveEntriesByIds and recallLongMemoryTopK both re-apply the active+expiry gate. MUST NOT: graph expansion bypass status/expiry filters (it shares the same SQL gate, crud.ts:412-417).

3. TRUNCATION-BYPASS VIA GRAPH RELABELING. A direct hit that was truncated (steered away with "refine your query") must not silently reappear as a graph lead, which would defeat the truncation signal and let an agent act on a result it was told to refine for. Test C2 proves dedupe is against the FULL blended set, not the post-cap inline set (search.ts:513-520). MUST NOT: a truncated id reappear with via_graph.

4. GRAPH SCORE INVERSION. A poisoned/low-credibility neighbor (hypothesis tier, decayed activation) reached via a strong seed must never match or exceed a real direct hit. graphScore strictly < seed for every positive seed (asserted property test exists; C1 proves it end-to-end). MUST NOT: GRAPH_HOP_DECAY ever be ≥1 (import-time assert) or a neighbor displace a direct slot.

5. PROVENANCE-LAUNDERING INTO HOT CONTEXT. An `inferred`/`hypothesis` lesson, or a `probationary`/`decayed` one, must never leak into the always-on prompt where the agent treats it as established truth. D1 pins the maturity gate; the source filter is already pinned. MUST NOT: a probationary entry promoted with source='observed' pass (the comment at hot-context.ts:30-35 calls this exact attack — the source filter alone is insufficient, so maturity_state is ALSO gated).

6. CROSS-DIM POISONING / DoS. A row written under a different embedding model/dim must never be compared (meaningless similarity) and must never crash the recall query for everyone (a pgvector dimension-mismatch error would deny ALL recall). A4/A5 prove the model+dim filter on the knowledge store. MUST NOT: a mixed-dim row reach the `<=>` operator.

7. FAIL-CLOSED EMPTY-STATE LIE. On a DB hiccup the system must not tell the model "nothing to find" (which would make the agent skip a search that would succeed once the DB recovers and act on stale knowledge). turn-context null-branch + memory-section omission (covered; reinforce that a thrown knowledge fetch NEVER yields the "Skip long_memory_search" text). MUST NOT: a failed fetch render empty-state guidance.

8. UNKNOWN-PARAM SMUGGLING. A removed/typo param (e.g. `scope:'all'` trying to widen the expiry gate) must be REJECTED, not silently dropped — otherwise an agent could believe it disabled the expiry filter. Covered (search.ts:403-410); keep it green.

## determinismSplit
DETERMINISTIC (hard-assert, PR-gating — no LLM, runs in integration.config or pure unit):
- A1-A7 recallLongMemoryTopK SQL invariants: ordering, status/expiry exclusion, pinned-expired keep, NULL-TTL keep, mixed-dim crash guard + dim-mismatch throw, model isolation, kind filter, k bounds. (real pgvector, synthetic randVector — the vectors are deterministic; the SQL gate is the truth.)
- D1-D3 hot-context maturity gate + judge-census divergence (real pgvector, synthetic vectors).
- E1, E3 F1 characterization + getActiveEntriesByIds/listActiveForHotContext NULL-TTL asymmetry (deterministic, gates every PR — the live lifecycle.int F1 only runs with a key).
- F1-F3 memory-section caps/empty-state + handler capInline first-result-kept (pure unit + mocked handler).
- The import-time policy asserts (already covered) — keep the constant-reference unit checks green so a future weight edit fails loud.
All hot-assertable because the outcome is a SQL predicate, a pure-scoring inequality with known constants (0.7×0.88=0.616 ≥ 0.6), a cap integer, or a rendered-string presence/absence — zero model nondeterminism.

LIVE-LLM / REAL-GEMMA (measured + a few HARD ranking asserts; skipIf no OPENROUTER_API_KEY; reportCard):
- B1 worst-case confirmed-outranks-candidate, B2 strong-candidate-surfaces, C1 graph-no-displace, C2 truncation-dedupe, C3 expired-not-resurrected: these are HARD asserts even though they use live Gemma, because the RANKING inequality is deterministic given real embeddings (the embedding only sets raw similarity; the tier/decay/decay-floor math guarantees the order). They are "live" only in that they need the real provider for faithful vectors — the assertion itself is a hard gate, recorded to the report card.
- B4 precision@3 / recall@5 / near-duplicate confusion: MEASURED metrics (reportCard.recordPrecision) with only a soft floor (p>0.4-style) — embedding quality is a property of Gemma, not of our code, so these are tracked, not gated hard.
- C4/C5 get/history on real rows: deterministic asserts but require the integration DB; place in the eval or integration suite as fits (no LLM needed for these two — they can be DETERMINISTIC integration tests if seeded with seedPromotedLessonDirect, which DOES need Gemma for the embedding but not the judge).
Rationale for the split: a ranking ORDER driven by fixed weights is a gate; a similarity MAGNITUDE driven by the embedding model is a metric.

## currentCoverage
Already covered — do NOT duplicate:

UNIT (pure, no DB) — `src/__tests__/vex-agent/memory/long-memory-retrieval-policy.test.ts`: the full weight-invariant matrix (confirmed>candidate incl. fresh+pinned-hypothesis worst case, activation × tier across {0,DECAY_FLOOR,0.5,1.0}×tiers×sims), scoreKnowledge/scoreCandidate/graphScore formulas, candidate gating + cap + dropped count, graphScore strictly-below-seed property, and the "much-stronger candidate surfaces" soft-signal case. The numeric doctrine is THOROUGHLY proven at the unit level.

HANDLER (mocked repos + mocked embed) — `src/__tests__/vex-agent/tools/internal/long-memory-search.test.ts`: blended union tagged by source, both-store model/dim filter pass-through, include_candidates:false short-circuit, notConsolidated marker, expand_graph default-ON / opt-out / never-touch-when-off, 1-hop append below direct hit + via_graph marker + graph_expanded log, detailed marker + empty contentMd, never-evicts-direct (12 hits → 0 slots → graph untouched, droppedDirect=2), droppedCount split + graph_expansion_truncated log, fail-open on graph repo error, inline cap + steering + search.truncated, chars-cap-not-applied-to-concise, concise vs detailed shapes, nothing-found steering, embedding-outage fail-loud, empty-query reject, unknown-param (scope) reject. get: active+loadedDocuments, superseded successor steer, not-found. history: lineage+reinforcement merge, empty-chain not-found.

GRAPH EXPANSION (injected deps, no DB) — `src/__tests__/vex-agent/tools/internal/long-memory-graph-expansion.test.ts`: remainingSlots≤0 guard, score≤0 seed skip, candidates-not-seeds, empty-graph, seed-entities-only edges, MAX_SEEDS/MAX_ENTITIES/MAX_RESULTS caps + drop counts, dedupe vs alreadyReturned, via-entity truncation + empty contentMd, strictly-below-seed + score-DESC sort, best-seed-score propagation, both-edge-directions, inactive-entry-dropped.

REPO INTEGRATION (real pgvector, synthetic vectors) — `memory-candidates-recall.int.test.ts`: full recallCandidatesTopK predicate (pending+not_consolidated+non-expired, suppressed/expired/terminal/retained excluded, future-TTL included, model/dim isolation, cosine ordering, k bounds + dim-mismatch throw). `knowledge-source-filter.int.test.ts`: listActiveForHotContext/listKnownKinds/countActiveHotContextEntries SOURCE dimension (observed/user_confirmed kept; inferred/hypothesis excluded; default 'observed'). `graph-v1.int.test.ts`, `reconcile.int.test.ts` exist for graph/reconcile.

UNIT — `turn-context.test.ts`: branch-nullability (each branch fails soft independently, never rejects, true-zero≠null, fetch limits 12/30). `memory-section.test.ts`: structure+routing always rendered, fail≠empty omission for both branches, empty-state texts on true-zero, two-knownKinds-widths, Active Memory caps (12 entries/200 summary/3000 hot loose/500 kinds), pinned-before-recent, footer tools.

LIVE EVAL — `retrieval-precision.int.test.ts`: precision@1 over 12-corpus/15-golden (real Gemma), confirmed-outranks-INFERRED-candidate (one case), superseded+expired excluded. `lifecycle.int.test.ts`: F1 (counted-not-listed), F2 (banner-skip-while-searchable), F3 (slow-recurrence). `graph.int.test.ts`: deterministic applyGraphPlan write + fail-open live extraction.

NOT covered (the gaps below build on these, never re-prove them).

## gaps
Untested / under-tested, ranked by risk:

R1 (HIGH) — recallLongMemoryTopK has NO dedicated integration test on real pgvector. The KNOWLEDGE-store mixed-dim crash guard (the documented reason the dim filter exists, recall.ts:6-8) is proven only for the CANDIDATE store. A regression that drops `AND embedding_dim=$` from the knowledge recall would crash every recall in production and NO test catches it. Also the status/expiry/pinned-expired/NULL-TTL gate of recall.ts is only proven through mocks (handler) or implicitly in the live exclusion test — never as a focused deterministic SQL suite. (Scenarios A1-A7.)

R2 (HIGH) — the hot-context MATURITY gate (probationary/decayed exclusion, hot-context.ts:38) is UNTESTED. knowledge-source-filter.int.test.ts proves only the source dimension. The genesis invariant + the explicit attack noted in the code ("a probationary entry promoted with source='observed' would leak into the always-on prompt") has zero regression protection. (Scenarios D1-D2.) listActiveKindCounts being deliberately UN-filtered (judge census) is also unverified (D3).

R3 (HIGH) — the worst-case confirmed-outranks-candidate doctrine is proven on SYNTHETIC numbers (unit) and on ONE `inferred` candidate (live), but NOT on the HARDEST real-Gemma case: hypothesis-tier + decayed-activation knowledge vs an equal-text candidate. Real embeddings can make raw similarities differ slightly; only a live test proves the inequality survives real vectors at the boundary. (Scenario B1.)

R4 (MEDIUM-HIGH) — graph expansion is proven only with STUBBED/MOCKED graph repos. There is no test where a REAL edge + REAL recall produces an expansion that (a) sits below a real direct hit, (b) refuses to resurrect a truncated direct id, (c) refuses to resurrect an expired neighbor. The truncation-dedupe (search.ts:513-520) — the subtle correctness seam — has no end-to-end exercise with a real truncation. (Scenarios C1-C3.)

R5 (MEDIUM) — long_memory_get redirect and long_memory_history lineage are proven only with mocked getById/getLineageChain. No test drives a REAL supersede chain through the repos and then the handlers, so a divergence between the real lineage repo and the handler's merge would slip. (Scenarios C4-C5.)

R6 (MEDIUM) — F1 is characterized ONLY in the live eval suite (skipIf no key), so it does not gate ordinary PRs, and there is no deterministic target test ready for when the fix lands. The precise getActiveEntriesByIds-vs-listActiveForHotContext NULL-TTL asymmetry (graph keeps NULL-TTL, hot list drops it) is undocumented by any test. (Scenarios E1-E3.)

R7 (LOW-MEDIUM) — precision is measured only @1; no precision@3 / recall@5 / near-duplicate-confusion metric, so retrieval-quality regressions that don't flip the #1 rank are invisible. (Scenario B4.)

R8 (LOW) — the Active Memory hot-block 3000-char cap is asserted with a loose `< 5000` bound, not at the boundary; capInline's "first result always kept even if it busts the chars cap" is proven for concise-not-applied but not for the detailed first-result-kept path. (Scenarios F1, F3.)

## priority
Top must-build, smallest-effective-first:

1. (R1) `src/__tests__/integration/repos/knowledge-recall.int.test.ts` — DETERMINISTIC recallLongMemoryTopK suite mirroring the existing memory-candidates-recall.int.test.ts. Highest value/effort: it is a near-copy of an existing pattern, runs without an API key, and closes the single scariest gap (the knowledge-store mixed-dim crash guard A4 + the status/expiry/NULL-TTL/pinned-expired gate A1-A3). This is the one that would catch a production-crashing or silent-leak regression.

2. (R2) Extend `knowledge-source-filter.int.test.ts` (or a sibling `hot-context-maturity.int.test.ts`) with the maturity gate D1-D2 + the listActiveKindCounts divergence D3. Deterministic, no key, directly protects the always-on-prompt poisoning invariant the code itself flags as an attack.

3. (R3) Extend `retrieval-precision.int.test.ts` with B1 (hypothesis+decayed knowledge vs equal-text candidate, HARD assert) — the most adversarial point of the entire doctrine, currently only proven on synthetic numbers. One added `it` in an existing live suite.

4. (R4) New `src/__tests__/integration/eval/retrieval-interaction.int.test.ts` with C1 (graph-no-displace on real edges), C2 (truncation-dedupe), C3 (expired-not-resurrected). Reuses graph.int.test.ts's applyGraphPlan pattern + seedPromotedLessonDirect; proves the S8 enrichment/dedupe seams end-to-end.

5. (R6) New deterministic `hot-context-divergence.int.test.ts` with E1 (F1 characterization that gates every PR, not just live runs) + E3 (the NULL-TTL graph-vs-hot asymmetry) + an E2 skipped target. Cheap, no key, makes the F1 finding a permanent regression sentinel and pre-stages the fix gate.

(R5 C4/C5, R7 B4, R8 F1/F3 follow once the above land.)

