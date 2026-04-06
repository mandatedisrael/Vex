/**
 * Embeddings configuration — ENV validation at startup.
 *
 * Loads `EMBEDDING_*` env vars and validates them. Fail-fast on missing/invalid.
 *
 * Default runtime: Docker Model Runner with `ai/embeddinggemma:300M-Q8_0`,
 * exposed on http://localhost:12434/engines/llama.cpp/v1.
 *
 * EMBEDDING_DIM is locked at 768 in the MVP because the schema has
 * `vector(768)` hardcoded — we validate and fail-fast on any other value
 * rather than pretend to support a configurable dimension.
 *
 * @see Team Standards §16.1 Config as code, §16.2 Validation at startup
 */

import logger from "@utils/logger.js";

/** Schema-locked embedding dimension. Schema has `vector(768)` in 001_initial.sql. */
export const REQUIRED_EMBEDDING_DIM = 768;

export interface EmbeddingConfig {
  /** Base URL of the embeddings provider. Client appends `/embeddings`. */
  baseUrl: string;
  /** Model identifier passed in the `model` field of every request. */
  model: string;
  /** Vector dimension. Locked at 768 in MVP — fail-fast on mismatch. */
  dim: number;
  /** Provider tag for logging/observability. Free-form (e.g. "local", "openrouter"). */
  provider: string;
}

/**
 * Load and validate all embedding ENV variables.
 * Throws if any required value is missing or invalid.
 */
export function loadEmbeddingConfig(): EmbeddingConfig {
  const errors: string[] = [];

  const baseUrl = (process.env.EMBEDDING_BASE_URL ?? "").trim();
  if (!baseUrl) {
    errors.push("EMBEDDING_BASE_URL is required (e.g. http://localhost:12434/engines/llama.cpp/v1)");
  } else if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    errors.push(`EMBEDDING_BASE_URL="${baseUrl}" must start with http:// or https://`);
  }

  const model = (process.env.EMBEDDING_MODEL ?? "").trim();
  if (!model) {
    errors.push("EMBEDDING_MODEL is required (e.g. ai/embeddinggemma:300M-Q8_0)");
  }

  const rawDim = (process.env.EMBEDDING_DIM ?? "").trim();
  let dim = REQUIRED_EMBEDDING_DIM;
  if (!rawDim) {
    errors.push(`EMBEDDING_DIM is required and must be ${REQUIRED_EMBEDDING_DIM}`);
  } else {
    const parsed = Number(rawDim);
    if (!Number.isFinite(parsed) || parsed !== REQUIRED_EMBEDDING_DIM) {
      errors.push(
        `EMBEDDING_DIM="${rawDim}" is invalid. The schema is locked at vector(${REQUIRED_EMBEDDING_DIM}); ` +
          `re-embedding with a different dimension is out of MVP scope.`,
      );
    } else {
      dim = parsed;
    }
  }

  const provider = (process.env.EMBEDDING_PROVIDER ?? "").trim();
  if (!provider) {
    errors.push("EMBEDDING_PROVIDER is required (e.g. local)");
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error("embeddings.config.validation_failed", { error: err });
    }
    throw new Error(`Embedding config validation failed:\n${errors.join("\n")}`);
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    dim,
    provider,
  };
}

// ── Internal constants (not from ENV — technical invariants) ─────

/** HTTP request timeout for embeddings calls (30s). */
export const EMBEDDING_REQUEST_TIMEOUT_MS = 30_000;

/** Max retry attempts on retryable errors (5xx, 429, transport). */
export const EMBEDDING_MAX_RETRIES = 2;

/** Initial backoff delay between retries. */
export const EMBEDDING_BASE_DELAY_MS = 1000;

/** Max backoff delay. */
export const EMBEDDING_MAX_DELAY_MS = 5000;
