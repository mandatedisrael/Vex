/**
 * Tool-embedding reembed task.
 *
 * Iterates every reembeddable manifest (filter via
 * `lifecycle.ts:isReembeddableNamespace` — `active` only, deprecated and
 * reserved skipped), computes a stable `content_hash` over the dense input
 * + formatter version, and upserts into `tool_embeddings` only when the
 * hash differs from what is stored. First boot embeds the full active
 * surface (~120 tools today, ~3-4s wallclock); subsequent boots are a
 * cheap hash diff.
 *
 * Wired into `src/mcp/bootstrap.ts:runBootstrapChecks` as **non-blocking**
 * fire-and-forget so MCP startup never waits on the embedding service. The
 * `discover_tools` cold path NEVER lazy-embeds in user-facing code — if
 * `tool_embeddings` is incomplete, dense discovery degrades to
 * `dense_failed: true` and falls back to lexical scoring.
 *
 * Module-level `inFlight` promise enforces single-flight: parallel calls
 * (e.g. CLI invocation racing the bootstrap fire-and-forget) wait on the
 * same run rather than double-embedding.
 */

import { createHash } from "node:crypto";
import { embedTool, FORMATTER_VERSION } from "@vex-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import { PROTOCOL_TOOLS } from "@vex-agent/tools/protocols/catalog.js";
import { isReembeddableNamespace } from "@vex-agent/tools/protocols/lifecycle.js";
import {
  findExistingByHash,
  upsertToolEmbedding,
} from "@vex-agent/db/repos/tool-embeddings.js";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";
import logger from "@utils/logger.js";

export interface ReembedReport {
  embedded: number;
  skipped: number;
  errors: number;
  durationMs: number;
  formatterVersion: string;
  embeddingModel: string;
  embeddingDim: number;
}

let inFlight: Promise<ReembedReport> | null = null;

/**
 * Embed (or refresh) every active protocol tool. Idempotent on
 * `content_hash`. Single-flight — concurrent calls share one run.
 */
export function reembedAllTools(): Promise<ReembedReport> {
  if (inFlight !== null) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<ReembedReport> {
  const start = Date.now();
  const config = loadEmbeddingConfig();
  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  const eligible = PROTOCOL_TOOLS.filter((m) => isReembeddableNamespace(m.namespace));

  for (const manifest of eligible) {
    try {
      const sourceText = pickSourceText(manifest);
      if (sourceText.length === 0) {
        skipped++;
        continue;
      }
      const contentHash = computeContentHash(manifest, sourceText);
      const existing = await findExistingByHash(contentHash);
      if (existing && existing.toolId === manifest.toolId) {
        skipped++;
        continue;
      }

      const result = await embedTool(manifest.toolId, sourceText, config);
      await upsertToolEmbedding({
        toolId: manifest.toolId,
        namespace: manifest.namespace,
        contentHash,
        embeddingModel: result.providerModel,
        embeddingDim: result.embedding.length,
        embedding: result.embedding,
      });
      embedded++;
    } catch (err) {
      errors++;
      logger.warn("tool_embeddings.reembed.tool_failed", {
        toolId: manifest.toolId,
        namespace: manifest.namespace,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report: ReembedReport = {
    embedded,
    skipped,
    errors,
    durationMs: Date.now() - start,
    formatterVersion: FORMATTER_VERSION,
    embeddingModel: config.model,
    embeddingDim: config.dim,
  };

  logger.info("tool_embeddings.reembed.completed", report);
  return report;
}

/**
 * The exact text that goes through the dense embedding pipeline. Falls back
 * through `embeddingText` → `canonicalSummary` → `description` so a tool
 * with no `discovery` metadata still embeds something coherent (the
 * description authors already wrote).
 */
function pickSourceText(manifest: ProtocolToolManifest): string {
  return (
    manifest.discovery?.embeddingText ??
    manifest.discovery?.canonicalSummary ??
    manifest.description ??
    ""
  );
}

/**
 * Stable content hash. Includes formatter version + tool_id + namespace so
 * - swapping the embedding-input formatter (Gemma `title:|text:` → BGE)
 *   invalidates every row;
 * - the same `sourceText` shared by two tools (rare but possible) hashes
 *   differently.
 */
function computeContentHash(manifest: ProtocolToolManifest, sourceText: string): string {
  const meta = manifest.discovery;
  const aliasesJoined = (meta?.aliases ?? []).join("|");
  const exampleIntentsJoined = (meta?.exampleIntents ?? []).join("|");
  const chainsJoined = (meta?.chains ?? []).join("|");
  const components = [
    FORMATTER_VERSION,
    manifest.toolId,
    manifest.namespace,
    sourceText,
    aliasesJoined,
    exampleIntentsJoined,
    chainsJoined,
  ];
  return createHash("sha256").update(components.join("\x1f")).digest("hex");
}
