/**
 * knowledge repo — canonical agent memory with embeddings + tiered TTL.
 *
 * Public API module. Internals split into `./knowledge/` submodules by
 * concern (types, CRUD, vector recall, hot-context listings, bulk export,
 * reembed support). Consumers import from this module — submodules are
 * implementation detail.
 *
 * Schema lives in 001_initial.sql + 006_knowledge_lifecycle.sql. See
 * ./knowledge/crud.ts and ./knowledge/recall.ts for the portability contract
 * (vector column has no typmod; recall MUST filter by embedding_model+dim).
 *
 * Ranking heuristics live in src/echo-agent/knowledge/ranking.ts. The
 * supersede transaction is its own repo (./knowledge-lifecycle.ts) because
 * atomicity and error taxonomy differ from plain CRUD.
 */

export * from "./knowledge/types.js";
export * from "./knowledge/crud.js";
export * from "./knowledge/recall.js";
export * from "./knowledge/hot-context.js";
export * from "./knowledge/export.js";
export * from "./knowledge/reembed.js";
