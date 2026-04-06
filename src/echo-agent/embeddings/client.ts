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
 * Failure is loud: missing config throws at load time, sidecar errors propagate
 * after retry exhaustion. The caller (knowledge_write/knowledge_recall handlers)
 * surfaces these as `embedding service unavailable` tool results.
 */

import {
  loadEmbeddingConfig,
  REQUIRED_EMBEDDING_DIM,
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

/** Format the document side of an embedding (write path). */
export function formatDocumentInput(title: string, summary: string): string {
  return `title: ${title} | text: ${summary}`;
}

/** Format the query side of an embedding (recall path). */
export function formatQueryInput(query: string): string {
  return `task: search result | query: ${query}`;
}

/**
 * Embed a knowledge entry's title + summary.
 * Throws on missing config or sidecar failure (after retries).
 */
export async function embedDocument(
  title: string,
  summary: string,
  configOverride?: EmbeddingConfig,
): Promise<number[]> {
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
): Promise<number[]> {
  const config = configOverride ?? loadEmbeddingConfig();
  const input = formatQueryInput(query);
  return embedSingle(input, config);
}

// ── Internals ────────────────────────────────────────────────────

interface OpenAIEmbeddingsResponse {
  data: Array<{ embedding: number[] }>;
  model?: string;
}

async function embedSingle(input: string, config: EmbeddingConfig): Promise<number[]> {
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
): Promise<number[]> {
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
  if (embedding.length !== REQUIRED_EMBEDDING_DIM) {
    throw new Error(
      `embeddings provider returned dim ${embedding.length}, expected ${REQUIRED_EMBEDDING_DIM}. ` +
        `Check that EMBEDDING_MODEL matches the schema-locked dimension.`,
    );
  }

  logger.debug("embeddings.embed.completed", {
    provider: config.provider,
    model: config.model,
    inputChars: input.length,
    dim: embedding.length,
  });

  return embedding;
}
