# S1b — `memory_candidates` (detailed stage spec)

Parent plan: `memory-system/memory-system-v2.md` §9 S1b. Cutover map: `audit/memory-cutover-manifest.md`.
Status: DRAFT → Codex gate (`harness-memory-s1b`) → Opus implement → verify → final gate.
Strategy: EDIT-IN-PLACE migrations (pre-release, dev reset OK). Full schema now, no deferral (owner: "walimy całość").

---

## 0. Goal

Build layer 3 of the 5-layer memory architecture: the **long-memory write buffer**. The agent
PROPOSES candidates here (via `long_memory_suggest`, S2); the async `memory_manager` (S4) DECIDES
promote/supersede/merge/retain/reject/expire. This stage delivers ONLY the storage substrate:
table + repo CRUD + Zod boundary schema + enums (lockstep) + observability. No suggest handler
(S2), no worker (S1c/S4), no retrieval (S3).

Advisory-only doctrine (§6): nothing in this table ever feeds sizing/approval/wallet-intent.

---

## 1. Grounding (verified against repo, not memory)

- `knowledge_entries` (001:38-109) and `session_memories` (016) both use `embedding vector` (NO
  typmod) + `embedding_model TEXT` + `embedding_dim INTEGER` + named CHECKs
  `*_embedding_dim_range` / `*_embedding_dim_matches_vector`. pgvector wire format =
  `vectorLiteral(number[]) → "[a,b,c]"` cast `$N::vector`. Recall MUST filter `(embedding_model,
  embedding_dim)`.
- `embeddings/client.ts`: `embedDocument/embedQuery → { embedding: number[], providerModel: string }`.
  Caller stamps `providerModel` to `embedding_model` (audit truth). (Producer is S2; S1b stores only.)
- Repo convention (knowledge/, session-memories/, compact-jobs/): `types.ts` (Row + domain +
  `mapRow` + helpers), `crud.ts` (parameterized `$1..$N`, CTE for upsert `inserted` flag,
  executor = `client ?? getPool()`), `index.ts` barrel.
- `knowledge_entries.kind` is **open snake_case TEXT** (`isValidKind`: `^[a-z][a-z0-9_]{0,63}$`),
  NOT a CHECK enum (agent-defined taxonomy). → candidate `kind` follows the SAME rule.
- `source` vocab is owned by `memory/long-memory-source-policy.ts`
  (`observed|user_confirmed|inferred|hypothesis`, `isKnowledgeSource`). REUSE it; do not redefine.
- `computeContentHash({kind,title,summary,contentMd})` in `knowledge/content-hash.ts`
  (length-prefixed SHA256). REUSE for suggest-time dedupe (loop-prevention §6).
- FIX-1 anchors: `protocol_executions.id` / `protocol_capture_items.id` are SERIAL **but immutable**
  (`sync/replay.ts:46` TRUNCATEs only `proj_*`, never the protocol_* audit trail). `instrument_key` /
  `position_key` are TEXT semantic keys on `proj_*`. → evidence anchors reference protocol_* ids +
  semantic keys, NEVER `proj_*` SERIALs.
- `sessions.id` is TEXT. No `conversations` table → candidate has `session_id` only (no `conversation_id`).
- Agent role model = `parent|subagent` (`tools/registry/visibility.ts:34`).
- Migrate runner applies `version > MAX(schema_version)`; editing an applied file does NOT re-run →
  edit-in-place needs dev reset. Mirror `vex-app/resources/migrations/` is gitignored → regen via
  `node vex-app/scripts/copy-migrations.mjs`.

---

## 2. Proposed DDL (append to `001_initial.sql`, after knowledge_entries / protocol_* / sessions)

```sql
-- ============================================================
-- Memory v2 — candidate buffer (S1b). Long-memory write buffer.
-- Agent PROPOSES via long_memory_suggest (S2); async memory_manager (S4) DECIDES.
-- Advisory-only: never feeds sizing/approval/wallet-intent (§6).
-- ============================================================
CREATE TABLE memory_candidates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- pg18 core
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  proposed_by           TEXT NOT NULL DEFAULT 'parent',
  kind                  TEXT NOT NULL,            -- open snake_case (isValidKind), NOT enum
  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  content_md            TEXT NOT NULL DEFAULT '',
  entities              TEXT[] NOT NULL DEFAULT '{}',
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  source_refs           JSONB NOT NULL DEFAULT '{}',   -- general provenance (msg ids, transcript ptrs)
  -- FIX-1 immutable anchors: array of
  -- { executionId:int (REQUIRED), captureItemId?:int, instrumentKey?:text, positionKey?:text }
  evidence_refs         JSONB NOT NULL DEFAULT '[]',
  outcome               JSONB,                    -- system-derived (S5); null until resolved
  source                TEXT NOT NULL DEFAULT 'observed',   -- system-derived tier (REUSE KnowledgeSource)
  confidence            REAL,                     -- agent-supplied, clamped [0,1]
  importance            INTEGER NOT NULL DEFAULT 5,
  sensitivity           TEXT NOT NULL DEFAULT 'normal',
  evidence_strength     TEXT NOT NULL DEFAULT 'none',
  retrieval_visibility  TEXT NOT NULL DEFAULT 'not_consolidated',
  retrieval_until       TIMESTAMPTZ,              -- dual-trace TTL (§2 layer 5)
  status                TEXT NOT NULL DEFAULT 'pending',
  retain_until          TIMESTAMPTZ,              -- system TTL for the candidate row
  embedding             vector NOT NULL,          -- computed AFTER redaction (S2)
  embedding_model       TEXT NOT NULL,
  embedding_dim         INTEGER NOT NULL,
  content_hash          CHAR(64) NOT NULL,        -- computeContentHash → dedupe (loop-prevention §6)
  event_time                  TIMESTAMPTZ,        -- point-in-time (S5 lookahead gating)
  observed_at                 TIMESTAMPTZ,
  recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at_decision_time  TIMESTAMPTZ,        -- as-of boundary for no-lookahead deref
  promoted_knowledge_id INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,  -- SERIAL→INTEGER
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- value-range guards
  CONSTRAINT mc_embedding_dim_range        CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT mc_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim),
  CONSTRAINT mc_confidence_range           CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT mc_importance_range           CHECK (importance BETWEEN 1 AND 10),
  CONSTRAINT mc_evidence_refs_is_array     CHECK (jsonb_typeof(evidence_refs) = 'array'),
  CONSTRAINT mc_source_refs_is_object      CHECK (jsonb_typeof(source_refs) = 'object'),
  -- bounded-vocab enums (NAMED → lockstep-testable, mirror ke_*_valid pattern)
  CONSTRAINT mc_proposed_by_valid          CHECK (proposed_by IN ('parent','subagent')),
  CONSTRAINT mc_source_valid               CHECK (source IN ('observed','user_confirmed','inferred','hypothesis')),
  CONSTRAINT mc_sensitivity_valid          CHECK (sensitivity IN ('normal','sensitive')),
  CONSTRAINT mc_evidence_strength_valid    CHECK (evidence_strength IN ('none','weak','moderate','strong')),
  CONSTRAINT mc_retrieval_visibility_valid CHECK (retrieval_visibility IN ('not_consolidated','suppressed')),
  CONSTRAINT mc_status_valid               CHECK (status IN ('pending','promoted','superseded','merged','rejected','expired','retained'))
);
CREATE INDEX idx_mc_embedding_match ON memory_candidates(embedding_model, embedding_dim);
CREATE INDEX idx_mc_status_recorded ON memory_candidates(status, recorded_at);  -- worker polling (S4)
-- loop-prevention: one live (pending) candidate per content_hash
CREATE UNIQUE INDEX uniq_mc_pending_hash ON memory_candidates(content_hash) WHERE status = 'pending';
```

Notes:
- `gen_random_uuid()` is pg18 core (DB image = pgvector/pgvector:pg18). No extension needed.
- NO ANN (ivfflat/hnsw) index — brute-force cosine acceptable at this scale (matches siblings).
- Indexes on maturity/activation are a knowledge_entries concern (S3), not here.

---

## 3. Enums (lockstep: TS `as const` + `z.enum` + SQL named CHECK + parser test)

New file `src/vex-agent/memory/schema/memory-candidate-enums.ts` — `as const` tuples + `z.enum` for:
`CANDIDATE_PROPOSED_BY` (parent|subagent), `CANDIDATE_SENSITIVITY` (normal|sensitive),
`CANDIDATE_EVIDENCE_STRENGTH` (none|weak|moderate|strong),
`CANDIDATE_RETRIEVAL_VISIBILITY` (not_consolidated|suppressed),
`CANDIDATE_STATUS` (pending|promoted|superseded|merged|rejected|expired|retained).

`source` is NOT redefined here — reuse `KnowledgeSource` / its vocab from
`memory/long-memory-source-policy.ts` (add an exported `as const` tuple there if one isn't already
exported, so the candidate `mc_source_valid` CHECK can be lockstep-tested against the same TS source).

`kind` is NOT an enum — validated by the shared `isValidKind` regex at the Zod boundary (S2).

New test `src/__tests__/vex-agent/memory/schema/memory-candidate-enums.test.ts`: parse the `mc_*_valid`
named CHECKs from `001_initial.sql`, assert each `IN (...)` set == TS `as const` == `z.enum().options`.
Mirror the existing `long-memory-enums.test.ts` regex approach. Doctrine assertion: `source` set
excludes nothing new; influence vocab is NOT present on candidates (those live on knowledge_entries).

---

## 4. Zod boundary schema (FIX-1)

New file `src/vex-agent/memory/schema/memory-candidate.ts`:
- `evidenceAnchorSchema` = `z.object({ executionId: z.number().int().positive(), captureItemId:
  z.number().int().positive().optional(), instrumentKey: z.string().min(1).max(256).optional(),
  positionKey: z.string().min(1).max(256).optional() }).strict()`.
- `evidenceRefsSchema = z.array(evidenceAnchorSchema)` (bounded length, e.g. `.max(32)`).
- **`sourceRefsSchema` (MF3 — strict, pointer-only).** `source_refs` is general provenance and S2
  makes it agent-adjacent input, so it MUST be a strict, bounded, pointer-only schema — NOT a loose
  bag (`z.record(z.unknown())` is forbidden). Shape: `z.object({ messageIds:
  z.array(z.number().int().positive()).max(64).optional(), toolCallIds:
  z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)).max(64).optional() }).strict()`. SYSTEM-
  captured at the S2 suggest boundary from the current session (recent message / tool-call refs); the
  agent never supplies free-form provenance text. Tests reject free-text, extra keys, non-pointer.
- `candidateSuggestInputSchema` (the shape `long_memory_suggest` will validate in S2, defined now so
  the repo input type derives from it): kind (isValidKind regex), title/summary (bounded length),
  contentMd, entities/tags (bounded arrays), sourceRefs (sourceRefsSchema), evidenceRefs
  (evidenceRefsSchema), confidence (0..1),
  importance (1..10), point-in-time fields. Derive `InsertCandidateInput` via `z.infer` where useful;
  repo-only/system-set fields (embedding, source tier, status, content_hash) are NOT in the agent
  input schema — they are set by the suggest boundary / repo, not the agent (§6: manager doesn't
  trust agent `source`).

This stage defines+tests the schema; S2 wires it into the handler.

---

## 5. Repo

`src/vex-agent/db/repos/memory-candidates/`:
- `types.ts` — `MemoryCandidateRow` (snake_case DB shape), `MemoryCandidate` (camelCase domain),
  `mapRow(row): MemoryCandidate`, local `vectorLiteral`/`toIsoOrNull` (kept local to avoid cyclic
  import, per knowledge-lifecycle precedent), `InsertCandidateInput`, `CandidateStatus` re-export.
- `crud.ts`:
  - `insertCandidate(input, client?) → { candidate, inserted }` — parameterized INSERT, `embedding`
    via `$N::vector`, `evidence_refs`/`source_refs` via `$N::jsonb`. **MF1 — concurrency-safe upsert**
    (NOT the racy `DO NOTHING + CTE UNION`): adopt the proven pattern from
    `session-memories/create.ts:68-94` —
    `ON CONFLICT (content_hash) WHERE status = 'pending' DO UPDATE SET updated_at =
    memory_candidates.updated_at RETURNING *, (xmax = 0) AS inserted`. The no-op `DO UPDATE` reliably
    returns the row on both insert and conflict paths; `(xmax = 0)` distinguishes fresh insert
    (`inserted=true`) from conflict-merged (`inserted=false`) without a fallback SELECT race. Validate
    `embedding.length === embeddingDim` before SQL (mirror create.ts:51). Throw if upsert returns no
    row.
  - `getCandidateById(id, client?) → MemoryCandidate | null`.
  - `updateCandidateStatus(id, toStatus, patch, client?)` — owner/precondition-checked transition;
    sets `promoted_knowledge_id` when toStatus='promoted', `updated_at=NOW()`; returns updated row.
  - `listCandidatesByStatus(status, limit, client?)` — for inspection (S10) + worker polling seed.
- `index.ts` — barrel (controlled public surface).

All exported fns: explicit return types (rules/20 §3). External input already validated upstream
(Zod) — repo operates on trusted typed `InsertCandidateInput`.

---

## 6. Observability (first real consumer of the S0 logger primitive)

Wire `memLog` (from `memory/observability/logger.ts`) into the candidate repo. The S0 allowlist
(`MemoryLogMeta` / `META_KEY_CATEGORY`, logger.ts:131-186) ALREADY carries every key we need EXCEPT
one — use existing keys; add exactly one new key.
- `memLog("candidate","inserted",{ candidateId, sessionId, kind, status, embeddingModel,
  embeddingDim, count: <evidenceAnchorCount>, insertResult })`
- `memLog("candidate","status_changed",{ candidateId, statusFrom, statusTo, promotedKnowledgeId })`

Key mapping (verified against logger.ts):
- `candidateId`/`sessionId`/`embeddingModel`/`promotedKnowledgeId` → existing `id` category.
- `status`/`statusFrom`/`statusTo` → existing `enum`.
- `kind` → existing `enum` (N1): candidate `kind` is snake_case ≤64, which satisfies the enum shape
  gate `^[A-Za-z][A-Za-z0-9_]*$` & ≤64. Do NOT add an id-category for it.
- `embeddingDim` → existing `num`; `evidenceAnchorCount` → reuse existing generic `count` (`num`).
- **MF2 — `inserted` is a BOOLEAN; the S0 logger structurally rejects booleans (string|number only,
  logger.ts:38,131).** Log `insertResult: "inserted" | "duplicate"` instead, and add EXACTLY ONE new
  allowlist key: `insertResult` → `enum` (extend `MemoryLogMeta` + `META_KEY_CATEGORY`). Do NOT add
  boolean support.

Deliberately NOT logged in S1b (would need further allowlist extension; defer to the stage that
needs them): `source`, `sensitivity`, `evidenceStrength`, `retrievalVisibility`, `importance`. Keep
the S0 primitive change minimal (one key).

NEVER log raw title/summary/content/secrets. Extend the existing logger guard test to cover
`insertResult` (passes) + a raw/oversized value on it (dropped).

---

## 7. Edits / Creates / Deletes

Creates:
- `src/vex-agent/memory/schema/memory-candidate-enums.ts`
- `src/vex-agent/memory/schema/memory-candidate.ts` (Zod boundary)
- `src/vex-agent/db/repos/memory-candidates/{types.ts,crud.ts,index.ts}`
- `src/__tests__/vex-agent/memory/schema/memory-candidate-enums.test.ts`
- `src/__tests__/vex-agent/db/repos/memory-candidates/crud.test.ts` (repo CRUD + CHECK rejects + dedupe)
- `src/__tests__/vex-agent/memory/schema/memory-candidate.test.ts` (Zod: evidence-refs accept valid
  anchors / reject missing executionId / extra keys / proj_*-style payloads; **sourceRefs accept
  pointer-only / reject free-text + extra keys + non-pointer** — MF3)

Edits:
- `src/vex-agent/db/migrations/001_initial.sql` — append `memory_candidates` DDL (§2).
- `src/vex-agent/memory/long-memory-source-policy.ts` — harden the source vocab to a tuple-derived
  `as const` source-of-truth (N2): if `KNOWLEDGE_SOURCES` is currently `readonly KnowledgeSource[]`,
  make it an `as const` tuple + derive `KnowledgeSource` + a `z.enum` from it, so candidate
  `mc_source_valid` SQL CHECK ↔ TS ↔ Zod can lockstep against one source. No behavior change.
- `src/vex-agent/memory/observability/logger.ts` — add EXACTLY ONE key: `insertResult` → `enum`
  (extend `MemoryLogMeta` type + `META_KEY_CATEGORY`). MF2 (§6). No boolean support.
- Mirror: `node vex-app/scripts/copy-migrations.mjs` (gitignored output; not committed).

Deletes: none.

---

## 8. Tests / Done-when

- `pnpm exec tsc --noEmit` clean.
- `memory-candidate-enums.test.ts` green (SQL CHECK ↔ TS ↔ Zod lockstep, all 5 candidate enums +
  source reuse).
- `memory-candidate.test.ts` green (evidence-refs Zod accept/reject).
- `crud.test.ts` green on a real pgvector container: insert→get→mapRow fidelity (all columns incl.
  evidence_refs/source_refs/point-in-time/uuid); status transition sets promoted_knowledge_id; named
  CHECKs reject bad enum/dim/importance/confidence/array-shape; serial dedupe (2nd pending insert of
  same hash → `inserted=false`, returns the existing row); **MF1 concurrency test: two parallel
  `insertCandidate` of the same content_hash → exactly one `inserted=true`, one `inserted=false`, one
  row total** (proves the `xmax=0` upsert is race-safe, mirrors the create.ts P2.2 fix); FK to
  sessions enforced (evidence deref is S5, not tested here).
- logger guard test extended (`insertResult` passes; a raw/oversized value on it is dropped).
- Fresh dev DB migrates clean (001 with new table); `vex-app/resources/migrations` synced to src.

---

## 9. DECISIONS TO RATIFY (Codex gate)

- **D1 Migration placement.** Append to `001_initial.sql` (edit-in-place; owner directive "edit not
  create / minimum files"; S1a precedent; all FK deps already in 001) vs a new `032_memory_v2.sql`.
  Recommend: 001.
- **D2 id type.** UUID `gen_random_uuid()` per parent plan §8 (decisions/IPC reference candidates;
  S1c memory_decisions FKs to it) vs SERIAL like siblings. Recommend: UUID.
- **D3 kind.** Open snake_case TEXT via `isValidKind` (consistency with knowledge_entries), NOT a
  CHECK enum — deviates from the handoff's "kind enum" bullet. Recommend: open.
- **D4 forward-looking enum vocabs.** `sensitivity` (normal|sensitive), `evidence_strength`
  (none|weak|moderate|strong), `retrieval_visibility` (not_consolidated|suppressed) are consumed at
  S2/S3/S4/S5. Provisional now; edit-in-place + dev reset makes refinement cheap. Are these the right
  bounded sets, or should any be widened/renamed before they calcify?
- **D5 evidence_refs model.** JSONB array + Zod (matches source_refs JSONB precedent; candidate is
  transient; deref-by-id in manager S5) vs a normalized `memory_candidate_evidence` child table.
  Recommend: JSONB array.
- **D6 FK delete semantics.** `session_id` ON DELETE CASCADE (match session_memories);
  `promoted_knowledge_id` ON DELETE SET NULL. Confirm.
- **D7 logger coupling.** Wire `memLog` into the repo now (first consumer, per S0 plan) + extend the
  allowlist. Confirm scope (touches the S0 primitive).
- **D8 NOT NULL embedding with no producer until S2.** Tests use a synthetic vector; same posture as
  knowledge_entries pre-writer. Confirm acceptable.
- **D9 dedupe seam.** `uniq_mc_pending_hash` partial unique (DB-enforced loop-prevention while
  pending) vs leaving dedupe to the S2 handler. Recommend: DB partial unique now. (Note: partial
  unique only blocks duplicate *pending*; full loop-prevention vs already-promoted/rejected hashes is
  an S2 application check — out of scope here.)

---

## 10. GATE ROUND 1 — Codex BLOCKED resolutions (2026-06-08, session harness-memory-s1b)

Codex round 1 ratified D1–D9 (no objection to placement/UUID/open-kind/enum-vocabs/JSONB-evidence/FK/
NOT NULL embedding/dedupe-seam) and confirmed FIX-1 + FIX-4 direction. Three must-fixes, all folded in:

- **MF1 (resolved §5 + §8).** Racy `DO NOTHING + CTE UNION` → concurrency-safe `ON CONFLICT
  (content_hash) WHERE status='pending' DO UPDATE SET updated_at = memory_candidates.updated_at
  RETURNING *, (xmax=0) AS inserted` (proven in `session-memories/create.ts:68-94`, audit P2.2). Added
  a two-parallel-insert race test.
- **MF2 (resolved §6 + §7).** `inserted` bool is rejected by the S0 logger (string|number only). Log
  `insertResult: "inserted"|"duplicate"` and add exactly one allowlist key `insertResult:"enum"`.
  Other classification fields not logged in S1b (keep S0 change minimal). `kind` uses the existing
  `enum` category (N1).
- **MF3 (resolved §4 + §7-tests).** `source_refs` gets a strict, bounded, pointer-only
  `sourceRefsSchema` (messageIds/toolCallIds, `.strict()`), system-captured at S2 — no loose bag.
  Tests reject free-text / extra keys / non-pointer.
- Nits: N1 `kind` logged as `enum` ✓; N2 harden `KNOWLEDGE_SOURCES` to tuple-derived `as const` for
  source lockstep ✓; N3 FIX-1/FIX-4 confirmed ✓.
