/**
 * Tool-embeddings health check.
 *
 * Used by the eval runner before dense baseline capture and by latency/smoke
 * tests. NOT called from `discoverProtocolCapabilities` — the dense leg already
 * degrades gracefully via `denseFailed: true` on empty or mismatched rows. This
 * is a pre-flight gate for test/eval paths where a misconfigured table should
 * fail loudly rather than silently produce zero dense hits.
 *
 * Three conditions checked, in order:
 *   1. Config is loadable (throws from `loadEmbeddingConfig()` if env vars
 *      are missing).
 *   2. `tool_embeddings` has at least one row for (model, dim) — no rows
 *      means the table was never populated or was populated under a different
 *      model. Operator fix: `pnpm tool-reembed`.
 *   3. Row count for (model, dim) is not fewer than the expected active tool
 *      count — stale table means some manifests changed without a reembed.
 *      Operator fix: `pnpm tool-reembed`.
 */

import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import { countByModelDim } from "@vex-agent/db/repos/tool-embeddings.js";
import { PROTOCOL_TOOLS } from "@vex-agent/tools/protocols/catalog.js";
import { isReembeddableNamespace } from "@vex-agent/tools/protocols/lifecycle.js";

/**
 * Assert that `tool_embeddings` is populated and consistent with the
 * current embedding config.
 *
 * Throws a descriptive error when:
 * - No rows exist for (embedding_model, embedding_dim) — needs `pnpm tool-reembed`.
 * - Row count < expected active tool count — stale table, needs `pnpm tool-reembed`.
 *
 * Returns void on success. Callers should await this before running dense
 * baseline capture or latency tests.
 */
export async function assertToolEmbeddingsReady(): Promise<void> {
  const config = loadEmbeddingConfig();
  const expectedCount = PROTOCOL_TOOLS.filter((m) =>
    isReembeddableNamespace(m.namespace),
  ).length;
  const actual = await countByModelDim(config.model, config.dim);

  if (actual === 0) {
    throw new Error(
      `tool_embeddings is empty for model "${config.model}" dim ${config.dim}. ` +
        `Run \`pnpm tool-reembed\` to populate it.`,
    );
  }

  if (actual < expectedCount) {
    const missing = expectedCount - actual;
    throw new Error(
      `tool_embeddings is stale for model "${config.model}" dim ${config.dim}: ` +
        `found ${actual} rows but expected at least ${expectedCount} ` +
        `(${missing} tool${missing === 1 ? "" : "s"} missing). ` +
        `Run \`pnpm tool-reembed\` to refresh.`,
    );
  }
}
