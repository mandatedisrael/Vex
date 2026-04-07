/**
 * knowledge-reembed — refresh embeddings in place when the model changes.
 *
 * Same-dim only. If the configured EMBEDDING_DIM differs from any existing
 * row's embedding_dim, this script ABORTS and tells the operator to use
 * the export → wipe → import flow instead — mixed-dim transitions would
 * crash recall (`<=>` requires equal dims) and there is no clean way to
 * make this atomic without an exclusive table lock.
 *
 * SAFETY GUARD SEMANTICS:
 *   The runtime_state.active pre-check is a SOFT guard. It catches the
 *   most obvious race with the autonomous loop engine, but it is NOT a
 *   full write lock. MCP server / internal tools / subagents / CLI can
 *   still write to knowledge_entries while runtime_state.active = FALSE.
 *
 *   The operator MUST stop the FULL stack of writers before running this:
 *     - autonomous loop engine
 *     - MCP server
 *     - any internal-tool dispatcher
 *     - subagents
 *     - any CLI session that might call knowledge_write
 *
 *   A race with another writer during reembed can produce silent corruption:
 *   a row whose `content_md` was updated to new text but whose embedding
 *   was already replaced with the embedding of the OLD text.
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/knowledge-reembed.ts [--force] [--dry-run]
 *
 *   --force     re-embed ALL rows, not just rows whose embedding_model
 *               differs from the currently configured model
 *   --dry-run   count rows that would be re-embedded; do NOT call the
 *               provider and do NOT write to the DB
 */

import { runMigrations } from "@echo-agent/db/migrate.js";
import { closePool } from "@echo-agent/db/client.js";
import {
  findRowsWithDimNotMatching,
  isRuntimeActive,
  streamRowsForReembed,
  updateEmbedding,
} from "@echo-agent/db/repos/knowledge.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { assertSchemaUpToDate } from "./_preflight.js";
import logger from "@utils/logger.js";

export interface ReembedReport {
  reembedded: number;
  failed: number;
  dryRun: boolean;
  plannedCount?: number;
}

export interface ReembedOptions {
  force?: boolean;
  dryRun?: boolean;
  /** Progress callback for tests / interactive runs. Called every 50 rows. */
  onProgress?: (n: number) => void;
}

/**
 * Programmatic entry point.
 *
 * Throws on pre-check failure (runtime active, dim mismatch). Returns a
 * report otherwise.
 */
export async function reembedKnowledge(opts: ReembedOptions = {}): Promise<ReembedReport> {
  const config = loadEmbeddingConfig();
  await runMigrations();
  await assertSchemaUpToDate();

  // ── Pre-check 1: soft guard against the loop engine.
  if (await isRuntimeActive()) {
    throw new Error(
      "runtime_state.active = TRUE — stop the agent loop engine first.\n" +
        "REMINDER: this is only a soft guard. The operator MUST also stop ALL\n" +
        "other writers (MCP server, internal tools, subagents, CLI) — a race\n" +
        "with any writer during reembed can corrupt rows silently.",
    );
  }

  // ── Pre-check 2: hard refusal on dim mismatch.
  const mismatched = await findRowsWithDimNotMatching(config.dim);
  if (mismatched > 0) {
    throw new Error(
      `${mismatched} row(s) in knowledge_entries have embedding_dim != ${config.dim} ` +
        `(current EMBEDDING_DIM). Re-embedding cannot reconcile mixed dims atomically.\n` +
        `Use the export → wipe → import flow instead:\n` +
        `  1. make knowledge-export ARGS="--out backup.jsonl"\n` +
        `  2. docker compose -f docker/echo-agent/docker-compose.dev.yml down -v\n` +
        `  3. update env (EMBEDDING_MODEL, EMBEDDING_DIM)\n` +
        `  4. docker compose ... up -d\n` +
        `  5. make knowledge-import ARGS="--in backup.jsonl"`,
    );
  }

  // Probe the provider once to discover its actual model name. We use this
  // value for both the streamRowsForReembed selector AND as the value we
  // stamp into embedding_model — that way the audit column is always the
  // truth (what the provider reported), not the requested config.model.
  // If the provider aliases (request "X" → response "Y"), every row gets
  // "Y" and recall filters consistently look for "Y".
  const probe = await embedDocument("__schema_probe__", "ignore", config);
  const currentProviderModel = probe.providerModel;

  if (opts.dryRun) {
    // Count rows that would be re-embedded.
    let planned = 0;
    for await (const _row of streamRowsForReembed(currentProviderModel, {
      includeMatching: opts.force ?? false,
    })) {
      void _row;
      planned++;
    }
    return { reembedded: 0, failed: 0, dryRun: true, plannedCount: planned };
  }

  let reembedded = 0;
  let failed = 0;

  for await (const row of streamRowsForReembed(currentProviderModel, {
    includeMatching: opts.force ?? false,
  })) {
    try {
      const { embedding, providerModel } = await embedDocument(row.title, row.summary, config);
      const ok = await updateEmbedding(row.id, providerModel, embedding.length, embedding);
      if (ok) {
        reembedded++;
      } else {
        failed++;
        logger.warn("knowledge_reembed.row_not_updated", { id: row.id });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("knowledge_reembed.row_failed", { id: row.id, error: msg });
      failed++;
    }
    const total = reembedded + failed;
    if (total % 50 === 0 && opts.onProgress) {
      opts.onProgress(total);
    }
  }

  return { reembedded, failed, dryRun: false };
}

interface ReembedArgs {
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): ReembedArgs {
  const args: ReembedArgs = { force: false, dryRun: false };
  for (const a of argv) {
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "knowledge-reembed — refresh embeddings in place (same-dim only)\n\n" +
          "Usage: knowledge-reembed [--force] [--dry-run]\n\n" +
          "  --force     re-embed ALL rows, not just rows from a different model\n" +
          "  --dry-run   count what would be re-embedded; do not call provider or DB\n\n" +
          "OPERATOR REQUIREMENT: stop the FULL stack of writers before running this\n" +
          "(loop engine, MCP server, internal tools, subagents, CLI). The script's\n" +
          "runtime_state.active check is a SOFT guard, not a write lock. A race with\n" +
          "any writer during reembed can corrupt rows silently.\n\n" +
          "DIFFERENT-DIM SWAP: this script refuses to run if any row has a different\n" +
          "embedding_dim from the current EMBEDDING_DIM. Use the export → wipe →\n" +
          "import flow for dim changes (see --help on knowledge-export / -import).\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const { assertExplicitDbUrl } = await import("./_preflight.js");
  assertExplicitDbUrl("knowledge-reembed");

  const args = parseArgs(process.argv.slice(2));
  let report: ReembedReport | undefined;
  try {
    report = await reembedKnowledge({
      force: args.force,
      dryRun: args.dryRun,
      onProgress: (n) => {
        process.stderr.write(`knowledge-reembed: progress ${n} rows\n`);
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge_reembed.failed", { error: msg });
    process.stderr.write(`knowledge-reembed: ${msg}\n`);
    process.exitCode = 2;
  } finally {
    await closePool();
  }

  if (report) {
    if (report.dryRun) {
      process.stderr.write(
        `knowledge-reembed: dry-run — would re-embed ${report.plannedCount ?? 0} rows\n`,
      );
    } else {
      process.stderr.write(
        `knowledge-reembed: reembedded=${report.reembedded} failed=${report.failed}\n`,
      );
      if (report.failed > 0 && process.exitCode === undefined) {
        process.exitCode = 1;
      }
    }
  }
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("knowledge-reembed.ts") === true;

if (isDirectInvocation) {
  main().catch((err) => {
    logger.error("knowledge_reembed.unhandled", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(2);
  });
}
