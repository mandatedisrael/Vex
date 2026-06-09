# S5 — Trading evidence + outcome resolver + point-in-time + bi-temporal — execution plan

Data: 2026-06-09
Status: `[~] PLAN — przed bramką Codexa (harness-memory-s5)`
Stage w `memory-system-v2.md` §9: **S5** (po S0/S1a-d/S2/S3/S4 DONE).
Sesja Codexa: `harness-memory-s5` (TODO — Codex na limicie konta do 11.06; gate gdy wróci).

Źródła: genesis `memory-system.md` (§180-237 typy MemoryCandidate/EvidenceRef/OutcomeSummary; §640-682 ledger + point-in-time; §684-726 rekonsolidacja outcome), `memory-system-v2.md` (§3 FIX-1, §9 S5/S7), recon substratu (`wcvh97lc9`), flow właściciela (niżej).

---

## 0. CO BUDUJE S5 (flow właściciela)

> agent zleca co chce zapamiętać (S2) → worker decyduje + audytuje (S4) → worker odczytuje konwersację (S4 context-builder) → **worker SPRAWDZA TEN TRADE i zapisuje na FAKTACH (S5)**.

S5 = kawałek **„sprawdza ten trade i zapisuje na faktach"**: dla kandydata tradingowego worker bierze kotwicę dowodową agenta (`executionId`), **dereferencjuje ją do ledgera, liczy PRAWDZIWY wynik z danych** (realized PnL / status pozycji), sprawdza brak lookahead, i zapisuje lekcję ugruntowaną w faktach (nie w deklaracji agenta). Odblokowuje `evidence_strength='strong'` (sufit S4 = `moderate`) i twardy awans `trade_outcome`/`strategy_lesson`/`risk_lesson`.

---

## 1. DECYZJE ZAMKNIĘTE (flow właściciela + decyzje inżynierskie)

- **D-FLOW (właściciel).** Worker (memory_manager) sprawdza KONKRETNY trade wskazany przez agenta (kotwica `executionId`), niezależnie od venue. Rozpoznaje venue po egzekucji i czyta właściwą tabelę wyników. **Nie ma product-forka „które venue"** — worker obsługuje to, co agent zakotwiczył.
- **D-OUTCOME-SRC (genesis §646/§651).** Outcome = FAKTY z ledgera, NIE deklaracja agenta. Canonical: **realized PnL** w `proj_pnl_matches` (spot, FIFO cost-basis, deterministyczny, replay-stable). Status pozycji z `proj_open_positions`. LP z `proj_lp_events`.
- **D-DEREF (FIX-1).** Kotwice tylko na niezmiennych `protocol_executions.id`/`protocol_capture_items.id` + semantic keys. Wiersze `proj_*` (pnlMatchId/activityId/lpEventId) **dereferencjujemy przy liczeniu** (executionId → proj_activity.execution_id → proj_pnl_matches.sell_activity_id), NIGDY nie zapisujemy ich SERIAL-i (niestabilne po `replayProjections`).
- **D-NOLOOKAHEAD (genesis §673-682 + poprawka pod v2 FIX-1).** **WAŻNE:** genesis zakładał `role` (decision/outcome/context) na evidence_refs, ale v2 FIX-1 ściął evidence_refs do `{executionId, captureItemId?, instrumentKey?, positionKey?}` — **BEZ `role`**. Więc nie da się „wykluczyć outcome-role anchorów". I nie trzeba: **outcome (realized PnL) jest DERYWOWANY przez S5 z ledgera, NIGDY nie jest anchorem** (deref executionId→pnl_matches). Realna gwarancja no-lookahead = **outcome z niezmiennych faktów ledgera** (deterministyczny, nie da się sfałszować ani wstrzyknąć przyszłości — to faktyczny realized result on-chain). Plus audytowy stempel: `available_at_decision_time` = `event_time` kandydata (agent podaje kiedy trade zaszedł) albo MIN(`created_at`) po anchor-executions (pierwsza akcja). `pointInTimeChecked: bool` = (granica wyznaczalna) ∧ (outcome z ledgera, nie deklaracji). Szczegóły §6.
- **D-STRONG (trade-family only).** `evidence_strength='strong'` TYLKO gdy rozwiązany ZAMKNIĘTY realized outcome z czystym PnL, dla kindów trade-family (`isTradeKind`). Pozycja OTWARTA → unrealized (stan bieżący) → max `moderate`. Venue z cienkim ledgerem → słabsze + `needsReconciliation=true`. Nie-trade kindy: sufit bez zmian (S5 nie dotyka).
- **D-OUTCOME-WRITE.** Outcome (kształt genesis `MemoryOutcomeSummary`) zapisywany do `memory_candidates.outcome` (kolumna istnieje, NULL do S5) PRZED promote, w tej samej atomowej transakcji co decyzja.
- **D-ORDER (recon flagował).** Outcome resolution MUSI być PRZED eskalacją do sędziego — żeby `evidenceStrengthCeiling` (teraz outcome-aware) poprawnie zasilał `clampSourceTier` (inaczej clamp liczy się na nieaktualnym suficie).
- **D-BITEMPORAL (reuse, bez zmiany schematu).** `knowledge_entries` ma już `valid_from`/`valid_until` (world-time) + `created_at` (ingestion) + `status` z wartością `'invalidated'`. S5: `valid_from` = eventTime/czas decyzji (kiedy fakt zaszedł), `created_at` = ingestion. Inwalidacja = `status='invalidated'` (S7). Bez nowej kolumny.
- **D-S5S7.** S5 produkuje PIERWSZY outcome + inicjalizuje `outcome_version=0` na promote. S7 bumpuje przy zmianie outcome (ledger wakes). **S5 NIE reconciluje** (reconcile branch S4 dalej `reconcile_not_supported_pre_s7`).
- **D-IMPORTANCE-CONF (genesis §233 outcomeComputedBy).** S5 wyprowadza `importance`/`confidence` częściowo z ledgera (np. większy realized PnL / wyraźniejszy lessonSignal → wyższa waga), ale agent-supplied zostaje jako wejście; final z faktów. Szczegóły derywacji w §9 — konserwatywnie, bez over-engineeringu.

---

## 2. ZAKRES (S5 vs S7 vs reszta)

| W S5 | DEFER |
|---|---|
| outcome resolver: deref kotwicy → venue dispatch → ledger read → `MemoryOutcomeSummary` | reconcile po zmianie outcome (S7) |
| no-lookahead timestamp-gate (`available_at_decision_time`) | `enqueueLedgerWake` w miejscach zapisu projekcji (S7) |
| `evidence_strength='strong'` (outcome-aware ceiling, trade-only) | bumpowanie `outcome_version` (S7) |
| zapis `memory_candidates.outcome` + ugruntowany promote | invalidacja wpisów `status='invalidated'` (S7) |
| bi-temporal valid-time (reuse valid_from/until) | maturity FSM probationary→established (S6) |
| `outcome_version=0` init na promote | regime detector (S6/OD-2) |
| importance/confidence z ledgera | graph extraction (S8) |

---

## 3. SCHEMAT — BEZ ZMIAN (potwierdzone reconem)

S5 jest **code-only**. Reuse istniejących kolumn:
- `memory_candidates.outcome` JSONB (NULL→`MemoryOutcomeSummary`), `available_at_decision_time` TIMESTAMPTZ (NULL→granica decyzji), `event_time`/`observed_at`/`recorded_at`.
- `knowledge_entries.valid_from`/`valid_until`/`created_at`/`status('invalidated')`/`outcome_version`.
- Ledger (read-only): `protocol_executions`, `protocol_capture_items`, `proj_activity`, `proj_pnl_matches`, `proj_pnl_lots`, `proj_open_positions`, `proj_lp_events`.

**Outcome JSONB = `MemoryOutcomeSummary` (genesis §227-237 + `pnlSource` z bramki R1#1):** `{status: open|closed|settled|failed|invalidated, productType?, lessonSignal: positive|negative|mixed|neutral, evidenceQuality: weak|medium|strong, pointInTimeChecked: bool, outcomeComputedBy: 'memory_manager'|'deterministic_replay', outcomeVersion: number, outcomeLastChangedAt?, needsReconciliation?, pnlSource?: 'pnl_matches'|'open_position'|'lp_events'|'none'}`. `pnlSource` = audytowy ślad SKĄD policzono outcome (która tabela ledgera) — bez raw wartości pieniężnych. Nowy Zod `memory/schema/memory-outcome.ts` (+ ewentualne lockstep enumy jeśli wartości wchodzą do CHECK; tu JSONB więc walidacja tylko Zod przy zapisie). **Gate-point: czy outcome enums potrzebują SQL CHECK (JSONB → nie) — plan: tylko Zod.**

Zero DDL. Logger: rozszerzenie allowlisty (§12).

---

## 4. MODUŁ I PLIKI (FIX-3: internal funcs; rozszerza S4 manager)

**Creates:**
- `memory/manager/outcome-resolver.ts` — `resolveOutcome(candidate, deps)` → `MemoryOutcomeSummary | null`. Venue dispatch: deref `executionId` → `executions.getById` → `namespace`/`product_type` → reader. Readers: `resolveSpotOutcome` (proj_activity→proj_pnl_matches realized PnL + open lots), `resolvePositionOutcome` (proj_open_positions status/unrealized — perps/prediction/order), `resolveLpOutcome` (proj_lp_events fee/value). Venue bez pełnego pokrycia → outcome z `status` + `lessonSignal:'neutral'` + `evidenceQuality:'weak'` + `needsReconciliation:true` (honesty, nie fałszywa precyzja).
- `memory/manager/point-in-time.ts` — `deriveDecisionBoundary(candidate, execDeref)` (= execution-decyzji `created_at`) + `checkNoLookahead(evidenceRefs, boundary, execDeref)` → `pointInTimeChecked: bool` (evidence non-outcome ≤ boundary).
- `memory/schema/memory-outcome.ts` — Zod `memoryOutcomeSummarySchema` + `z.infer` typ.

**Edits (S4 files):**
- `memory/manager/consolidate.ts` — w `consolidateCandidate`: PRZED deterministic/judge (D-ORDER), dla trade-family kindów wywołaj `resolveOutcome` + `checkNoLookahead`; wynik zasila `deriveEvidenceStrengthCeiling` (outcome-aware) i jest niesiony do apply. Rozszerz `ConsolidateDeps` o `resolveOutcome`/ledger reads (injectable).
- `memory/manager/evidence-deref.ts` — `deriveEvidenceStrengthCeiling` rozszerzony o outcome arg: zamknięty realized PnL + pointInTimeChecked → `strong` (trade-only); inaczej sufit jak S4 (none/weak/moderate).
- `memory/manager/promote.ts` — `buildPromotionInsert`: zapis `candidate.outcome` (przez updateCandidate) + `valid_from` z eventTime; `outcome_version=0`. NIE embeduje raw outcome values (genesis §667-671 — outcome to lekcja, nie raw liczby w embeddingu; embedding zostaje z tytuł+summary jak S4).
- `db/repos/memory-candidates/crud.ts` — `updateCandidateOutcome(id, outcome, availableAtDecisionTime, tx)` (kolumny istnieją; brak settera).
- ledger repos — reuse istniejących (`executions`, `activity`, `pnl-matches`, `pnl-lots`, `open-positions`, `lp-events` — wszystkie mają gettery); ewentualnie 1-2 nowe odczyty (np. realized PnL po executionId) jeśli getter nie pasuje.
- `memory/observability/logger.ts` — +klucze (§12).

**NIE dotykamy:** registry/tool-map (FIX-3), prompty, S7 (reconcile/ledger-wakes).

---

## 5. OUTCOME RESOLVER (deref → venue dispatch → fakty)

```
resolveOutcome(candidate):
  anchors = candidate.evidenceRefs (executionId required)
  exec = executions.getById(anchor.executionId)        # immutable, stable
  if !exec: return null (anchor gone → S4 already handled existence)
  venue = classify(exec.namespace, product_type)        # via proj_activity for that execution
  switch venue:
    spot:        activities = activity by execution_id; sells → pnl_matches (sell_activity_id) → realized PnL;
                 buys w/o sell → open lot (proj_pnl_lots) → open exposure. status=closed if matched, open if lot open.
    position:    proj_open_positions by (instrument_key/position_key + wallet); status open/closed; unrealized/realized.
    lp:          proj_lp_events by execution_id/position_key → fee_collected/value; status from legs.
    other/thin:  status only + neutral signal + weak quality + needsReconciliation=true
  lessonSignal = sign(realizedPnl) (positive/negative; mixed if partial; neutral if open/unknown)
  evidenceQuality = strong (closed+matched realized) | medium (closed thin) | weak (open/unknown)
  return MemoryOutcomeSummary{status, productType, lessonSignal, evidenceQuality, pointInTimeChecked(§6),
                              outcomeComputedBy:'memory_manager', outcomeVersion:0, needsReconciliation}
```
Reuse: `pnl-matches.getMatchesByInstrument`/`getTotalRealizedPnl`, `pnl-lots.getOpenLots`, `open-positions.getOpen`, `activity.getActivities`, `lp-events.getLpEventsByPosition`. Wallet-scoping wg istniejącego wzorca (`addresses?`).

---

## 6. NO-LOOKAHEAD (timestamp-gate, role-free pod v2 FIX-1)

Fundament: **outcome jest DERYWOWANY z ledgera, nie jest anchorem ani deklaracją agenta** → nie da się wstrzyknąć przyszłości jako „dowodu". To główna ochrona. Stempel czasowy jest audytowy + degraduje `strong` gdy granica niewyznaczalna.

- `available_at_decision_time` (granica) = `candidate.event_time` (agent podaje kiedy trade faktycznie zaszedł — genesis §677) jeśli obecne; inaczej MIN(`created_at`) po wszystkich anchor-executions (pierwsza zarejestrowana akcja). Ustawiane na kandydacie przez `updateCandidateOutcome`.
- `checkNoLookahead(candidate, execDeref, boundary)`:
  - granica NULL (brak event_time ∧ brak istniejących anchorów) → `pointInTimeChecked:false`.
  - inaczej → `true` (outcome z ledgera = z definicji nie-lookahead; anchory to akcje agenta, nie przyszłe dane rynkowe). Opcjonalny twardszy check: anchor-execution z `created_at` znacząco PO granicy + brak realized-match (czyli nie jest closeem trade'u) → podejrzenie context-lookahead → degraduj `pointInTimeChecked:false`. *(Konserwatywnie; bez `role` nie rozróżnimy idealnie — wolimy degradować strong niż fałszywie awansować.)*
- `pointInTimeChecked:false` → **blokuje `strong`** (degraduje do moderate), NIE odrzuca kandydata.
- Done-when „promote tylko z poprawnym evidence+point-in-time": trade-family `strong` wymaga `pointInTimeChecked=true` ∧ rozwiązanego closed realized outcome.

---

## 7. EVIDENCE_STRENGTH 'strong' + RE-CLAMP ORDER (D-STRONG + D-ORDER)

- `deriveEvidenceStrengthCeiling({anchorExists, recurrenceCount, outcome?})`:
  - `outcome.status∈{closed,settled}` ∧ `outcome.evidenceQuality='strong'` ∧ `pointInTimeChecked` ∧ trade-family → **`strong`**.
  - inaczej jak S4: anchor+recurrence≥2 → moderate; anchor → weak; brak → none.
- W `consolidateCandidate`: resolveOutcome PRZED `runDeterministicStage`/judge → ceiling już outcome-aware → `clampSourceTier` (S4) dostaje poprawny sufit. `strong` ceiling → `maxTierForCeiling` zwraca `observed` (już obsłużone w S4 kodzie, case 'strong'→'observed'). source-tier clamp niezmieniony.

---

## 8. ZAPIS OUTCOME + PROMOTE (atomowo)

W atomowej transakcji S4 (`applyDecisionAtomically`): po owner-check, dla trade-family z rozwiązanym outcome:
1. `updateCandidateOutcome(candidate.id, outcome, availableAtDecisionTime, tx)` — zapis faktów na kandydacie. **Row-lock (R1#6):** owner-check S4 już lockuje item+job `FOR UPDATE OF i,j`; updateCandidateOutcome działa w tym samym tx (kandydat spójny). Setter = `UPDATE memory_candidates SET outcome=$, available_at_decision_time=$, updated_at=NOW() WHERE id=$ AND status='pending'` (precondition jak updateCandidateStatus; zwraca ok/precondition_failed).
2. promote (jeśli decyzja promote): `valid_from` = eventTime||decision boundary; `outcome_version=0`; outcome NIE w embeddingu (lekcja, nie raw liczby). knowledge_entries niesie outcome przez source_refs? NIE — outcome to osobny fakt; promote zapisuje go na kandydacie (audyt) + lekcja (title/summary) już go opisuje tekstem. **Gate-point: czy knowledge_entries potrzebuje kolumny outcome (nie ma) — plan: NIE; outcome żyje na candidate + w treści lekcji; S7 reconcile czyta candidate/ledger.**
3. recordDecision jak S4 (decisionVersion=0).

---

## 9. IMPORTANCE / CONFIDENCE Z LEDGERA (konserwatywnie)

- `confidence`: agent-supplied jako wejście; S5 nie podbija w górę, ale przy `pointInTimeChecked=false` lub `evidenceQuality=weak` → degraduje (cap). Brak fabrykowania pewności.
- `importance`: agent-supplied (1-10) zostaje; S5 może podnieść dla wyraźnego `lessonSignal` z dużym |realizedPnL| (np. ≥ próg) — nazwana stała, opcjonalne. **Gate-point: czy w ogóle ruszać importance w S5 czy zostawić agentowe — plan: minimalnie, tylko degradacja confidence na słabym evidence; importance bez zmian (prościej, mniej ryzyka).**

---

## 10. BI-TEMPORAL (reuse)

`valid_from` (world-time) = kiedy fakt zaszedł (eventTime/decision boundary); `valid_until` = NULL (otwarte) dopóki S7 nie zinwaliduje; `created_at` = ingestion (promote NOW). Inwalidacja/successor = S7 (`status='invalidated'` + what_failed). S5 tylko ustawia `valid_from` poprawnie na promote. Bez nowej kolumny.

---

## 11. OUTCOME_VERSION INIT (S5 ustawia 0; S7 bumpuje)

Promote trade-family: `outcome_version=0` (DEFAULT, ale EXPLICIT w insert by S7 enqueueLedgerWake miał czego targetować — recon risk: „silent 0 nie gwarancja jeśli kod zapomni"). `needsReconciliation` w outcome sygnalizuje S7 że to żywy outcome. S5 NIE tworzy reconcile jobów.

---

## 12. OBSERWOWALNOŚĆ (memLog +klucze lockstep)

Dołożyć: `outcomeStatus`, `lessonSignal`, `evidenceQuality`, `pointInTimeChecked` (bool→string), `realizedPnlUsd`? (NIE — to liczba z portfela, nie logujemy raw wartości pieniężnych per §70 live-state; tylko `lessonSignal`/`evidenceQuality`), `productType`, `outcomeVersion`. Eventy: `manager.outcome.resolved {candidateId, outcomeStatus, lessonSignal, evidenceQuality, pointInTimeChecked}`, `manager.outcome.no_anchor`, `manager.outcome.lookahead_blocked`. NIGDY raw PnL/wallet/ceny.

---

## 13. TESTY (rule 13; nazwy samoopisowe)

**Non-DB:** outcome-resolver venue dispatch (spot/position/lp/thin) z wstrzykniętymi ledger reads; lessonSignal/evidenceQuality mapping; point-in-time (evidence ≤ granica → checked true; po granicy → false; outcome-role wyłączone z testu; NULL granica → false); deriveEvidenceStrengthCeiling z outcome (closed+strong+PIT+trade → strong; open → moderate; non-trade → bez strong); confidence degradacja na weak; memory-outcome Zod.

**Integration (realny pgvector, temp-harness `_s5_tmp`):** seed protocol_executions + proj_activity + proj_pnl_matches (realized PnL) → resolveOutcome zwraca closed/positive/strong; otwarta pozycja → open/moderate; lookahead evidence (execution po granicy) → blocked → max moderate; promote trade-family zapisuje memory_candidates.outcome + valid_from + outcome_version=0; thin venue → weak+needsReconciliation; replay-stability (TRUNCATE proj_* + regenerate → outcome re-derive identyczny przez stabilny executionId).

LLM: mock provider jak S4.

---

## 14. DONE-WHEN

- tsc clean; vex-app lint pass (jeśli ruszone — raczej nie); non-DB zielone; integracja realny pgvector zielona.
- `trade_outcome`/`strategy_lesson`/`risk_lesson` promowane TYLKO z rozwiązanym outcome + `pointInTimeChecked=true` (genesis Done-when).
- outcome = fakty ledgera (realized PnL deref przez stabilny executionId), nie deklaracja agenta; replay-stable.
- `memory_candidates.outcome` wypełniony; `evidence_strength='strong'` osiągalny (trade-only, closed); `outcome_version=0` init; bez raw PnL w embeddingu/logach.
- S5 NIE reconciluje (S4 reconcile branch nietknięty).

---

## 15. GATE-POINTS (do bramki harness-memory-s5)

1. Outcome JSONB enums: tylko Zod (JSONB) vs SQL CHECK — plan Zod.
2. knowledge_entries kolumna outcome: NIE (outcome na candidate + w treści) — potwierdzić że S7 reconcile to wystarczy.
3. importance w S5: bez zmian (tylko confidence degradacja) — potwierdzić.
4. Venue „position" realized PnL dla perps (R1#10): gdzie dokładnie żyje realized PnL perpa po zamknięciu — `proj_open_positions` (closed status + realized?) vs derive z `proj_activity` close-row. Plan: jeśli brak czystego realized → thin-fallback (status closed + lessonSignal z znaku unrealized-at-close + evidenceQuality `medium` + needsReconciliation). LP: `proj_lp_events` fee/value → lessonSignal z net cashflow. Konkretny helper per-venue przy impl; NIGDY fałszywej precyzji.
5. point-in-time bez `role` (v2 FIX-1) — ROZWIĄZANE w §1/§6: granica = `event_time`||MIN(anchor created_at); outcome derywowany (nie anchor) = z natury nie-lookahead; `pointInTimeChecked=false` degraduje strong, nie odrzuca. Bramka: potwierdzić że to wystarcza dla genesis Done-when (lub czy chcemy twardszy context-lookahead heuristic).
6. resolveOutcome przed judge dla WSZYSTKICH czy tylko trade-family (koszt) — plan: tylko trade-family (isTradeKind), nie-trade pomija resolver.
7. Replay-stability test: realized PnL re-derive po TRUNCATE+regenerate musi być identyczny (FIX-1 fundament).

---

## 16. ŚLAD BRAMEK

- **Plan-gate R1 (harness-memory-s5, thread `019eacae`, model spark): BLOCKED-misframe** (jak S4 R3). Reviewer ocenił plan-gate jak review implementacji — pkt 1/2/3/6/8/10 = `Creates`/`Edits` prescribed przez plan (nie defekty; pkt 4/5/7 POTWIERDZAJĄ poprawność prescribed edits; scrutiny a-f bez zgłoszonego defektu projektowego). **#9 ODRZUCONY** (over-reach): Codex chciał S5 podpiąć enqueue reconcile do S7 — plan świadomie odracza (D-S5S7: S5 ustawia outcome_version=0 + needsReconciliation; S7 dopina ledger-wake + reconcile; podpinanie w S5 = scope creep do S7). Wcielone doprecyzowania: `pnlSource` w outcome (§3), row-lock `updateCandidateOutcome` (§8), per-venue helper + perps realized PnL (§15.4). Re-submit R2 z klarownym framingiem.
- **Plan-gate R2 (harness-memory-s5, thread `019eacae`): GREEN LIGHT — 0 defektów projektowych.** Codex potwierdził: role-free no-lookahead spójne; D-ORDER czyste (S4 liczy ceiling PRZED applyDecision/judge → wstawienie resolveOutcome bez reworku); outcome replay-safe ze stabilnego executionId; venue dispatch wykonalny (repos istnieją); atomowość outcome-write w S4 tx; bi-temporal schema-ready; **pushback #9 ZAAKCEPTOWANY** (staged S5/S7 boundary poprawny). Start implementacji autoryzowany (bez enqueue reconcile).
- **Implementacja: DONE** (subagent Opus 4.8; outcome-resolver + point-in-time + memory-outcome schema + edycje consolidate/evidence-deref/promote/executor + updateCandidateOutcome + open-positions getByPositionKeyAnyStatus + supersede validFrom + observability +6 kluczy lockstep + testy).
- **Weryfikacja niezależna (parent): PASS.** tsc root clean; non-DB **124/124** (11 plików); **integracja na REALNYM pgvector 14/14** (S4 10 — zero regresji; S5 4: spot closed→strong + outcome zapisany + valid_from=boundary + outcome_version=0 + zero raw PnL; open→weak; thin→weak+needsReconciliation; replay-stability). Spot-review: outcome-resolver (deref stabilnego executionId, venue dispatch, brak fałszywej precyzji, zero proj_* SERIAL), point-in-time (role-free konserwatywny degrade), D-ORDER, atomowy outcome-write (owner-check tx, status=pending precond), executor reconcile UNTOUCHED — poprawne.
- **Impl-gate Codexa (Phase 6, thread `019eacae`): GREEN LIGHT — 0 fixów.** Potwierdził replay-stability/D-DEREF, role-free no-lookahead, D-ORDER, atomowość, D-STRONG (strong tylko trade+closed+PIT), D-S5S7, zero raw monetary values, position/LP medium+reconcile. Confidence-unchanged zaakceptowane (§9 — clamp już degraduje provenance; mutacja agentowego confidence zbędna/ryzykowna).
- **NIE commitowane** (czeka na wyraźną prośbę właściciela — harness Phase 7).
