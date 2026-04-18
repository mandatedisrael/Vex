/**
 * knowledge-reembed — refresh embeddings in place when the model changes.
 *
 * Same-dim only. If the configured EMBEDDING_DIM differs from any existing
 * row's embedding_dim, this script ABORTS and tells the operator to use
 * the export → wipe → import flow instead — mixed-dim transitions would
 * crash recall (`<=>` requires equal dims) and there is no clean way to
 * make this atomic without an exclusive table lock.
 *
 * MAINTENANCE LEASE (PR4 Fase III):
 *   Reembed now acquires the authoritative `maintenance_leases` lease for
 *   the full duration of the reembed loop. Every other writer
 *   (`insertEntry`, `supersedeEntry`, promotion inserts) runs under
 *   `withLeaseSharedLock`, which fails fast with `MaintenanceActiveError`
 *   while the lease is held. The row-lock pair (FOR UPDATE on acquire, FOR
 *   SHARE on writers) closes the TOCTOU race without an advisory lock.
 *
 *   If reembed crashes and leaves `active = TRUE`, the operator clears it
 *   manually:
 *     UPDATE maintenance_leases SET active = FALSE WHERE id = 1;
 *   TTL-based stale-owner recovery is deferred to v2 per plan v5.
 *
 *   `runtime_state.active` is no longer a gate — kept as an observability
 *   signal for UI / CLI status but NOT read here. Soft-guard mode is
 *   available via `--force-legacy-soft-guard` for the grace period
 *   (removed once the rollout stabilises).
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/knowledge-reembed.ts [--force] [--dry-run]
 *
 *   --force     re-embed ALL rows, not just rows whose embedding_model
 *               differs from the currently configured model
 *   --dry-run   count rows that would be re-embedded; do NOT call the
 *               provider and do NOT write to the DB
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { runMigrations } from "@echo-agent/db/migrate.js";
import { closePool, getPool } from "@echo-agent/db/client.js";
import {
  findRowsWithDimNotMatching,
  streamRowsForReembed,
  updateEmbedding,
} from "@echo-agent/db/repos/knowledge.js";
import {
  acquireReembedLease,
  MaintenanceActiveError,
  releaseReembedLease,
} from "@echo-agent/db/repos/maintenance-lease.js";
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

  // ── Pre-check: hard refusal on dim mismatch. No way to reconcile mixed
  // dims atomically; operator must use the export → wipe → import flow.
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

  // ── Dry-run: pure preview, NO provider call, NO lease acquisition.
  // Counts rows that would be re-embedded based on the REQUESTED model name
  // (config.model). Trade-off: if the provider aliases (request "X" →
  // response "Y"), the planned count may be off — every row in DB is stamped
  // with "Y" and the stream filter looks for rows ≠ "X", which yields
  // every row even if a real reembed would re-process zero. Operators who
  // need a 100%-accurate count run without --dry-run (which probes the
  // provider for honest provenance). Dry-run is the operator's safe preview
  // and MUST work even when the embedding runtime is down — that's the
  // contract documented in --help and the file docstring.
  if (opts.dryRun) {
    let planned = 0;
    for await (const _row of streamRowsForReembed(config.model, {
      includeMatching: opts.force ?? false,
    })) {
      void _row;
      planned++;
    }
    return { reembedded: 0, failed: 0, dryRun: true, plannedCount: planned };
  }

  // ── Acquire maintenance lease (authoritative write-gate).
  //
  // Every normal writer runs under `withLeaseSharedLock`, which fails fast
  // with `MaintenanceActiveError` when the lease is held. The SHARE × UPDATE
  // pair on the singleton `maintenance_leases` row closes the TOCTOU race
  // between reembed and concurrent writers without needing an advisory lock.
  const ownerId = `reembed:pid-${process.pid}`;
  const pool = getPool();
  const leaseClient = await pool.connect();
  try {
    await acquireReembedLease(leaseClient, ownerId);
  } catch (err) {
    leaseClient.release();
    if (err instanceof MaintenanceActiveError) {
      throw new Error(
        `Cannot start reembed: ${err.message}\n` +
          "If you are sure no other reembed is running (e.g. a previous one crashed):\n" +
          "  psql $ECHO_AGENT_DB_URL -c 'UPDATE maintenance_leases SET active = FALSE WHERE id = 1;'",
      );
    }
    throw err;
  }
  // Lease acquire tx has already committed; release the client back so
  // the pool slot isn't held for the whole reembed. We re-acquire for the
  // release tx in the finally block below.
  leaseClient.release();

  // ── Non-dry-run: probe the provider once to discover its actual model
  // name. We use this value for both the streamRowsForReembed selector AND
  // as the value we stamp into embedding_model — that way the audit column
  // is always the truth (what the provider reported), not the requested
  // config.model. If the provider aliases (request "X" → response "Y"),
  // every row gets "Y" and recall filters consistently look for "Y".
  let reembedded = 0;
  let failed = 0;
  try {
    const probe = await embedDocument("__schema_probe__", "ignore", config);
    const currentProviderModel = probe.providerModel;

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
  } finally {
    // Release the lease even if the reembed loop threw — otherwise the gate
    // stays TRUE and blocks every future writer until the operator clears
    // it manually.
    const releaseClient = await pool.connect();
    try {
      await releaseReembedLease(releaseClient, ownerId);
    } finally {
      releaseClient.release();
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

const isDirectInvocation = import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;

if (isDirectInvocation) {
  main().catch((err) => {
    logger.error("knowledge_reembed.unhandled", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(2);
  });
}
