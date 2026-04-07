/**
 * Embeddings client — OpenAI-compatible HTTP POST to a local Docker Model Runner.
 *
 * Two functions reflect the EmbeddingGemma model card recommendation to use
 * different prompts for documents (write path) and queries (recall path):
 *
 *   - embedDocument(title, summary) → "title: <title> | text: <summary>"
 *   - embedQuery(query)              → "task: search result | query: <query>"
 *
 * Both call POST {baseUrl}/embeddings with body { input, model } and parse the
 * OpenAI-shaped { data: [{ embedding: number[] }], model } response.
 *
 * Both return `EmbedResult { embedding, providerModel }` — providerModel is
 * the model name AS REPORTED BY THE PROVIDER in the response, falling back to
 * `config.model` if the provider does not return one. Callers MUST stamp this
 * value to `knowledge_entries.embedding_model` (audit truth, not requested
 * name) and use it as the recall filter — write and read paths must agree on
 * the same source of truth, otherwise audit drift breaks recall silently.
 *
 * Failure is loud: missing config throws at load time, sidecar errors propagate
 * after retry exhaustion. The caller (knowledge_write/knowledge_recall handlers)
 * surfaces these as `embedding service unavailable` tool results.
 */

import {
  loadEmbeddingConfig,
  EMBEDDING_REQUEST_TIMEOUT_MS,
  EMBEDDING_MAX_RETRIES,
  EMBEDDING_BASE_DELAY_MS,
  EMBEDDING_MAX_DELAY_MS,
  type EmbeddingConfig,
} from "./config.js";
import {
  retryWithBackoff,
  withTimeout,
  isRetryableError,
} from "@echo-agent/inference/resilience.js";
import logger from "@utils/logger.js";

// ── Public API ───────────────────────────────────────────────────

// NOTE: The two formatters below use EmbeddingGemma-specific prompt prefixes
// (`title: ... | text: ...` and `task: search result | query: ...`) per the
// model card. Switching to a non-Gemma family (BGE, E5, Qwen3-Embedding, nomic)
// requires updating these prefixes per that model's recommended scheme — they
// are intentionally NOT model-agnostic. A pluggable per-model formatter is a
// follow-up refactor; for now this assumption is documented and accepted.

/** Format the document side of an embedding (write path). */
export function formatDocumentInput(title: string, summary: string): string {
  return `title: ${title} | text: ${summary}`;
}

/** Format the query side of an embedding (recall path). */
export function formatQueryInput(query: string): string {
  return `task: search result | query: ${query}`;
}

/**
 * Result of an embed call — the vector plus the provider's reported model name.
 *
 * `providerModel` is what the provider returned in `response.model`, or
 * `config.model` as a fallback when the provider omits it. Callers MUST use
 * this value as the audit `embedding_model` AND as the recall filter — never
 * `config.model` directly. This is what makes the audit column authoritative.
 */
export interface EmbedResult {
  embedding: number[];
  providerModel: string;
}

/**
 * Embed a knowledge entry's title + summary.
 * Throws on missing config or sidecar failure (after retries).
 */
export async function embedDocument(
  title: string,
  summary: string,
  configOverride?: EmbeddingConfig,
): Promise<EmbedResult> {
  const config = configOverride ?? loadEmbeddingConfig();
  const input = formatDocumentInput(title, summary);
  return embedSingle(input, config);
}

/**
 * Embed a recall query.
 * Throws on missing config or sidecar failure (after retries).
 */
export async function embedQuery(
  query: string,
  configOverride?: EmbeddingConfig,
): Promise<EmbedResult> {
  const config = configOverride ?? loadEmbeddingConfig();
  const input = formatQueryInput(query);
  return embedSingle(input, config);
}

// ── Internals ────────────────────────────────────────────────────

interface OpenAIEmbeddingsResponse {
  data: Array<{ embedding: number[] }>;
  model?: string;
}

async function embedSingle(input: string, config: EmbeddingConfig): Promise<EmbedResult> {
  return retryWithBackoff(
    () =>
      withTimeout(
        callEmbeddingsEndpoint(input, config),
        EMBEDDING_REQUEST_TIMEOUT_MS,
        "embeddings.request",
      ),
    {
      maxRetries: EMBEDDING_MAX_RETRIES,
      baseDelayMs: EMBEDDING_BASE_DELAY_MS,
      maxDelayMs: EMBEDDING_MAX_DELAY_MS,
      jitter: true,
      shouldRetry: isRetryableError,
    },
    "embeddings.embed",
  );
}

async function callEmbeddingsEndpoint(
  input: string,
  config: EmbeddingConfig,
): Promise<EmbedResult> {
  const url = `${config.baseUrl}/embeddings`;
  const body = JSON.stringify({ input, model: config.model });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`embeddings provider returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenAIEmbeddingsResponse;
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`embeddings provider returned malformed response: missing data[0].embedding`);
  }
  if (embedding.length !== config.dim) {
    throw new Error(
      `embeddings provider at ${config.baseUrl} returned dim ${embedding.length} for model "${config.model}", ` +
        `expected ${config.dim} (from EMBEDDING_DIM). ` +
        `Either update EMBEDDING_DIM to match the model, or use a model that returns the configured dim.`,
    );
  }

  // Honest provenance: prefer the model name the provider actually reported.
  // Falls back to the configured name when the provider omits it (or returns
  // an empty string). This is what callers stamp to embedding_model.
  const providerModel =
    typeof json.model === "string" && json.model.length > 0 ? json.model : config.model;

  logger.debug("embeddings.embed.completed", {
    provider: config.provider,
    requestedModel: config.model,
    providerModel,
    inputChars: input.length,
    dim: embedding.length,
  });

  return { embedding, providerModel };
}
