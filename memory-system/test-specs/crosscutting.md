## domain
Cross-cutting invariants + observability + export/import + inspector (memory-system)

## correctnessProperties
Each property is a testable claim with file:line evidence of where it is enforced.

ADVISORY-ONLY (OD-1):
- P-ADV-1: No execution/sizing/approval/wallet-intent module imports the knowledge repo or long-memory recall. Enforced structurally — engine/core/* and db/repos/{wallet-intents,approval-intents,approvals,swap-prequotes}.ts contain ZERO imports of `@vex-agent/db/repos/knowledge` or `@vex-agent/memory/long-memory*` (verified by grep: empty result). The ONLY consumers of recall are the 4 read-only tools tools/internal/long-memory/{search,get,history,suggest}.ts.
- P-ADV-2: Every promoted entry is stamped `influence_scope:"advisory"` and `maturity_state:"probationary"` regardless of plan — promote.ts:175-178 hardcodes `influenceScope:"advisory"` (the comment "advisory-ALWAYS"); supersede successor inherits it via promote.ts:284.
- P-ADV-3: `retrieval_boost` (the only non-advisory scope) modulates RECALL RANK only, never a hard constraint — long-memory-enums.ts:33-34, long-memory-retrieval-policy.ts header ("a SOFT signal, never a hard constraint"). influence_scope never reaches a numeric sizing/approval input.
- P-ADV-4: ledger-wake touches ONLY memory_jobs — ledger-wake.ts:25-27,118 (only `enqueueReconcileJob`); reconcile writes ONLY activation/maturity/status/provenance-tier — reconcile.ts:33-35, applyConsequence reconcile.ts:495-579 calls only applyMaturityTransition / invalidateEntryOnReconcile / raiseEntrySourceTier / recordMaturityEvent / invalidateEdgesForOrigin.

FAIL-CLOSED:
- P-FC-1: judge throws on missing config, timeout, missing braces, JSON.parse failure, or schema failure — never returns a promoting/guessed verdict — judge.ts:85-127 (5 distinct throw sites; "NO promoting fallback on LLM failure").
- P-FC-2: reconcile judge failure THROWS → markFailed → retry; no guessed consequence — reconcile.ts:316-322,457-461.
- P-FC-3: promote defense-in-depth: a NEW redact/scanLiveState hit on already-redacted text refuses promotion and converts to reject(secret_or_live_state) — never stored — promote.ts:132-139,390-403.
- P-FC-4: reconcile no-op paths (entry_inactive/stale_version/no_candidate/unresolvable/unchanged) complete WITHOUT writing a decision row or mutating knowledge — reconcile.ts:239-284.

REDACT-ON-EVERY-BOUNDARY:
- P-RB-1: promote re-runs redact()+scanLiveState() on title+summary+contentMd before any store — promote.ts:132-139.
- P-RB-2: memLog drops every non-allowlisted key, every wrong-typed value, every shape-failing string, every credential-prefixed string, and everything redact() flags (hardRedactCount>0 OR maskCount>0) — logger.ts:333-390.

AUDIT COMPLETENESS + IDEMPOTENCY:
- P-AU-1: promote/supersede/retain/reject/expire each return a recordDecision input (decisionVersion 0) written in the same tx — promote.ts:229-239,313-324,349-370; reconcile writes a reconcile decision per applied change — reconcile.ts:396-418.
- P-AU-2: decision_hash hashes ONLY the semantic payload (anchor, version, type, knowledge pointers, rejectReason, evidenceRefs canonicalized order-independently) — NEVER timestamps/provider/model/cost/job_id — decision-hash.ts:54-69.
- P-AU-3: same (candidate,version)|(reconcile_entry,outcome_version) + same hash → inserted=false benign duplicate; same key + DIFFERENT hash → idempotency_conflict, never a silent second row — crud.ts:287-298.
- P-AU-4: a decision with an incoherent anchor (job not holding the candidate / not the matching reconcile job) is refused with anchor_incoherent, zero rows written — crud.ts:74-102,267-269.
- P-AU-5: decision log survives cascade-delete of its candidate/session (non-FK anchors) — types.ts:5-9; outcome pointer promoted_knowledge_id is SET NULL on entry delete.

EXPORT/IMPORT (FIX-2):
- P-EI-1: v3 export carries all 30 schema_fields incl `source` + the full memory-v2 influence/bi-temporal block — knowledge-export.ts:63-94.
- P-EI-2: import recomputes content_hash locally (never trusts the file hash), dedups before embedding, re-embeds locally, resolves supersedes lineage by predecessor content_hash — row-pipeline.ts:110-141.
- P-EI-3: present-but-invalid durable field rejects the row (fail-loud), absent maps to insertEntry default — validators.ts (every requireValid* throws on present-but-bad).
- P-EI-4: a supersedes_content_hash that resolves to no predecessor is fail-loud (throws), never silently NULLed — row-pipeline.ts:131-141.

INSPECTOR (renderer trust boundary):
- P-IN-1: candidate/decision/job SELECTs never reference content_md/source_refs/evidence_refs/outcome/content_hash/embedding/session_id/proposed_by/decision_hash/locked_by/locked_at/heartbeat_at/last_error — memory-inspector-db.ts:12-21,225-227,307-312,411-416.
- P-IN-2: DTO schemas are `.strict()` — a row carrying content_md/evidence_refs/decision_hash/last_error/lastErrorCode FAILS the parse — memory-inspector.ts:231,264,298,302; shared/schemas test pins it.
- P-IN-3: DB unreachable OR tables missing (42P01) → redacted RETRYABLE dbUnavailable, NEVER ok([]) — memory-inspector-db.ts:64-101.
- P-IN-4: inputs are bounded (limit cap 500 / recentLimit cap 100) and `.strict()` reject unknown keys — memory-inspector.ts:154-202.

## scenarios
All scenarios are DETERMINISTIC unless tagged [LIVE]. New files proposed; "EXTEND" = add to an existing file.

=== A. ADVISORY-ONLY GREP-GATE (deterministic, architecture test) ===
NEW: src/__tests__/architecture/advisory-boundary.test.ts (or extend an existing arch/boundary suite if present)

A1 — execution surface never imports recall (static grep gate)
- SEED: list of EXECUTION_MODULES = all .ts under src/vex-agent/engine/core, plus db/repos/{wallet-intents,approval-intents,approvals,swap-prequotes}.ts (exclude __tests__).
- ACTION: read each file's source; scan for any import matching /from ["']@vex-agent\/db\/repos\/knowledge(\/|")/ or /@vex-agent\/memory\/long-memory/ or /searchLongMemory|long_memory_search/.
- EXPECTED: zero matches.
- ASSERT: `expect(offenders).toEqual([])` with the offending file:line in the message. This is the grep-gate the prompt demands; it fails loudly the day someone wires a lesson into sizing.

A2 — only the 4 read-only tools consume recall
- SEED: glob src/vex-agent/tools/internal/long-memory/*.ts.
- ACTION: assert the set is exactly {search,get,history,suggest}.ts and that none of them import insertEntry/supersedeEntry/recordDecision or any sizing/approval/walletIntent repo (grep each file).
- ASSERT: each file matches NONE of /insertEntry|supersedeEntry|recordDecision|positionSize|sizing|approvalIntent|walletIntent/. (suggest.ts writes a CANDIDATE, not knowledge — assert it imports insertCandidate but NOT insertEntry.)

A3 — promote always stamps advisory (behavioral, deterministic, integration)
EXTEND: src/__tests__/integration/memory/memory-manager-executor.int.test.ts (or a new memory-manager-promote.int.test.ts)
- SEED: a pending candidate with a clean English trade lesson; drive the real consolidate→promote path (reuse seedFaithful* / the executor harness) with a stubbed judge returning verdict=promote and proposedScope absent AND a second run with a judge that (hypothetically) tries to set a non-advisory scope.
- ACTION: read back the promoted knowledge_entries row.
- EXPECTED: influence_scope='advisory', maturity_state='probationary', activation_strength=PROBATION_ACTIVATION — regardless of judge output.
- ASSERT: `expect(row.influence_scope).toBe('advisory')`. Property P-ADV-2. (No judge field can elevate scope — promote.ts hardcodes it.)

=== B. AUDIT COMPLETENESS — every verdict writes exactly one decision (deterministic, integration) ===
EXTEND: src/__tests__/integration/repos/memory-decisions-crud.int.test.ts is repo-level; the gap is the MANAGER-level "every applyDecision writes a row". NEW: src/__tests__/integration/memory/decision-completeness.int.test.ts

B1 — promote / supersede / retain / reject / expire each emit one decision row
- SEED: 5 reserved candidates (reuse seedReservedCandidate + the apply harness). Force each DecisionPlan type via a stubbed plan resolver.
- ACTION: run applyDecision then recordDecision in-tx for each.
- EXPECTED: each candidate has exactly ONE memory_decisions row with the matching decision_type; promote/supersede carry promoted_knowledge_id; supersede ALSO carries supersedes_knowledge_id; reject/expire carry reject_reason; retain carries neither.
- ASSERT: per candidate `count(*)=1`; decision_type matches; pointer columns match the plan; getLatestDecision reflects it.

B2 — reconcile applied-change writes a reconcile decision; no-op writes NONE
- SEED: a promoted trade lesson with a live outcome (seedFaithful confirmed trade). Two sub-cases: (i) ledger unchanged since promote → outcomeDelta 'unchanged'; (ii) ledger flips loss→profit → consequence change.
- ACTION: run processReconcileJob with a stubbed judge.
- EXPECTED: case (i) completes with NO new memory_decisions row (reconcile.ts:281-284); case (ii) writes exactly one reconcile decision stamped outcome_version=v+1.
- ASSERT: `decisions where reconcile_entry_id=entry` count is 0 for (i), 1 for (ii); the (ii) row's outcome_version = jobVersion+1, decided_by ∈ {manager,system}.

=== C. DECISION_HASH IDEMPOTENCY — semantic-only + conflict (deterministic) ===
NEW unit: src/__tests__/vex-agent/db/repos/memory-decisions/decision-hash.test.ts
EXTEND integration: memory-decisions-crud.int.test.ts (already covers same-hash dup, conflict, reconcile dual idempotency — add the hash-invariance cases below).

C1 — hash ignores non-semantic fields (unit, pure)
- SEED: two DecisionHashInput objects identical in {anchorKind,anchorId,version,decisionType,knowledge pointers,rejectReason,evidenceRefs} but differing only conceptually (the hash function has no time/provider/model/cost/job fields as inputs — assert by construction that those are absent from the signature).
- ACTION: computeDecisionHash on both.
- EXPECTED+ASSERT: equal hashes. Then mutate decisionType → different hash; mutate promotedKnowledgeId null↔42 → different hash; mutate rejectReason → different hash.

C2 — evidenceRefs order-independence (unit)
- SEED: same anchors in two different array orders, each anchor with mixed presence of instrumentKey/positionKey/captureItemId.
- ACTION: computeDecisionHash.
- EXPECTED+ASSERT: equal hash (decision-hash.ts:56 sorts the canonical anchors). Then change one anchor's instrumentKey → different hash. Then `""` absent-field vs a real single-char value must NOT collide (decision-hash.ts:46-51 comment) — assert anchor with instrumentKey:"" (impossible via schema but test the encoder) hashes differently from instrumentKey:"a".

C3 — idempotency_conflict at the manager level produces zero new rows (integration; already partly covered)
- Confirm the EXISTING crud test (line 65-87) covers candidate conflict. ADD: a reconcile conflict — same (entry, outcome_version) re-recorded with a DIFFERENT promoted/supersedes pointer set → idempotency_conflict, still exactly one row.

=== D. memLog STRUCTURAL GUARD — secret-shaped tokens through the logger (deterministic) ===
The unit test logger.test.ts is thorough on filterMemoryLogMeta. The GAP: the F5 missed-shapes (write-gates eval) are NOT proven against the LOGGER. Add a focused suite that drives the exact F5 shapes through filterMemoryLogMeta to prove they are dropped even though the redactor misses them in PROSE.
EXTEND: src/__tests__/vex-agent/memory/observability/logger.test.ts

D1 — F5 missed shapes are dropped by the logger on id+enum keys
- SEED: the 4 F5 shapes verbatim from write-gates.int.test.ts (solana base58 88-char, unlabelled 64-hex, postgres URI creds, comma-separated mnemonic) plus the credential-prefix family.
- ACTION: filterMemoryLogMeta({correlationId: shape}) and filterMemoryLogMeta({errorCode: shape}) for each.
- EXPECTED: ALL drop. Mechanism per shape: 64-hex on an id key → redact() maskCount/hardRedact catches it OR id-charset; base58 88-char → contains no separators, but if it satisfies enum/id charset it must be dropped — ASSERT the OUTCOME is {} regardless of mechanism; postgres URI has `:` `@` `/` → id charset rejects `@` (not in [A-Za-z0-9._:/-]) → shape gate drop; comma-mnemonic → spaces+commas fail both charsets.
- ASSERT: `expect(filterMemoryLogMeta({correlationId: shape})).toEqual({})` for each. This is the load-bearing claim: a secret shape the PROSE redactor misses can never ride a structured log field because the charset + credential-prefix + redactor triple-gate it. (If any shape survives, that is a real finding — assert {} and let it fail to surface it.)

D2 — every memLog call site key is allowlisted (drift gate, deterministic)
- SEED: grep all memLog/memLog.warn/memLog.error call sites in src/vex-agent (the meta object literal keys).
- ACTION: collect every meta key used at a call site; compare to keys of META_KEY_CATEGORY (logger.ts:245-309).
- EXPECTED: every used key is in the allowlist (otherwise it is silently dropped — a real telemetry bug).
- ASSERT: `expect(usedKeysNotInAllowlist).toEqual([])`. Smallest-effective static guard against a call site logging into the void.

=== E. EXPORT/IMPORT ROUND-TRIP — extend FIX-2 evidence (deterministic, integration) ===
The existing knowledge-roundtrip.int.test.ts is strong (3 seeds, all durable columns, idempotency). GAPS to add (same file, new `it`s):

E1 — supersession LINEAGE survives the round-trip (the prompt's headline lineage claim)
- SEED: predecessor P (status='superseded', some content) and successor S (status='active', supersedes_id → P, change_summary/what_failed set). Insert P first then S so export order (id ASC) emits P before S.
- ACTION: export → DELETE → import.
- EXPECTED: after import, S.supersedes_id resolves to the RE-IMPORTED P (row-pipeline.ts:131-141 maps supersedes_content_hash→local id); P stays status='superseded', S stays 'active'; predecessor content is byte-identical (NOT overwritten).
- ASSERT: restored S.supersedesId === restored P.id (new local id, resolved by content_hash); P.status==='superseded'; S.status==='active'; both content_md byte-identical to seed.

E2 — dangling predecessor is fail-loud (P-EI-4)
- SEED: hand-craft a JSONL where a row carries supersedes_content_hash pointing at a hash that appears NOWHERE in the file.
- ACTION: importKnowledge(lines).
- EXPECTED: that row is counted `failed` (the pipeline throws "does not resolve to any existing entry"); other rows still import.
- ASSERT: report.failed >= 1 for that row; the dangling successor is NOT inserted with a NULL FK.

E3 — present-but-invalid durable field rejects the row, valid rows survive (P-EI-3)
- SEED: JSONL with one row carrying influence_scope:"manipulate_sizing" (out of {advisory,retrieval_boost}); another with maturity_state:"god_tier"; another with activation_strength:1.7; another with source:"trusted" (not a KnowledgeSource); a clean row.
- ACTION: importKnowledge.
- EXPECTED: the 4 bad rows → failed (validators throw NAMING the bad value); clean row → inserted. CRITICAL: a bad influence_scope is NEVER silently coerced to 'advisory' — it FAILS (the FIX-2 anti-pattern is silent re-default).
- ASSERT: report.failed===4, report.inserted===1; the bad rows produced no knowledge_entries rows.

E4 — content_hash is recomputed, file hash is ignored (tamper resistance)
- SEED: a valid export row whose `content_hash` field is overwritten with garbage hex, but kind/title/summary/content_md untouched.
- ACTION: import.
- EXPECTED: row imports under the LOCALLY recomputed hash (row-pipeline.ts:110-116); a re-import dedups on the recomputed hash, zero embed calls.
- ASSERT: findByContentHash(recomputed) is non-null; findByContentHash(garbage) is null; rerun → skipped_duplicate.

E5 — non-active statuses round-trip without re-activation (history fidelity)
- SEED: an 'invalidated' entry and an 'archived' entry with explicit created_at/valid_until in the past.
- ACTION: export → wipe → import.
- EXPECTED: status preserved (NOT silently re-activated to 'active' with NOW() — knowledge-export.ts:22-27 rationale); created_at/valid_until preserved.
- ASSERT: restored.status==='invalidated'/'archived'; iso(created_at) unchanged.

=== F. INSPECTOR SANITIZATION — close the integration gap (deterministic) ===
The unit tests mock pg. GAP: no INTEGRATION test that runs the real SELECTs against a DB seeded with a row that HAS content_md/evidence_refs/decision_hash/last_error populated, proving the live query result has those keys ABSENT.
NEW: src/__tests__/integration/database/memory-inspector-sanitization.int.test.ts (uses the integration testcontainers pg; if vex-app main DB helper cannot be driven from this harness, do it as a contract test calling the same SQL — see notes).

F1 — live candidate row never surfaces sanitized columns
- SEED: insert a memory_candidate with content_md="SECRET BODY", evidence_refs=[{executionId:1,instrumentKey:"X"}], source_refs={messageIds:[1]}, a real session_id, proposed_by set, an embedding vector.
- ACTION: call listInspectorCandidates({limit:10}) (or run its exact SQL).
- EXPECTED: the returned DTO has NONE of content_md/source_refs/evidence_refs/outcome/content_hash/embedding/session_id/proposed_by/retain_until/retrieval_until.
- ASSERT: `Object.keys(dto)` is exactly the MemoryCandidateDto key set; `JSON.stringify(dto)` does NOT contain "SECRET BODY"; memoryCandidateDtoSchema.parse(dto) succeeds (round-trips through the strict schema).

F2 — live decision row never surfaces evidence_refs/decision_hash
- SEED: a recordDecision row (real, via the repo) — it has a 64-hex decision_hash and evidence_refs.
- ACTION: listInspectorDecisions.
- EXPECTED+ASSERT: DTO keys exclude evidence_refs/decision_hash; the 64-hex hash string does not appear in JSON.stringify(dto).

F3 — live job row never surfaces last_error/locked_by/heartbeat_at
- SEED: a memory_job with last_error="raw provider failure: <stack> sk-leak" and locked_by/heartbeat set.
- ACTION: getJobsSummary.
- EXPECTED+ASSERT: recentJobs[0] keys exclude last_error/locked_by/locked_at/heartbeat_at; the raw last_error text does not appear anywhere in JSON.stringify(summary).

F4 — strict-DTO injection (deterministic, unit, EXTEND memory-inspector.test.ts)
- Already covers strict rejection of forbidden keys. ADD: a row that ALSO carries a benign-looking extra (`note`, `reason`, `lastErrorCode`) → parse fails (strict), proving no future column silently rides through.

=== G. FAIL-CLOSED [LIVE] + DETERMINISTIC ===
Judge fail-closed is deterministic via a stub provider; the LIVE half is measured by the existing F31 report-card.

G1 — judge throws on every malformed step (deterministic, unit) — EXTEND judge tests (or NEW judge-failclosed.test.ts)
- SEED: a stub JudgeProvider returning, per case: null config; content="" ; content="no braces"; content="{not json"; content='{"verdict":"bogus"}' (schema-invalid); plus a provider whose chatCompletionSimple never resolves within JUDGE_TIMEOUT_MS (use fake timers).
- ACTION: callJudge(ctx, ()=>stub).
- EXPECTED: EVERY case THROWS; NONE returns a verdict; no memLog leaks raw text (the warn calls carry no meta or bounded enums only).
- ASSERT: `await expect(callJudge(...)).rejects.toThrow()` per case; assert the thrown message is one of the bounded internal codes (memory_judge_*). Pair with reconcile.ts mapReconcileErrorCode → bounded errorCode.

G2 — reconcile judge failure → markFailed, no knowledge mutation (deterministic, integration)
- SEED: a promoted trade lesson + flipped ledger so flip_judge fires; inject a judge dep that throws.
- ACTION: processReconcileJob.
- EXPECTED: markFailed called, attemptCount bumps, NO maturity event, NO outcome_version bump, NO reconcile decision row, entry status/activation UNCHANGED (fail-closed; reconcile.ts:316-322 + the tx never opens).
- ASSERT: post-run, entry.outcome_version === pre; zero new memory_decisions for the entry; zero new knowledge_maturity_events; job.status flips toward failed/retry.

G3 — [LIVE] judge output-valid rate (already wired) — the F31 headline (consolidation-judge.int.test.ts + zz-report). NO new code; this is the MEASURED metric counterpart to G1. Document in the plan that G1 is the GATE and G3 is the METRIC.

=== H. SUPERSESSION PRESERVES LINEAGE / NEVER OVERWRITES (deterministic, integration) ===
EXTEND the knowledge-lifecycle supersede int suite (or NEW supersede-lineage.int.test.ts)
- SEED: active predecessor P with content C_p.
- ACTION: supersedeFromCandidate / supersedeEntry to produce successor S with content C_s≠C_p.
- EXPECTED (supersede.ts:1-14): a NEW row S is inserted (supersedes_id→P), and P is UPDATEd to status='superseded' (its content_md untouched). Re-superseding P again is refused (predecessor_already_superseded). Superseding with content IDENTICAL to P is refused (content differs check).
- ASSERT: P.content_md === C_p (NOT overwritten); P.status==='superseded'; S.supersedes_id===P.id; S.status==='active'; a second supersede on P throws predecessor_already_superseded; an identical-content supersede throws.

## adversarial
Adversarial / poisoning scenarios specific to THIS subsystem and what must NOT happen:

ADV-1 — Memory poisoning into execution (the core threat). A crafted lesson ("always 10x size on TOKEN") must NEVER influence sizing/approval/wallet-intent. MUST NOT: any code path lets influence_scope or a knowledge row feed a numeric sizing input, an approval auto-grant, or a wallet-intent. Tested by A1/A2 (static import gate — the day someone adds `import { searchLongMemory }` into engine/core or a sizing repo, A1 turns red) + A3 (every promotion is advisory regardless of judge). The grep-gate is the security tripwire; the behavioral test is the backstop.

ADV-2 — Supersede an arbitrary entry / overwrite a predecessor. An attacker-influenced candidate must not be able to silently rewrite an unrelated trusted lesson's content. MUST NOT: supersede UPDATE the predecessor's content_md, or supersede a non-conflicting entry. Supersede only flips predecessor status and inserts a NEW successor (H); the predecessor's content is immutable. Re-supersede and identical-content supersede are refused.

ADV-3 — Fuzzy-merge a scam token into a trusted lesson. Export/import resolves lineage by EXACT content_hash, never fuzzy similarity (row-pipeline.ts:131-141). A scam row with a fabricated supersedes_content_hash that does not exactly match any predecessor is fail-loud (E2), not fuzzy-merged into the nearest entry. MUST NOT: NULL the FK and import the orphan; MUST NOT resolve to a near-match.

ADV-4 — Silent re-default on restore (FIX-2 regression class). A tampered backup with influence_scope/source/maturity garbled must FAIL the row, not be silently coerced to advisory/observed/established (which could auto-promote a hypothesis to a hot-context tier or strip a demotion). E3 proves present-but-bad rejects; the existing roundtrip proves absent maps to default. MUST NOT: coerce "manipulate_sizing"→"advisory" silently.

ADV-5 — Secret exfiltration via telemetry. A candidate transcript containing sk-/ghp-/postgres-URI/mnemonic/address must never reach a log transport, even masked, even as a "bounded id". D1 drives the exact F5 shapes through filterMemoryLogMeta. MUST NOT: any secret shape survive on an id or enum key. Also MUST NOT: a free-text errorMessage/summary/content/prompt key survive (logger.test (d) covers; D extends to the missed shapes).

ADV-6 — Secret exfiltration via the inspector to the untrusted renderer. content_md (raw transcript), evidence_refs, decision_hash, and last_error (which may quote a provider failure verbatim incl a leaked key) must never cross to the renderer. F1-F4 prove the live SELECTs omit them and the strict DTO rejects them. MUST NOT: a future column added to the SELECT or the DTO leak through — strict() + the FORBIDDEN_*_COLUMNS pins are the guard.

ADV-7 — Promote on judge failure. A judge that times out / returns garbage / a poisoned promoting verdict for a schema-invalid shape must not result in a stored lesson or a guessed consequence. G1/G2 + P-FC-1..4. MUST NOT: a fail-open promote, a guessed reconcile consequence, or a decision row written on a no-op.

ADV-8 — Idempotency replay forging a different decision. Re-recording the SAME (candidate,version) with a DIFFERENT verdict (e.g. flipping a reject into a promote) must be refused as idempotency_conflict, never a silent second row that the inspector then surfaces as the "latest". C3 + crud.ts:287-298 + P-AU-3. MUST NOT: two rows for one version; MUST NOT: the later-arriving forged decision win.

ADV-9 — Anchor forgery. A decision whose job did not actually reserve the candidate (or is not the matching reconcile job) must be refused (anchor_incoherent) so a rogue worker cannot stamp a decision onto a candidate it never processed — crud.ts:74-102, already covered (lines 183-213); keep as a regression pin.

## determinismSplit
DETERMINISTIC (hard-assertable gates — the vast majority of this domain):
- A1/A2 advisory import grep-gate; A3 advisory-always stamp.
- B1/B2 audit completeness (ledger-/plan-derived outcomes, decision-row counts).
- C1/C2/C3 decision_hash math + idempotency/conflict (pure + ledger-derived).
- D1/D2 memLog filtering (pure function over fixed strings; allowlist-vs-callsite static diff).
- E1-E5 export/import round-trip + lineage + fail-loud validation (DB-state derived, byte-faithful; embeddings asserted only as non-null+provider-stamped, NEVER vector equality — that part is non-deterministic and is correctly excluded by the existing test).
- F1-F4 inspector sanitization (DB-seeded row → key-set + substring-absence predicates; strict-schema parse).
- G1 judge throw-on-malformed (stub provider, fake timers); G2 reconcile fail-closed (stub judge; ledger-derived state predicates).
- H supersede lineage (DB-state predicates).

LIVE-LLM (measured metrics, NOT pass/fail gates — already wired, reference only):
- G3 / F31 headline: judge output-valid rate (% of escalations that produce a schema-valid verdict) — measured by consolidation-judge.int.test.ts + reportCard.recordJudgeAttempt + zz-report. This is a METRIC (model quality), not a correctness gate; the deterministic gate is G1 (the code is fail-closed regardless of model quality).
- The write-gates eval F5 findings (write-gates.int.test.ts) MEASURE redactor prose-coverage gaps; D1 turns the same shapes into a deterministic GATE at the logger boundary (a different, stricter surface).
- Embedding re-derivation in E1-E5 is non-deterministic at the vector level → asserted only structurally (non-null, provider model stamped, dim>0), matching the existing roundtrip test's discipline.

Rule for the plan: anything ledger-derived, predicate-based, math, lineage, key-set, or substring-absence is a GATE. Anything that depends on what Gemma/DeepSeek actually returned is a METRIC.

## currentCoverage
HONEST inventory of what already exists.

Unit (deterministic, no DB):
- logger.test.ts (src/__tests__/vex-agent/memory/observability/) — THOROUGH on filterMemoryLogMeta: allowlist, scalar typing, num/enum/id categories, credential-prefix guard, redactor-caught secrets, S4/S5/S6b/S7 key extensions, buildMemoryEventName token regex, memLog throws on bad tokens. NOT covered: the exact F5 missed shapes (D1) and the call-site-vs-allowlist drift gate (D2).
- shared/schemas/__tests__/memory-inspector.test.ts — input bounds, strict DTO rejection of content_md/evidence_refs/decision_hash/lastError/lastErrorCode/locked_*, engine-enum mirror pins. Solid. Gap: a benign-extra-key strict rejection (F4) is implied but worth one explicit case.
- knowledge-import validators tests + knowledge-import.test.ts + the v2/v3 suites (audit/counters/lease/short-circuit/v2-influence/v2-lifecycle/v2-provenance) — strong validator coverage.
- decision-hash: NO dedicated unit test found (C1/C2 are a genuine gap — the hash invariants are only exercised indirectly through the integration conflict test).

Integration (real DB):
- memory-decisions-crud.int.test.ts — append-only, same-hash dup, idempotency_conflict (candidate), reconcile dual idempotency, anchor durability (cascade survival), SET NULL on entry delete, anchor_incoherent (both anchors), full md_* CHECK rejects. STRONG. Gap: reconcile-side idempotency_conflict with differing pointers (C3 add); manager-level "every applyDecision emits a row" (B1, currently only repo-level).
- knowledge-roundtrip.int.test.ts — 3 seeds, all 30 durable columns byte-faithful, embedding re-derived (non-null + provider-stamped), re-import idempotency. STRONG for the happy path. Gaps: supersession LINEAGE round-trip (E1), dangling-predecessor fail-loud (E2), present-but-invalid reject (E3), tampered-hash recompute (E4), non-active-status fidelity (E5).
- memory-inspector-db.test.ts (vex-app, pg MOCKED) — pins the SELECTs omit sanitized columns, status filter, source coercion, 42P01→dbUnavailable. Gap: NO integration test running the real SQL against a seeded row with secrets populated (F1-F3 — the mock cannot prove the live result has the keys absent because it controls the mocked rows).
- eval/* (LIVE) — write-gates (redactor/gate behavior + F5 findings), consolidation-judge (F31 headline), graph, lifecycle, outcome-s5, reconcile-s7, retrieval-precision, zz-report. These MEASURE; they are the live counterpart.

NOT covered anywhere: the advisory-only IMPORT grep-gate (A1/A2) — the single most security-critical invariant has no automated tripwire today; decision_hash unit invariants (C1/C2); judge fail-closed as a deterministic stub-driven gate (G1 — currently only the LIVE F31 metric exists); reconcile fail-closed no-mutation (G2); supersede-never-overwrites lineage as an explicit pin (H); inspector LIVE-SQL sanitization (F1-F3).

## gaps
Correctness gaps ranked by risk (highest first):

1. [SECURITY — CRITICAL] No automated grep-gate that execution/sizing/approval/wallet code never imports recall (A1/A2). The advisory-only invariant is the #1 memory-poisoning defense and it is enforced only by convention today. A single careless import wires lessons into sizing with zero test failure. SMALLEST FIX, HIGHEST VALUE.

2. [SECURITY] Inspector sanitization is proven only against MOCKED pg rows (F1-F3). The mock test pins the SQL string but cannot prove a live row with content_md/decision_hash/last_error populated actually comes back stripped. A column accidentally added to the SELECT (or a `SELECT *` regression) would pass the mock test if the mock rows happen not to include it. Needs a live-DB substring-absence assertion.

3. [SECURITY] memLog never proven against the SPECIFIC secret shapes the prose redactor is known to miss (D1). The F5 findings show the redactor misses base58 keys / 64-hex / postgres URIs / comma-mnemonics in PROSE; the logger uses charset+prefix gates that SHOULD catch them on structured fields, but this is untested at that boundary. If any survives, it is a logged-secret incident.

4. [SAFETY] Judge fail-closed exists only as a LIVE metric (F31), not a deterministic gate (G1). Model-quality measurement ≠ code-correctness proof. A refactor that introduces a fail-open path (e.g. returning a default verdict on timeout) would not be caught by the live metric if the live model happens to answer well.

5. [DATA INTEGRITY] Export/import lineage + tamper paths untested (E1-E5). Supersession lineage round-trip, dangling-predecessor fail-loud, present-but-invalid reject (the literal FIX-2 regression class), and tampered-hash recompute are the exact behaviors the importer was hardened for, yet only the all-valid happy path is tested.

6. [SAFETY] Reconcile fail-closed no-mutation (G2) untested — a judge throw must leave knowledge state byte-identical and write no decision/maturity rows; today only the throw-propagation is implicit.

7. [AUDIT] decision_hash semantic-only + order-independence not unit-tested (C1/C2). The idempotency contract rests on the hash ignoring timestamps/provider and being anchor-order-independent; both are untested directly.

8. [AUDIT] Manager-level "every verdict writes exactly one decision; every no-op writes none" (B1/B2) — repo-level idempotency is tested, but the manager→repo wiring that GUARANTEES one row per applied verdict is not asserted end-to-end.

9. [DATA INTEGRITY] Supersede-never-overwrites (H) has no explicit pin — the predecessor's content immutability is a load-bearing safety property with no direct test.

10. [TELEMETRY] No drift gate (D2) catching a memLog call site using a non-allowlisted key (silently dropped → invisible telemetry loss). Lower risk (not a security incident) but cheap.

## priority
Top 5 must-build, smallest-effective-first:

1. A1 — advisory-only IMPORT grep-gate (NEW src/__tests__/architecture/advisory-boundary.test.ts). ~30 lines, zero DB, pure source scan. Highest security value per line: it is the only automated tripwire for memory poisoning into execution. Add A2 (4 tools are the only consumers) in the same file. DETERMINISTIC.

2. F1-F3 — inspector LIVE-SQL sanitization (NEW src/__tests__/integration/database/memory-inspector-sanitization.int.test.ts). Seed a candidate/decision/job with real secrets in content_md/decision_hash/last_error; run the real inspector queries (or their exact SQL via the integration pg); assert the secret strings are absent from JSON.stringify(result) AND the DTO key-set is exactly the sanitized set. Closes the mock-only gap. DETERMINISTIC.

3. D1 — F5 secret shapes through the logger (EXTEND logger.test.ts, ~20 lines). Drive the 4 known-missed shapes through filterMemoryLogMeta on id+enum keys; assert {}. Proves the structured-field boundary is stricter than the prose redactor. DETERMINISTIC. (Add D2 drift-gate if cheap.)

4. G1 + G2 — judge / reconcile fail-closed as deterministic gates (NEW judge-failclosed.test.ts unit + EXTEND a reconcile int test with a throwing judge stub). Stub provider for the 6 malformed cases (incl fake-timer timeout) → all throw; reconcile throw → zero knowledge/decision/maturity mutation. Converts the live-only F31 metric into a real correctness gate. DETERMINISTIC.

5. E1-E3 — export/import lineage + fail-loud (EXTEND knowledge-roundtrip.int.test.ts). E1 supersession lineage survives; E2 dangling predecessor → failed (not NULL FK); E3 present-but-invalid influence_scope/source/maturity → failed (NEVER silently re-defaulted — the FIX-2 anti-pattern). Directly exercises the importer's hardening. DETERMINISTIC.

(Defer C1/C2 decision-hash unit, B1/B2 audit-completeness, H supersede-lineage pin, F4 strict-extra-key, D2 drift-gate to a second wave — valuable but lower marginal risk than 1-5.)

