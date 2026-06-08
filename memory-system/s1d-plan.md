# S1d — `memory_entities` + `memory_entry_entities` + `memory_edges` (detailed stage spec)

Parent plan: `memory-system/memory-system-v2.md` §9 S1d (+ §2 read-path graph-expansion, §6 advisory-only, §8 schema list). Closes the S1 schema layer. Cutover map: `audit/memory-cutover-manifest.md`.
Status: DRAFT → Codex gate (`harness-memory-s1d`) → Opus implement → independent verify → final impl-gate.
Strategy: EDIT-IN-PLACE in `001_initial.sql` (append after line 753, the `memory_job_items` block). Pre-release, dev reset OK. Mirror regen via `copy-migrations.mjs` (gitignored).

## 0. Owner decisions (made 2026-06-08) + scope

Three forks were put to the owner (richer-than-minimal chosen on all three — "complete the schema in one pass"):

- **Q1 = FULL bi-temporal history on edges.** Record BOTH valid-time (`valid_from`/`valid_until` — when the relation was true in the world) AND transaction-time (`invalidated_at` — when we retracted/superseded it) + an explicit `superseded_by_edge_id` pointer. Matches the Zep/Graphiti bi-temporal model the parent plan targets (§1a). Edge is NEVER deleted — invalidation = set timestamps.
- **Q2 = embeddings included now.** Entities carry a NAME embedding (entity resolution); edges carry an optional FACT embedding (recall). Triplet `(embedding, embedding_model, embedding_dim)` mirrors `memory_candidates`/`knowledge_entries`. S1d has no producer — the substrate just requires/stores them; the LLM that fills them is S8. Fixtures use synthetic `randVector` (no embeddings endpoint), exactly like S1b/S1c.
- **Q3 = fixed (closed) enums** for `entity_type` and edge `relation`, enforced by named DB CHECK + lockstep drift tests (like every other memory enum). ⚠ **The exact value lists in §3 need owner sign-off before code.**

**Goal of S1d:** the graph SUBSTRATE — 3 tables + repo CRUD primitives (upsert/invalidate/link/list) + Zod boundary + closed enums (lockstep) + logger keys. NO LLM entity extraction, NO edge classification, NO retrieval graph-expansion, NO redaction logic, NO "when to invalidate" policy — those are **S8** (graph v1) and **S3** (retrieval). Same substrate/executor cut as S1c (tables+CRUD) vs S4 (worker/LLM).

Advisory-only doctrine holds: nothing here feeds sizing/approval/wallet-intent. The graph only enriches retrieval (§6).

## 1. Grounding (verified — 5-agent recon `wf_748bd2cc-7f1`)

- **No legacy graph/entity code exists** — fully greenfield. `entities TEXT[]` on `memory_candidates` (001:573) and `tags`/`regime_tags` on `knowledge_entries` are denormalized arrays; the normalized graph tables are new and COEXIST with them (arrays = quick tags; junction = normalized graph S8 populates).
- **Bi-temporal template** = `knowledge_entries` (001:47-50,90-98): a lineage `status` axis (`active|superseded|invalidated|archived`) + valid-time `valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW()` / `valid_until TIMESTAMPTZ` (NULL=evergreen) + ingestion `created_at`/`updated_at` + `outcome_version`.
- **Embedding triplet** = `(embedding vector NOT NULL, embedding_model TEXT NOT NULL, embedding_dim INTEGER NOT NULL)` + `*_embedding_dim_range` (1..8192) + `*_embedding_dim_matches_vector (vector_dims(embedding)=embedding_dim)`. No typmod (re-embed-friendly). `embedding_model`/`dim` are authoritative — recall filters on them.
- **FK target types:** `knowledge_entries.id` = SERIAL → **INTEGER** FKs; `memory_candidates.id` = UUID. New entities get **UUID** PK (cross-session, distributed identity — like candidates).
- **Naming:** CHECK `<abbr>_<field>_<scope>`; `idx_<abbr>_*`; `uniq_<abbr>_*` + partial `WHERE`; named CHECKs for lockstep. Section banner `-- ══…`.
- **DB toolkit:** `db/client.ts` (`getPool`, `Executor = Pool|PoolClient`, `queryWith`/`queryOneWith`/`executeWith`, `withTransaction`); local `inTransaction(client, fn)` helper used by memory repos; `db/params.ts` (`jsonb`).
- **xmax no-op upsert** (race-safe, pure — beats CTE/UNION DO-NOTHING under concurrency): `INSERT … ON CONFLICT <partial-arbiter> DO UPDATE SET col = table.col RETURNING *, (xmax = 0) AS inserted`. Precedents: `memory-candidates` insertCandidate, `memory-jobs` enqueueReconcileJob, `memory-decisions` recordDecision.
- **Owner-checked / precondition-guarded UPDATE** (single statement, returns rowCount): precedent `memory-job-items` markItem* and `memory-jobs` heartbeat/markCompleted.
- **Discriminated result types** (no throws for expected failure): `{ ok: true; … } | { ok: false; reason: "…" }`. Precedent `resetReconcileJob`, `recordDecision`.
- **Enum lockstep:** `as const` + `z.enum` + `z.infer` in `memory/schema/*-enums.ts`; named SQL CHECK; shared parser `src/__tests__/vex-agent/memory/schema/_lockstep.ts` (`parseCheckInList`, `sorted`, `MIGRATION_SQL`) — REUSE, do not duplicate.
- **memLog allowlist** (`memory/observability/logger.ts`): `MemoryLogMeta` keys + `META_KEY_CATEGORY` map, string|number ONLY (no boolean), categories `id`/`enum`/`num`. Adding a key = add to BOTH (compile-time forced). Existing keys incl. `candidateId/jobId/decision/status/.../promotedKnowledgeId/errorCode/errorKind`.
- **Graphiti/Zep model** (authoritative, retrieved 2026-06-08 — `getzep/graphiti` `edges.py`/`nodes.py`/`edge_operations.py`, Zep `arXiv:2501.13956`): entity node = uuid/name/labels/name_embedding(of the NAME)/summary/attributes; edge = source/target uuid + relation name + fact text + fact_embedding(of the FACT) + episodes[] provenance + four temporal fields `valid_at`/`invalid_at` (world) + `created_at`/`expired_at` (system). Invalidation = keep row, set `invalid_at = new.valid_at`, `expired_at = now()`. Supersession link is IMPLICIT in Graphiti (no pointer) — **we add an explicit `superseded_by_edge_id`** (Q1; Vex prefers deterministic auditable links, cf. `memory_decisions.supersedes_knowledge_id`). Edge uniqueness must NOT be a plain `(source,target,relation)` — temporal versions coexist; uniqueness is only among ACTIVE edges (partial index).

## 2. Proposed DDL (append to `001_initial.sql` after line 753)

Table order (FK dependency): **memory_entities → memory_entry_entities → memory_edges**.

```sql
-- ══════════════════════════════════════════════════════════════════
-- Memory v2 — knowledge graph (S1d). Entity nodes + entry↔entity links + edges.
-- ══════════════════════════════════════════════════════════════════
-- The async memory_manager (S8) extracts/normalizes entities from promoted
-- knowledge_entries, links them, and asserts edges between entities. Supersession
-- is by INVALIDATION (set timestamps), NEVER DELETE — Zep/Graphiti bi-temporal.
-- Advisory-only: the graph only enriches retrieval (S3); never feeds
-- sizing/approval/wallet-intent. Entities are GLOBAL (cross-session, like the
-- long-term store) — no session_id. Embeddings are stored here (Q2) but produced
-- by S8; the substrate only requires/validates them.

-- memory_entities — normalized entity nodes (canonical things memories are about).
CREATE TABLE memory_entities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL,                        -- closed enum (me_entity_type_valid)
  name              TEXT NOT NULL,                        -- display surface as first seen
  normalized_name   TEXT NOT NULL,                        -- lower()+collapsed-whitespace canonical dedup key
  aliases           TEXT[] NOT NULL DEFAULT '{}',         -- observed surface variants (no NULL elements)
  summary           TEXT NOT NULL DEFAULT '',             -- regional summary; S8 fills (redacted upstream)
  attributes        JSONB NOT NULL DEFAULT '{}',          -- type-dependent attributes
  embedding         vector NOT NULL,                      -- NAME embedding (entity resolution); no typmod
  embedding_model   TEXT NOT NULL,                        -- authoritative — resolution filters on this
  embedding_dim     INTEGER NOT NULL,
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- world: when the entity became known
  valid_until       TIMESTAMPTZ,                          -- world: entity ceased (NULL = active)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- ingestion
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT me_embedding_dim_range          CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT me_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim),
  CONSTRAINT me_aliases_no_null              CHECK (array_position(aliases, NULL) IS NULL),
  CONSTRAINT me_attributes_is_object         CHECK (jsonb_typeof(attributes) = 'object'),
  CONSTRAINT me_normalized_name_nonempty     CHECK (length(normalized_name) > 0),
  CONSTRAINT me_valid_window                 CHECK (valid_until IS NULL OR valid_until >= valid_from),
  -- closed vocabulary (NAMED → lockstep-testable; source of truth: memory/schema/memory-entity-enums.ts)
  CONSTRAINT me_entity_type_valid CHECK (entity_type IN
    ('token','protocol','wallet','strategy','market_regime','concept','person','event'))
);
-- entity resolution dedup: AT MOST ONE active entity per (type, normalized_name).
-- Partial predicate is the ON CONFLICT arbiter for upsertEntity's xmax upsert.
CREATE UNIQUE INDEX uniq_me_active_identity ON memory_entities(entity_type, normalized_name) WHERE valid_until IS NULL;
CREATE INDEX idx_me_embedding_match ON memory_entities(embedding_model, embedding_dim);
CREATE INDEX idx_me_normalized     ON memory_entities(normalized_name);
CREATE INDEX idx_me_type           ON memory_entities(entity_type);

-- memory_entry_entities — junction: which entities a long-term knowledge_entry mentions.
CREATE TABLE memory_entry_entities (
  entry_id      INTEGER NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  entity_id     UUID    NOT NULL REFERENCES memory_entities(id)   ON DELETE CASCADE,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entry_id, entity_id),
  CONSTRAINT mee_mention_count_pos CHECK (mention_count >= 1)
);
CREATE INDEX idx_mee_entity ON memory_entry_entities(entity_id);   -- reverse lookup (entity → entries)

-- memory_edges — directed entity→entity relations, FULL bi-temporal (invalidate, never delete).
CREATE TABLE memory_edges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id      UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  target_entity_id      UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation              TEXT NOT NULL,                       -- closed enum (med_relation_valid)
  fact                  TEXT NOT NULL DEFAULT '',            -- NL fact text (S8), redacted upstream
  fact_embedding        vector,                              -- FACT embedding (recall); NULLABLE
  embedding_model       TEXT,
  embedding_dim         INTEGER,
  origin_entry_id       INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,  -- primary provenance (FK-safe; full episode list deferred — D8)
  -- FULL bi-temporal (Q1). NULL = open interval on every temporal bound.
  valid_from            TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- world: relation became true
  valid_until           TIMESTAMPTZ,                         -- world: relation stopped being true
  invalidated_at        TIMESTAMPTZ,                         -- system: when WE retracted/superseded it (Graphiti expired_at)
  superseded_by_edge_id UUID REFERENCES memory_edges(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- ingestion
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT med_no_self_loop      CHECK (source_entity_id <> target_entity_id),
  CONSTRAINT med_no_self_supersede CHECK (superseded_by_edge_id IS NULL OR superseded_by_edge_id <> id),
  CONSTRAINT med_superseded_implies_invalidated CHECK (superseded_by_edge_id IS NULL OR invalidated_at IS NOT NULL),
  CONSTRAINT med_valid_window      CHECK (valid_until IS NULL OR valid_until >= valid_from),
  -- fact embedding is an all-or-nothing triplet (mirror ke_/mc_ embedding guards, but nullable as a set)
  CONSTRAINT med_embedding_triplet CHECK (
    (fact_embedding IS NULL AND embedding_model IS NULL AND embedding_dim IS NULL)
    OR (fact_embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedding_dim IS NOT NULL
        AND embedding_dim > 0 AND embedding_dim <= 8192 AND vector_dims(fact_embedding) = embedding_dim)
  ),
  CONSTRAINT med_relation_valid CHECK (relation IN
    ('traded_on','uses','holds','competes_with','correlates_with','part_of','supersedes','related_to'))
);
-- AT MOST ONE active (currently-believed) edge per (source, target, relation). Invalidated
-- temporal versions coexist (they fall out of the partial predicate). ON CONFLICT arbiter for upsertEdge.
CREATE UNIQUE INDEX uniq_med_active_relation ON memory_edges(source_entity_id, target_entity_id, relation) WHERE invalidated_at IS NULL;
CREATE INDEX idx_med_source          ON memory_edges(source_entity_id) WHERE invalidated_at IS NULL;
CREATE INDEX idx_med_target          ON memory_edges(target_entity_id) WHERE invalidated_at IS NULL;
CREATE INDEX idx_med_relation        ON memory_edges(relation);
CREATE INDEX idx_med_embedding_match ON memory_edges(embedding_model, embedding_dim) WHERE fact_embedding IS NOT NULL;
```

## 3. Closed enums (⚠ owner sign-off on the value lists)

Single source of truth in TS (`as const` + `z.enum` + `z.infer`); mirrored by the named SQL CHECKs above; drift-guarded by lockstep tests (§8).

- **`MEMORY_ENTITY_TYPE`** (`me_entity_type_valid`): `token`, `protocol`, `wallet`, `strategy`, `market_regime`, `concept`, `person`, `event`.
  - Rationale (Vex = crypto trading agent): `token`=asset (SOL/ETH); `protocol`=on-chain protocol or trading venue (Hyperliquid/Uniswap); `wallet`=address/account; `strategy`=named approach; `market_regime`=condition (high_vol/bull); `concept`=indicator/metric/general idea (funding_rate/liquidation); `person`=counterparty/social figure; `event`=discrete occurrence.
- **`MEMORY_EDGE_RELATION`** (`med_relation_valid`): `traded_on`, `uses`, `holds`, `competes_with`, `correlates_with`, `part_of`, `supersedes`, `related_to`.
  - `related_to` is the generic fallback so S8 is never blocked by an un-classifiable relation. Directed; symmetry (e.g. competes_with) is handled by the producer choosing source/target.

> These lists are the one thing I am proposing rather than deriving. Confirm or edit before I run the gate / write code. Adding/removing values later is cheap (edit-in-place + dev reset) but the lockstep test pins them, so the set should be deliberate.

## 4. Zod boundary (`src/vex-agent/memory/schema/`)

- `memory-entity-enums.ts` — `MEMORY_ENTITY_TYPE` (`as const`) + `memoryEntityTypeSchema = z.enum(...)` + `MemoryEntityType` type.
- `memory-edge-enums.ts` — `MEMORY_EDGE_RELATION` + `memoryEdgeRelationSchema` + `MemoryEdgeRelation` type.
- `memory-entity.ts` —
  - `normalizeEntityName(raw: string): string` = `raw.trim().toLowerCase().replace(/\s+/g, " ")` (mirrors Graphiti `_normalize_string_exact`; lowercases + trims/collapses whitespace, does NOT strip internal spaces). The SINGLE source for the dedup key.
  - `entityInputSchema` (`.strict()`): `entityType` (enum), `name` (1..256), `aliases?` (string[]≤64, each ≤256), `summary?` (≤ bound), `attributes?` (record), `embedding` (number[]) + `embeddingModel` + `embeddingDim`, `validFrom?`. **`normalizedName` is NOT a field** — `upsertEntity` derives it from `name` via `normalizeEntityName` (repo-owned, so a caller can never store a `name` that disagrees with its dedup key — §6 memory-poisoning guard; impl-gate fix). Export `EntityInput`.
- `memory-edge.ts` —
  - `edgeInputSchema` (`.strict()`): `sourceEntityId`/`targetEntityId` (uuid, must differ — refine), `relation` (enum), `fact?` (≤ bound), optional fact-embedding triplet (all-or-none refine mirroring the SQL CHECK), `originEntryId?` (int), `validFrom?`. Export `EdgeInput`.
  - `edgeInvalidationSchema`: `validUntil?` (timestamp), `supersededByEdgeId?` (uuid).
- Bounds: reuse the candidate bounds style (`CANDIDATE_ENTITY_MAX=256`, array ≤64) for name/aliases.

## 5. Repo primitives (`src/vex-agent/db/repos/`) — 3 dirs, `{types,crud,index}.ts` each

**memory-entities/**
- `upsertEntity(input, client?) → { entity, inserted }` — xmax upsert, arbiter `(entity_type, normalized_name) WHERE valid_until IS NULL`, `DO UPDATE SET updated_at = memory_entities.updated_at` (no-op). Repo fast-fails if `embedding.length !== embeddingDim` (mirror insertCandidate).
- `getEntityById(id, client?)`, `findActiveEntity(entityType, normalizedName, client?)`.
- `addEntityAliases(id, aliases[], client?) → MemoryEntity | null` — merge-dedupe (`array(SELECT DISTINCT unnest(aliases || $2))`), only while active.
- `invalidateEntity(id, validUntil, client?) → { ok: true; entity } | { ok: false; reason: "not_found" | "already_invalidated" }` — precondition-guarded `WHERE id=$1 AND valid_until IS NULL`.
- `listEntities({ entityType?, activeOnly?, limit? }, client?)`.

**memory-entry-entities/**
- `linkEntryEntity(entryId, entityId, mentionCount = 1, client?) → { link, inserted }` — idempotent xmax upsert on PK `(entry_id, entity_id)`, `DO UPDATE SET mention_count = GREATEST(memory_entry_entities.mention_count, EXCLUDED.mention_count)` (R1: caller supplies the count; conflict takes the MAX so retries / duplicate S8 extraction never drift it — increment-on-conflict was non-idempotent). `inserted = (xmax = 0)`.
- `listEntitiesForEntry(entryId, client?)`, `listEntriesForEntity(entityId, client?)`.

**memory-edges/**
- `upsertEdge(input, client?) → { edge, inserted }` — xmax upsert, arbiter `(source_entity_id, target_entity_id, relation) WHERE invalidated_at IS NULL`, `DO UPDATE SET updated_at = memory_edges.updated_at` (no-op). Triplet validated by Zod + CHECK.
- `getEdgeById(id, client?)`.
- `invalidateEdge(id, { validUntil?, supersededByEdgeId? }, client?) → { ok: true; edge } | { ok: false; reason: "not_found" | "already_invalidated" }` — precondition-guarded single statement: `UPDATE … SET invalidated_at = NOW(), valid_until = COALESCE($2, valid_until), superseded_by_edge_id = $3, updated_at = NOW() WHERE id=$1 AND invalidated_at IS NULL RETURNING …`.
- `listActiveEdgesForEntity(entityId, client?)` (both directions — graph expansion seed for S3/S8), `listEdgesFrom(entityId, {activeOnly})`, `listEdgesTo(entityId, {activeOnly})`.
- `supersedeEdge(oldEdgeId, newInput, client?) → { ok: true; superseded: MemoryEdge; replacement: MemoryEdge } | { ok: false; reason: "not_found" | "already_invalidated" }` — **atomic** (R1; required because `uniq_med_active_relation` forbids a second active edge for the same `(source,target,relation)`, so a plain `upsertEdge(new)` would just conflict with the still-active old edge and return it — no new id to point at). One transaction via `inTransaction`, binding ONE boundary timestamp `replacementValidFrom := COALESCE($newValidFrom, NOW())` reused everywhere: (1) `SELECT old FOR UPDATE WHERE id=$1 AND invalidated_at IS NULL` (precondition lock; serializes concurrent supersedes — the loser sees it already invalidated → `already_invalidated`; missing → `not_found`); (2) `UPDATE old SET invalidated_at = NOW(), valid_until = COALESCE($newValidFrom, NOW()), updated_at = NOW()`; (3) `INSERT` the new active edge with an **explicit** `valid_from = COALESCE($newValidFrom, NOW())` (NOT the column default), now allowed — old left the active partial index; (4) `UPDATE old SET superseded_by_edge_id = new.id`. Returns both rows. **The bi-temporal boundary is continuous** (R2; Graphiti invariant `old.invalid_at == new.valid_at`): because `NOW()` is the transaction timestamp (identical across all statements in the txn), `old.valid_until === replacement.valid_from` whether or not the caller supplied `validFrom`. (If a caller passes a `validFrom` earlier than the old edge's `valid_from`, `med_valid_window` rejects the txn — incoherent timeline, fail-loud.)
- `upsertEdge` + `invalidateEdge` stay as standalone primitives for NEW-relation inserts and plain retractions (no successor); `supersedeEdge` is the ONLY race-safe path to replace an active edge with a new active one for the SAME triple.

All `types.ts`: snake_case Row + camelCase domain + `mapRow` + `*_COLUMNS` constant (mirror existing repos). Vectors via the existing literal helper; JSONB via `jsonb()`.

## 6. Observability (`memory/observability/logger.ts`)

Add bounded keys to `MemoryLogMeta` + `META_KEY_CATEGORY` (string|number only):
- `entityId` (id), `edgeId` (id), `entryId` (id), `entityType` (enum), `relation` (enum).

Emit (allowlisted meta only — never name/fact/summary text):
- `entity.upserted` `{ entityId, entityType }`, `entity.invalidated` `{ entityId }`, `entity.aliased` `{ entityId, count }`.
- `edge.upserted` `{ edgeId, relation }`, `edge.invalidated` `{ edgeId }`.
- `entry_entity.linked` `{ entryId, entityId }`.

## 7. Scope split — S1d vs S8/S3

| Concern | S1d (this stage) | Deferred |
|---|---|---|
| 3 tables + CHECKs + indexes | ✅ | |
| Repo CRUD primitives (upsert/invalidate/link/list) | ✅ | |
| Zod boundary + closed enums + lockstep | ✅ | |
| `normalizeEntityName` helper | ✅ (deterministic key) | fuzzy/LLM alias resolution → S8 |
| Embedding columns | ✅ (required/validated) | producing vectors (LLM) → S8 |
| Entity extraction / edge classification (LLM) | | **S8** |
| WHEN to invalidate / supersede (reconciliation policy) | primitive only | **S7/S8** |
| Bounded graph expansion in `long_memory_search` | | **S3/S8** |
| Redaction of name/fact/summary | | producer boundary (suggest/promote, S2/S8) — substrate stores already-clean text, like candidates/knowledge |

## 8. Tests (self-documenting names — NO gate-codes)

- **Lockstep** (`src/__tests__/vex-agent/memory/schema/`): `memory-entity-enums.test.ts`, `memory-edge-enums.test.ts` — reuse `_lockstep.ts` `parseCheckInList`; assert SQL CHECK list == `as const` tuple == `schema.options`; fail-loud on missing constraint.
- **Schema** (`memory-entity.test.ts`, `memory-edge.test.ts`): `normalizeEntityName` collapses case/whitespace; edge rejects equal source/target; fact-embedding all-or-none refine; `.strict()` rejects unknown keys.
- **Integration** (`src/__tests__/integration/repos/`, new `_s1d-fixtures.ts` with `seedEntity`/`seedEdge` using `randVector` — NO embeddings endpoint):
  - entities: same identity upserts idempotently (second call `inserted=false`, same row); re-inserting after invalidation creates a NEW active row (partial-unique allows it); `invalidateEntity` twice → `already_invalidated`; alias merge dedupes; embedding-dim mismatch rejected (repo fast-fail + CHECK).
  - junction: re-linking the same `(entry, entity)` is idempotent and `mention_count` becomes `MAX(stored, supplied)` — retries never drift it; composite PK enforced; reverse lookups; cascade when entry or entity deleted.
  - edges: active relation upserts idempotently; self-loop rejected; no-self-supersede; `superseded_by_edge_id` without `invalidated_at` rejected (CHECK); `invalidateEdge` sets `invalidated_at`+`valid_until`+pointer; invalidate twice → `already_invalidated`; an invalidated edge and a fresh active one coexist for the same `(source,target,relation)`; embedding-triplet all-or-none CHECK; nullable fact-embedding path; `listActiveEdgesForEntity` excludes invalidated; FK cascade on entity delete; `superseded_by_edge_id` SET NULL when the pointed edge is deleted.
  - supersede: `supersedeEdge` atomically invalidates the old edge (sets `invalidated_at`+`valid_until`+`superseded_by_edge_id`→replacement) and leaves EXACTLY ONE active edge for the triple; with `validFrom` OMITTED, `old.valid_until === replacement.valid_from` (continuous bi-temporal boundary — R2); superseding an already-invalidated/missing edge → `already_invalidated`/`not_found`; two concurrent `supersedeEdge` on the same old edge → exactly one wins (FOR UPDATE serializes), never two active edges.
- **Verify:** `pnpm exec tsc --noEmit`; targeted `pnpm exec vitest run <paths>`; integration on real pgvector via throwaway temp-harness (standard `integration.config.ts` globalSetup hard-requires `EMBEDDING_BASE_URL` which S1d doesn't need — spin `pgvector/pgvector:0.8.2-pg18-trixie`, runMigrations, NO embeddings probe, then delete temp files); `copy-migrations.mjs` → mirror byte-identical.

## 9. Decisions to ratify (gate)

- **D1 — entities GLOBAL** (no `session_id`): the graph is a cross-session knowledge graph over the long-term store; matches `knowledge_entries` (also global).
- **D2 — entity dedup** = `(entity_type, normalized_name)` among active rows, via xmax upsert. `normalized_name` from the single `normalizeEntityName` helper. (Fuzzy/embedding-similarity resolution is S8.)
- **D3 — edges DIRECTED** (`source`→`target`); active-unique `(source,target,relation) WHERE invalidated_at IS NULL` (temporal versions coexist — Graphiti pitfall avoided).
- **D4 — FULL bi-temporal on edges** (Q1): world `valid_from`/`valid_until` + system `invalidated_at` + `superseded_by_edge_id`; NULL = open interval. "Currently believed" filter = `invalidated_at IS NULL`. Entities are bi-temporal-lite (`valid_from`/`valid_until` + `created_at`) — they rarely cease but can be invalidated.
- **D5 — embeddings now** (Q2): entity NAME embedding `NOT NULL` (producer always has the name; mirrors candidates); edge FACT embedding NULLABLE all-or-none triplet (not every edge carries a fact vector — Graphiti `fact_embedding` is optional).
- **D6 — closed enums** (Q3) entity_type + relation; ⚠ exact lists (§3) need owner sign-off.
- **D7 — junction** `memory_entry_entities` links `knowledge_entries` (long-term) ↔ entities; composite PK `(entry_id, entity_id)` + `mention_count`. Denormalized `entities TEXT[]` on candidates stays (quick tags); junction is the normalized form S8 fills.
- **D8 — provenance** = single `origin_entry_id` FK (SET NULL), not the full Graphiti `episodes[]` list. FK-enforceable; sufficient for v1 "which entry first asserted this edge". A full provenance side-table is deferred (revisit in S8 if multi-source attribution is needed).
- **D9 — supersession is an atomic substrate primitive `supersedeEdge`** (R1 gate). The active partial-unique makes the naive "insert new active then invalidate old" sequence unimplementable for the same `(source,target,relation)` — the new insert collides with the still-active old. One transaction locks the old `FOR UPDATE`, invalidates it, inserts the new active edge, and back-points `superseded_by_edge_id`. S8 decides WHEN to supersede; the race-safe HOW lives in S1d. `upsertEdge`/`invalidateEdge` remain for new-relation inserts and successor-less retractions.
- **D10 — redaction** is the producer's responsibility at the suggest/promote boundary (S2/S8); the substrate stores already-clean `name`/`fact`/`summary`, exactly like `knowledge_entries`/`memory_candidates`. memLog never logs free text.

## 10. Gate rounds (`harness-memory-s1d`)

- **R1 (BLOCKED → fixed):** (1) `supersedeEdge` must be an atomic substrate primitive — the active partial-unique forbids `upsertEdge(new)`+`invalidateEdge(old)` for the same triple (new collides with still-active old). → added to §5/§9 D9. (2) `linkEntryEntity` increment-on-conflict (`mention_count+1`) is non-idempotent → caller supplies count, conflict takes `GREATEST/MAX`. Non-blocking confirmations: active predicate `invalidated_at IS NULL`, nullable fact-embedding triplet, advisory-rebuildable CASCADE posture, lockstep wiring all coherent.
- **R2 (BLOCKED → fixed):** `supersedeEdge` with `validFrom` omitted left old `valid_until=NULL` while replacement got `valid_from=NOW()` → broken bi-temporal boundary. → bind one `replacementValidFrom := COALESCE($newValidFrom, NOW())` for BOTH old `valid_until` and an explicit replacement `valid_from`; continuous boundary guaranteed by the stable txn timestamp. Test added.

- **Impl gate (after Opus implement + my independent verify):** my verification on a real pgvector container caught a REAL repo bug — `upsertEntity` listed 10 INSERT columns but bound 9 values (`summary` had no param) — plus 2 wrong test premises (a name variant that does NOT normalize equal; an `invalidateEdge` `valid_until` earlier than the edge's `valid_from` correctly tripping `med_valid_window`). All fixed. The final Codex impl-gate then caught the dedup-key poisoning vector: `upsertEntity` trusted a caller-supplied `normalizedName` instead of deriving it → removed the field, repo now derives via `normalizeEntityName`.

## 11. Status

DONE (pending commit) — owner approved §3 enum lists (2026-06-08). Implemented + verified: tsc clean; 26 non-DB tests; 30 integration tests on real pgvector; mirror byte-identical. Plan gate GREEN (R3) + impl gate GREEN (after the fixes above). `harness-memory-s1d` thread `019ea7b3-a515-7d61-945b-c0ea2ef7908f`. Executor (LLM extraction / edge classification) + retrieval graph-expansion = S8/S3. Commit on explicit request.
