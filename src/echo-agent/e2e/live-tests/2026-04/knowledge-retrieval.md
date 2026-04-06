# Knowledge Retrieval E2E — Hybrid Memory Layer

> Live MCP E2E test for the new `knowledge_*` toolset (write → recall → get → recall_overflow).
> No real-money trades — this exercises the local DB + Docker Model Runner only.
> DB: Docker Postgres (pgvector) on port 5777 (tmpfs, ephemeral); embeddings via Docker Model Runner on port 12434

---

## Test Environment

- **MCP Server**: `pnpm exec tsx src/echo-agent/e2e/mcp/server.ts` (via `.mcp.e2e.json`)
- **DB**: `docker/echo-agent/docker-compose.e2e.yml` — `pgvector/pgvector:0.8.2-pg18-trixie`, ephemeral tmpfs on port 5777
- **Embeddings**: Docker Model Runner with `ai/embeddinggemma:300M-Q8_0` (pinned tag, llama.cpp Q8_0, 768 dim, ~307MB image, no `HF_TOKEN`)
- **Endpoint**: `POST http://localhost:12434/engines/llama.cpp/v1/embeddings`
- **Migrations applied**: 001_initial (now includes `CREATE EXTENSION vector` + `knowledge_entries`), 002–005

---

## Preflight

### P.1 Bring up the stack

```bash
make e2e-up
```

**Expected**: `echo-agent-db` healthy on `localhost:5777`, Docker Model Runner pulls `ai/embeddinggemma:300M-Q8_0` on first run (~30 s cold pull from Docker Hub, image ~307 MB), subsequent runs use the cached image.

Verify both lanes:

```bash
docker model status                    # Model Runner active
docker model list | grep embeddinggemma # ai/embeddinggemma:300M-Q8_0 present
psql -h localhost -p 5777 -U echo_agent -d echo_agent_test -c "\dx"  # vector extension present
psql -h localhost -p 5777 -U echo_agent -d echo_agent_test -c "\dt knowledge_entries"  # table present
```

### P.2 Sidecar smoke

```bash
make e2e-smoke
```

**Expected**: `OK: dim=768`. If anything else, abort — model is wrong or runner not active.

### P.3 Connect Claude Code via MCP

```bash
cp .mcp.e2e.json.example .mcp.e2e.json
claude --strict-mcp-config --mcp-config .mcp.e2e.json
```

The MCP server runs migrations on startup (including the new `knowledge_entries` table from baseline 001).

---

## 1. Write path — `knowledge_write`

Goal: write 12 entries with three different kinds and confirm embedding-on-write.

### 1.1 First entry — agent invents a new kind

```
echo_internal {
  tool: "knowledge_write",
  params: {
    kind: "pumpfun_entry_pattern",
    title: "low-holder pump entry",
    summary: "Tokens with under 50 holders and over 10k initial liquidity show short-term continuation in observed pump.fun launches.",
    confidence: 0.7,
    ttl_hours: 168
  }
}
```

**Expected**:
```json
{ "id": 1, "kind": "pumpfun_entry_pattern", "validUntil": "...", "pinned": false, "embedded": true }
```

**DB check**:
```sql
SELECT id, kind, title, embedding_dim, length(embedding::text) > 0 AS has_embed
FROM knowledge_entries WHERE id = 1;
```
`embedding_dim = 768`, `has_embed = true`.

### 1.2 Pinned evergreen rule

```
echo_internal {
  tool: "knowledge_write",
  params: {
    kind: "risk_rule",
    title: "no leverage on memecoins",
    summary: "Never open leveraged positions on tokens with under 1M USD market cap. Hard rule.",
    pinned: true
  }
}
```

**Expected**: `validUntil: null`, `pinned: true`.

### 1.3 Bulk-write 10 more entries (pure dispatch loop)

Use any mix of kinds (`pumpfun_entry_pattern`, `bridge_observation`, `solana_mev_risk`, etc.). Goal: 12 total entries so the next recall step triggers overflow.

**Expected**: 12 rows in `knowledge_entries` after this section.

### 1.4 Failure mode — sidecar offline

```bash
docker model unload ai/embeddinggemma:300M-Q8_0
```

```
echo_internal {
  tool: "knowledge_write",
  params: { kind: "memo", title: "x", summary: "y" }
}
```

**Expected**: tool result `success: false`, output contains `embedding service unavailable`.

```bash
docker model run ai/embeddinggemma:300M-Q8_0
```

---

## 2. Active Knowledge prompt injection

Goal: confirm that the next agent turn after write actually receives `# Active Knowledge` in the system prompt (drift guard).

In a Claude Code chat session connected via MCP, ask any question. Inspect the agent's system prompt (via debug log or by looking at the prompt builder in `src/echo-agent/engine/core/turn.ts`).

**Expected**:
- `# Active Knowledge` heading present.
- `Pinned (evergreen):` section contains `[risk_rule] no leverage on memecoins`.
- `Recent:` section contains the most recent non-pinned entries.
- `Known kinds (reuse before creating new):` section lists `pumpfun_entry_pattern (...)`, `risk_rule (...)`, etc.
- `Knowledge Layer Rules` section appears in `tool-usage.ts` part of the prompt.

---

## 3. Recall path with inline + overflow — `knowledge_recall`

### 3.1 Small recall (k=5) — all inline

```
echo_internal {
  tool: "knowledge_recall",
  params: { query: "early holder count entry pattern", k: 5 }
}
```

**Expected**:
```json
{
  "count": 5,
  "inline": [ /* 5 entries with full content_md, similarity, etc. */ ]
  // no `overflow` field
}
```

### 3.2 Large recall (k=12) — 10 inline + 2 overflow

```
echo_internal {
  tool: "knowledge_recall",
  params: { query: "early holder count entry pattern", k: 12 }
}
```

**Expected**:
```json
{
  "count": 12,
  "inline": [ /* 10 entries */ ],
  "overflow": {
    "cacheKey": "rcl-2026MMDD-XXXXXXXX",
    "remainingCount": 2,
    "expiresAt": "<ISO timestamp ~15 minutes from now>"
  }
}
```

**DB check**: cache row was written.
```sql
SELECT space, slug, length(content_md) AS bytes, updated_at
FROM documents
WHERE space = 'cache';
```
One row with `slug` matching the returned `cacheKey`.

### 3.3 Read overflow

```
echo_internal {
  tool: "knowledge_recall_overflow",
  params: { cacheKey: "<cacheKey from 3.2>" }
}
```

**Expected**: `results` array with the 2 overflow entries (full content_md).

### 3.4 Failure mode — sidecar offline (recall path)

```bash
docker model unload ai/embeddinggemma:300M-Q8_0
```

```
echo_internal { tool: "knowledge_recall", params: { query: "anything" } }
```
**Expected**: `success: false`, output contains `embedding service unavailable`.

```
echo_internal { tool: "knowledge_recall_overflow", params: { cacheKey: "<existing>" } }
```
**Expected**: `success: true` — overflow read does not require the sidecar (DB only).

```bash
docker model run ai/embeddinggemma:300M-Q8_0
```

---

## 4. Direct fetch — `knowledge_get`

```
echo_internal { tool: "knowledge_get", params: { id: 1 } }
```

**Expected**: full entry (`title`, `summary`, `contentMd`, `tags`, `sourceRefs`, `confidence`, `status`, `pinned`, `validUntil`).

The handler also injects `content_md` into the engine context under the key `knowledge:1`. In a chat session this means the next turn sees the full text loaded.

`knowledge_get` does not require the sidecar — it works with the model unloaded.

---

## 5. Status update — `knowledge_update_status`

```
echo_internal {
  tool: "knowledge_update_status",
  params: { id: 1, status: "invalidated", reason: "no longer holds in current regime" }
}
```

**Expected**: `{ id: 1, status: "invalidated", updated: true }`.

**Effect**:
- Subsequent `knowledge_recall` no longer returns this entry (filter `status = 'active'`).
- Active Knowledge block no longer mentions it on the next turn.
- `knowledge_get { id: 1 }` still returns the entry — direct fetch is not status-filtered.

---

## 6. Lazy cache cleanup

After ~15 minutes, run any `knowledge_recall` again. The handler runs `recall_cache.cleanupExpired()` before any potential write.

**DB check**:
```sql
SELECT count(*) FROM documents WHERE space = 'cache';
```
Should drop to 0 once expired rows are evicted.

---

## Notes

- All `knowledge_*` tools stay visible regardless of `EMBEDDING_BASE_URL`. Hiding them would obscure core memory and prevent agents from at least reading what they previously wrote.
- `kind` is free-form; the agent organically grows its taxonomy. The `Known kinds` section in Active Knowledge prevents drift (e.g. `pumpfun_entry_pattern` vs `pump_fun_pattern`).
- All written content (title/summary/content_md) and recall queries MUST be in English regardless of the user's conversation language — the EmbeddingGemma 300M model achieves significantly better retrieval on English text.
- `documents.space = 'cache'` is system-only and not exposed via `document_*` tools (which only allow `space: ['notes']`). Only `knowledge_recall_overflow` reads it.
