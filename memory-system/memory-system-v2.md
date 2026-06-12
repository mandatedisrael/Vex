# Vex Memory System v2 — staged execution plan

Data: 2026-06-07
Status: PLAN ZATWIERDZONY ARCHITEKTONICZNIE — przed kodem. Pre-release, brak userów.
Zastępuje: `memory-system.md` (zachowany jako źródłowa analiza; ten plik jest wykonawczy).

---

## 0. RESUME PROTOCOL (czytaj to najpierw po utracie kontekstu)

Jeśli wracasz do tego zadania bez pamięci rozmowy:

1. Przeczytaj sekcje 1–6 (decyzje, architektura, kontrakty, moduł, reuse, bezpieczeństwo).
2. Otwórz `audit/memory-cutover-manifest.md` — to wynik researchu Codexa: dokładna lista plików do DELETE/REPLACE/KEEP. Bez tego nie ruszaj cutoveru.
3. Wejdź w sekcję 9 (STAGES). Znajdź pierwszy stage ze statusem `[ ] TODO` lub `[~] IN PROGRESS`. Kontynuuj od niego.
4. Każdy stage ma: Goal / Creates / Edits / Deletes / Contracts / Tests / Done-when. Nie uznawaj stage za skończony, dopóki testy z „Done-when" nie przechodzą.
5. Aktualizuj status stage'a w tym pliku po każdym ukończeniu (commit razem z kodem).

Status legend: `[ ] TODO` · `[~] IN PROGRESS` · `[x] DONE` · `[!] BLOCKED`

---

## 1. DECYZJE ZAMKNIĘTE (locked)

- **Czysta karta = pełne zastąpienie 1:1.** Zero dead code, zero adapterów, zero martwych ścieżek. Odrzucamy tymczasowe adaptery z §372 starego planu.
- **Reuse substratu, nie tabel od zera.** Reużywamy: `knowledge_entries`+lifecycle, `session_memories`, pgvector, wzorzec workera `compact_jobs`, redakcję Track-2, ranking.
- **Strategia migracji (decyzja właściciela): EDIT-IN-PLACE — aktualizujemy istniejące migracje zamiast tworzyć nowe, jeśli się da.** Development, brak danych do zachowania → dev DB reset akceptowalny.
  - runner aplikuje tylko `version > schema_version.MAX` → edycja zaaplikowanej migracji NIE re-runuje się → **edit wymaga resetu dev DB** (drop + re-migrate; pre-release OK).
  - S1a–S1d: schemat v2 **edytując istniejące migracje**: kolumny knowledge_entries v2 → CREATE TABLE w `001_initial.sql`; nowe tabele memory v2 → dołożone do istniejącej migracji wg najbliższego sensu; nowy plik migracji TYLKO gdy się nie da.
  - BEZ DROP statements; usunięcia (np. recall_cache_entries) = usunięcie z tekstu `001` + reset (S9).
  - **Mirror:** edytujemy tylko `src/vex-agent/db/migrations/`; sync `node vex-app/scripts/copy-migrations.mjs` (auto na vex-app prebuild/predev); commit obu drzew.
  - Schemat finalnie czysty, bez kolumn „na zapas", minimum plików migracji.
- **Pamięć = osobny, izolowany moduł** `src/vex-agent/memory/*` z warstwą debug/observability OD POCZĄTKU. Minimalne sprzężenie z resztą — tylko zdefiniowane szwy (sekcja 4).
- **Pełny zakres, bez defer** — z jednym wyjątkiem bezpieczeństwa (niżej). Buduje wszystkie warstwy planu + dwa dopięcia ze źródeł (bi-temporal Zep, graceful degradation paper).
- **Infra (potwierdzona w repo):**
  - LLM stage managera: **ten sam OpenRouter provider + model co agent** przez `src/vex-agent/inference/registry.ts` (`OPENROUTER_API_KEY` + `AGENT_MODEL`). Bez nowego klucza/configu.
  - Embeddingi (w tym kandydaci dla dual-trace): **lokalny `ai/embeddinggemma:300M-Q8_0`** w Docker Model Runner przez `src/vex-agent/embeddings/client.ts`. Dim config-driven; kolumna `vector` bez typmod.
  - Postgres lokalny (Docker) na wszystkie tabele.
- **Worker pamięci = dedykowana `memory_jobs`**, NIE współdzielona z `compact_jobs` (ta ma semantykę checkpoint/chunking → reuse rozmyłby debug). Reużywamy WZORZEC, nie tabelę.
- **`influenceScope = advisory | retrieval_boost` tylko.** `execution_constraint` i `sizing_hint` USUNIĘTE NA STAŁE (security — wektor memory poisoning MINJA/MemoryGraft). Pamięć jest doradcza; policy/approval/wallet-intent to JEDYNE źródło prawdy o wykonywalności. → patrz Open Decision OD-1.

## 1a. ŹRÓDŁA (zweryfikowane, nie z pamięci)

- arXiv 2605.08538v1 „Human-Inspired Memory Architecture for LLM Agents" (preprint, 6 mechanizmów). UWAGA: „dual-trace"/„point-in-time"/„regime reactivation" to terminologia Vex, nie cytaty; liczb (λ, t_half) nie hardkodować bez weryfikacji.
- Anthropic „Writing effective tools for AI agents" (7 zasad: konsoliduj-nie-owijaj, namespacing, concise/detailed, high-signal>opaque-id, steering errors, finite context).
- Mem0 (extraction→consolidation, single-pass V3), Graphiti/Zep (bi-temporal valid-time vs ingestion-time, supersesja przez invalidację), LangGraph/LangMem (working vs long-term, hot vs background), Letta sleep-time (najbliższy analog memory_manager).

---

## 2. ARCHITEKTURA (skrót operacyjny)

Trzy ruchome części: **agent proponuje** → **manager decyduje (async)** → **retrieval serwuje**. Pięć warstw:

1. **Live state** — portfolio/balances/ceny. NIE pamięć. Tylko read-only evidence. Nigdy embedding.
2. **Session memory** — `session_memories` (zostaje). Epizodyczna narracja sesji. Agent: `session_memory_search` / `session_memory_resolve_item`.
3. **Memory candidates** — `memory_candidates` (nowa). Bufor sugestii. Systemowy TTL, systemowy source tier, embedding (lokalny model).
4. **Long-term memory** — `knowledge_entries` (zostaje). Źródło prawdy. Wpisuje TYLKO manager przez jedną granicę `promote()/insertLongMemory()`.
5. **Dual-trace retrieval** — świeży wysokosygnałowy kandydat widoczny jako `not_consolidated` zanim manager skonsoliduje; niższa waga; `retrievalUntil`; nigdy hard constraint.

Ścieżka zapisu:
```
agent → long_memory_suggest → [granica suggest: Zod→redakcja→live-state reject→zapis candidate→enqueue memory_job]
      → memory_manager worker → [deterministyczny: dedupe/similarity/source-tier/point-in-time/deref-evidence]
                              → [LLM tylko gdy niejednoznaczne: konflikt/merge/supersede/graph-edges]
      → decyzja promote/supersede/merge/retain/reject/expire/reconcile
      → promote → [granica promote: redakcja+scan→hash→embed→store] → knowledge_entries (start: probationary)
```

Ścieżka odczytu: `long_memory_search` (jedno narzędzie) = vector + lexical + graph expansion + dual-trace → rerank → filtr active/current → format concise|detailed. Wyniki rozróżnione typem: `source:"long_memory"` vs `source:"memory_candidate"`.

---

## 3. CZTERY OBOWIĄZKOWE FIXY (kontrakty, nie opcje)

Potwierdzone w kodzie przez 2 sesje Codexa + 2 krytyki workflow.

- **FIX-1 Immutable evidence anchors.** `sync/replay.ts` robi TRUNCATE `proj_*` i odtwarza je z audytu → ich SERIAL PK NIE są stabilne. Evidence MUSI kotwiczyć na `protocol_executions.id` / `protocol_capture_items.id` + klucze semantyczne (`instrumentKey`, `positionKey`). Wiersze projekcji dereferencujemy przez FK `execution_id`/`capture_item_id` przy reconcile. Bez tego reconciliation cicho się psuje po replay. WCHODZI DO SCHEMATU W STAGE S1.
- **FIX-2 `source` round-trip.** `knowledge/export.ts` + `scripts/knowledge-export.ts` + `knowledge-import/row-pipeline.ts` gubią kolumnę `source` → import defaultuje do `observed` → `inferred/hypothesis` cicho awansuje do hot-context. Naprawić export+import+walidację.
- **FIX-3 Brak roli „manager".** `tools/registry/visibility.ts` zna tylko `parent|subagent`. Operacje managera (promote/supersede/merge/archive/graph_link/candidate_*) to **wewnętrzne funkcje modułu, NIE ToolDefs**. Nigdy nie rejestrujemy ich w registry.
- **FIX-4 Redakcja na strukturalnej granicy.** `tools/internal/knowledge/write.ts` + `supersede.ts` embedują surowy tekst bez redakcji. Jedyna droga do `knowledge_entries` to `promote()/insertLongMemory()`, które redaguje + skanuje live-state PRZED embed. Stary `knowledge_write`/`knowledge_supersede` znika.

---

## 4. MODUŁ I SZWY (anti-corruption boundary)

Dom: `src/vex-agent/memory/*` (rozbudowa istniejącego; rozdzielić dzisiejszy `memory/policy.ts`, który miesza memory + pressure policy + knowledge source).

Minimalne szwy memory↔reszta:
- engine woła `memory.getTurnContext(...)` (hot context / recall seed) — nie sięga bezpośrednio do repo knowledge/session.
- registry importuje TYLKO agent-facing ToolDefs z modułu memory.
- dispatcher mapuje nowe nazwy → handlery memory.
- worker używa wewnętrznych use-case functions (nie ToolDefs).
- LLM stage → `inference/registry.ts` (ten sam provider/model). Embedding → `embeddings/client.ts`.
- renderer widzi tylko sanitized DTO przez IPC (nigdy DB/embeddings/sekrety).
- ledger → JEDNO `enqueueLedgerWake(...)` wołane z miejsc zapisu projekcji (jedyne sprzężenie ledger→memory; świadomy koszt — patrz S7).

Observability OD V1 (rules/70):
- Logi tranzycji: `correlationId`, `candidateId`, `jobId`, `sessionId`, `status_from→to`, `decision`, `rejectReason`, redaction counts, `promotedKnowledgeId`, attempt count. NIGDY raw content/sekrety.
- Metryki: queue depth wg statusu, najstarszy pending, decyzje wg typu, rejecty wg powodu, stale recoveries, koszt/błędy/liczba LLM, latencja promocji.
- Inspekcja: lista kandydatów, detal decyzji, status jobów, queue summary (sanitized DTO).

---

## 5. REUSE MAP (plan → istniejący prymityw)

- worker/claim/heartbeat/retry/stale → wzorzec `db/repos/compact-jobs/crud.ts` (FOR UPDATE SKIP LOCKED) zaimplementowany na NOWEJ `memory_jobs`.
- long-term store/promote/supersede → `db/repos/knowledge/crud.ts` insertEntry + `knowledge-lifecycle/supersede.ts`, owinięte JEDNĄ redagującą granicą `promote()`.
- redakcja + live-state reject → `memory/redaction.ts` + `memory/exclusion-rules.ts` + wzorzec `engine/compact-jobs/chunk-processing.ts`.
- hybrid retrieval → `embeddings/client.ts` (embedQuery) + vector recall z OBOWIĄZKOWYM filtrem `(embedding_model, embedding_dim)` + `knowledge/ranking.ts` (tunable weights) + recall-cache overflow.
- content-hash dedupe → `knowledge/content-hash.ts` (length-prefixed SHA256 + formatter_version).
- LLM decisions → `inference/registry.ts` provider (ten sam model).
- session memory → `db/repos/session-memories/*` (zostaje, oczyszczone nazwy/komentarze).

---

## 6. BEZPIECZEŃSTWO (twarde invarianty)

- Pamięć WYŁĄCZNIE doradcza. `influenceScope ∈ {advisory, retrieval_boost}`. Nigdy nie zasila sizing/approval/wallet-intent.
- Redakcja na granicy suggest I promote (strukturalnie, nie przez konwencję).
- Rejected/expired kandydaci NIE trzymają raw payloadu — tylko redacted summary + hash + reason.
- Manager NIE ufa agentowemu `source` (`user_confirmed` itp.) — wyprowadza tier sam z message/transcript refs.
- Promocja idempotentna i lockowana: `SELECT FOR UPDATE` na kandydacie + unique content_hash + decision version + owner-checked job completion.
- Loop-prevention: agent nie sugeruje w kółko już wypromowanej/odrzuconej pamięci (dedupe na suggest).
- `secret_or_live_state` → reject natychmiast na suggest, steering error do agenta.
- Soft-deleted sesje (`sessions.deleted_at`) NIE są używane jako evidence (OD-3 = block).

---

## 7. CUTOVER MANIFEST

Źródło prawdy o tym, co usunąć/zastąpić: **`audit/memory-cutover-manifest.md`** (5-subagentowy research Codexa, sesja `memory-cutover`).
Zakres slice'ów: (1) tool layer, (2) engine/prompts, (3) db/repos/migrations/policies, (4) vex-app main/IPC/preload/shared, (5) vex-app renderer + testy.
Status manifestu: `[x] READY` (2026-06-07).

Niespodzianki z manifestu, które zmieniają zakres (uwzględnić w stage'ach):
- `vex-app/resources/migrations/*` to LUSTRO migracji agenta → każdą edycję migracji robić w OBU drzewach (dotyczy S1/S9).
- `knowledge.updateStatus` to mutacja wołana z renderera (Electron main → stare knowledge repo) → kłóci się z „manager ops internal"; usunąć w S9, brak agent-facing zamiennika (lifecycle tylko przez managera).
- `knowledge/policy.ts` trzyma też generic tool-output TTL/overflow (nie tylko knowledge) → najpierw wydzielić neutralny policy module, dopiero potem usuwać (przed S9; blokuje engine/tool-output imports).
- `memory/policy.ts` miesza session-memory + pressure + KnowledgeSource → rozdzielić w S0.
- Ukryte ścieżki wstrzykujące pamięć poza turn stack: `resume-packet.ts` (bezpośredni SQL), `giant-tool.ts` (placeholder `memory_recall` w transkrypcie) → objąć S3.
- Marker transkryptu jest 3-częściowy: DB `mappers.ts RECALL_TOOL_NAMES` → shared `messages.ts` → renderer `MemoryMarker.tsx` → zmieniać razem (S9).
- Grep gate: `knowledge_entries` zostaje jako nazwa tabeli; `observed|user_confirmed|inferred|hypothesis` zostają jako wartości source w DB, ale przestają być agent-trusted (manager-derived).

---

## 8. SCHEMAT DANYCH (docelowy, finalny — migracje edytowane w miejscu)

Nowe tabele: `memory_candidates`, `memory_jobs`, `memory_decisions`, `memory_entities`, `memory_entry_entities`, `memory_edges`.
Rozszerzenia `knowledge_entries` (influence + bi-temporal): `maturity_state`, `activation_strength`, `influence_scope` (advisory|retrieval_boost), `decay_policy`, `regime_tags`, `first_promoted_at`, `last_reinforced_at`, `next_review_at`, `outcome_version`, oraz bi-temporal `valid_from`/`valid_until` (valid-time) rozdzielone od `created_at` (ingestion-time).
`memory_candidates`: mały, ale z konsumentami (bo budujemy całość) — id(uuid), session/conversation, proposed_by, kind, title, summary, content_md, entities, tags, source_refs, evidence_refs (IMMUTABLE anchors), outcome, source(system-derived), confidence, importance, sensitivity, evidence_strength, retrieval_visibility, retrieval_until, status, retain_until, embedding+embedding_model+embedding_dim, point-in-time (event_time/observed_at/recorded_at/available_at_decision_time), audit pointers.
UWAGA TYP ID: `knowledge_entries.id` jest SERIAL/number — `promoted_knowledge_id` MUSI być number (nie string jak w starym planie).
Wszystkie enumy: Zod + DB CHECK + TS discriminated union w LOCKSTEP (rules/20 §4).

---

## 9. STAGES (kolejność zależności; ląduje razem, ale budowane i testowane po kolei)

### S0 — Module boundary + policy decoupling + logger primitive `[x] DONE` (2026-06-07, Codex GREEN LIGHT)
> Zrobione: split `memory/policy.ts` → `memory/session-memory-policy.ts` + `memory/long-memory-source-policy.ts` + `engine/core/context-pressure-policy.ts` + `engine/compact-jobs/policy.ts` (delete policy.ts; 18 importerów + 1 test re-routed leaf-em); `memory/index.ts` minimal barrel; `memory/observability/logger.ts` (memLog + filterMemoryLogMeta: kategorie num/enum/id + shape + credential-prefix guard + redact() drop + ≤200 cap) + 27 testów. tsc clean. NIE commitowane. (metryki → S4; logger NIE wpięty w handlery — pierwsi konsumenci S1.)
- Goal: fundament izolowanego modułu — rozdzielić mieszany `memory/policy.ts`, ustanowić front door, dodać memory-scoped logger primitive. Czysty refaktor + prymityw. BEHAVIOR-NEUTRAL (zero zmian logiki i istniejących nazw zdarzeń telemetry).
- Creates:
  - `memory/session-memory-policy.ts` (chunking/recall/banner/theme/exclusion + clampMemoryRecallK)
  - `memory/long-memory-source-policy.ts` (KnowledgeSource + sources + helpers + KNOWLEDGE_BANNER_TOP_KINDS_LIMIT)
  - `engine/core/context-pressure-policy.ts` — ENGINE-owned (PRESSURE_*_FRACTION, POST_COMPACT_BRIDGE_CYCLES, PressureBand, classifyPressure) — NIE w barrelu memory
  - `engine/compact-jobs/policy.ts` — worker constants (WORKER_*, TRACK2_*)
  - `memory/index.ts` — MINIMALNY barrel (tylko publiczne memory primitives: redaction, exclusion-rules, theme-validation, session-memory-policy, long-memory-source-policy)
  - `memory/observability/logger.ts` — PRYMITYW: `memLog(area,event,meta)` buduje `memory.${area}.${event}` (tokeny `^[a-z][a-z0-9_]*$`, zły token → throw); strict allowlist meta keys; unit tests
- Edits: usunąć `memory/policy.ts`; zaktualizować ~18 importerów + 1 test — LEAF imports (NIE przez barrel). Nazwy stałych/typów BEZ zmian (pure move).
- Deletes: `memory/policy.ts`.
- Contracts:
  - logger to PRYMITYW — w S0 BEZ podpinania do handlerów (InternalToolContext nie ma correlationId/toolCallId; żadnych fake IDs); pierwsi realni konsumenci w S1.
  - Guard strukturalny (gwarancja braku raw/secret): meta typy **tylko string|number** (zgodnie z `createChildLogger`; bez boolean); tylko allowlisted klucze przechodzą, reszta + wartości nie-skalarne → DROP; **wszystkie string-wartości to bounded enums/ids (ZERO free-text)** + length-bound ≤200 (drop/truncate); błędy jako bounded **`errorCode`/`errorKind`**, NIE `errorMessage` (free-text zakazany strukturalnie).
- Scope (świadome przeniesienia, NIE w S0): metrics registry → S4 (pierwsi emitenci; rejestr bez liczników = dead code); `memory/types.ts` → S1 (z pierwszymi typami repo).
- Tests: logger guard unit (allowlist, drop raw/secret, event-name regex); testy importerów po move (knowledge-source-filter.int, memory recall/mark-resolved, context-band/pressure, knowledge types).
- Verify: `pnpm exec tsc --noEmit`; `pnpm exec vitest run <affected>`; grep że `memory/policy.js` nie jest importowane.
- Done-when: tsc czysty; affected + logger-guard testy zielone; grep czysty; zero zmian zachowania (telemetry events nietknięte).

### S1 — Schemat v2 (EDIT-IN-PLACE, rozbity na S1a–S1d) `[x] DONE`
Strategia: EDIT-IN-PLACE istniejących migracji (sekcja 1) — knowledge_entries v2 → `001` CREATE TABLE; nowe tabele → dołożone do istniejącej migracji wg sensu; nowy plik tylko gdy się nie da. Bez DROP; dev DB reset po edycji. Mirror sync przez copy-migrations.mjs. Enumy: jedno źródło `as const`/Zod w module memory + test porównujący z CHECK w SQL (lockstep testowalny, nie deklarowany). Każde pole dodane do `KnowledgeEntry` musi być mapowane przez WSZYSTKIE mappery zwracające ten typ (knowledge/crud.ts mapRow, knowledge-lifecycle/types.ts, explicit SELECT-y jak export.ts) albo świadomie węższy DTO.

#### S1a — knowledge_entries v2 + influence enums + FIX-2 `[x] DONE` (2026-06-08, Codex GREEN LIGHT)
> Zrobione: 001 +9 v2 kolumn + 6 named CHECK + source_refs immutable-anchor comment; `memory/schema/long-memory-enums.ts` (as const+z.enum) + lockstep test (czyta 001); mapRow/mapRowLocal/insertEntry/SupersedeInput INSERT +v2 (oba realne insert paths); FIX-2 pełny export/import fidelity (source+9 v2, manifest v3, legacy defaults). tsc clean, 148+31 testów, walidacja na realnym pgvector. Mirror gitignored (regen przez copy-migrations.mjs). NIE commitowane.
- Edycja `001_initial.sql` — dodać v2 kolumny do CREATE TABLE knowledge_entries (named CHECK inline; bez ALTER/backfill bo fresh CREATE; dev reset). Bez nowej migracji. Przy okazji dotykania tabeli: poprawić stale comment `source_refs` (`proj_*` ids) → immutable anchors (`protocol_executions`/`protocol_capture_items` + semantic keys) [FIX-1 alignment]:
  - `maturity_state TEXT NOT NULL DEFAULT 'established' CHECK(probationary|established|reinforced|decayed)` (osobna oś od `status`; legacy='established').
  - `activation_strength REAL NOT NULL DEFAULT 1.0 CHECK(>=0 AND <=1)` (legacy=1.0).
  - `influence_scope TEXT NOT NULL DEFAULT 'advisory' CHECK(advisory|retrieval_boost)` (OD-1; bez execution_constraint/sizing_hint).
  - `decay_policy TEXT NOT NULL DEFAULT 'none' CHECK(none|time|regime_aware|outcome_aware)`.
  - `regime_tags TEXT[] NOT NULL DEFAULT '{}'` + CHECK brak NULL elementów.
  - `first_promoted_at/last_reinforced_at/next_review_at TIMESTAMPTZ` (nullable).
  - `outcome_version INTEGER NOT NULL DEFAULT 0 CHECK(>=0)` (konsument: reconciliation S7).
  - Bi-temporal: reuse valid_from/valid_until (valid-time) + created_at (ingestion); `expired_at` ODŁOŻONY do S7.
  - Indeksy maturity/activation ODŁOŻONE do S3.
- Enumy maturityState/influenceScope/decayPolicy: `as const`/Zod w module memory → TS type → CHECK; test lockstep porównujący wartości z named CHECK w `001_initial.sql`.
- FIX-2 + export/import fidelity (PEŁNY round-trip WSZYSTKICH trwałych pól): export/import musi nieść `source` ORAZ wszystkie kolumny v2 (maturity_state, activation_strength, influence_scope, decay_policy, regime_tags, first_promoted_at, last_reinforced_at, next_review_at, outcome_version) — inaczej backup/restore cicho je zresetuje (catch Codexa). Touch: `knowledge/export.ts` SELECT (+source +v2; embedding NADAL nie — re-derived on import); `scripts/knowledge-export.ts` (cols/typ/mapping); `scripts/knowledge-import/{validators,row-pipeline}.ts` read/validate/pass; `InsertEntryInput`+`insertEntry`. Bump export manifest do **v3**. Legacy v1/v2 import bez nowych pól → defaulty (source='observed', established/1.0/advisory/none/'{}'/null/0). Testy: round-trip fidelity v2 + inferred→inferred + legacy-default.
- Repo: `knowledge/types.ts` (+v2 w KnowledgeEntry + InsertEntryInput defaulted); `knowledge/crud.ts` mapRow+insertEntry; przejrzeć WSZYSTKIE mappery zwracające KnowledgeEntry (knowledge-lifecycle/types.ts) — mapować v2 albo węższy DTO. Behavior-neutral.
- Tests (gate edit-in-place — BEZ legacy backfill, bo fresh CREATE po reset): fresh DB po dev reset migruje czysto; defaulty stosują się na NOWYCH insertach; named CHECK odrzucają złe wartości; lockstep Zod↔CHECK(001); export/import round-trip FIDELITY wszystkich pól v2 + `source` (inferred→inferred) + import starego pliku bez nowych pól→defaulty; mapRow/mapRowLocal v2; mirror == src.
- Done-when: tsc clean; repo/export-import/lockstep testy zielone; fresh DB migruje czysto; `vex-app/resources/migrations` zsynchronizowany z src.

#### S1b — memory_candidates `[x] DONE` (2026-06-08, Codex GREEN LIGHT — gate + final; sesja harness-memory-s1b; spec: `memory-system/s1b-plan.md`)
> Zrobione: `memory_candidates` dołożone do `001` (EDIT-IN-PLACE, po wszystkich FK-targetach) + named CHECK-i + indeksy (idx_mc_embedding_match, idx_mc_status_recorded, uniq_mc_pending_hash partial-unique); repo `db/repos/memory-candidates/{types,crud,index}` (insertCandidate = MF1 concurrency-safe xmax upsert; getCandidateById; updateCandidateStatus optimistic-precondition + discriminated union; listCandidatesByStatus); Zod `memory/schema/memory-candidate.ts` (evidenceAnchorSchema/.strict FIX-1, sourceRefsSchema MF3 strict pointer-only, candidateSuggestInputSchema reuse isValidKind); enumy `memory/schema/memory-candidate-enums.ts` (5× as const+z.enum) + lockstep test parsujący `mc_*_valid` z 001 + test doktryny (brak influence_scope, source bez execution_constraint/sizing_hint); N2 `KNOWLEDGE_SOURCES` tuple-derived + knowledgeSourceSchema (behavior-neutral); logger +1 klucz `insertResult:enum` (MF2, zero boolean) — repo to PIERWSZY realny konsument memLog (candidate.inserted/status_changed, tylko allowlisted meta). Weryfikacja (niezależna): tsc clean; 55 testów non-DB; **12 testów integracyjnych na realnym pgvector (001→031 czysto)**; mirror byte-identical. NIE commitowane. Nit→S4: graf tranzycji statusów należy do workera (substrat S1b tylko guarduje precondition).
- Kontrakt: FIX-1 immutable evidence anchors (executionId/captureItemId + instrumentKey/positionKey, NIGDY proj_*); embedding cols; candidate enums lockstep; point-in-time cols; `promoted_knowledge_id INTEGER` (= SERIAL). `kind` = OTWARTY snake_case (isValidKind), NIE enum. EDIT-IN-PLACE w `001`. Decyzje D1–D9 + rozwiązania MF1–3 w `memory-system/s1b-plan.md`.
#### S1c — memory_jobs + memory_job_items + memory_decisions `[x] DONE` (2026-06-08; Codex plan-gate GREEN po 7 rundach + final impl-gate GREEN po 3 rundach; sesja harness-memory-s1c; spec: `memory-system/s1c-plan.md`)
> Zrobione: decyzja właściciela **B (batch/sweep jobs) + A (append-only decisions)** → batch wymusił 3. tabelę `memory_job_items` (rezerwacja). 3 tabele dołożone do `001` (kolejność jobs→decisions→items) + named CHECK-i + indeksy; repo `db/repos/{memory-jobs,memory-job-items,memory-decisions}` (durable queue: claim FOR UPDATE SKIP LOCKED/heartbeat/owner-check/retry/atomic stale-recovery; reservation: owner-checked revive-CTE + lock-and-insert; append-only decisions: decision_hash idempotency + anchor coherence FOR UPDATE+running); enumy (3 pliki) + lockstep test (shared `_lockstep.ts`); Zod discriminated-union `recordDecisionInputSchema`; logger +`jobKind`. Identity refs = immutable anchory (no FK, durable audit); liczniki postępu DERIVED (getJobProgress). Final gate złapał 5 bugów (stale-strand, reconcile-enqueue race, recordDecision coherence+TOCTOU, markItemDone cross-candidate) — naprawione + regression testy. Weryfikacja: tsc clean; 86 non-DB; **45 integracyjnych na realnym pgvector**; mirror byte-identical. Executor/scheduler/LLM/promote() = S4. NIE commitowane.
- Decyzje D1–D9 + rozwiązania MF1–7 (R1), R2–R6, FG-1–4: `memory-system/s1c-plan.md` §9–§16.
#### S1d — graph `[x] DONE` (2026-06-08; Codex plan-gate GREEN po 3 rundach + impl-gate GREEN po 3 rundach; sesja harness-memory-s1d; spec: `memory-system/s1d-plan.md`)
> Zrobione: graph substrate — 3 tabele dołożone do `001` (kolejność FK: memory_entities → memory_entry_entities → memory_edges) + named CHECK-i + indeksy (partial-unique `uniq_me_active_identity`, `uniq_med_active_relation`). Decyzje właściciela: Q1=FULL bi-temporal edges (world `valid_from`/`valid_until` + system `invalidated_at` + `superseded_by_edge_id`; invalidacja, nie kasowanie), Q2=embeddings-now (entity NAME embedding NOT NULL; edge FACT embedding NULLABLE all-or-none triplet), Q3=closed enums (entity_type ×8 + relation ×8, zatwierdzone przez właściciela). Repo `db/repos/{memory-entities,memory-entry-entities,memory-edges}` (xmax upsert; **atomic `supersedeEdge`** — lock-old→invalidate→insert-new→back-point, continuous bi-temporal boundary jednym `replacementValidFrom`; precondition-guarded `invalidateEdge`/`invalidateEntity`; GREATEST-on-conflict `linkEntryEntity`; **repo-owned `normalized_name`** dedup key — anti-poisoning). Enumy (2 pliki) + lockstep test (shared `_lockstep.ts`); Zod boundary (all-or-none fact-embedding refine, source≠target, whitespace-name guard); logger +5 kluczy (entityId/edgeId/entryId/entityType/relation). Impl-gate złapał 3 realne defekty: `upsertEntity` column/value arity (brak `summary`), `normalized_name` poisoning (caller-supplied → repo-derived), whitespace-only name boundary. Weryfikacja (niezależna): tsc clean; 27 non-DB; **30 integracyjnych na realnym pgvector**; mirror byte-identical. Executor (LLM extraction / edge classification) + retrieval graph-expansion = S8/S3. NIE commitowane.

### S2 — Redaction boundary + `long_memory_suggest` `[x] DONE` (2026-06-08; Codex plan-gate GREEN po 3 rundach + impl-gate GREEN po 2 rundach; sesja harness-memory-s2; spec: `memory-system/s2-plan.md`)
> Zrobione: agent-facing `long_memory_suggest` (ToolDef wg zasad Anthropic — opis „jak dla nowego pracownika", reject policy w description + 1 linijka w prompcie, response_format concise|detailed, snake_case params) → handler `tools/internal/long-memory/suggest.ts`: read+map snake→camel → `candidateSuggestInputSchema.safeParse` → **redakcja KAŻDEGO trwałego pola free-text** (title/summary/contentMd/entities/tags) + **hard-scan-reject** kind + pointer/key strings (sourceRefs.toolCallIds, evidenceRefs.instrumentKey/positionKey) → **live-state reject** (≥30%) na zredagowanym agregacie (z entities/tags) → content_hash z REDACTED → loop-prevention w OBU magazynach (knowledgeRepo.findByContentHash → already_known; nowy `findLatestCandidateByContentHash` terminal→duplicate) → **embed PO redakcji** (fail-loud) → deterministyczne floory (D-B source='hypothesis', evidenceStrength='none'; D-D sensitive⇔maskCount>0; D-C not_consolidated + retrievalUntil=+7d + retainUntil=NULL) → **atomic** `withTransaction{ insertCandidate; enqueueConsolidateJob }` (wake na inserted true I false). `memory/long-memory-suggest-policy.ts` (pure). Rejestracja triple-point (lookup/internal-loaders/tool-map) + 1 linijka w tool-usage. `knowledge_write` NIETKNIĘTY (do S9). Impl-gate złapał 2 dziury bezpieczeństwa: kind nieskanowany (sk_live_… jako valid snake_case), live-state pomijał entities/tags — naprawione + regression testy. Weryfikacja: tsc clean; 130 non-DB (+2 regression); 5/5 integracyjnych na realnym pgvector. NIE commitowane.
- Goal: jedyne wejście agenta do pamięci trwałej; redakcja+live-state reject na granicy.
- Creates: `memory/redaction` (rozdzielone od knowledge), `long_memory_suggest` handler, deterministyczne nadanie TTL/source-tier/retrievalVisibility/retrievalUntil na suggest.
- Contracts: secret_or_live_state→reject+steering error; embedding kandydata PO redakcji; loop-prevention dedupe.
- Tests: redakcja sekretów; live-state reject; TTL/visibility deterministyczne; steering error; evidenceRefs walidacja (immutable ids).
- Done-when: suggest zapisuje czystego kandydata + enqueue job; testy zielone.

### S3 — Retrieval (`long_memory_search/get/history`) `[x] DONE` (2026-06-08; Codex plan-gate GREEN po 2 rundach + impl-gate GREEN po 2 rundach; sesja harness-memory-s3; spec: `memory-system/s3-plan.md`)
> Zrobione (ZAKRES ZAWĘŻONY przez właściciela — retrieval only): 3 nowe agent-facing read-toole `long_memory_search` (wektor po knowledge_entries + **dual-trace** świeżych kandydatów, scalone + reranked, znacznik `long_memory` vs `memory_candidate`, concise/detailed), `long_memory_get`, `long_memory_history` (lineage + pola reinforcementu). Prymitywy: `recallLongMemoryTopK` (knowledge recall ZWRACA `source`), `recallCandidatesTopK` (memory_candidates: pending + not_consolidated + non-expired + model/dim). Czysta polityka `memory/long-memory-retrieval-policy.ts`: `scoreKnowledge = rerank × tier(1.0|0.7)`, `scoreCandidate = sim × 0.6` (bez boostów), inwariant `0.6<0.7≤1` GWARANTUJE że confirmed > candidate przy równym similarity; gate + cap + dropped-count (bez cichego ucinania); INLINE-ONLY (cap 10/50KB; chars-cap tylko detailed). Graph-expansion = pusty hook do S8 (D1); vector-only (lexical później, D2). Rejestracja triple-point + 1 linijka routingu. `knowledge_recall/get/history` NIETKNIĘTE (do S9). Plan-gate złapał 7 niezgodności API (rerank reuse, equal-sim guarantee, cache DTO, source, scope, memLog, history fields); impl-gate złapał 2 (chars-cap mylił concise, ciche dropowanie nieznanych paramów) — naprawione + regression. Weryfikacja: tsc clean; 46 non-DB (+2 regression); 8/8 integracyjnych na realnym pgvector. **DEFER (faza strukturyzacja+cache po module, przed S9):** reorg promptu/cache, sekcja MEMORY, połączony katalog kindów, `getTurnContext`/hot-context rewire. **S9:** rename `session_memory_*` + znacznik transkryptu + kasowanie starego `knowledge_recall`. NIE commitowane.
- Goal: jedno wysokopoziomowe retrieval; dual-trace; concise/detailed; hot-context rewire.
- Creates: `long_memory_search` (vector+lexical+graph-expansion+dual-trace+rerank+format), `long_memory_get`, `long_memory_history` (łączy history+lineage), `session_memory_search`, `session_memory_resolve_item`. Rewire `recall-seed`/`hydrate`/`getTurnContext`.
- Contracts: result union long_memory|memory_candidate; dual-trace lower weight + retrievalUntil + never hard constraint; concise default.
- Tests: ranking/filtry; dual-trace not_consolidated; concise vs detailed; superseded nie wypiera active.
- Done-when: agent dostaje rankingowane wyniki obu typów; testy zielone.

### S4 — Worker `memory_manager` + granica `promote()` `[x] DONE` (2026-06-09; Codex plan-gate po 3 rundach R1/R2/R3 + Phase-6 impl-gate GREEN po 1 fixie; sesja harness-memory-s4; spec: `memory-system/s4-plan.md`)
> Zrobione: async kurator. Engine `engine/memory-manager/{executor,policy}` (worker wzorzec compact_jobs: claim/heartbeat/stale/pre-claim provider gate; processConsolidateJob reserve→per-item idempotent-close|consolidate→apply→close→finalizacja markFailed-jeśli-failed/unclosed; reconcile branch; maintenance cron-tick). Kurator `memory/manager/{consolidate,deterministic-stage,judge,judge-prompt,judge-schema,context-builder,evidence-deref,promote,kind-families}` (FIX-3 internal, zero registry): D1–D11 + Graphiti guardrail; LLM-sędzia (mirror chunker-call, 5 verdyktów bez merge, throw na malformed); **twardy clamp source-tier** `clampSourceTier` (none→hypothesis/weak→inferred/moderate→observed; user_confirmed exempt) — runtime-safe, nie promptowo; `promote()` FIX-4 (redact+scanLiveState defense-in-depth→reject; reuse content_hash+embedding; source_refs={evidence:evidenceRefs,transcript:sourceRefs}; probationary/advisory/activation<1); atomowość owner-check `FOR UPDATE OF i,j`→applyDecision→recordDecision jeden tx. Decyzje właściciela: D-NOISE/D-GROUND(split source-tier)/D-REC(≥2 dla uogólnień, n=1→retain)/D-LLM(każdy awans)/D-DUP(0.93+Graphiti)/D-S4S5(lekki deref, ceiling moderate)/D-MERGE(defer). 4 code-only edycje (getCandidateEmbedding; recallCandidatesTopK status IN pending,retained; hot-context wyklucza probationary; isSessionSoftDeleted/OD-3). Logger +8 kluczy lockstep. vex-app slice (probeMemoryJobsReady + setupMemoryManagerWorker supervisor + wiring index.ts). Plan-gate złapał 11 defektów (R1×9+R2×2); Phase-6 impl-gate 1 (source-tier hard clamp). Weryfikacja (niezależna parent): tsc clean; vex-app lint pass; **85 non-DB**; **10 integracyjnych na realnym pgvector** (×2, przed i po clampie). NIE commitowane → commit teraz. S5 (outcome resolver/point-in-time/bi-temporal) następny.
- Goal: async konsolidacja na `memory_jobs`; FIX-3 (internal funcs) + FIX-4 (redagujący promote).
- Creates: `memory_jobs` worker (claim/heartbeat/retry/stale wzorzec compact_jobs), deterministyczny etap, LLM etap (OpenRouter), `promote()/insertLongMemory()`, `memory_decisions` audit. Scheduler: startup sweep + periodyczny + threshold.
- Contracts: idempotentna+lockowana promocja; manager nie ufa agentowemu source; decyzje audytowane.
- Tests: claim race; heartbeat/stale recovery; retry/permanent fail; promote idempotency; supersede race; reject live state.
- Done-when: kandydat→job→decyzja→(promote)→knowledge_entries; testy zielone.

### S5 — Trading evidence + point-in-time + bi-temporal `[x] DONE` (2026-06-09; Codex plan-gate GREEN po 2 rundach + Phase-6 impl-gate GREEN 0 fixów; sesja harness-memory-s5; spec: `memory-system/s5-plan.md`)
> Zrobione: flow właściciela „worker sprawdza wskazany trade wg faktów ledgera". `memory/manager/outcome-resolver.ts` (deref niezmiennego `executionId` → `proj_activity` product_type → venue dispatch spot/position/lp/thin; spot=`proj_pnl_matches` matched realized PnL→closed+strong+pnlSource; perps/LP→medium+needsReconciliation; thin→weak; D-DEREF: zero proj_* SERIAL, replay-stable; tylko ZNAK PnL→lessonSignal, zero raw kwot). `memory/manager/point-in-time.ts` (role-free pod v2 FIX-1: boundary=event_time||MIN(anchor created_at); checkNoLookahead konserwatywny — degraduje strong, nigdy nie odrzuca; główna ochrona = outcome DERYWOWANY z ledgera, nie anchor). `memory/schema/memory-outcome.ts` (Zod `MemoryOutcomeSummary` genesis §227-237 + pnlSource). Edycje S4: consolidate.ts (D-ORDER: resolveOutcome+boundary dla trade-family PRZED ceiling/judge → outcome-aware `deriveEvidenceStrengthCeiling`; atomowy `updateCandidateOutcome` po owner-check, przed applyDecision, ten tx; validFrom+outcome_version=0), evidence-deref.ts (strong tylko trade+closed+PIT), promote.ts (PromotionOptions byte-neutral; zero raw PnL w embeddingu), executor.ts (przekazuje outcome; reconcile branch NIETKNIĘTY=D-S5S7), supersede.ts (successor honoruje validFrom). Repo: `updateCandidateOutcome` (precondition status=pending), `getByPositionKeyAnyStatus`. Logger +6 kluczy lockstep (zero raw monetary). Decyzje: D-FLOW/D-OUTCOME-SRC/D-DEREF/D-NOLOOKAHEAD(role-free)/D-STRONG/D-ORDER/D-BITEMPORAL(reuse)/D-S5S7. Plan-gate R1 BLOCKED-misframe→R2 GREEN (pushback #9 zaakceptowany); Phase-6 GREEN 0 fixów. Weryfikacja (niezależna parent): tsc clean; **124 non-DB**; **14 integracyjnych na realnym pgvector** (S4 10 zero-regresji + S5 4: closed→strong, open→weak, thin→needsReconciliation, replay-stable). Confidence agentowe nietknięte (clamp degraduje provenance — Codex OK). CODE-ONLY (zero DDL). S6 (maturity FSM + decay) następny.
- Goal: lekcje z ledgeru bez lookahead; outcome z danych, nie deklaracji.
- Creates: deref evidence (immutable anchors→portfolio repos), point-in-time gating (event/observed/recorded/availableAtDecisionTime), bi-temporal valid-time vs ingestion-time, deterministyczny outcome resolver, importance/confidence z ledgeru.
- Tests: point-in-time blokuje lookahead; deref do protocol_executions/capture_items; outcome nie duplikuje raw values w embeddingu.
- Done-when: trade_outcome/strategy_lesson/risk_lesson promowane tylko z poprawnym evidence+point-in-time.

### S6 — Maturity FSM + activation + decay (+graceful degradation) `[x] DONE (S6a + S6b)` (2026-06-09; S6a: sesja harness-memory-s6; S6b: sesja harness-memory-s6b, plan-gate GREEN po 2 rundach + Phase-6 GREEN; spec: `memory-system/s6-plan.md` + `memory-system/s6b-plan.md`)
> **S6a DONE** (rdzeń replay-stabilny): maturity FSM (probationary→established→reinforced→decayed; **decayed→established reaktywacja przez recurrence** R1#7) + **decay czasowy** (`activation × 0.5^(dni/half_life=30)`, podłoga 0.03, **NIGDY kasowanie** — delete-safety zweryfikowana + floor self-healing dla wierszy poniżej podłogi) + **reinforcement przy recurrence** (2. potwierdzenie przy konsolidacji, NIE recall; seam w applyDecisionAtomically obok reject(duplicate) via findActiveByContentHash/D5) + **activation w reranku** (`scoreKnowledge = rerank × tier × activationFactor`, `activationFactor=0.88+0.12·a`; inwariant „confirmed>candidate" dowodowy 0.7×0.88=0.616≥0.6, property-test + 2 import-time asserts) + **tabela audytu `knowledge_maturity_events`** (append-only, immutable non-FK anchor, debug „dlaczego": event/from→to/activation/reason_code/trigger_refs/rationale bez sekretów; closed enumy lockstep) + decay-sweep w maintenance cron-tick (idempotent, anti audit-spam) + hot-context wyklucza `probationary`+`decayed`. `regime_aware`/`outcome_aware`→decay czasowy (gated); `none` no-op. Schema EDIT-IN-PLACE w `001` + mirror regen. Decyzje: D-MATURE/D-DECAY/D-CONST(tune-not-freeze, dni)/D-AUDIT/D-RERANK/D-SCOPE-GATE. Plan-gate R1 BLOCKED-misframe→R2 GREEN (3 fixy: MIN_FACTOR=0.88, hot-context decayed, decayed-reaktywacja); Phase-6 R1 BLOCKED (decay floor-repair)→R2 GREEN. Weryfikacja (niezależna parent, złapała 2 bugi: test-fixture UUID + decay floor-repair): tsc clean; **117+ non-DB** (rerank property-test + lockstep); **21 integracyjnych na realnym pgvector** (S4+S5+S6a, zero regresji). advisory-only zachowane.
> **S6b DONE** (2026-06-09, w working tree do commitu): **dzienny regime worker** (`engine/regime/regime-worker.ts` — osobny executor, tick 1h + cadence-gate 20h, odpala się TYLKO gdy env ma TAVILY_API_KEY/RETTIWT_API_KEY per tick; vault unlock/lock = naturalny włącznik; fail-closed: błąd źródeł/LLM → BRAK snapshotu) + **`regime_snapshots`** (dwie osie F1: trend{bull,bear,range,unknown}×vol{high,low,unknown}, confidence KUBEŁKI F4 low/med/high, source tavily|twitter|hybrid, SERIAL id, 4 named CHECKi lockstep) + **regime-aware decay** (dwell F3: para latest-two zgodna per oś, gap≤48h, fresh≤3d, conf=min pary; match→half-life 60d / mismatch→15d / neutral→30d, widełki [0.25,1]/[1,4] z import-assertami; **reaktywacja decayed→established TYLKO match+high**, audyt `reactivated`/`regime_decay`/`{regimeSnapshotId}`) + **zamknięty słownik tagów F2** (sędzia S4 + DB CHECK containment `ke_regime_tags_valid` + import-validator FIX-2 reject-by-name+dedupe) + **anty-injection prompt** (§5a, untrusted-data rule, cap medium przy 1 źródle) + supervisor vex-app. **Bonus weryfikacji: złapany i naprawiony latentny bug S6a — compounding decay** → przyrostowa kotwica `last_decayed_at` (sweep idempotentny dla każdego wieku wpisu). Plan-gate R1 BLOCKED-misframe→R2 GREEN; Phase-6 GREEN (świeży wątek po context-overflow). Weryfikacja parenta: tsc/lint/boundaries clean; non-DB 445/445 + 73/73 + supervisor 5/5; **integracja realny pgvector 48/48**. Nie replay-stabilny (świadome — audytowalny przez label+conf+source+czas); advisory-only OD-1 (grep-czysty); OD-2 rozstrzygnięte (LLM nad Tavily/Twitter, nie heurystyka zmienności).
- Goal: stopniowany wpływ; decay = spadek wpływu nie kasowanie.
- Creates: FSM probationary/active/reinforced/decayed/archived; activationStrength w rerankingu; decay (time + interference + graceful fidelity tiers/tombstones z papera); regime tags (LLM przy konsolidacji); regime detector dla reaktywacji (OD-2).
- Tests: probationary nie jest twardą regułą; maturity/activation wpływa na rerank; decay obniża influence bez kasowania.
- Done-when: świeża lekcja startuje probationary; awans wymaga 2. potwierdzenia.

### S7 — Outcome reconciliation + ledger wakes `[x] DONE` (2026-06-10, w working tree do commitu; sesja harness-memory-s7: plan-gate GREEN R1 + Phase-6 GREEN; spec: `memory-system/s7-plan.md`)
> **DONE:** **JEDEN szew `enqueueLedgerWake`** na końcu `populateCaptureItems` (pokrywa trady agenta + settlement sync przez `recordSyntheticCapture`; replay przez `replayActivityFromCapture` omija strukturalnie — zero burzy wake'ów bez flag; best-effort try/catch — błąd wake nigdy nie wywraca sync) + **mapowanie kotwicami FIX-1** (`findPromotedWakeTargets`: GIN `idx_mc_evidence_refs`, OR @> po executionId/positionKey/instrumentKey → aktywne wpisy) + **idempotencja D-REARM z `wake_pending`** (job keyed `(entry, outcome_version)`; completed→re-arm, running→flaga konsumowana przy markCompleted w dodatkowy przebieg, stale→re-enqueue na currentVersion — sygnał nigdy nie ginie; recovery zachowuje flagę) + **`processReconcileJob`** (re-resolve S5 → `outcomeDelta` z anty-pętlą → mapa F1 reguł UPORZĄDKOWANYCH: flip→LLM-sąd {invalidate|quench|retain}+tier; reinforce zysk; quench strata 0.15 z bump kotwicy S6b; default bookkeep → atomowa tx FOR UPDATE entry first → maturity event `outcome_change` → candidate v+1 → guarded bump → decyzja `reconcile`) + **F2 awans tieru po faktach** (ceiling strong + tier hypothesis/inferred → sąd, clampSourceTier, tylko w górę) + **F3 wallet_intents poza zakresem** (świadome, udokumentowane). `needsReconciliation` z S5 domknięte. Bramki: plan-gate GREEN (1 zastrzeżenie wcielone: recovery×flaga), Phase-6 GREEN 0 defektów. Weryfikacja parenta: tsc clean, non-DB 709/709, **integracja realny pgvector 57/57 za pierwszym razem**, grepy OD-1/F3/FIX-3 czyste. Wallet_intents-deviation = jedyne odstępstwo od litery tej sekcji (uzasadnione: resolver czyta tylko proj_*).

### S8 — Graph v1 `[x] DONE` (2026-06-10, w working tree do commitu; sesja harness-memory-s8: plan-gate R1 BLOCKED(1 defekt planu)→R2 GREEN + Phase-6 GREEN; spec: `memory-system/s8-plan.md`)
> **DONE:** **LLM-ekstrakcja encji/krawędzi TYLKO przy promocji** (F1: drugi mały call pre-tx, sędzia zostaje sędzią; zamknięte słowniki S1d ×8/×8; bounds ciaśniejsze od substratu; $-kanonizacja w warstwie ekstrakcji; redact() defensywny) + **zapisy grafu atomowo z promocją pod `SAVEPOINT graph_plan`** (fail-open end-to-end: ŻADEN błąd grafu — LLM/embed/in-tx — nie blokuje promocji; entryId z decisionInput.promotedKnowledgeId) + **aliasy deterministycznie + jawnie od LLM, ZERO fuzzy-merge** (F2, anty-scam) + **D-EDGE-OWNERSHIP** (świadomy kompromis v1 współdzielonych krawędzi) + **wiring inwalidacji**: supersede (S4) i reconcile-invalidate (S7) unieważniają krawędzie poprzednika (`invalidateEdgesForOrigin`, bi-temporalnie; linki entry↔entity zostają — historyczne) + **ekspansja grafowa w `long_memory_search` DOMYŚLNIE WŁĄCZONA** (F3: 1 skok, capy 5/8/5, `graphScore = seed.score × GRAPH_HOP_DECAY(0.5) × tier(neighbor) × activation(neighbor)` — ściśle < seed, property-test; guard seedów ≤0; dedupe vs wszystkie bezpośrednie; dopełnia wolne sloty, nigdy nie wypiera; marker `via_graph(entity)`; droppedDirect/droppedExpansion split) + 5 prymitywów batch repo + 5 kluczy memLog lockstep. ZERO DDL (substrat S1d wystarczył). Bramki: plan-gate R1 BLOCKED (1 realny defekt: niespójność 0.5/0.6 w samym planie) → R2 GREEN; Phase-6 GREEN 0 defektów. Weryfikacja parenta: tsc clean, non-DB 809/809, **integracja realny pgvector 47/47 za pierwszym razem**, grepy OD-1/FIX czyste. Lekcje o tokenie wypływają przy zapytaniach o token przez encje, nie tylko wektor — domknięty najsłabszy praktyczny punkt oceny.

### STRUCTURE+CACHE — reorg promptu + prompt-cache + savings UI `[x] DONE` (2026-06-11, w working tree do commitu; sesja harness-memory-structure: plan-gate R1 misframe-odrzucony→R2 GREEN + Phase-6 GREEN 0 defektów; spec: `memory-system/structure-cache-plan.md`)
> **DONE (pozycje DEFER z S3 + nowy zakres właściciela):** **D-LAYOUT 4-segmentowy request** ([system STATYCZNY PREFIKS | summary | historia | trailing TURN-STATE], markery `cacheHint` ustawiane przez engine, `history_tail` PO repair; Loaded Content z środka base na koniec prefiksu; 2+1 odsyłaczy pozycyjnych przeredagowanych; iteracja misji do turn-state — snapshot per-slice) + **fasada `memory.getTurnContext()`** (branch-nullable: fail≠empty; jedno źródło hasSessionMemory↔sekcja; prefetch z executeTurn USUNIĘTY; resume-packet SQL→repo `listUnresolvedOutstandingItems`) + **jedna sekcja `# Memory`** (4 bloki verbatim, omission per-branch, szerokości kinds 5/30; stare 4 moduły prompts USUNIĘTE) + **kind-catalog** (2 opisy long_memory_*) + **wiring `cacheControl`** (gating: lista `anthropic/`,`qwen/` + `cachePricePerM≠null`; breakpoint A na static, B na history_tail; turn-state/summary nigdy; fallback-merge za flagą `false`; auto-providerzy zero markupu) + **D-SAVINGS netto per-term** (read gated na cachePrice, write na cacheWritePrice; ujemne zapisywane; migracja **032** ADD COLUMN IF NOT EXISTS — NIE edycja 001, bo runner `version>MAX`; lustro auto przez copy-migrations) + **UI oszczędności** (SUM-y w usage-db, DTO bez `.min(0)` na savings, UsageChip `saved ~$X` / `cache overhead $X`, fmtSignedCost). **D-LIVETEST ALL PASS:** Anthropic cached **94%** (8569/9128, 0.1×; OpenRouter HOISTUJE trailing system → trailing≡merged, flaga zostaje false; historia re-write przy churnie turn-state — follow-up: mniejszy churn), OpenAI auto cached **99.3%** (8448/8509) — system+historia IN-PLACE z trailing turn-state. Bramki: krytyka 4×SOUND_WITH_FIXES (16 wcielonych — m.in. P1 livetest-dyskryminacja, fail≠empty, per-term gating, migracja 032); plan-gate R2 GREEN; Phase-6 GREEN. Weryfikacja parenta: tsc ×2, 326+61+59 agent + 55 vex-app, integracja realny pgvector 7/7, grep-gates. Audyt pricingu: mechanizm zdrowy; znaleziska w D-AUDIT. DeepResearch: poprawiona hierarchia (TOOLS→SYSTEM→RAG→historia→query). ZERO zmian semantyki widoczności tooli; OD-1 nietknięte.

### S9 — CUTOVER (usunięcie starego, 1:1, zero dead code) `[x] DONE` (2026-06-11; plan-gate Fable 5 adversarial R1 BLOCKED→R2 GREEN; Phase-6 Codex 1×P3→fix→GREEN; spec: `memory-system/s9-plan.md`)
> **DONE:** Legacy powierzchnia `knowledge_*`/`memory_*` usunięta w całości (~5k LOC): 8 ToolDefs + 7 handlerów + barrel, recall-cache (repo + tabela: 001-edit + migracja **033** DROP IF EXISTS), recall-seed, recall-payload, rerank/recallTopK/listHistory/updateStatus z repo, partycja `knowledge/policy.ts` (TOOL_OUTPUT_* → `engine/core/tool-output-policy.ts`; 12 martwych eksportów out). RENAME: `memory_recall`→`session_memory_search`, `mark_outstanding_resolved`→`session_memory_resolve_item` (handlery + event-namespaces; triple-point lookup+loaders+tool-map atomowo). Prompty v2 (suggest-only, lifecycle=manager; `# Active Knowledge`→`# Active Memory`; persisted-copy→session_memory_search). vex-app: łańcuch knowledge skasowany (w tym renderer-mutacja updateStatus bez zamiennika); NOWY read-only `vex:longMemory:list` + `MemoryPanel`/`MemoryButton`/`LongMemorySection`; marker 3-lockstep → {session_memory_search, long_memory_*} (historyczne wiersze degradują do tool_call — zaakceptowane). Gate 35 trybów (word-boundary/prefix/string-literal + allowlist doktryny OD-1) = ZERO; negative-assertions ze stringów-z-części. Weryfikacja parenta: tsc×2, 250+45 testów niezależnie, integracja realny pgvector 3/3 (033 fresh+old-path idempotentnie, repo smoke). Lekcja: martwy import params.ts przeżył 3 bramki (sprawdzano istnienie importu, nie użycie) — złapał Phase-6.

### S10 — Inspector + export/import `[x] DONE` (2026-06-12; sesja harness-memory-s10: plan-gate R1/R2 BLOCKED→R3 GREEN; final-gate GREEN, Codex niezależnie lint+55/55)
> **DONE:** read-only inspektor pipeline'u managera w vex-app: NOWY namespace `CH.memoryInspector.{listCandidates,listDecisions,jobsSummary}` (pin `CH.longMemory===["list"]` NIETKNIĘTY) — pełny łańcuch S9 ×3: shared strict Zod z 9 mirrored closed-vocab enumami + sanitization pins (DTO odrzuca content_md/evidence_refs/decision_hash/embedding* ORAZ lastError/lastErrorCode — `memory_jobs.last_error` to untrusted TEXT, świadomie POMINIĘTY, przyszłość = skończona allowlista kodów); preload invokeWithSchema; main registerHandler; własny pg.Client read model `memory-inspector-db.ts` (2s/5s; kandydaci recorded_at DESC, decyzje decided_at DESC + filtry candidate/type, jobsSummary = GROUP BY counts + JEDEN LEFT JOIN FILTER po memory_job_items bez N+1; 42P01→redacted retryable, NIGDY ok([]); locked_*/heartbeat/last_error NIGDY nie SELECTowane; mergeTargetKnowledgeId w DecisionDto; decisions.id BIGINT→string) + 3 sekcje MemoryPanel po LongMemorySection (pills, zero mutation affordances — pin rozszerzony na wszystkie sekcje). FIX-2 domknięty DOWODEM: NOWY `src/__tests__/integration/scripts/knowledge-roundtrip.int.test.ts` — realny pgvector + żywy llama.cpp: 3 wpisy non-default (source=inferred, reinforced, activation 0.42, retrieval_boost, regime_aware, regime_tags, bi-temporal, outcome_version=3) → programatyczny export → targeted DELETE FROM knowledge_entries → import → field-fidelity (toBeCloseTo dla REAL, ISO timestamps; embedding re-derived) + re-import idempotency: 1/1 PASS. Weryfikacja (niezależna parent): vex-app `lint` PASS + 104/104 targeted (long-memory-ipc UNMODIFIED zielony); agent tsc clean; integracja roundtrip 1/1 + memory regression 15/15. Znane: +2 błędy w main tsconfig o PRE-EXISTING wzorcu correlationId-omission (identycznie long-memory-db/memory-db — dług blueprintu; normalny gate `lint` czysty). Genesis „manual forget/archive" świadomie NIE — v2 = read-only, lifecycle wyłącznie przez managera.

---

## 10. OPEN DECISIONS (właściciel)

- **OD-1 influenceScope** — default `advisory|retrieval_boost` (sprzężenie pamięć→egzekucja OUT). Zmiana = wyraźny override właściciela + bramka policy + audyt. STATUS: default przyjęty, czeka na ewentualny override.
- **OD-2 regime detector** — jak wykrywać „aktualny reżim" dla reaktywacji. STATUS: ROZSTRZYGNIĘTE w S6b (właściciel): dzienny worker, LLM nad Tavily/Twitter (gdy konta podłączone), dwie osie trend×vol, kubełki confidence, dwell 2 dni; advisory-only.
- **OD-3 soft-deleted sessions jako evidence** — default BLOCK. STATUS: przyjęty.
- **OD-4 retencja rejected/expired candidates i session_memories TTL** — do ustalenia (audit window). STATUS: open.

---

## 11. KOMENDY WERYFIKACJI (zweryfikowane wg package.json)

Root projekt (`src/vex-agent`): NIE ma `pnpm typecheck` ani `pnpm lint`. Typecheck = `tsc --noEmit`. Testy = vitest.

```bash
# typecheck (root vex-agent)
pnpm exec tsc --noEmit
# testy celowane (rule 13: tylko dotknięte, nie cały suite)
pnpm exec vitest run <ścieżka/do/test.ts> [...]
# integration (osobny config)
pnpm exec vitest run --config vitest/integration.config.ts <ścieżka>
# vex-app typecheck (gdy ruszamy renderer/IPC/preload)
pnpm --dir vex-app run lint        # = tsc --noEmit -p tsconfig.json && check:boundaries
# cutover grep gate (S9): pełna lista wzorców w audit/memory-cutover-manifest.md
rg -n "knowledge_write|knowledge_recall|memory_recall|knowledge_supersede|KNOWLEDGE_TOOLS|MEMORY_TOOLS" src vex-app   # ma być pusto
```

---

## 10. DOPIECIA DO OBECNEGO SCHEMATU SYSTEMU MEMORY (decyzje 2026-06-11)

Status: DO DODANIA do aktualnego schematu memory v2. Repo jest w development/pre-release, wiec zmiany schematu robimy przez edycje biezacych migracji, jesli da sie utrzymac czysty finalny DDL. Nie dokladamy nowych migracji tylko po to, zeby zasymulowac produkcyjny rollout.

### 10.1. Migration posture: edit-in-place

- Dla zmian tabel memory/long-memory edytujemy istniejace migracje, przede wszystkim `src/vex-agent/db/migrations/001_initial.sql` i odpowiadajace lustro w `vex-app/resources/migrations/`.
- Nie tworzymy nowej migracji dla tych zmian, dopoki repo jest pre-release i dev DB reset jest akceptowalny.
- Po edycji migracji utrzymujemy finalny schemat jako docelowy, bez historycznych adapterow i bez tymczasowych kolumn.

### 10.2. Nazewnictwo long-memory

Obecna fizyczna nazwa `knowledge_entries` jest legacy mismatch wzgledem agent-facing API `long_memory_*`.

Decyzja kierunkowa:

- Preferowana nazwa docelowa: `long_memory_entries`.
- Nie uzywac `memory_entries`, bo jest zbyt ogolne i koliduje mentalnie z `session_memories`, `memory_candidates`, `memory_jobs`, `memory_decisions`, `memory_entities`, `memory_edges`.
- Rename tabeli/repo/typow traktowac jako osobny slice, bo blast radius jest duzy: migracje, repozytoria, lifecycle, export/import, renderer/IPC panel read-only, testy i dokumentacja.

Akceptowalny etap posredni:

- Fizyczna tabela moze tymczasowo zostac `knowledge_entries`, ale publiczne nazwy, komentarze i dokumentacja powinny mowic `long-memory` / `long_memory_entries` tam, gdzie opisujemy finalny model.

### 10.3. `embedding_text` - NIE dodajemy teraz

Po analizie EmbeddingGemma/SentenceTransformers najwazniejsze jest poprawne promptowanie query/document, a obecny klient juz robi wlasciwy ksztalt dla EmbeddingGemma:

- query: `task: search result | query: <query>`
- document: `title: <title> | text: <summary>`

Decyzja:

- Na tym etapie NIE dodajemy parametru `embedding_text` do `long_memory_suggest`.
- `summary` pozostaje tekstem semantycznym do retrieval i musi byc pisany jak przyszle zdanie wyszukiwalne.
- `title + summary` wystarcza jako embedding input, pod warunkiem ze summary jest po angielsku, stabilne semantycznie i nie zawiera live-state.
- Do `embedding_text` wracamy dopiero, jesli realne testy recall pokaza slaby retrieval albo bedziemy chcieli rozdzielic human summary od retrieval representation.

Wymagana korekta tool description:

- W `long_memory_suggest.summary` doprecyzowac, ze summary jest rowniez retrieval-quality semantic text.
- Instrukcja: pisz po angielsku, uzywaj stabilnych nazw protokolow/synonimow, nie dodawaj live sald/cen/kwot ani chwilowych quote'ow.

### 10.4. English-by-contract dla persisted/embedded memory text

Poniewaz lokalny model EmbeddingGemma ma najlepszy retrieval przy angielskim tekscie, system memory ma miec kontrakt:

> Wszystkie teksty, ktore beda persistowane jako memory albo embedowane, musza byc po angielsku. Jesli user rozmawia w innym jezyku, agent/model tlumaczy trwala lekcje na angielski przed zapisem.

Zakres:

- `long_memory_suggest.title`
- `long_memory_suggest.summary`
- `long_memory_suggest.content_md`
- `compact_now.conversation_summary`
- `compact_now.preserve_md`
- `compact_now.thread_themes_hints`
- Track 2 chunker output: `theme`, `happened_md`, `did_md`, `tried_md`, `outstanding_items`, `entities`, `protocols`, `error_classes`, `chains`, `tasks`
- Judge-generated replacement/merge text, jesli dodamy merge/supersede payload w pozniejszym etapie

Walidacja:

- Na boundary `long_memory_suggest` dodac prosty language check dla pol tekstowych, ktore trafiaja do DB/embeddingu.
- Jesli tekst nie wyglada na angielski, zwracac steering error do agenta: przepisz trwala lekcje po angielsku.
- Nie walidowac agresywnie tickerow/protocol ids jako pelnych zdan; `entities`/`tags` moga zawierac symbole, ale nie powinny zawierac opisowego nie-angielskiego tekstu.
- Track 2 ma juz instrukcje English-by-contract; docelowo dodac walidacje outputu i retry/fail job zamiast cichego zapisu nie-angielskiego chunku.

### 10.5. EmbeddingGemma config cleanup

Obecny faktyczny default runtime:

- model alias: `ai/embeddinggemma:300M-Q8_0`
- GGUF file: `embeddinggemma-300M-Q8_0.gguf`
- runtime: `llama.cpp:server` w Compose
- endpoint: `http://127.0.0.1:27134/v1/embeddings`
- dim: `768`
- provider: `local`

Do poprawienia:

- `src/vex-agent/embeddings/config.ts` ma stale komentarze/error examples o Docker Model Runner i `localhost:12434/engines/llama.cpp/v1`.
- Zaktualizowac je do aktualnego Compose runtime: `127.0.0.1:27134/v1` i standalone `llama.cpp:server`.
- Utrzymac rozroznienie `providerModel` z odpowiedzi jako audit truth dla `embedding_model`.

### 10.6. Judge context v2 zamiast judge tooli

Nie dajemy judge LLM pelnego Tool Map ani raw tooli. Judge pozostaje strict-JSON klasyfikatorem bez mozliwosci samodzielnych akcji.

Powod:

- judge jest czescia granicy bezpieczenstwa;
- pelne toole zrobilyby z niego drugiego agenta z wieksza powierzchnia memory poisoning;
- DB writes, merge, supersede i promote musza zostac w workerze jako walidowane, audytowane transakcje.

Zamiast tooli worker ma zbudowac bogatszy, bounded context pack dla judge:

- `knownKinds` z long-memory, z countami i limitem;
- candidate metadata: `kind`, `title`, `summary`, `content_md`, `recorded_at`, `event_time`, `observed_at`, `available_at_decision_time` jesli dostepne;
- top similar long-memory entries z excerptami: `id`, `kind`, `title`, `summary`, krotki `content_md` excerpt, `sourceTier`, `maturityState`, `activationStrength`, `similarity`, lineage/head status;
- similar pending/retained candidates jako soft context;
- source transcript window jak dzis, nadal redacted i bounded;
- deterministic signals jak dzis: evidence ceiling, recurrence, conflict flag, anchor existence, user affirmation, generalization flag.

Judge nadal zwraca strict JSON. Worker nadal:

- waliduje Zod;
- clampuje `sourceTier`;
- redaguje i skanuje live-state przed promote/supersede;
- wykonuje DB writes atomowo;
- zapisuje `memory_decisions`.

### 10.7. Merge/supersede jako przyszly structured plan

Obecnie judge prompt zabrania `merge`. To jest bezpieczne, ale ogranicza jakosc konsolidacji.

Kierunek pozniejszy:

- Dodac nowy verdict/plan tylko po wdrozeniu Judge Context v2.
- Judge moze proponowac structured merge/supersede payload, ale nie edytuje DB sam.
- Worker waliduje, redaguje, sprawdza live-state, tworzy successor entry, superseduje stare wpisy i zapisuje audyt.

Przykladowy kierunek kontraktu:

```json
{
  "verdict": "merge",
  "mergeTargetIds": [123, 456],
  "merged": {
    "kind": "strategy_lesson",
    "title": "...",
    "summary": "...",
    "content_md": "..."
  }
}
```

### 10.8. Kolejnosc prac

1. Poprawic stale komentarze/default examples EmbeddingGemma config. `[x] DONE`
2. Wzmocnic English-by-contract w opisach tooli i promptach. `[x] DONE`
3. Dodac boundary language check dla `long_memory_suggest` persisted text. `[x] DONE`
4. Dodac Judge Context v2: known kinds + similar memories excerpts + temporal metadata. `[x] DONE`
5. Dopiero potem rozwazyc rename `knowledge_entries` -> `long_memory_entries` jako osobny duzy slice.
6. Dopiero po Context v2 rozwazyc merge/supersede structured payload.

> **Pkt 1–4 DONE** (2026-06-12; sesja harness-memory-dopiecia: plan-gate R1 BLOCKED→R2 GREEN; final-gate R1 BLOCKED (titleExcerpt)→R2 GREEN, Codex niezależnie 28/28). Zakres: (1) config/client/schemas+benchmark+globalSetup+Makefile prose → Compose `llama.cpp:server` @127.0.0.1:27134/v1 (001:31 świadomie NIE — applied migration, do rename-slice; fixtury 12434 inertne zostają); (2) English-by-contract: compact_now (ToolDef+Zod spójnie), summary=retrieval-quality (§10.3), session_memory_search/resolve_item, entity-extraction prompt, tool-usage bullet; (3) `memory/english-check.ts` zero-dep (metric A non-ASCII-letter fraction 0.05 — NIE Unicode-script, diakrytyki łapane; metric B unambiguous-stopword fraction 0.04 przy ≥8 słowach, set bez kolizji pl: to/i/a/on/by/no/ma/do/my/me; contentMd po stripie code/URL; entities/tags per-string count=0 z udokumentowanym limitem ASCII-deskryptorów) wpięty po live-state reject, przed hash/embed; `SUGGEST_REJECT_REASONS += non_english`; reject zaadvertyzowany w ToolDef; (4) Judge Context v2: `listActiveKindCounts` (unfiltered census, listKnownKinds nietknięte), temporal metadata w Pick (render only-when-available), KnowledgeMatch + opcjonalne tier/maturity/activation/contentExcerpt (text=title+summary nietknięte — Graphiti guardrail), JEDEN recallCandidatesTopK → recurrence + soft context (self-excluded, cap 5, titleExcerpt/summaryExcerpt redact-before-truncate), transcript char-cap 8000 PO detectUserAffirmation na pełnym oknie 40, UNTRUSTED DATA RULE w prompcie sędziego, capy w engine/memory-manager/policy.ts; verdicts/schema/clamp/promote()/audyt NIETKNIĘTE. Weryfikacja (niezależna parent): tsc clean; 31 plików/557+ unit (po fixie 281 affected re-run); **integracja realny pgvector + żywy llama.cpp: memory 15/15 + recall 8/8 + consolidate re-run 8/8**; grep-gates OD-1/staleness/schema czyste. NIE commitowane.
