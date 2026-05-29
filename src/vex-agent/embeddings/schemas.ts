/**
 * Zod response schema for the OpenAI-compatible /embeddings endpoint.
 *
 * codex-002: this gates the SHAPE of the embeddings response at the HTTP
 * boundary before the raw `as OpenAIEmbeddingsResponse` cast, replacing a
 * blind trust in `res.json()`. It is intentionally PERMISSIVE — embeddings
 * here come from a local OpenAI-compatible Docker Model Runner, and different
 * providers (llama.cpp, vLLM, Ollama's OpenAI shim, etc.) decorate the body
 * with extra fields (`object`, `usage`, `index`, ...). We `.passthrough()`
 * unknown keys so a provider variation never turns a valid embedding into a
 * spurious failure.
 *
 * What we DO assert: `data` is an array of objects each carrying an
 * `embedding` number[], and `model` (when present) is a string. We do NOT
 * assert `data` is non-empty or that `embedding` matches the configured dim —
 * the client owns those checks and throws its own descriptive errors
 * (`missing data[0].embedding`, dim mismatch) so the existing failure
 * messages and tests are preserved.
 *
 * NOTE: unlike the Solana/Jupiter schemas this validation is NOT financial —
 * an embedding vector never feeds transaction signing — so it is not routed
 * through `fetchJson`/VexError. On a shape mismatch the client throws the same
 * plain `Error("embeddings provider returned malformed response: ...")` it
 * already used, keeping this module's loud-but-plain failure style.
 *
 * The wire interface in `client.ts` (`OpenAIEmbeddingsResponse`) stays the
 * canonical type; this schema mirrors it and `z.infer` is verified assignable
 * to it at the call site.
 */

import { z } from "zod";

export const openAIEmbeddingsResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          embedding: z.array(z.number()),
        })
        .passthrough(),
    ),
    model: z.string().optional(),
  })
  .passthrough();
