/**
 * knowledge-import — restore canonical knowledge from a JSONL backup.
 *
 * Reads JSONL produced by knowledge-export, re-embeds each entry locally
 * with the currently configured model, and inserts via repo.insertEntry
 * (idempotent on content_hash).
 *
 * Audit fields (status, valid_from, created_at, updated_at, valid_until)
 * are preserved exactly from the backup — without this, an `invalidated`
 * row would silently re-activate as `'active'` with NOW() timestamps and
 * falsify history.
 *
 * `content_hash` is RECOMPUTED locally from the imported text fields and
 * the file's `content_hash` is ignored. A corrupted/tampered hash in the
 * file is therefore a no-op; idempotency is anchored on what we re-derive.
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/knowledge-import.ts [--in FILE]
 */

import { createReadStream, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { runMigrations } from "@echo-agent/db/migrate.js";
import { closePool } from "@echo-agent/db/client.js";
import { MaintenanceActiveError } from "@echo-agent/db/repos/maintenance-lease.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { assertSchemaUpToDate } from "./_preflight.js";
import {
  type ImportedRow,
  type ManifestVersion,
} from "./knowledge-import/validators.js";
import { processRow } from "./knowledge-import/row-pipeline.js";
import logger from "@utils/logger.js";

export interface ImportReport {
  inserted: number;
  skipped_duplicate: number;
  failed: number;
  total: number;
}

/**
 * Programmatic entry point. Reads JSONL from `source` (any async-iterable of
 * strings) and writes a report to the returned promise.
 */
export async function importKnowledge(source: AsyncIterable<string>): Promise<ImportReport> {
  const config = loadEmbeddingConfig();
  await runMigrations();
  await assertSchemaUpToDate();

  const report: ImportReport = {
    inserted: 0,
    skipped_duplicate: 0,
    failed: 0,
    total: 0,
  };

  let lineNumber = 0;
  let manifestSeen = false;
  let manifestVersion: ManifestVersion = 1;

  for await (const rawLine of source) {
    lineNumber++;
    const line = rawLine.trim();
    if (line.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("knowledge_import.parse_failed", { lineNumber, error: msg });
      throw new Error(`line ${lineNumber}: invalid JSON (${msg})`);
    }

    if (!manifestSeen) {
      // First line MUST be a manifest. Validate aggressively — refuse to
      // import unknown formats rather than silently misparse.
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as Record<string, unknown>).__type !== "echoclaw_knowledge_export"
      ) {
        throw new Error(
          `line 1: expected manifest with __type="echoclaw_knowledge_export", got ${JSON.stringify(parsed).slice(0, 200)}`,
        );
      }
      const version = (parsed as Record<string, unknown>).version;
      // v1 kept for backwards compat (old backups with no lifecycle fields).
      // v2 adds supersedes_content_hash + status_reason + change_summary + what_failed.
      if (version !== 1 && version !== 2) {
        throw new Error(
          `line 1: unsupported manifest version ${String(version)} (expected 1 or 2)`,
        );
      }
      manifestVersion = version;
      manifestSeen = true;
      continue;
    }

    report.total++;
    if (typeof parsed !== "object" || parsed === null) {
      report.failed++;
      logger.error("knowledge_import.row_invalid", { lineNumber, reason: "not an object" });
      continue;
    }

    const row = parsed as ImportedRow;
    if (
      typeof row.kind !== "string" ||
      typeof row.title !== "string" ||
      typeof row.summary !== "string" ||
      typeof row.content_md !== "string"
    ) {
      report.failed++;
      logger.error("knowledge_import.row_invalid", {
        lineNumber,
        reason: "missing required text fields",
      });
      continue;
    }

    try {
      const outcome = await processRow(row, lineNumber, config);
      if (outcome === "inserted") {
        report.inserted++;
      } else {
        report.skipped_duplicate++;
      }
    } catch (err) {
      if (err instanceof MaintenanceActiveError) {
        // Concurrent reembed holds the authoritative write-gate. The row is
        // still counted as failed (import cannot proceed mid-maintenance),
        // but the dedicated event lets the operator tell this apart from a
        // genuine row-level error.
        logger.error("knowledge_import.row_maintenance_blocked", {
          lineNumber,
          ownerId: err.ownerId,
          manifestVersion,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("knowledge_import.row_failed", { lineNumber, error: msg, manifestVersion });
      }
      report.failed++;
    }
  }

  if (!manifestSeen) {
    throw new Error("input was empty: no manifest line found");
  }

  return report;
}

interface ImportArgs {
  in?: string;
}

function parseArgs(argv: readonly string[]): ImportArgs {
  const args: ImportArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") {
      args.in = argv[++i];
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "knowledge-import — restore knowledge_entries from a JSONL backup\n\n" +
          "Usage: knowledge-import [--in FILE]\n\n" +
          "Reads JSONL (manifest + entries) from stdin or FILE, re-embeds each\n" +
          "entry locally with the currently configured model, and upserts.\n" +
          "Idempotent on content_hash; re-running on the same backup is a no-op.\n" +
          "Audit fields (status, valid_from, created_at, updated_at) are preserved.\n",
      );
      process.exit(0);
    } else if (a !== undefined && a.startsWith("--")) {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

async function* readLines(input: Readable): AsyncIterable<string> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}

async function main(): Promise<void> {
  const { assertExplicitDbUrl } = await import("./_preflight.js");
  assertExplicitDbUrl("knowledge-import");

  const args = parseArgs(process.argv.slice(2));
  const input = args.in ? createReadStream(args.in, { encoding: "utf-8" }) : process.stdin;

  let report: ImportReport | undefined;
  try {
    report = await importKnowledge(readLines(input));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge_import.failed", { error: msg });
    process.stderr.write(`knowledge-import failed: ${msg}\n`);
    process.exitCode = 2;
  } finally {
    await closePool();
  }

  if (report) {
    process.stderr.write(
      `knowledge-import: inserted=${report.inserted} skipped_duplicate=${report.skipped_duplicate} failed=${report.failed} total=${report.total}\n`,
    );
    if (report.failed > 0 && process.exitCode === undefined) {
      process.exitCode = 1;
    }
  }
}

const isDirectInvocation = import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;

if (isDirectInvocation) {
  main().catch((err) => {
    logger.error("knowledge_import.unhandled", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(2);
  });
}
