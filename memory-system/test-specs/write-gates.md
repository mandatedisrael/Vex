## domain
WRITE-PATH GATES (long_memory_suggest) — the agent's only write-door into long-term memory. Ordered gauntlet: Zod boundary → free-text redaction (hard-redact + mask on title/summary/contentMd/entities/tags) + scanned-string secret reject (kind/toolCallIds/instrumentKey/positionKey) → live-state reject on redacted aggregate → English-by-contract reject → content-hash from redacted text → cross-store loop-prevention → embed-after-redaction (fail-loud) → deterministic system fields → atomic insert+enqueue.

## correctnessProperties
Each property is a testable claim with file:line evidence of where it is enforced:

P1 (ORDER — no work after a reject). On ANY gate reject (zod/secret/live-state/english), the handler returns `fail()` BEFORE content-hash, before any store lookup, before embed, before insert+enqueue. Enforced by sequential early-returns: zod at suggest.ts:193-195; secret at :201-208; live-state at :219-226; english at :231-246; hash only at :249-254; loop-prevention lookups at :259/273; embed at :302; insert+enqueue at :321-360.

P2 (REDACTION COVERS EVERY PERSISTED FIELD). hardRedactCount/maskCount aggregate across title, summary, contentMd, AND every entity + every tag (redactFreeText maps `apply` over entities/tags). suggest.ts:102-108. A Tier-1 secret in ANY of these → hardRedactCount>0 → reject (:201).

P3 (SCANNED STRINGS REJECTED, NOT MASKED). kind + sourceRefs.toolCallIds + evidenceRefs.instrumentKey/positionKey are SCANNED for Tier-1 secrets (redact(s).hardRedactCount>0) and the candidate is rejected if any hit — these strings are never masked/mutated so FIX-1 anchors and the kind label stay byte-intact. scannedStringsContainSecret suggest.ts:120-128; wired into the reject OR at :201.

P4 (LIVE-STATE GATE RUNS ON REDACTED AGGREGATE INCL ENTITIES/TAGS). scanLiveState runs on the join of redacted title+summary+contentMd+entities+tags (:212-218), so live values smuggled into entities/tags count. Reject iff liveFraction ≥ 0.30 (EXCLUSION_REJECT_THRESHOLD, session-memory-policy.ts:91; exclusion-rules.ts:139).

P5 (ENGLISH GATE RUNS ON REDACTED TEXT, kind EXEMPT). checkLongMemorySuggestEnglish runs on redacted title/summary/contentMd/entities/tags (:231-238); kind is NOT passed (english-check.ts:188-198 surfaces are prose + entities_tags only). Prose: metric A non-ASCII-letter fraction >0.05 OR (≥8 words AND stopword fraction <0.04). entities/tags: per-string non-ASCII letter count >0. (english-check.ts:152-198).

P6 (CONTENT-HASH FROM REDACTED TEXT). computeContentHash uses input.kind + redacted.title/summary/contentMd — NOT the raw input text (:249-254). So a masked address yields a stable clean identity; two suggests differing only in a raw address that masks identically collide. (content-hash.ts:29-37 hashes kind+title+summary+contentMd only.)

P7 (CROSS-STORE LOOP-PREVENTION, THREE OUTCOMES). (a) hash found in knowledge_entries → return already_known {duplicate:true}, NO insert/enqueue (:259-267). (b) latest candidate exists AND status != 'pending' (terminal: promoted/rejected/superseded/merged/expired/retained) → return {candidateId,status,duplicate:true}, NO insert/enqueue (:273-288). (c) no terminal match (none, or a pending match) → fall through to insert; insertCandidate's partial-unique upsert on `status='pending'` resolves a pending collision to inserted:false (crud.ts:92-94, `xmax=0 AS inserted`).

P8 (EMBED AFTER REDACTION, FAIL-LOUD). embedDocument receives redacted.title/summary (:302), runs only after all gates + loop-prevention; on throw → fail("embedding service unavailable") with NO insert/enqueue (:305-308). loadEmbeddingConfig throw → fail("embedding config invalid") (:294-296). No non-embedded fallback row is ever written.

P9 (DETERMINISTIC SYSTEM FIELDS). source = 'hypothesis' floor always (long-memory-suggest-policy.ts:39-41); sensitivity = maskCount>0 ? 'sensitive':'normal' (:50-52); retrievalUntil = recordedAt + 7d (:58-60, CANDIDATE_DUAL_TRACE_TTL_DAYS=7); evidenceStrength='none', retrievalVisibility='not_consolidated', retainUntil=null, availableAtDecisionTime=null (suggest.ts:338-352). proposedBy = context.role (:325).

P10 (ATOMIC INSERT+ENQUEUE; WAKE ON inserted true AND false). insertCandidate + enqueueConsolidateJob run inside ONE withTransaction with the SAME tx (:321-360); enqueue runs unconditionally after insert so a pending-conflict (inserted:false) row still gets a wake (:358 comment). On any tx error → fail, nothing committed (:363-366).

P11 (STEERING-ERROR CONTRACT). Reject messages are fixed, secret-free, agent-facing: SECRET_REJECT_MESSAGE / LIVE_STATE_REJECT_MESSAGE / ENGLISH_REJECT_MESSAGE (:66-71); zod reject renders only `path: message` (firstIssueMessage :169-174) — never echoes the offending value. memLog uses bounded rejectReason enum (long-memory-suggest-policy.ts:72) and never logs raw text.

P12 (ZOD BOUNDARY STRICTNESS). candidateSuggestInputSchema.strict() rejects unknown agent keys incl system-only fields (embedding/source/status/content_hash); kind via isValidKind regex `^[a-z][a-z0-9_]*$` ≤64 (policy.ts:30-36); evidenceAnchorSchema.strict() requires positive-int executionId and rejects proj_* keys (FIX-1); sourceRefsSchema.strict() is pointer-only (messageIds positive ints, toolCallIds `^[A-Za-z0-9._:-]{1,128}$`), no free-text. (memory-candidate.ts:67-142).

## scenarios
All scenarios are split by tier. UNIT = mocked repos/embeddings (extend src/__tests__/vex-agent/tools/internal/long-memory-suggest.test.ts). LIVE = real Gemma + ephemeral pg (extend src/__tests__/integration/eval/write-gates.int.test.ts). PURE = pure-module unit (extend english-check / exclusion-rules / memory-candidate / redaction tests).

═══ A. ORDERING GAUNTLET (UNIT — highest value, mostly NEW) ═══

A1 — secret reject fires BEFORE hash/lookup/embed/insert (NEW; existing tests assert no-insert but NOT the full downstream chain on the secret path).
  SEED: default happy mocks. mockFindByContentHash/mockFindLatestCandidate spied.
  ACTION: handleLongMemorySuggest(validArgs({ summary: "...sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789..." })).
  EXPECTED: reject (secret).
  ASSERT: res.success===false; res.output matches /secret/i; mockFindByContentHash NOT called; mockFindLatestCandidate NOT called; mockEmbedDocument NOT called; mockInsertCandidate NOT called; mockEnqueueConsolidateJob NOT called. (The english test already pins this for non-english at :270-273; replicate the assertion set for the secret + live-state paths so all four reject gates pin the same no-downstream invariant.)

A2 — live-state reject fires BEFORE hash/lookup/embed/insert (NEW — extend existing live-state test which only asserts no insert/enqueue).
  SEED: default mocks.
  ACTION: validArgs({ title:"now", summary:"balance is 1.2 SOL price $0.0042 gas 5 gwei slippage 5% slippage", content_md:"" }).
  ASSERT: success===false; /live state/i; mockFindByContentHash NOT called; mockEmbedDocument NOT called; insert/enqueue NOT called.

A3 — zod reject fires before everything (NEW — existing validation test only checks no-insert).
  ACTION: missing summary → validArgs minus summary.
  ASSERT: success===false; /summary/i; mockFindByContentHash NOT called; mockEmbedDocument NOT called; insert/enqueue NOT called.

A4 — gate PRECEDENCE: secret beats live-state beats english (NEW).
  ACTION (a): a payload that is simultaneously a secret AND live-state AND non-english (summary in Polish containing sk-or key and "balance is 1.2 SOL"). ASSERT res.output matches /secret/i (secret wins, :201 before :219).
  ACTION (b): payload that is live-state AND non-english but no secret (Polish "saldo to 1.2 SOL ..."). ASSERT /live state/i (live-state wins, :219 before :231). This pins the documented ordering, not just individual gates.

═══ B. REDACTION COVERAGE PER FIELD (UNIT) ═══

B1 — secret in contentMd rejects (NEW — existing tests cover summary, entity, toolCallId, instrumentKey, kind but NOT contentMd or tags).
  ACTION: validArgs({ content_md: "Reminder: api key sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789" }).
  ASSERT: success===false; /secret/i; insert NOT called; embed NOT called.

B2 — secret in a TAG token rejects (NEW).
  ACTION: validArgs({ tags: ["risk", "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789"] }).
  ASSERT: success===false; /secret/i; insert NOT called.

B3 — secret in evidenceRefs.positionKey rejects (NEW — only instrumentKey is covered today at :192).
  ACTION: validArgs({ evidence_refs:[{ executionId:5, positionKey:"private_key: 0x"+"c".repeat(64) }] }).
  ASSERT: success===false; /secret/i; insert NOT called.

B4 — masked address in an ENTITY drives sensitivity + is stored masked (NEW — sensitivity is only tested via summary at :288).
  ACTION: validArgs({ entities:["0x1234567890123456789012345678901234567890"] }).
  ASSERT: success===true; insertInput.sensitivity==='sensitive'; insertInput.entities[0] does NOT contain the raw 40-hex; contains "…".

B5 — content-hash is computed from REDACTED text, not raw (NEW — critical, currently untested).
  SEED: spy computeContentHash is hard (it is imported, not injected) — instead assert behaviorally: two suggests whose ONLY difference is a raw EVM address that masks to the SAME `0x1234…7890` produce the SAME content_hash. Capture insertInput.contentHash across two calls.
  ACTION call-1: summary "Treasury 0x1234567890123456789012345678901234567890 funds risk." ; call-2: summary "Treasury 0x1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7890 funds risk." (Note: maskHex keeps first 6 + last 4, so BOTH mask to "0x1234…7890".)
  ASSERT: insertInput.contentHash (call-1) === insertInput.contentHash (call-2). Proves P6: identity is the clean redacted text. (Reset mocks between calls; mockFindLatestCandidate stays null so both insert.)

═══ C. LIVE-STATE GATE PRECISION (PURE + UNIT) ═══

C1 — threshold boundary on the redacted aggregate (PURE, extend exclusion-rules.test.ts).
  Construct text with exactly liveFraction just below 0.30 → rejected false; and exactly ≥0.30 → rejected true. Pin EXCLUSION_REJECT_THRESHOLD===0.30. (Current tests assert "mostly live" / "mostly narrative" but never the 30% boundary.)
  EXPECTED: e.g. 3 live words / 11 total = 0.272 → false; 3/10 = 0.30 → true.

C2 — live state in entities/tags counts in the handler aggregate (already covered at long-memory-suggest.test.ts:235 — KEEP, do not duplicate; cite as covered).

═══ D. ENGLISH GATE (PURE — mostly covered; fill gaps) ═══

D1 — kind is EXEMPT from the english check (NEW at handler level).
  ACTION (UNIT): validArgs({ kind:"zażółć_test" }) → this fails ZOD first (non-ASCII kind), so instead pin at the english-check unit: checkLongMemorySuggestEnglish never receives kind. Assert by code-contract test: a non-English-looking but schema-valid kind like "perps_lekcja" passes the handler's english gate (only entities/tags/prose are checked). ACTION: validArgs({ kind:"perps_lekcja_pl" }) with clean English title/summary → success===true (kind never trips english). Pins P5.

D2 — content_md non-English prose rejects at handler (NEW — handler-level; unit covers prose via title only).
  ACTION: validArgs({ content_md: "Dokładanie do pozycji wyłącznie po potwierdzonym wybiciu pozwoliło uniknąć słabych wejść w wielu sesjach handlowych." }) with English title/summary.
  ASSERT: success===false; /english/i; insert NOT called.

(D-existing: metric A/B boundaries, code-block exemption, entity diacritic reject, documented ASCII-PL limitation are already pinned in english-check.test.ts — cite, do not duplicate.)

═══ E. LOOP-PREVENTION THREE-WAY (UNIT — partly covered) ═══

E1 — knowledge-store hit → already_known (covered :315). KEEP.
E2 — terminal candidate → duplicate short-circuit (covered :327 with status 'rejected'). EXTEND: parametrize over EVERY terminal status (promoted, superseded, merged, expired, retained) — assert each returns {duplicate:true} and NO insert/enqueue. Currently only 'rejected' is tested; the handler's `status !== 'pending'` branch (:274) must hold for all six terminal values.
E3 — pending candidate match → still insert+enqueue, inserted:false (covered :343). KEEP.
E4 — knowledge lookup THROWS → fail, no candidate lookup/insert (NEW).
  SEED: mockFindByContentHash.mockRejectedValue(new Error("db down")).
  ASSERT: success===false; /long_memory_suggest failed/i; mockFindLatestCandidate NOT called; insert NOT called. (Pins the try/catch at :268-271 returns fail, not silent continue.)

═══ F. EMBED-AFTER-REDACTION FAIL-LOUD (UNIT — partly covered) ═══

F1 — embedder outage → fail, nothing written (covered :303). KEEP.
F2 — embedding CONFIG invalid → distinct fail message, no embed/insert (NEW).
  SEED: mockLoadEmbeddingConfig throws Error("EMBEDDING_BASE_URL missing").
  ASSERT: success===false; /embedding config invalid/i; mockEmbedDocument NOT called; insert NOT called.
F3 — embed receives REDACTED title+summary (covered :136 — KEEP).
F4 — embed ordering: embed runs AFTER loop-prevention, so a terminal-candidate duplicate never embeds (NEW).
  SEED: mockFindLatestCandidate returns {status:'promoted'}.
  ASSERT: mockEmbedDocument NOT called (duplicate short-circuit at :273 precedes embed at :302).

═══ G. DETERMINISTIC SYSTEM FIELDS (UNIT + PURE — covered; one gap) ═══

G1 — retrievalUntil = recordedAt + 7d stamped on insert (NEW at handler level — only the pure policy is tested).
  SEED: freeze time via vi.useFakeTimers().setSystemTime(new Date("2026-06-12T00:00:00Z")).
  ACTION: validArgs().
  ASSERT: insertInput.retrievalUntil.toISOString()==="2026-06-19T00:00:00.000Z". Pins P9 end-to-end through the handler, not just computeRetrievalUntil.
G2 — source/sensitivity/evidenceStrength/visibility/retainUntil/availableAtDecisionTime/proposedBy (covered :122). KEEP.

═══ H. ATOMICITY (UNIT — covered; one gap) ═══

H1 — insert + enqueue share one tx (covered :148). KEEP.
H2 — enqueue runs on inserted:false (covered :343). KEEP.
H3 — tx THROW → fail, nothing reported as committed (NEW).
  SEED: mockInsertCandidate.mockRejectedValue(new Error("unique violation")).
  ASSERT: success===false; /long_memory_suggest failed/i; mockEnqueueConsolidateJob NOT called (insert threw inside tx before enqueue). Pins P10 rollback contract.

═══ I. ADVERSARIAL F5 (LIVE eval + PURE characterization) ═══

I1 — CHARACTERIZATION (assert CURRENT behavior; covered in write-gates.int.test.ts:207 and via redact() hardRedactCount). KEEP as-is — it records F5 findings to the report card. Additionally add a PURE characterization in text-redaction.test.ts asserting redact(shape).hardRedactCount===0 for: (a) Solana base58 88-char key, (b) unlabelled 64-hex (no 0x, no key label), (c) "postgres://admin:s3cretP@ss@db.internal:5432/vex", (d) comma-separated 12-word mnemonic. This pins the EXACT redactor gap at the unit level (fast, no LLM).
I2 — TARGET (skipped until F5 fixed). Add an it.skip / it.todo block "F5 target: these shapes MUST reject once the redactor closes the gap" with the SAME four shapes asserting suggest → success===false /secret/i and redact().hardRedactCount>0. Tag with a stable marker so the day F5 lands, un-skip flips green. This is the "what SHOULD reject" half the prompt requires, kept non-failing today.

═══ J. ZOD BOUNDARY (PURE — well covered; targeted additions) ═══

J1 — evidence-anchor strictness FIX-1 (covered memory-candidate.test.ts:43 — proj_* rejected). KEEP.
J2 — toolCallId charset reject at HANDLER level (NEW — schema test covers the schema, but pin that a malformed toolCallId surfaces a steering message from the handler).
  ACTION (UNIT): validArgs({ source_refs:{ toolCallIds:["has spaces"] } }).
  ASSERT: success===false; /sourceRefs|toolCallIds/i in output; insert NOT called.
J3 — response_format is NOT a candidate field; an unknown extra top-level key is rejected by .strict (covered :190). KEEP. ADD (NEW): response_format:"detailed" is accepted and NOT forwarded into the candidate — already implicitly covered by the detailed-shape test (:375); cite.

## adversarial
Subsystem-specific abuse scenarios and the MUST-NOT outcomes:

1. SECRET EXFILTRATION VIA ANY PERSISTED FIELD. A secret hidden in contentMd, a tag, a positionKey, or the kind label must NOT survive into memory_candidates. MUST NOT: write a row when hardRedactCount>0 anywhere, or when scannedStringsContainSecret is true. The scanned strings (kind/toolCallIds/instrumentKey/positionKey) must be SCANNED-and-rejected, never masked — a partial mask that mutated an evidence anchor would corrupt the FIX-1 audit link AND could still leak. Tests B1-B3, A1.

2. F5 REDACTOR BLIND SPOTS (CURRENTLY EXPLOITABLE). Solana base58 secret keys (88 chars, exceed the 32-44 SOLANA_ADDRESS bound at text-redaction.ts:78 so they are not even masked), unlabelled raw 64-hex (TX_HASH_HEX_RE requires the 0x prefix at :73; RAW_HEX_KEY_RE requires a key label at :51), postgres://user:pass@host URIs (no pattern), and comma-punctuated mnemonics (BIP39_HEURISTIC_RE skips matches containing punctuation at :115) all pass with hardRedactHits=0 and are ACCEPTED today. The test suite MUST NOT silently assert these reject (that would be a false-green lie). It MUST characterize the accept (I1) AND carry a skipped target test (I2) so the gap is visible and the fix is gated.

3. LIVE-STATE SMUGGLING INTO ENTITIES/TAGS. The agent could keep title/summary clean and pack balances/prices into entities/tags to dodge a naive gate. MUST NOT: pass the live-state gate when the redacted aggregate (incl entities+tags) crosses 0.30. Covered (suggest.ts:212-218); keep the C2 test green.

4. NON-ENGLISH POLLUTION OF pgvector. Non-English prose degrades Gemma recall permanently. MUST NOT: embed or store a candidate whose redacted prose fails metric A/B, or whose entity/tag carries a non-ASCII letter. The english gate must run on REDACTED text and BEFORE embed (:231 before :302). Note the documented limitation (ASCII-stripped Polish in short labels slips through, english-check.ts:38-39) — a target/known-gap test should mark it, not falsely assert rejection.

5. LOOP / DUPLICATE-WRITE AMPLIFICATION. An agent re-suggesting an already-promoted or already-terminal lesson must NOT create a fresh pending row or a redundant consolidate job (cost + judge load). already_known (knowledge hit) and terminal-candidate short-circuit must return WITHOUT insert/enqueue (E1, E2). Conversely, a genuine pending re-suggest MUST still wake the manager (inserted:false → enqueue), else a stranded pending row never consolidates (E3, P10).

6. STRANDED CANDIDATE (ATOMICITY BREAK). A candidate inserted without an enqueued consolidate job is invisible to the manager forever. MUST NOT: ever commit an insert without the enqueue in the same tx; on insert throw, enqueue must not run and nothing commits (H3).

7. STEERING-CHANNEL LEAK. The fail() message is fed back to the agent and logged. MUST NOT: echo the offending secret/value/raw text in the reject message or in memLog. Reject messages are fixed constants (:66-71); zod renders path:message only (firstIssueMessage); memLog rejectReason is a bounded enum. A test should assert the secret string itself does NOT appear in res.output for the secret-reject path (negative assertion).

8. FAKE PROVENANCE / SCAM-AUTHORITY. An agent must NOT be able to stamp a high source tier — the schema forbids an agent-supplied `source` (strict reject, J/covered), and the handler always derives source='hypothesis' (P9). A test should confirm passing `source:"user_confirmed"` is rejected by .strict (covered memory-candidate.test.ts:190) AND that the handler-derived source is always 'hypothesis' regardless (covered :122).

## determinismSplit
DETERMINISTIC (hard-assert; these are GATES, run without an LLM):
- Zod accept/reject + first-issue message (mapAndValidate/firstIssueMessage).
- redact() hard/mask counts and output text (pure regex) — incl the F5 hardRedactCount===0 characterizations.
- scannedStringsContainSecret boolean.
- scanLiveState rejected boolean + liveFraction at the 0.30 boundary (pure arithmetic over EXCLUSION_REJECT_THRESHOLD).
- checkLongMemorySuggestEnglish rejected/reason/field (pure heuristic, calibrated to fixed BENCHMARK_PAIRS).
- computeContentHash stability/identity from redacted text (sha256, deterministic).
- All control-flow ORDERING assertions (which mocks were/weren't called) — pure handler logic with mocked IO.
- Deterministic system fields: source='hypothesis', sensitivity from maskCount, retrievalUntil = recordedAt+7d, evidenceStrength/visibility/retainUntil/availableAtDecisionTime, proposedBy=role.
- Atomicity: same-tx assertion, enqueue-on-inserted:false, rollback-on-throw.
- insertCandidate upsert `inserted` boolean (xmax=0) — deterministic given pg semantics (integration tier).
These belong in the UNIT suite (mocked) and PURE module suites — NO live LLM. They are gates: any drift = test fail.

LIVE-LLM (measured, recorded to report card, NOT a hard gate):
- The end-to-end accept of a CLEAN English lesson requires a REAL Gemma embedding (embed-after-redaction succeeds) → this is the only place the live harness adds value beyond unit mocks: it proves the real embedder is reachable and the redacted text embeds. write-gates.int.test.ts already asserts status==='pending'.
- The already_known path with a REAL promoted entry (seedPromotedLessonDirect + real Gemma) — proves the content-hash matches across the real insertEntry path (covered :146).
- F5 characterization findings (manifested true/false) — recorded as report-card findings, NOT hard-asserted to a fixed outcome (the suite stays green whether or not the gap exists, by design). This is correct: F5 is a known-gap measurement, not a gate.
Rationale: the write-path gates are overwhelmingly DETERMINISTIC — the embedder is the only live dependency, and it is fail-loud, so the gate logic is fully unit-testable. The live eval's role here is reachability + content-hash-parity proof + F5 gap reporting, not gate verification.

## currentCoverage
Honest inventory of what already exists:

UNIT (src/__tests__/vex-agent/tools/internal/long-memory-suggest.test.ts) — STRONG. Covers: accepted path stages candidate+enqueues; system-field stamping incl proposedBy/embeddingModel/dim (:122); embed-after-redaction with masked address (:136); one-tx atomicity (:148); secret in summary/entity/toolCallId/instrumentKey/kind (:158-216); live-state in summary AND in entities/tags (:219-253); non-English Polish prose with full no-downstream ordering assertion (:256-274) and non-English entity (:276); masked-address sensitivity (:288); embedding outage fail-loud (:303); loop-prevention all three branches incl inserted:false wake (:314-365); concise/detailed response shapes (:368-389); zod missing-field + bad-kind (:391-405).

PURE: english-check.test.ts (benchmark calibration en-pass/non-en-fail, metric A/B boundaries, code-block exemption, entity/tag diacritic reject, documented ASCII-PL limitation, named-constant pins) — STRONG. exclusion-rules.test.ts (live-heavy reject, narrative accept, empty/whitespace, shouldRejectChunk) — MODERATE (no explicit 0.30 boundary test). memory-candidate.test.ts (FIX-1 anchors incl proj_* reject, non-positive/non-int executionId, semantic-key bounds, sourceRefs pointer-only/free-text/charset reject, kind regex, defaults, .strict top-level incl source/embedding reject, max-array bounds) — STRONG. long-memory-suggest-policy.test.ts (source floor, sensitivity from maskCount, 7d TTL, no-mutate, bounded reasons) — STRONG. redaction.test.ts + text-redaction.test.ts (Tier-1 labelled key/api/jwt/mnemonic, punctuated-mnemonic NON-redact, Tier-2 EVM/tx/Solana mask, redactObject over fields+arrays) — STRONG for the SHAPES IT KNOWS; does NOT characterize the F5 blind spots.

LIVE EVAL (src/__tests__/integration/eval/write-gates.int.test.ts) — GOOD. Real-Gemma drive of the production handler: API-key reject, live-state reject, Polish reject, clean accept (pending), exact-dup already_known via seedPromotedLessonDirect, and the four F5 characterizations recorded to the report card.

NOT COVERED (honest): contentMd-secret and tag-secret reject; positionKey-secret reject; entity masked-address sensitivity; content-hash-from-redacted-text identity proof; gate PRECEDENCE (secret>live-state>english on a payload tripping multiple); secret-path full no-downstream chain (knowledge/embed not-called on secret reject — only the english path pins this today); live-state/zod-path no-embed ordering; knowledge-lookup-throws → fail; embedding-config-invalid → fail; embed-not-called on terminal duplicate; tx-throw rollback (enqueue not called); retrievalUntil stamped through the handler with frozen time; terminal short-circuit for ALL six terminal statuses (only 'rejected' tested); 0.30 live-state boundary; F5 PURE-unit characterization at redact() level; F5 target (skipped) test.

## gaps
Ranked by risk:

R1 (HIGH) — F5 secret blind spots have NO target/gate. Today they are only characterized in the live eval. There is no skipped/todo "MUST reject when fixed" test and no PURE-unit pin of redact().hardRedactCount===0 for the four shapes. A future redactor refactor could SILENTLY change F5 behavior (better or worse) with nothing failing. Need I1 (pure pin) + I2 (skipped target).

R2 (HIGH) — content-hash-from-redacted-text is UNTESTED. P6 is the identity foundation of loop-prevention and supersession lineage. If someone "fixes" the handler to hash raw input.title/summary (e.g. to preserve pre-mask identity), duplicate detection silently changes and the same lesson re-promotes under two hashes. B5 closes this.

R3 (MED-HIGH) — gate PRECEDENCE untested. The ordered gauntlet's whole point is determinism; nothing asserts secret beats live-state beats english when a payload trips several. A reorder (e.g. moving the english check above the secret check) would leak a secret in a non-English steering message AND change which reject the agent sees. A4 closes this.

R4 (MED) — secret/live-state/zod reject paths don't pin the FULL no-downstream chain. Only the english path asserts findByContentHash/embed/insert/enqueue all-not-called (:270). A regression that moved the secret check AFTER the hash/embed would still pass today's secret tests (which only check insert/enqueue not-called) while leaking the secret into the embedder. A1-A3 close this.

R5 (MED) — terminal short-circuit only tested for status 'rejected'. The `status !== 'pending'` branch (:274) must hold for promoted/superseded/merged/expired/retained too; a future enum addition (e.g. a new terminal state) could accidentally be treated as pending and re-inserted. E2 parametrization closes this.

R6 (MED) — error-path branches untested: knowledge-lookup throw (:268), embedding-config invalid (:294), tx throw rollback (:363). Each currently returns fail with a specific message and a specific no-side-effect guarantee; none is pinned. E4/F2/H3 close these.

R7 (LOW-MED) — handler-level coverage gaps that the unit tier should own but currently only the schema/policy modules pin: retrievalUntil stamped through the handler (G1); contentMd-secret/tag-secret/positionKey-secret (B1-B3); entity masked-address sensitivity (B4); 0.30 live-state boundary (C1).

R8 (LOW) — kind-exempt-from-english is implied but not asserted at handler level (D1); content_md non-English reject not asserted at handler level (D2).

## priority
Top 5 must-build, smallest-effective-first:

1. B5 — content-hash-from-REDACTED-text identity proof (UNIT). Two suggests differing only by a raw EVM address that masks identically yield the SAME insertInput.contentHash. ~15 lines, pure control-flow, closes R2 (the loop-prevention/supersession foundation). Highest value/effort ratio.

2. A4 + A1-A3 — gate PRECEDENCE + full no-downstream chain on every reject path (UNIT). One small describe block: (a) multi-trip payload asserts secret>live-state>english order; (b) for secret + live-state + zod rejects, assert findByContentHash NOT called AND embed NOT called AND insert/enqueue NOT called (mirror the english test at :270). Closes R3 + R4 — the core "ordered, fail-loud" contract.

3. I1 + I2 — F5 pure characterization + skipped target (PURE, in text-redaction.test.ts). Pin redact(shape).hardRedactCount===0 for the four F5 shapes (asserts the gap byte-exactly, no LLM) and add an it.skip target block asserting they MUST reject once fixed. Closes R1; makes the most dangerous known gap visible and fix-gated. Keep the existing live-eval F5 characterization untouched (it feeds the report card).

4. E2-parametrized + E4 + F2 + H3 — terminal-status matrix + error-path branches (UNIT). Loop over all six terminal statuses for the short-circuit; add knowledge-lookup-throw, embedding-config-invalid, and tx-throw-rollback. Closes R5 + R6 — the under-tested failure surfaces.

5. B1-B4 + G1 — per-field secret coverage (contentMd, tag, positionKey), entity masked-address sensitivity, and handler-level retrievalUntil with frozen time (UNIT). Closes R7 — fills the remaining persisted-field redaction + system-field gaps that the schema/policy unit tests can't reach because they don't exercise the handler wiring.

All five are UNIT/PURE (no live LLM) — they are gates, fast, and deterministic. The existing LIVE write-gates eval already covers reachability + clean-accept + already_known + F5 reporting and should NOT be duplicated; at most add one live assertion that a clean lesson's stored summary is byte-equal to its redacted form to prove no post-embed mutation, but that is optional and lower priority than the five deterministic gates above.

