# S4 — Worker `memory_manager` + granica `promote()` — execution plan

Data: 2026-06-08
Status: `[~] PLAN — po R1 (BLOCKED, 9 fixów zaaplikowanych) → przed R2 bramki Codexa`
Stage w `memory-system-v2.md` §9: **S4** (po S0/S1a-d/S2/S3 DONE).
Sesja Codexa: `harness-memory-s4` (thread `019ea8b4-52e8-74e2-b39d-6499422a3cd4`).

Źródła: `memory-system-v2.md` (§1/§3/§4/§6/§9), `memory-system.md` (genesis §161/§240-272/§949/§951-967), recon substrate (`wijmqa531`), research szum/wartość (`wdaf7ginr`), konsult+gate Codexa (turn 1–2).

---

## 0. CO BUDUJE S4 (jedno zdanie)

Asynchroniczny **kurator pamięci**: worker na `memory_jobs` claimuje `consolidate` joby → każdy pending kandydat przechodzi **deterministyczny filtr** (tanie reguły) → **LLM-sędziego** (każdy awans) → emituje audytowaną **decyzję** (`promote|supersede|retain|reject|expire`) → przy `promote` przez jedną redagującą granicę `promote()/insertLongMemory()` do `knowledge_entries` (start: **probationary**). Domyka pętlę uczenia: candidate → decision → knowledge.

---

## 1. DECYZJE ZAMKNIĘTE W TEJ SESJI (model kuracji)

Forki rozstrzygnięte z właścicielem (research + Codex jako wejście, decyzja właściciela jako wyrok):

- **D-NOISE — szum (właściciel).** Szum = krótka, bezkontekstowa informacja bez trailu dowodowego i bez tezy. Model 4-osiowy: (1) grounding, (2) maturity/recurrence, (3) non-redundancy, (4) durability/worth. „Unsupported OR premature" to trafny rdzeń, ale za wąski (mija duplikaty, transient/live-state, ledger-raw, outcome-not-process, regime-bound, mundane).
- **D-GROUND — split wg źródła prawdy.**
  - **Wnioski agenta** (KAŻDY kind) → wymagają **dereferencjowalnego trailu dowodowego**; bogactwo źródeł → wyższy `evidence_strength`.
  - **Preferencje/fakty od użytkownika** → uziemione wypowiedzią → tier `user_confirmed`; z definicji nie szum; bez wymogu trailu. Split **wypada z derywacji source-tier**, NIE z listy kindów.
- **D-REC — recurrence (Fork B = ≥2, reżim jako waga).** UOGÓLNIONA lekcja (strategy/risk) awansuje **dopiero przy ≥2 niezależnych egzekucjach**; przy n=1 → **retain** (przywoływalna hypoteza, nie ginie). Pojedynczy zakotwiczony fakt NIE jest promowany jako uogólnienie. Rozrzut reżimów → `activation_strength`, nie bramka. Zero „statystycznego teatru".
- **D-LLM — sędzia dla każdego awansu (Fork C).** Deterministyczny etap może TANIO terminalnie odrzucić/wygasić/retain, ale **nic nie awansuje bez LLM-sędziego**. Sędzia: process-vs-outcome, scope/regime, supersede + **autorytatywna derywacja source-tier z transkryptu** (§6).
- **D-DUP — near-dup (Fork D).** Duplikat = cosine ≥ `0.93` **ORAZ** guardrail Graphiti: różna liczba/data/kwalifikator ⇒ NIE duplikat.
- **D-S4S5 — granica S4↔S5 (Fork „lekki deref").** S4 robi **TANI** check istnienia kotwicy (`executions.getById` + OD-3 soft-delete) + recurrence count; przy n≥2 promuje lekcję tradingową jako **probationary** (`activation_strength<1`, NIGDY hot-context). Pełny outcome resolver + point-in-time/no-lookahead + bi-temporal = S5/S7. `evidence_strength` w S4 ma SUFIT `moderate` (`strong` = S5).
- **D-MERGE (decyzja planu).** W S4 sędzia emituje `{promote, supersede, retain, reject, expire}`. **MERGE (enrich-in-place) DEFER** — knowledge nie ma update-body (insertEntry immutable-on-conflict, supersede tworzy successor), więc „nowa wersja zastępuje starą" pokrywa supersede; enrich-and-collapse dochodzi w późniejszym refinement. **Wykluczenie merge jest na WARSTWIE WYJŚCIA SĘDZIEGO** (`judgeVerdictSchema` emituje tylko 5 typów) — NIE zwężamy zablokowanego substratowego enuma `decision_type`/`recordDecisionInputSchema` (S1c locked; `merge` zostaje zarezerwowany dla późniejszego stage'a). (R3 over-reach #8 odrzucony: narrow substratu byłby breaking change.)

---

## 2. ZAKRES (S4 vs S5)

| W S4 | DEFER |
|---|---|
| worker `memory_jobs` (claim/heartbeat/retry/stale — wzorzec compact_jobs) | pełny outcome resolver z ledgeru (S5) |
| deterministyczny filtr D1–D11 | point-in-time / no-lookahead `available_at_decision_time` (S5) |
| LLM-sędzia (OpenRouter, każdy awans) | bi-temporal valid/ingestion dla knowledge (S5) |
| `promote()/insertLongMemory()` (FIX-4) → knowledge (probationary) | maturity FSM probationary→established + decay (S6) |
| `supersede()` ścieżka | regime detector reaktywacji (S6/OD-2) |
| lekki deref: istnienie egzekucji + OD-3 + recurrence count | reconcile + `enqueueLedgerWake` (S7) |
| audyt `memory_decisions` | graph extraction (S8); MERGE enrich (refinement); inspector (S10) |
| scheduler (startup sweep + periodyczny + enqueue-on-suggest z S2) | |

---

## 3. SCHEMAT — BEZ ZMIAN; kilka CODE-ONLY edycji istniejących repo

S4 jest **code-only** (zero DDL — wszystkie kolumny/enumy istnieją, recon `wijmqa531`):
- `memory_decisions.decision_type/reject_reason` pokrywają taksonomię; `knowledge_entries` ma `maturity_state/activation_strength/influence_scope/decay_policy/regime_tags/source`; `insertEntry` bierze wszystkie pola v2.

**Code-only edycje istniejących prymitywów (NIE schemat) — wymuszone przez R1:**
- `memory-candidates/crud.ts`: nowy **read-only helper** `getCandidateEmbedding(id)` (kolumna `embedding` jest write-only, wyłączona z DTO i `CANDIDATE_COLUMNS` — potrzebny do similarity D5/D6/D7 i do promote bez re-embed). **R1#4.**
- `memory-candidates/crud.ts` `recallCandidatesTopK`: predykat `status='pending'` → `status IN ('pending','retained')` (retained zostaje przywoływalnym dual-trace). **R1#5.**
- `knowledge/hot-context.ts`: do 3 zapytań (`listActiveForHotContext`, `listKnownKinds`, `countActiveHotContextEntries`) dodać `AND maturity_state <> 'probationary'` (filtr źródła NIE filtruje maturity → probationary z `source='observed'` wszedłby do hot-context, łamiąc §949). **R1#8.**
- `sessions.ts` (lub `evidence-deref.ts`): helper `isSessionSoftDeleted(sessionId)` (`SELECT deleted_at` — `getSession` go nie wystawia). **R1#9.**

memLog: rozszerzenie allowlisty (§11) w lockstep (`MemoryLogMeta` + `META_KEY_CATEGORY`).

---

## 4. MODUŁ I PLIKI (FIX-3: operacje managera = wewnętrzne funkcje, NIE ToolDefs)

Dom: `src/vex-agent/memory/manager/*` (logika) + `src/vex-agent/engine/memory-manager/executor.ts` (worker).

**Creates:**
- `engine/memory-manager/executor.ts` — worker (mirror `engine/compact-jobs/executor.ts`); export z `engine/index.ts`.
- `engine/memory-manager/policy.ts` — stałe: `MEMORY_WORKER_POLL_INTERVAL_MS`, `CONSOLIDATE_BATCH_LIMIT`, `MAINTENANCE_SWEEP_INTERVAL_MS`, near-dup/conflict/cluster cosines, `MUNDANE_IMPORTANCE_MAX`, `LOW_CONFIDENCE_FLOOR`, `RECURRENCE_PROMOTE_MIN=2`, `PROBATION_ACTIVATION` (<1), backoff/heartbeat/stale (reuse compact policy gdzie pasuje).
- `memory/manager/consolidate.ts` — orkiestracja per-kandydat.
- `memory/manager/deterministic-stage.ts` — D1–D11; dyskryminowany `DeterministicVerdict`.
- `memory/manager/judge.ts` — wywołanie LLM (mirror `chunker-call.ts`).
- `memory/manager/judge-prompt.ts` — buildery promptu + few-shot (rubryka §7).
- `memory/manager/judge-schema.ts` — Zod `judgeVerdictSchema`.
- `memory/manager/context-builder.ts` — kontekst sędziego (kandydat + deref `source_refs.messageIds` → re-redagowany transkrypt jak `renderRedactedArchivedTranscript`).
- `memory/manager/evidence-deref.ts` — lekki deref: `derefAnchorExistence` (executions.getById + `isSessionSoftDeleted`/OD-3), `countRecurrence`, `deriveEvidenceStrengthCeiling` (none|weak|moderate).
- `memory/manager/promote.ts` — `promote()/insertLongMemory()` (FIX-4) + `supersedeFromCandidate()`. Reuse istniejących getterów `getLatestDecision`/`getDecisionsForCandidate` (memory-decisions repo — istnieją) do idempotent-close (R2#2). Bez nowego repo.
- `memory/manager/index.ts` — barrel (tylko internal; NIC do registry).

**Creates (vex-app main-process slice — supervisor + DB-ready probe, mirror compact/wake/sync; R3 #2/#3):**
- `vex-app/src/main/agent/memory-manager-worker.ts` — `setupMemoryManagerWorker()` SUPERVISOR (mirror `agent/compact-worker.ts`): startuje `startMemoryManagerExecutor` z engine, ale GATE'uje na (a) DB-schema-ready probe + (b) provider gate (executor ma własny pre-claim `OPENROUTER_API_KEY`+`AGENT_MODEL`); zwraca `stop()`.
- `vex-app/src/main/database/memory-jobs-db.ts` — `probeMemoryJobsReady()` (mirror `database/compaction-db.ts:185` `probeCompactJobsReady`): schema-readiness gate (czy `memory_jobs` istnieje), retry/backoff/timeout; supervisor pauzuje start workera dopóki false.

**Edits:** `engine/index.ts` (+`startMemoryManagerExecutor`); **`vex-app/src/main/index.ts`** (po `setupSyncWorker` ~linia 158: `const stopMemoryManagerWorker = setupMemoryManagerWorker();` + dołożyć `stopMemoryManagerWorker()` do `makeOrderedQuitCleanup` Promise.allSettled ~linia 172); `memory/observability/logger.ts` (+klucze §11); + 4 code-only edycje z §3.

**NIE dotykamy:** registry/visibility/tool-map (FIX-3); `knowledge_write/recall` (S9); prompty (faza strukturyzacja+cache).

---

## 5. WORKER EXECUTOR + LIFECYCLE (mirror compact, na `memory_jobs`)

`startMemoryManagerExecutor({pollIntervalMs})→{stop()}`; `workerId=memory-manager-${pid}-${rand8}`; bootstrap `recoverStaleRunning` (non-fatal); `tick()` z **pre-claim provider-config gate** (`OPENROUTER_API_KEY`+`AGENT_MODEL`, warn-once, return — claim inkrementuje attempt_count); `schedule()` setTimeout-loop + `stopped`/`inFlight`.

**Branch `job.jobKind`:** `consolidate` → process; `reconcile` (powstaje dopiero w S7) → `markFailed(job, workerId, "reconcile_not_supported_pre_s7", LONG_BACKOFF)` (nie permanent-loss).

**Brak per-session mutex** (compact ma; consolidate batchuje kandydatów z WIELU sesji w jednym jobie): kandydata serializuje `uniq_mji_active_candidate`, joba `claimNextDueJob` FOR UPDATE SKIP LOCKED. **R1#1 gate-point potwierdzony: bez mutexu OK.**

**`processConsolidateJob(job, workerId)`:**
1. heartbeat `setInterval` + `claimLost` flag (heartbeat false → claimLost; sprawdzać między etapami).
2. `reserveCandidatesForJob(jobId, workerId, CONSOLIDATE_BATCH_LIMIT)` → ids; `listItemsByJob(jobId,'reserved')` → itemy (itemId+candidateId).
3. `let anyTransientFailure = false; let anyUnclosed = false;` dla każdego itemu (sekwencyjnie — rate):
   - `if (claimLost) return;`
   - `markItemProcessing(itemId,jobId,workerId)`; false → race/claim-lost → przerwij item.
   - `getCandidateById(candidateId)` + `getCandidateEmbedding(candidateId)`.
   - **idempotent close (R2#2):** jeśli `candidate.status ≠ 'pending'` (decyzja z poprzedniej próby committed, ale jej `markItemDone` padł): `dec = getLatestDecision(candidateId)`. `dec` istnieje → `closed = markItemDone(itemId,jobId,workerId,dec.id)` (idempotentne; ten sam jobId bo revive trzyma item pod TYM jobem, a kandydat non-pending nie jest reserwowany przez inny job). Brak `dec` przy non-pending → **korupcja** → `markItemFailed(...,"decided_without_decision")` + flaga fail-job. SKIP do następnego itemu (NIE re-apply — brak double-promote).
   - inaczej (pending): `consolidateCandidate(...)` → `DecisionPlan` (§6–§9).
   - **apply (atomowo, §8):** `decisionId = withTransaction(tx => { ownerCheckLockOrThrow(tx, jobId, candidateId, workerId); applyDecision(tx); return recordDecision(input, tx) })`. ClaimLost/owner-loss → throw → łapane niżej.
   - **close:** `closed = markItemDone(itemId,jobId,workerId,decisionId)`. `!closed` (owner-loss między commit a close) → decyzja JEST trwała, ale item nie zamknięty → `anyUnclosed=true` (NIE markCompleted joba; retry zamknie item ścieżką idempotent-close wyżej).
   - **transient error** (LLM timeout / DB hiccup / owner-loss throw): `markItemFailed(itemId,jobId,workerId,errorCode)`; `anyTransientFailure=true`. NIE wywalaj całego joba przez jeden item.
   - `bumpJobInference(jobId,{llmCalls,costUsd})` po każdym wywołaniu sędziego.
4. **Finalizacja (R1#3 + R2#2):**
   - `anyTransientFailure || anyUnclosed` → **`markFailed(jobId, workerId, "items_failed_retry", backoff)`** (NIE markCompleted) — job→failed→retry; przy re-claim `reserveCandidatesForJob` revive'uje WŁASNE failed/released itemy (ten sam jobId), a idempotent-close domyka decided-ale-nie-zamknięte. *(markCompleted po nie-zamkniętych itemach osierociłby je — ożywia je tylko running job reserwujący ponownie.)*
   - inaczej → `markCompleted(jobId, workerId)` (false → completion-claim-lost: loguj, bez retry — decyzje trwałe).
5. job-level throw → `markFailed(jobId, workerId, errorCode, backoff)`.

**Terminalne werdykty (promote/supersede/retain/reject/expire) = DECYZJE → `markItemDone(decisionId)`.** `markItemFailed` TYLKO dla transient infra (nie dla werdyktu).

Sygnatury potwierdzone: `claimNextDueJob(workerId)`, `heartbeat(jobId,workerId)`, `markCompleted(jobId,workerId)`, `markFailed(jobId,workerId,errorCode,nextAttemptInMs)→{ok,terminal}`, `reserveCandidatesForJob(jobId,workerId,limit)→string[]`, `listItemsByJob(jobId,status?)→MemoryJobItem[]`, `markItemProcessing/Done/Failed`, `bumpJobInference`, `recoverStaleRunning`.

---

## 6. DETERMINISTYCZNY ETAP (D1–D11)

Wejście: wiersz kandydata + `getCandidateEmbedding`. Pierwszy terminal wygrywa; inaczej `escalate` z sygnałami. Stałe = nazwane w `policy.ts` (startowe, do tuningu).

```
D1  Live-state re-scan          scanLiveState(aggregate).rejected (≥0.30) → reject(secret_or_live_state)
D2  Stale evidence (OD-3)        evidenceRef.executionId → exec.session soft-deleted → reject(insufficient_evidence)
D3  Anchor existence + ceiling   deref (executions.getById): 0→'none'; ≥1 istnieje→'weak'; ≥1+recurrence≥2→'moderate' [SUFIT S4]
D4  Exact dup vs knowledge       knowledgeRepo.findByContentHash(hash) → reject(duplicate)
D5  Near-dup (Fork D)            max cosine vs active knowledge ≥0.93 AND brak nowej liczby/daty/kwalifikatora → reject(duplicate)
D6  Conflict flag                cosine ≥0.85 vs ACTIVE entry, ten kind/encja, z przeczącą liczbą → FLAG → escalate (supersede vs reject)
D7  Recurrence count             distinct executionId po klastrze (cosine≥CLUSTER) z pending+retained+knowledge:
                                   n≥2 → uogólnienie awansowalne; n=1 → uogólnienie tylko retain
D8  Mundane                      importance ≤2 AND evidence_strength∈{none,weak} → retain
D9  Low confidence               confidence <0.30 AND source≠user_confirmed → retain (reject tylko gdy też evidence='none')
D10 TTL                          now > retain_until (lub retrieval_until bez konsolidacji) → expire(expired_ttl)
D11 Status guard                 candidate.status ≠ 'pending' → NIE re-apply; idempotent-close ścieżką §5.3 (getLatestDecision → markItemDone); retained NIE jest re-sądzony
```

Reuse: D1 `scanLiveState`; D4 `findByContentHash`; D5/D6/D7 `recallLongMemoryTopK`(S3)+`recallCandidatesTopK` z embeddingiem kandydata, filtr `(model,dim)`; D3/D7 `evidence-deref.ts`. Przeżywa → `escalate {nearDupTopK, conflictFlag, evidenceStrengthCeiling, recurrenceCount, anchorExists, isUserAffirmed?}`.

---

## 7. LLM-SĘDZIA (OpenRouter; każdy awans — Fork C)

Wzorzec = `chunker-call.ts`: `new OpenRouterProvider()`→`loadConfig()`→`Promise.race([chatCompletionSimple([{system},{user}],config),timeout])`→`indexOf('{')…lastIndexOf('}')`→`JSON.parse`→`judgeVerdictSchema.safeParse`. **Throw (nie return-empty) na malformed** → `markItemFailed`/retry. Wejście: TYLKO zredagowany kandydat + zredagowany transkrypt + sygnały §6. Zero raw evidence values.

**Rubryka (1–5 każdy; kotwiczone + few-shot; osie ROZDZIELNE):** Grounding · Durability · Novelty · Generalizability · Process-not-outcome (tylko trade-family).
**Kalibracja (twarda):** sędzia NIE podnosi `source` powyżej sufitu z D3 (grounding). Frazowanie nie podnosi groundingu. Sędzia obniża/scope'uje.
**Source-tier (§6, D-GROUND):** jawna afirmacja usera w transkrypcie → `user_confirmed` (bez kotwicy); inaczej agent-derived → `observed` gdy evidence≥moderate+recurrence, `inferred` gdy recurrence≥2 bez mocnej kotwicy, inaczej `hypothesis`.

**Mapowanie → `decision_type`:**
```
promote   Grounding≥3 ∧ Durability≥3 ∧ Novelty≥3 ∧ Generalizability≥3 ∧ (kind∉trade ∨ Process≥3)
          ∧ (UOGÓLNIENIE ⇒ recurrenceCount≥2)   → promote(maturity='probationary', activation<1)
supersede Grounding≥4 ∧ conflict-flag(D6), nowsze+mocniejsze → supersedeFromCandidate(previousId)
retain    awansowalne ale recurrenceCount<2 (uogólnienie) ∨ Generalizability=2 ∨ Process nierozstrzygnięty
          → status='retained' (zostaje przywoływalnym dual-trace; „premature holding pen")
reject    Grounding=1→insufficient_evidence | Novelty=1→duplicate | Process=1(trade)→insufficient_evidence
          | conflict-loser→superseded_by_existing | live-state→secret_or_live_state | policy-toxic→policy
expire    TTL (zwykle D10)
```
**Default-deny ordering (Mem0):** próbuj retain/reject zanim promote. Tani default niepewnego-czystego = `retain` (zostaje dual-trace, nic nie ginie).
**Fallback porażki LLM:** brak fallbacku promującego. LLM fail po retry → `markItemFailed` → job markFailed → retry → revive; po max_attempts permanent-fail (kandydat zostaje pending/retained, przywoływalny). NIGDY promote bez sędziego (§949).

---

## 8. GRANICA `promote()` (FIX-4) + supersede + ATOMOWOŚĆ + AUDYT

**Atomowość per-kandydat (jedna `withTransaction`):**
1. **Owner-check (R1#2):** `SELECT 1 FROM memory_job_items i JOIN memory_jobs j ON j.id=i.job_id WHERE i.job_id=$job AND i.candidate_id=$cand AND i.item_status='processing' AND j.status='running' AND j.locked_by=$worker FOR UPDATE OF i,j`. Brak wiersza → **claim-lost → throw przed JAKIMKOLWIEK zapisem knowledge**. (recordDecision później re-lockuje te same wiersze w TYM SAMYM txn — bez deadlocka.)
2. apply decyzji (promote / supersede / nic dla retain/reject/expire poza status+audit).
3. `recordDecision(input, tx)` → decisionId. **Po commit:** `markItemDone(itemId,jobId,workerId,decisionId)`.

**`promote(candidate, verdict, tx)`:**
1. **FIX-4 defense-in-depth:** `redact()`+`scanLiveState()` na już-zredagowanym tekście kandydata — oczekiwany no-op; NOWY sekret/live-state → anomalia → `reject(secret_or_live_state)`, NIE promuj.
2. **Reuse hash+embedding (R1#4):** ten sam zredagowany tekst → `content_hash` + `embedding(+model+dim)` z `getCandidateEmbedding` są byte-identyczne (ten sam formatter; embed był PO redakcji w S2). **Bez re-embed.**
3. **source_refs mapping (R2#1):** `knowledge_entries.source_refs` JEST polem na DURABLE FIX-1 anchory (komentarz DDL `001_initial.sql:45`: immutable `protocol_executions.id`/`capture_items.id` + semantic keys, NIGDY proj_*). Więc `insertEntry.sourceRefs` (typ `Record<string,unknown>`) budujemy z **`candidate.evidenceRefs`** (FIX-1 anchory — żeby S7 reconcile mógł je zderefować po replay), z transkryptem zagnieżdżonym osobno: `{ evidence: candidate.evidenceRefs, transcript: candidate.sourceRefs }`. **NIGDY blind-pass `candidate.sourceRefs`** (to pointer-only transcript refs, nie anchory). `content_hash` ich nie obejmuje (kind+title+summary+contentMd) → kształt source_refs nie wpływa na dedup.
4. `insertEntry(input, tx)` z polami kandydata + **v2:** `maturityState='probationary'`, `activationStrength=PROBATION_ACTIVATION`, `influenceScope='advisory'` (twardo), `source=<tier sędziego>`, `regimeTags=<sędzia>`, `decayPolicy=<regime_aware|outcome_aware dla trade; none indziej>`, `firstPromotedAt=NOW()`. Idempotent na `content_hash`.
5. `updateCandidateStatus('pending','promoted', {expectedFromStatus:'pending', promotedKnowledgeId:entry.id}, tx)`.

**`supersedeFromCandidate`:** `supersedeEntry(previousId, successorInput, reason, tx)` (reuse `knowledge-lifecycle/supersede.ts`: lock predecessor FOR UPDATE → walidacja active+no-successor+content-differs → successor z v2 (probationary) → predecessor 'superseded'). Status kandydata → 'promoted' (successor jest promocją).

**`recordDecision` input (R1#6 — dokładny kształt `recordDecisionInputSchema`):**
- candidate-branch `{decisionType:'promote'|'supersede'|'retain', candidateId, jobId, decisionVersion:0, promotedKnowledgeId?/supersedesKnowledgeId?, evidenceRefs, inferenceProvider?/inferenceModel?/costUsd?}`.
- reject-branch `{decisionType:'reject'|'expire', candidateId, rejectReason, jobId, decisionVersion:0, evidenceRefs, …}`.
- **BEZ** `decisionHash` (repo liczy sam z payloadu) i **BEZ** `decidedBy` (repo ustawia `decided_by`). `decisionVersion=0` (pierwsza/jedyna decyzja per kandydat; retained NIE jest re-sądzony, więc zawsze 0; bump zarezerwowany dla S7 reconcile). Idempotencja repo po (candidate, version)+decision_hash.
- promote → `promotedKnowledgeId=entry.id`; supersede → `supersedesKnowledgeId=previousId` + `promotedKnowledgeId=successor.id`.

**Idempotencja+lock (§6):** `content_hash` UNIQUE (knowledge) + decision (anchor,version)+hash + owner-checked item + FOR UPDATE na item/job.

---

## 9. LEKKI EVIDENCE DEREF (S4 subset; S5 rozszerza)

`evidence-deref.ts`:
- `derefAnchorExistence(anchors)` → `executions.getById(executionId)` istnieje? + `isSessionSoftDeleted(exec.sessionId)` false (OD-3 BLOCK). **R1#9:** `isSessionSoftDeleted` = nowy helper (`SELECT deleted_at`), bo `getSession` go nie wystawia.
- `countRecurrence(candidate, similarRows)` → distinct `executionId` po klastrze (cosine≥`RECURRENCE_CLUSTER_COSINE`) z pending+retained+knowledge. Steruje D7 + sufitem.
- `deriveEvidenceStrengthCeiling(...)` → `none|weak|moderate` (NIGDY `strong` w S4).
- NIE robi: outcome resolver, point-in-time/no-lookahead, bi-temporal (S5). `available_at_decision_time` zostaje NULL — S4 NIE gate'uje po nim (świadomy dług; lekcje probationary są poza hot-context, więc bez ryzyka lookahead w hot-context).

---

## 10. SCHEDULER

- **Supervisor gate (vex-app, R3#3):** `setupMemoryManagerWorker` startuje executor DOPIERO gdy `probeMemoryJobsReady()` true (schema gotowa) — mirror compact/wake/sync; idle dopóki schema+provider niegotowe (bez burning retry budget).
- **Startup sweep:** `recoverStaleRunning` w bootstrapie executora.
- **Event-driven (już działa):** `enqueueConsolidateJob` z `long_memory_suggest` (S2).
- **Periodyczny fallback:** poll-loop co `MEMORY_WORKER_POLL_INTERVAL_MS`; maintenance cron-tick co `MAINTENANCE_SWEEP_INTERVAL_MS` (~3h, genesis §953/§967) → enqueue consolidate gdy są pending bez aktywnego joba. Plan: cron-tick w executorze (nie threshold-enqueue) — prostsze.

---

## 11. OBSERWOWALNOŚĆ (memLog — rozszerzyć allowlistę w lockstep)

Dołożyć brakujące do `MemoryLogMeta`+`META_KEY_CATEGORY`: `decisionType`, `rejectReason`, `decisionVersion`, `promotedKnowledgeId`, `supersedesKnowledgeId`, `evidenceStrength`, `recurrenceCount`, `llmCalls`, `costUsd`, `decisionId`. (`similarity`/`durationMs`/`count`/`candidateId`/`jobId` już są.)
Eventy: `manager.claimed/skipped`, `consolidate.candidate_decided {decisionType,rejectReason?,promotedKnowledgeId?}`, `consolidate.completed {count}`, `judge.called {llmCalls,costUsd,durationMs}`, `judge.malformed`, `promote.stored {promotedKnowledgeId}`, `stale_recovered {count}`, `claim_lost`. NIGDY raw content/sekrety/raw evidence values.

---

## 12. WORKED EXAMPLE (fixture — przykład właściciela; R1#1 spójny z D-REC)

Kandydat `strategy_lesson`: „przy opłaconym booście dexscreener + przewadze kupujących + rosnącym wolumenie m5 token ma realne szanse" + evidence_refs: 1 execution (zakup pump.fun) + capture items (twitter/dexscreener/websearch/CMC).
Przepływ S4 **przy n=1**:
1. Deterministic: D1 czysto; D2 OK; D3 anchor istnieje → ceiling `moderate` (recurrence n=1 → nie `moderate`+, zostaje `weak`); D7 recurrence n=1 dla UOGÓLNIENIA → tylko-retain; nie-dup.
2. Judge: Grounding≥3, Process≥3 (teza z sygnałów PRE-buy, nie z PnL) → resulting-guard OK; Generalizability OK; ale `recurrenceCount<2`.
3. Decyzja: **`retain`** (UOGÓLNIENIE przy n=1 — D-REC). Kandydat → `status='retained'`, zostaje **przywoływalny dual-trace** (recall amend R1#5), niższa waga, nie hot-context.
4. **Drugi podobny trejd** → jego konsolidacja liczy recurrence (klastr obejmuje retained #1) → `recurrenceCount≥2` → **`promote` jako probationary** (light deref potwierdza oba anchory; `activation<1`, `source='observed'|'inferred'`, `decay_policy='regime_aware'`). Maturacja probationary→established = S6.
Negatyw (szum): „token poszedł w górę" bez evidence_refs/tezy → D-NOISE → judge Grounding=1 → `reject(insufficient_evidence)`.

→ Agent UCZY SIĘ z realnego trejdu natychmiast (retained = przywoływalny), a hartuje do trwałej wiedzy dopiero przy potwierdzeniu (n≥2) — dokładnie Fork B + zasada właściciela.

---

## 13. TESTY (rule 13 — tylko dotknięte; nazwy SAMOOPISOWE)

**Non-DB:**
- deterministic-stage: live-state reject; exact-dup; near-dup+guardrail Graphiti (różna liczba ⇒ NIE dup); conflict flag; mundane retain; low-confidence retain; recurrence-gate (n=1 uogólnienie→retain, n≥2→awansowalne); status-guard skip (retained nie re-sądzony).
- judge: parse JSON; throw na malformed (nie return-empty); Zod odrzuca złą rubrykę; mapowanie rubryka→decision_type; kalibracja (source ≤ sufit groundingu); user-affirmation→user_confirmed bez kotwicy.
- promote input mapping: probationary+advisory+activation<1+source z sędziego; reuse hash/embedding; defense-in-depth redact no-op vs anomalia→reject; recordDecision input bez decisionHash/decidedBy, version=0.

**Integration (realny pgvector, temp-harness `_s4_tmp`):**
- claim race; heartbeat/stale recovery; **job markFailed-on-item-failure → re-claim revive (R1#3)**; permanent-fail.
- **owner-check claim-lost: stale-recovered worker NIE zapisuje knowledge (R1#2)**.
- **idempotent-close (R2#2): decyzja committed ale markItemDone padł → retry zamyka item przez getLatestDecision, BEZ double-promote** (knowledge entry policzony raz, content_hash idempotent).
- **promoted entry `source_refs` niesie FIX-1 anchory z candidate.evidenceRefs (S7-derefowalne), NIE candidate.sourceRefs (R2#1)**.
- pełny consolidate: candidate→job→deterministic→judge(MOCK provider)→promote→knowledge(probationary)+memory_decisions; status pending→promoted.
- promote idempotency (content_hash); supersede race (predecessor lock); reject live-state.
- **getCandidateEmbedding zwraca wektor (R1#4)**; lekki deref: anchor istnieje→ceiling; **soft-deleted sesja (OD-3)→reject (R1#9)**; recurrence z ≥2 egzekucji→awansowalne; **n=1→retain, retained PRZYWOŁYWALNY przez recallCandidatesTopK (R1#5)**.
- **probationary NIE w hot-context: `listActiveForHotContext`/`countActiveHotContextEntries` wykluczają maturity='probationary' (R1#8)**; user_confirmed bypass (bez kotwicy→promote).

**vex-app (R3#2/#3 — mirror `compact-worker.test.ts`/`wake-worker.test.ts`):** `setupMemoryManagerWorker` idle dopóki `probeMemoryJobsReady` false; startuje gdy schema+provider gotowe; `stop()` drenuje; `probeMemoryJobsReady` true/false wg istnienia `memory_jobs`. (vex-app typecheck: `pnpm --dir vex-app run lint`.)

LLM w testach: mock/stub providera (deterministyczny JudgeVerdict). Bez realnego OpenRouter w CI.

---

## 14. DONE-WHEN

- `tsc --noEmit` czysto; non-DB zielone; integracja na realnym pgvector zielona.
- candidate→job→decyzja→(promote)→knowledge_entries (probationary) end-to-end.
- claim race / heartbeat-stale / retry-permanent / promote-idempotency / supersede-race / reject-live-state przechodzą.
- manager nie ufa agentowemu `source`; decyzje audytowane; **probationary nie wchodzi do hot-context; retained pozostaje przywoływalny**.
- FIX-3 (zero ToolDefs managera) + FIX-4 (jedyna droga do knowledge = redagujący promote) zweryfikowane.
- mirror migracji bez zmian (code-only); lockstep test memLog zielony jeśli allowlist edytowany; 4 code-only edycje (§3) mają testy.

---

## 15. GATE-POINTS (rozstrzygnięte; potwierdzić w R2)

1. ~~reconcile branch~~ → branch w processJob (`reconcile_not_supported_pre_s7`).
2. ~~merge semantyka~~ → **DEFER merge** (D-MERGE); S4 emituje promote/supersede/retain/reject/expire.
3. ~~promote embedding reuse~~ → `getCandidateEmbedding` (kolumna write-only) + reuse (post-redakcyjny); bez re-embed (R1#4).
4. maintenance sweep → cron-tick w executorze.
5. ~~per-session mutex~~ → BEZ (batch wielosesyjny; `uniq_mji_active_candidate` + claim serializują) (R1#1).
6. `PROBATION_ACTIVATION` startowa (np. 0.5) <1; spójna z rerankiem S3.
7. `evidence_strength` sufit `moderate` w S4 — potwierdzić że nic w S4 nie wymaga `strong` (to S5).
8. retain recallable → amend `recallCandidatesTopK` (`status IN ('pending','retained')`) + brak set retain_until (retrieval_until z S2 rządzi) (R1#5).

---

## 16. ŚLAD BRAMEK

- **Plan-gate R1 (harness-memory-s4): BLOCKED — 9 must-fixów** (worked-example vs D-REC; brak owner-check w apply-txn; retry/job-completion osierocające failed itemy; brak embeddingu w candidate DTO; retained wykluczony z recall; recordDecision nie bierze decisionHash/decidedBy; merge bez update-body; hot-context nie filtruje maturity; OD-3 deleted_at niewystawiony). **Wszystkie zaaplikowane w tym pliku.**
- **Plan-gate R2 (harness-memory-s4): BLOCKED — 2 must-fixy** (promote source_refs musi nieść FIX-1 anchory z candidate.evidenceRefs nie sourceRefs; okno crash decyzja-committed-ale-markItemDone-padł → osierocony item). **Oba zaaplikowane** (§8.3 source_refs mapping; §5.3 idempotent-close + markItemDone-bool + finalizacja na anyUnclosed).
- **Plan-gate R3 (harness-memory-s4, świeża sesja `019ea8fa`, model spark — gpt-5.5 override trafiał w limit konta): BLOCKED-misframe.** Reviewer potraktował bramkę planu jak review implementacji — pkt 1/4/5/6/7/9 = `Creates`/`Edits`, które plan PRZEPISUJE (nie defekty; niezależnie POTWIERDZONE jako poprawne). **Żaden substancjalny punkt (a)-(e) — race/strand/double-promote/FIX-4/§949 — NIE zgłoszony jako zepsuty** (utwardzony lifecycle przetrwał świeży adversarial read). 3 realne dodatki zaaplikowane: **#2** konkretny bootstrap site (`vex-app/src/main/index.ts` startWorkers/stopWorkers) + supervisor; **#3** DB-ready probe `probeMemoryJobsReady` (mirror compaction-db); **#8 ODRZUCONY** (over-reach — merge wykluczany na warstwie sędziego, nie przez zwężanie zablokowanego enuma substratu). Plan: §4 vex-app slice, §10 supervisor gate, §1 D-MERGE klaryfikacja.
- **Implementacja: DONE** (subagent Opus 4.8; engine executor + `memory/manager/*` + 4 code-only edycje + observability +8 kluczy lockstep + vex-app supervisor/probe/wiring + testy).
- **Weryfikacja niezależna (parent, nie raport subagenta): PASS.**
  - `pnpm exec tsc --noEmit` (root): clean (exit 0).
  - `pnpm --dir vex-app run lint` (tsc + boundaries): pass (exit 0).
  - non-DB vitest: **82/82** (7 plików manager+logger).
  - vex-app vitest: **9/9** (5 supervisor + 4 probe).
  - **integracja na REALNYM pgvector (temp-harness `_s4_tmp`, usunięty po): 10/10** (2 pliki). Zweryfikowane end-to-end: candidate→job→deterministic→judge(stub)→promote→knowledge(probationary)+memory_decisions; promote/retain/reject ścieżki; executor loop + provider-gate idle; owner-check; idempotent-close; OD-3; retained recallable; hot-context wyklucza probationary.
  - Spot-review promote.ts/consolidate.ts/executor.ts/judge-schema.ts: FIX-3 (internal funcs, zero registry), FIX-4 (jedyna droga = promote z redact+scanLiveState defense-in-depth→reject), atomowość (owner-check `FOR UPDATE OF i,j`→applyDecision→recordDecision jeden tx), idempotent-close, §949 (probationary out of hot-context) — **poprawne**.
- **Impl-gate Codexa (Phase 6, thread `019ea8fa`): BLOCKED-1 → naprawione → GREEN LIGHT.** Jedyny must-fix: sufit source-tier był egzekwowany PROMPTOWO, nie runtime-safe → wymuszony **twardy clamp** `clampSourceTier` w `planFromVerdict` (`none→hypothesis`/`weak→inferred`/`moderate→observed`; `user_confirmed` EXEMPT per D-GROUND; klamp tylko obniża), wpięty `evidenceStrengthCeiling` z `EscalationSignals`. +3 testy (pure exhaustive + pipeline). Re-weryfikacja: tsc clean, non-DB **85/85**, integracja realny pgvector **10/10**. Codex potwierdził FIX-3/FIX-4/atomowość/advisory-only/§949/OD-3 jako spójne. (gpt-5.5 trafił limit konta; review na spark.)
- **NIE commitowane** (czeka na wyraźną prośbę właściciela — harness Phase 7).
