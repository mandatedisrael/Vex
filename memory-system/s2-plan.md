# S2 — Redaction boundary + `long_memory_suggest` (detailed stage spec)

Parent plan: `memory-system/memory-system-v2.md` §9 S2 (+ §2 write-path, §3 FIX-3/FIX-4, §6 security). Genesis: `memory-system/memory-system.md` §161 (candidates), §240-245 (TTL), §247-272 (dual-trace), §400-438 (write path), §593-617 (privacy), §949 (closed decisions). Tool-writing: Anthropic "Writing tools for agents".
Status: DRAFT → Codex gate (`harness-memory-s2`) → Opus implement → independent verify → final impl-gate.
Strategy: ADDITIVE — `long_memory_suggest` is NEW; the old `knowledge_write` stays agent-visible until the S9 cutover. S2 is the FIRST stage to register an agent-facing tool in the v2 system.

## 0. Owner-ratified decisions (2026-06-08) + scope

**Goal:** the agent's ONLY write-door into long-term memory. `long_memory_suggest` → validate → **redact** → **live-state reject** → dedupe → **embed-after-redaction** → `insertCandidate` (S1b) → `enqueueConsolidateJob` (S1c). S2 only WRITES a candidate + enqueues a job. Retrieval (dual-trace reading) = **S3**; the manager/worker that consolidates = **S4**. Neither exists yet, so S2 stamps only deterministic, safe values and defers nuance to the stages that consume them.

Four decisions were finalized (owner delegated the call, guiding principle: **the agent must learn from real trades over time** — so trade lessons must NOT be suppressed). Codex consulted (`harness-memory-s2`, thread `019ea812-…`):

- **D-A — reject policy (+ steered, + advertised).** `redact()` first; if `hardRedactCount > 0` (a real secret) → **reject** with a steering error (no row written). Then `scanLiveState()` on the redacted aggregate; if `rejected` (liveFraction ≥ `EXCLUSION_REJECT_THRESHOLD = 0.30`) → **reject** with a steering error. Tier-2 address **masks are kept** (store masked). A reject writes NO candidate row — only a `memLog` line (`rejectReason` enum + counts). The reject policy is stated **lightly in the system prompt + the tool `description`** (Anthropic "steering errors" + good docstring) so the agent rarely trips it.
- **D-B — source tier = floor.** Every accepted candidate gets `source = 'hypothesis'` and `evidenceStrength = 'none'`. Rationale: §6 — the manager (S4) owns the authoritative tier and derives it from the transcript; §949 — `inferred`/`hypothesis` never enter hot context, so a `hypothesis` floor cannot poison anything; ref-presence is not evidence until S4/S5 dereferences it (deriving now = "fake authority", Codex). S4 re-derives later.
- **D-C — visibility + TTLs.** `retrievalVisibility = 'not_consolidated'` (the row literally IS unconsolidated; HOW to surface/weight it is S3's job — do NOT signal-gate at S2). `retrievalUntil = recordedAt + CANDIDATE_DUAL_TRACE_TTL_DAYS (=7)` — a bounded dual-trace upper limit (genesis §240). `retainUntil = NULL` — candidate retention is an OPEN decision (OD-4 / genesis §940#4); don't invent a number a later decision owns. *Forward-note to S3 (Codex): `not_consolidated` alone is NOT "return this" — S3 must still filter by signal and apply low/advisory weight (genesis §262-266).*
- **D-D — sensitivity = `sensitive` ⇔ `maskCount > 0`, else `normal`** (owner's learning-optimized call; overrides Codex's broader `|| evidenceRefs.length>0 || liveStateMatches>0`). Rationale: Tier-1 redact already stripped secrets and the ≥30% live-state reject already blocked transient-value dumps, so the only residual in-text privacy marker is a masked wallet/tx address. Including `evidenceRefs`/`liveStateMatches` would mark essentially every real trade lesson `sensitive` and suppress exactly what the agent must learn from. S4's LLM re-classifies with full context.

Advisory-only doctrine holds: a candidate never feeds sizing/approval/wallet-intent.

## 1. Grounding (verified — 5-agent recon `wf_d06f2ad7-0f6`)

Reuse (all exist, S0–S1d done):
- **Redaction** `src/vex-agent/memory/redaction.ts` → re-exports `redact(text) → { text, hardRedactCount, maskCount }` + `redactObject` from `src/lib/diagnostics/text-redaction.ts`. Tier-1 hard-redact (BIP39/private-key/API-key/JWT → `[REDACTED:class]`); Tier-2 mask (EVM/Solana addr, tx hash → `0xabc…123`).
- **Live-state** `src/vex-agent/memory/exclusion-rules.ts` → `scanLiveState(text) → { rejected, liveFraction, liveStateMatches, categories, … }`; `EXCLUSION_REJECT_THRESHOLD = 0.30` (`session-memory-policy.ts`). Patterns: balance_amount/fiat_price/gas_amount/slippage_pct/chain_height/pending_tx/literal_state/now_timestamp.
- **Suggest input** `src/vex-agent/memory/schema/memory-candidate.ts` `candidateSuggestInputSchema` (`.strict()`): agent supplies `kind`/`title`/`summary` (req) + optional `contentMd`/`entities`/`tags`/`sourceRefs`/`evidenceRefs`/`confidence`/`importance`/`eventTime`/`observedAt`. `evidenceAnchorSchema` (FIX-1: executionId req + optional captureItemId/instrumentKey/positionKey), `sourceRefsSchema` (pointer-only messageIds/toolCallIds).
- **Repo** `db/repos/memory-candidates` `insertCandidate(InsertCandidateInput) → { candidate, inserted }` (xmax upsert on `uniq_mc_pending_hash WHERE status='pending'`; fast-fails on `embedding.length !== embeddingDim`). `db/repos/memory-jobs` `enqueueConsolidateJob() → MemoryJob` (plain insert). **NEW (S2 adds):** `findLatestCandidateByContentHash(hash, client?) → MemoryCandidate | null` (loop-prevention beyond pending).
- **Embed** `src/vex-agent/embeddings/client.ts` `embedDocument(title, summary, config?) → { embedding, providerModel }` (fail-loud; 30s timeout, 2 retries). `embeddings/config.ts` `loadEmbeddingConfig()`. Stamp `embeddingModel = providerModel`, `embeddingDim = embedding.length` (honest provenance — mirror `knowledge/write.ts:154-155`).
- **Hash** `src/vex-agent/knowledge/content-hash.ts` `computeContentHash({kind,title,summary,contentMd}) → 64-hex` (length-prefixed SHA256).
- **Tool infra** ToolDef shape (`tools/registry/types.ts` + `tools/registry/memory.ts`): `{ name, kind:"internal", mutating, pressureSafety, actionKind, visibility, description, parameters }`. Handler `(params: Record<string,unknown>, ctx: InternalToolContext) → Promise<ToolResult>`; `ok(data)` / `fail(msg)` (`tools/internal/types.ts`) — **`fail(msg)` IS the steering channel** (agent sees `output`). `InternalToolContext` carries `sessionId`, `role` (`parent|subagent`), `sessionKind`, `contextUsageBand`, `sourceSurface/sourceSession` — NO correlationId/toolCallId (memLog uses `sessionId`/`candidateId`). Registration is a **triple-point**: ToolDef → `INTERNAL_TOOL_LOADERS` → `TOOL_MAP_CATEGORIES`, with the dispatcher mapping name→handler; `registry-completeness` + tool-map-consistency tests enforce it (mirror `knowledge/write.ts`).
- **memLog** allowlist already has `candidateId/sessionId/kind/status/rejectReason/insertResult/redactionCount/count/errorCode/errorKind/jobId` — enough for S2 (no new keys expected; confirm `redactionCount` exists, else add).

Closed/locked context: §949 — `inferred|hypothesis` never hot; memory-poisoning is a security decision. FIX-3 — manager ops are internal funcs, but `long_memory_suggest` IS agent-facing. FIX-4 — redaction is structural at the boundary, embedding computed AFTER redaction.

## 2. Handler flow (`tools/internal/long-memory/suggest.ts`)

Ordered, fail-loud, deterministic core + IO at edges:
1. **Read + map + validate.** Tool params are snake_case (repo convention — `content_md`/`source_refs`/`evidence_refs`/`event_time`/`observed_at`/`response_format`, mirror `knowledge/write.ts`); read via `str`/`num`/`readStringArray`/`readObject` accessors and MAP snake→camel to the `candidateSuggestInputSchema` shape (camelCase + `.strict()`), then `safeParse(mapped)`. `response_format` is a TOOL-ONLY param (concise|detailed), read separately — NOT part of the candidate schema (it's not a candidate field). On parse failure → `fail(<readable message: which field, what's allowed>)`.
2. **Redact EVERY persisted free-text field** (R1 gate — secrets must not survive in any stored string). `redact()` each of `title`, `summary`, `contentMd`, and every element of `entities[]` and `tags[]`. Aggregate `hardRedactCount` + `maskCount` across ALL of them. If `hardRedactCount > 0` (a real secret ANYWHERE) → `memLog("suggest","rejected",{rejectReason:"secret_or_live_state", sessionId})` + `fail("A secret (key/seed/token) was detected and memory never stores secrets. Remove it and re-suggest the durable lesson only.")`. **No row.** `sourceRefs`/`evidenceRefs` are pointer/id-only by schema — but `sourceRefs.toolCallIds` AND `evidenceRefs.instrumentKey`/`positionKey` are bounded STRINGS that can pass the schema regex while carrying a credential-shaped token (R2 gate), so hard-SCAN EVERY such persisted string for Tier-1 secrets and reject on any hit; do NOT mask pointer/key fields (FIX-1 anchors must stay intact for dereference). **Net rule:** hard-redact-and-mask free-text fields (title/summary/contentMd/entities/tags); hard-SCAN-reject-only the pointer/key strings; a Tier-1 hit ANYWHERE → reject.
3. **Live-state reject**: `scanLiveState(redactedTitle + "\n" + redactedSummary + "\n" + redactedContentMd)`. If `rejected` → `memLog(... rejectReason:"secret_or_live_state")` + `fail("This reads as live state (balances/prices/amounts), which goes stale. Record the durable LESSON, not the live values.")`. **No row.**
4. **content_hash** = `computeContentHash({ kind, title: redacted, summary: redacted, contentMd: redacted })`.
5. **Loop-prevention** (genesis §123) — check BOTH stores (R1 gate: `knowledge_write` stays live until S9, so the lesson may already be promoted): (a) `knowledgeRepo.findByContentHash(hash)` — if the exact redacted content is already in `knowledge_entries`, it's already long-term memory → `ok({ status:'already_known', duplicate:true })`, no insert/enqueue. (b) `findLatestCandidateByContentHash(hash)` — if found AND `status !== 'pending'` (promoted/rejected/superseded/merged/expired/retained) → `memLog("suggest","duplicate",{candidateId, status})` + `ok({ candidateId, status, duplicate:true })`, no insert/enqueue. A `pending` match is handled by `insertCandidate`'s upsert (`inserted:false`). (Hashes are computed identically; a knowledge entry written with unredacted secrets simply won't match our redacted hash — correct, we then stage the clean candidate.)
6. **Embed-after-redaction**: `loadEmbeddingConfig()` then `embedDocument(redactedTitle, redactedSummary, config)`. Fail-loud → `fail("embedding service unavailable: …")` (NO non-embedded fallback — mirror `knowledge/write.ts`).
7. **Derive system fields** (pure — `memory/long-memory-suggest-policy.ts`): `source='hypothesis'`, `evidenceStrength='none'`, `sensitivity = maskCount > 0 ? 'sensitive' : 'normal'`, `retrievalVisibility='not_consolidated'`, `retrievalUntil = recordedAt + 7d`, `retainUntil=null`, `proposedBy = ctx.role`, `availableAtDecisionTime = null` (S5 owns). `importance` = agent value (default 5); `confidence` = agent value (or null). **Convert** the agent's `eventTime`/`observedAt` from ISO strings → `Date | null` (R1 gate: the schema yields ISO strings; `InsertCandidateInput` requires `Date | null`).
8. **Insert + enqueue ATOMICALLY** (R2 gate — never write a candidate without a wake, and always wake a pending one): `withTransaction(async tx => { const { candidate, inserted } = await insertCandidate({ sessionId: ctx.sessionId, …redacted text…, source, sensitivity, evidenceStrength, retrievalVisibility, retrievalUntil, retainUntil, embedding, embeddingModel: providerModel, embeddingDim: embedding.length, contentHash, … }, tx); await enqueueConsolidateJob(tx); return { candidate, inserted }; })`. Enqueue runs for BOTH `inserted:true` AND `inserted:false` — a pending-hash conflict still left a pending candidate that needs consolidation; skipping the wake could strand it if its original job already ran. (The terminal-duplicate (step 5b) and already-known (step 5a) cases short-circuited earlier and never reach here.) `memLog("suggest","accepted",{ candidateId, kind, redactionCount: hardRedactCount+maskCount, insertResult })` — ONLY allowlisted keys (R1 gate: NOT `sensitivity` — the logger has no such key and S2 adds none).
9. **Return** per `response_format` (Anthropic concise/detailed):
    - `concise` (default): `ok({ candidateId, status: 'pending', duplicate: !inserted })`.
    - `detailed`: `+ { source, sensitivity, retrievalUntil, redactions: { hard: hardRedactCount, masked: maskCount } }`.

## 3. ToolDef (`tools/registry/long-memory.ts` — Anthropic principles)

```
name: "long_memory_suggest"      // namespaced: long_memory_* (vs session memory_*, vs knowledge_*)
kind: "internal"
mutating: false                  // R1 gate: a LOCAL candidate write, NOT an approval-gated external mutation. mutating:true would wrongly trigger approval in restricted sessions (dispatcher/protocol-route.ts); knowledge local-writes use mutating:false.
pressureSafety: "mutating"       // still blocked at barrier/critical (don't suggest while compaction is urgent) — mirrors knowledge.ts:15
actionKind: "local_write"        // mirror knowledge_write
visibility: {}                    // always visible to parent AND subagent (candidates.proposed_by supports both)
description: <as-for-a-new-hire>  // see below
parameters: { type:"object", properties:{ kind,title,summary,content_md,entities,tags,source_refs,evidence_refs,confidence,importance,event_time,observed_at,response_format }, required:["kind","title","summary"], additionalProperties:false }
// NOTE (R1 gate): tool params are snake_case (repo convention — knowledge_write/memory_recall). The handler reads them via accessors and maps snake→camel for candidateSuggestInputSchema (camelCase + .strict()). response_format is tool-only, not a candidate field.
```

Description (high-signal, steers usage; reject policy advertised here per D-A):
- WHAT: "Propose a durable, cross-session LESSON for long-term memory — a trading insight, a strategy/risk lesson, a stable user preference, a project fact or constraint. Write title+summary in English."
- HOW IT WORKS: "This does NOT write memory directly. It stages a candidate; an async manager reviews, dedupes, and decides whether to promote it. You'll get back a candidateId, not a stored memory."
- DO NOT (steering, so the agent rarely hits a reject): "Never include secrets (keys/seeds/tokens) — they're rejected. Don't record live values (current balances/prices/amounts) — memory is for the durable lesson, not the snapshot. Wallet/tx addresses are auto-masked."
- EVIDENCE: "Attach evidence_refs (protocol execution / capture ids) when the lesson came from a real trade — it makes the lesson far stronger downstream."
- response_format: "concise (default) returns the candidate id + status; detailed adds redaction counts, derived source tier, and the dual-trace window."

## 4. New files / edits

**Create:**
- `src/vex-agent/tools/internal/long-memory/suggest.ts` — the handler (§2).
- `src/vex-agent/tools/registry/long-memory.ts` — `LONG_MEMORY_TOOLS` ToolDef (§3).
- `src/vex-agent/memory/long-memory-suggest-policy.ts` — `CANDIDATE_DUAL_TRACE_TTL_DAYS = 7`, `deriveCandidateSource() → 'hypothesis'`, `deriveCandidateSensitivity(maskCount) → 'sensitive'|'normal'`, `computeRetrievalUntil(recordedAt) → Date`, `SUGGEST_REJECT_REASONS` (bounded enum: `secret_or_live_state`). Pure, unit-tested.
- Tests (see §6).

**Edit (additive, no behavior change to old paths):**
- `db/repos/memory-candidates/{crud,index}.ts` — add `findLatestCandidateByContentHash`.
- Registry aggregation index (where `MEMORY_TOOLS` etc. are combined) — include `LONG_MEMORY_TOOLS`.
- `INTERNAL_TOOL_LOADERS` — map `long_memory_suggest` → handler (dynamic import).
- `TOOL_MAP_CATEGORIES` — add `long_memory_suggest` under a "Long-term memory" category (new, parallel to "Session memory").
- Dispatcher name→handler wire (if not automatic via loaders).
- System prompt (`engine/prompts/tool-usage.ts` or the tool catalog) — ONE concise line: "Use `long_memory_suggest` to remember durable lessons; never put secrets or live values in memory." (Lightweight, per D-A; full guidance is in the tool description.)

## 5. Reuse-not-new + boundaries

- Reuse `redact`/`scanLiveState`/`computeContentHash`/`embedDocument`/`insertCandidate`/`enqueueConsolidateJob` as-is. No new redactor (FIX-4 boundary uses the canonical one).
- Anti-corruption (§4): ToolDef in `tools/registry`, handler in `tools/internal/long-memory`, business logic (policy + schema + redaction) in the `memory` module. Handler imports the memory module + repos — never the renderer/wallet/signing.
- `knowledge_write` is NOT touched (stays until S9). No adapter, no dual-write.

## 6. Tests (self-documenting names — no gate-codes)

- **Policy unit** (`memory/long-memory-suggest-policy.test.ts`): source is always 'hypothesis'; sensitivity flips on maskCount>0; retrievalUntil = recordedAt + 7d; retainUntil null.
- **Handler unit** (`tools/internal/long-memory/suggest.test.ts`, mock repo+embed): valid input → accepted candidate + enqueue; a hard secret in summary → rejected with a steering message, no insert; ≥30% live-state → rejected, no insert; a wallet address → stored masked + sensitivity 'sensitive'; embedding outage → fail, no insert; already-promoted content_hash → duplicate ok, no insert/enqueue; concise vs detailed output shape; Zod validation failure → steering message.
- **Repo integration** (real pgvector, temp-harness): `findLatestCandidateByContentHash` returns the latest across statuses; a promoted hash blocks re-suggest.
- **Registry** (reuse existing suites): registry-completeness (ToolDef ↔ loader), tool-map consistency (`long_memory_suggest` rendered), `knowledge_write` unaffected, dispatcher happy-path.
- **Verify:** `pnpm exec tsc --noEmit`; targeted `pnpm exec vitest run <paths>`; integration on real pgvector via throwaway temp-harness (no embeddings probe — the handler unit tests mock embed; the repo integration test needs only DB). mirror N/A (no migration change unless `findLatestCandidateByContentHash` needs none — it doesn't).

## 7. Scope split

| Concern | S2 | Deferred |
|---|---|---|
| `long_memory_suggest` ToolDef + handler + registration | ✅ | |
| Redaction + live-state reject + steering errors at the boundary | ✅ | |
| Deterministic system fields (source floor, sensitivity, visibility, dual-trace TTL) | ✅ | authoritative source/sensitivity re-derivation → **S4** |
| Loop-prevention dedupe (pending + terminal by hash) | ✅ | |
| Embed-after-redaction + insertCandidate + enqueue | ✅ | |
| Reading dual-trace candidates / ranking / weighting | | **S3** (`long_memory_search`) |
| The manager that consolidates/promotes | | **S4** |
| `retainUntil` retention policy | NULL | **OD-4** |
| Removing old `knowledge_write` from the agent surface | | **S9** cutover |

## 8. Decisions to ratify (gate)

- D-A reject ordering (redact → reject-secret → scan-redacted → reject-livestate → mask-keep; reject = log only, no row).
- D-B `source='hypothesis'` + `evidenceStrength='none'` floor.
- D-C `not_consolidated` + `retrievalUntil=+7d` (named const) + `retainUntil=NULL`.
- D-D `sensitive ⇔ maskCount>0` (learning-optimized; narrower than Codex).
- Loop-prevention needs the new `findLatestCandidateByContentHash` (terminal-status check beyond `uniq_mc_pending_hash`).
- ToolDef: `mutating`/`pressureSafety:"mutating"`, visible to parent+subagent, namespaced `long_memory_*`, concise/detailed `response_format`.
- Additive: `knowledge_write` stays until S9.

## 9. Gate rounds (`harness-memory-s2`)

- **R1 (BLOCKED → fixed):** (1) tool params are snake_case but `candidateSuggestInputSchema` is camelCase `.strict()` + `response_format` is tool-only → handler maps snake→camel, parses, handles `response_format` separately. (2) redaction must cover EVERY persisted free-text field (`entities`/`tags`, not just title/summary/contentMd) — secrets could survive otherwise; refs hard-scanned not masked. (3) `mutating:true` wrongly triggers approval in restricted sessions → `mutating:false` + keep `pressureSafety:"mutating"` (knowledge.ts precedent). (4) loop-prevention must also short-circuit on `knowledgeRepo.findByContentHash` (old `knowledge_write` lives until S9). (5) `sensitivity` is not a memLog-allowlisted key → dropped from the log meta. (6) `eventTime`/`observedAt` ISO strings → convert to `Date|null` for `InsertCandidateInput`.
- **R2 (BLOCKED → fixed):** (1) `sourceRefs.toolCallIds` (bounded strings) were unscanned — hard-scan EVERY persisted string (incl. toolCallIds + instrumentKey/positionKey), reject-only, no mask. (2) insert + enqueue must be ONE `withTransaction` (both fns take a tx client) and enqueue must run even on `inserted:false` — otherwise an orphaned candidate (no job) or a stranded pending duplicate.

## 10. Status

DONE (pending commit) — plan gate GREEN (R3, after R1/R2) + impl gate GREEN (after R1: `kind` Tier-1 scan + live-state over entities/tags). Verified: tsc clean; 130 non-DB tests (+2 regression); 5/5 repo integration on real pgvector. `harness-memory-s2` thread `019ea812-…`. Retrieval (S3) + manager (S4) consume the staged candidates. Old `knowledge_write` removed at S9.
