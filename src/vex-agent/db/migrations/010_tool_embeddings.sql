-- 010_tool_embeddings.sql
--
-- Tool discovery embeddings — dense ranker over the
-- protocol tool surface. Mirrors `knowledge_entries` shape (vector + dim +
-- model + content_hash) so re-embed only happens when the source text
-- actually changed.
--
-- The dense retriever in `src/vex-agent/tools/protocols/discovery.ts` ranks
-- free-text queries by cosine similarity on `embedding`. If the embedding
-- service or table is unavailable at runtime, discovery falls back to lexical
-- scoring so callers still get a useful shortlist.
--
-- Re-embed task at startup (`src/mcp/bootstrap.ts:runBootstrapChecks`,
-- non-blocking) iterates active manifests, computes `content_hash`, and
-- skips rows whose hash is unchanged. Deprecated namespaces are excluded
-- via `lifecycle.ts:isReembeddableNamespace`.
--
-- No ivfflat/hnsw index here — `vector` is intentionally typmod-free so
-- we can swap embedding dim later. Brute-force cosine scan is acceptable
-- through ~10k tools; ANN gets added when we cross that threshold.

CREATE TABLE tool_embeddings (
  tool_id          TEXT PRIMARY KEY,
  namespace        TEXT NOT NULL,
  -- sha256 hex of `formatter_version|tool_id|namespace|source_text|aliases|exampleIntents|chains`.
  -- Includes formatter version so a future swap of the embedding-input
  -- prefix (e.g. EmbeddingGemma `title:|text:` → BGE-style) automatically
  -- invalidates every row and forces a fresh re-embed.
  content_hash     CHAR(64) NOT NULL,
  embedding_model  TEXT NOT NULL,                 -- audit: provider-reported model name (recall filters on this)
  embedding_dim    INTEGER NOT NULL,              -- audit: actual provider response dim
  embedding        vector NOT NULL,               -- no typmod — re-embed-friendly
  refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT te_embedding_dim_range CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT te_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim)
);

CREATE INDEX idx_te_namespace ON tool_embeddings(namespace);
CREATE INDEX idx_te_model_dim ON tool_embeddings(embedding_model, embedding_dim);
CREATE UNIQUE INDEX idx_te_content_hash ON tool_embeddings(content_hash);

COMMENT ON TABLE tool_embeddings IS
  'Per-tool dense embeddings for tool discovery; re-embedded only when content_hash differs from canonical (formatter_version|tool_id|namespace|sourceText|aliases|exampleIntents|chains) hash.';
