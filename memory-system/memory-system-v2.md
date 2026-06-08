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

### S1 — Schemat v2 (EDIT-IN-PLACE, rozbity na S1a–S1d) `[~] IN PROGRESS`
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
#### S1c — memory_jobs + memory_decisions `[ ] TODO`
- Worker queue (wzorzec compact_jobs: claim/heartbeat/retry/stale) + decision audit; repo.
#### S1d — graph `[ ] TODO`
- memory_entities/memory_entry_entities/memory_edges + repo (invalidacja krawędzi, nie kasowanie).

### S2 — Redaction boundary + `long_memory_suggest` `[ ] TODO`
- Goal: jedyne wejście agenta do pamięci trwałej; redakcja+live-state reject na granicy.
- Creates: `memory/redaction` (rozdzielone od knowledge), `long_memory_suggest` handler, deterministyczne nadanie TTL/source-tier/retrievalVisibility/retrievalUntil na suggest.
- Contracts: secret_or_live_state→reject+steering error; embedding kandydata PO redakcji; loop-prevention dedupe.
- Tests: redakcja sekretów; live-state reject; TTL/visibility deterministyczne; steering error; evidenceRefs walidacja (immutable ids).
- Done-when: suggest zapisuje czystego kandydata + enqueue job; testy zielone.

### S3 — Retrieval (`long_memory_search/get/history` + `session_memory_*`) `[ ] TODO`
- Goal: jedno wysokopoziomowe retrieval; dual-trace; concise/detailed; hot-context rewire.
- Creates: `long_memory_search` (vector+lexical+graph-expansion+dual-trace+rerank+format), `long_memory_get`, `long_memory_history` (łączy history+lineage), `session_memory_search`, `session_memory_resolve_item`. Rewire `recall-seed`/`hydrate`/`getTurnContext`.
- Contracts: result union long_memory|memory_candidate; dual-trace lower weight + retrievalUntil + never hard constraint; concise default.
- Tests: ranking/filtry; dual-trace not_consolidated; concise vs detailed; superseded nie wypiera active.
- Done-when: agent dostaje rankingowane wyniki obu typów; testy zielone.

### S4 — Worker `memory_manager` + granica `promote()` `[ ] TODO`
- Goal: async konsolidacja na `memory_jobs`; FIX-3 (internal funcs) + FIX-4 (redagujący promote).
- Creates: `memory_jobs` worker (claim/heartbeat/retry/stale wzorzec compact_jobs), deterministyczny etap, LLM etap (OpenRouter), `promote()/insertLongMemory()`, `memory_decisions` audit. Scheduler: startup sweep + periodyczny + threshold.
- Contracts: idempotentna+lockowana promocja; manager nie ufa agentowemu source; decyzje audytowane.
- Tests: claim race; heartbeat/stale recovery; retry/permanent fail; promote idempotency; supersede race; reject live state.
- Done-when: kandydat→job→decyzja→(promote)→knowledge_entries; testy zielone.

### S5 — Trading evidence + point-in-time + bi-temporal `[ ] TODO`
- Goal: lekcje z ledgeru bez lookahead; outcome z danych, nie deklaracji.
- Creates: deref evidence (immutable anchors→portfolio repos), point-in-time gating (event/observed/recorded/availableAtDecisionTime), bi-temporal valid-time vs ingestion-time, deterministyczny outcome resolver, importance/confidence z ledgeru.
- Tests: point-in-time blokuje lookahead; deref do protocol_executions/capture_items; outcome nie duplikuje raw values w embeddingu.
- Done-when: trade_outcome/strategy_lesson/risk_lesson promowane tylko z poprawnym evidence+point-in-time.

### S6 — Maturity FSM + activation + decay (+graceful degradation) `[ ] TODO`
- Goal: stopniowany wpływ; decay = spadek wpływu nie kasowanie.
- Creates: FSM probationary/active/reinforced/decayed/archived; activationStrength w rerankingu; decay (time + interference + graceful fidelity tiers/tombstones z papera); regime tags (LLM przy konsolidacji); regime detector dla reaktywacji (OD-2).
- Tests: probationary nie jest twardą regułą; maturity/activation wpływa na rerank; decay obniża influence bez kasowania.
- Done-when: świeża lekcja startuje probationary; awans wymaga 2. potwierdzenia.

### S7 — Outcome reconciliation + ledger wakes `[ ] TODO`
- Goal: rekonsolidacja po zmianie outcome; event-driven kadencja.
- Creates: reconciliation idempotentna po `(entry_id, outcomeVersion)`; `enqueueLedgerWake(...)` w miejscach zapisu projekcji (activity-populator, position-projector, PnL/LP writers, wallet-intent transitions) — JEDEN cienki szew.
- Contracts: świadome sprzężenie ledger→memory (tylko przez enqueueLedgerWake).
- Tests: wake po proj_pnl_matches / position status / lp_events / wallet_intents; reconcile idempotentny po replay (dzięki FIX-1).
- Done-when: zmiana outcome budzi rekonsolidację powiązanej lekcji.

### S8 — Graph v1 `[ ] TODO`
- Goal: relacje jako pomoc w retrieval (nie źródło prawdy).
- Creates: entity extraction/normalization (LLM), edge classification, bounded expansion w long_memory_search.
- Tests: entity aliases; supersesja krawędzi (invalidacja, nie kasowanie — wzorzec Zep); bounded expansion.
- Done-when: graph wzbogaca retrieval, nie dominuje.

### S9 — CUTOVER (usunięcie starego, 1:1, zero dead code) `[ ] TODO`
- Goal: usunąć/zastąpić CAŁĄ starą powierzchnię wg `audit/memory-cutover-manifest.md`.
- Deletes/Edits: stare `knowledge_*`/`memory_*` tools, handlery, dispatcher/internal-loaders, tool-map, registry, prompty, IPC/preload/renderer, testy — wg manifestu. Bez aliasów.
- Tests: registry↔Tool Map consistency; „knowledge_write nie agent-visible"; renderer marker po rename; brak referencji do starych nazw (grep gate).
- Done-when: `rg` nie znajduje starych nazw poza historią; wszystkie testy zielone; typecheck czysty.

### S10 — Inspector + export/import `[ ] TODO`
- Goal: sanitized wgląd; provenance round-trip.
- Creates: renderer inspector (pending candidates, decisions, job status) przez sanitized IPC DTO; export/import z `source` (FIX-2 domknięty).
- Tests: renderer widzi tylko sanitized DTO; brak raw wallet/DB/secrets; boundary Zod.
- Done-when: inspektor działa; export/import round-trippuje source.

---

## 10. OPEN DECISIONS (właściciel)

- **OD-1 influenceScope** — default `advisory|retrieval_boost` (sprzężenie pamięć→egzekucja OUT). Zmiana = wyraźny override właściciela + bramka policy + audyt. STATUS: default przyjęty, czeka na ewentualny override.
- **OD-2 regime detector** — jak wykrywać „aktualny reżim" dla reaktywacji (LLM nad snapshotem live-state vs heurystyka zmienności). STATUS: do decyzji w S6.
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
