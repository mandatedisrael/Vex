/**
 * Production MCP — startup health probes.
 *
 * Two probes, both must pass before the server binds a transport:
 *   1. DB ping  — `SELECT 1` over the shared echo-agent pool. Fails if
 *      ECHO_AGENT_DB_URL points at an unreachable / down Postgres.
 *   2. Embeddings probe — POST {EMBEDDING_BASE_URL}/embeddings with a
 *      throwaway input, assert the returned vector length matches
 *      EMBEDDING_DIM. Fails if the model runner is not running, the model
 *      is not loaded, or dim drift has crept in (the same check `make
 *      e2e-smoke` does).
 *
 * If either probe fails, MCP exits non-zero with an actionable stderr
 * message instead of binding a transport that would then return cryptic
 * errors on every tool call. Cichy fallback is the worst possible UX for
 * MCP clients which usually do not surface server logs.
 */

import { getPool } from "@echo-agent/db/client.js";
import {
  EMBEDDING_REQUEST_TIMEOUT_MS,
  loadEmbeddingConfig,
} from "@echo-agent/embeddings/config.js";
import { fetchWithTimeout } from "@utils/http.js";
import logger from "@utils/logger.js";

export class McpHealthError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "McpHealthError";
  }
}

/** Verify the echo-agent DB pool is reachable. */
export async function probeDb(): Promise<void> {
  try {
    const pool = getPool();
    const result = await pool.query<{ ok: number }>("SELECT 1 AS ok");
    if (result.rows[0]?.ok !== 1) {
      throw new McpHealthError(
        "DB probe returned unexpected payload",
        "Inspect ECHO_AGENT_DB_URL and the Postgres instance health.",
      );
    }
    logger.info("mcp.health.db_ok");
  } catch (err) {
    if (err instanceof McpHealthError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpHealthError(
      `DB probe failed: ${msg}`,
      "Check that ECHO_AGENT_DB_URL points at a running pgvector Postgres (e.g. `make e2e-up`).",
    );
  }
}

/**
 * POST a tiny request to the embeddings provider and assert that the response
 * vector length matches the configured EMBEDDING_DIM. Mirrors the assertion
 * `make e2e-smoke` runs.
 */
export async function probeEmbeddings(): Promise<void> {
  let config;
  try {
    config = loadEmbeddingConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpHealthError(
      `Embedding config invalid: ${msg}`,
      "Set EMBEDDING_BASE_URL / EMBEDDING_MODEL / EMBEDDING_DIM / EMBEDDING_PROVIDER in your .env.",
    );
  }

  const url = `${config.baseUrl}/embeddings`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "ping", model: config.model }),
      timeoutMs: EMBEDDING_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpHealthError(
      `Embeddings probe POST failed: ${msg}`,
      `Check that the embedding service is reachable at ${config.baseUrl} within ${EMBEDDING_REQUEST_TIMEOUT_MS}ms (Docker Model Runner status, model loaded).`,
    );
  }

  if (!response.ok) {
    throw new McpHealthError(
      `Embeddings probe HTTP ${response.status} from ${url}`,
      "Verify the model is loaded in the runner and matches EMBEDDING_MODEL.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpHealthError(
      `Embeddings probe returned non-JSON body: ${msg}`,
      "The provider URL probably does not point at an OpenAI-compatible /embeddings endpoint.",
    );
  }

  const vector = extractFirstEmbedding(payload);
  if (vector === null) {
    throw new McpHealthError(
      "Embeddings probe returned no vector in `data[0].embedding`",
      "Provider response shape does not match the OpenAI embeddings contract.",
    );
  }
  if (vector.length !== config.dim) {
    throw new McpHealthError(
      `Embeddings probe dim mismatch: model returned ${vector.length}, EMBEDDING_DIM=${config.dim}`,
      `Either EMBEDDING_DIM is wrong, or the loaded model is not ${config.model}. Run \`make e2e-smoke\` for the same check.`,
    );
  }
  logger.info("mcp.health.embeddings_ok", { dim: vector.length, model: config.model });
}

function extractFirstEmbedding(payload: unknown): readonly number[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (typeof first !== "object" || first === null) return null;
  const embedding = (first as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding)) return null;
  if (!embedding.every((v) => typeof v === "number")) return null;
  return embedding as readonly number[];
}

/** Run all health probes in order. Throws `McpHealthError` on first failure. */
export async function probeAll(): Promise<void> {
  await probeDb();
  await probeEmbeddings();
}
