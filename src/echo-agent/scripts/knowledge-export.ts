/**
 * knowledge-export — read-only DB backup of canonical knowledge.
 *
 * Streams every row in `knowledge_entries` as JSONL (one entry per line, plus
 * a manifest as the first line). Vectors and embedding-model metadata are
 * intentionally NOT exported — re-embed happens locally on import, so the
 * backup is portable across embedding model swaps.
 *
 * IMPORTANT: this script does NOT call loadEmbeddingConfig(). Export must
 * work in disaster recovery scenarios where the embedding provider is down
 * or the env is broken — backing up the data must never depend on a working
 * model. Only the DB pool + migration runner is required.
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/knowledge-export.ts [--out FILE]
 *
 * Output JSONL shape:
 *   line 1: {"__type":"echoclaw_knowledge_export","version":1,"schema_fields":[...],
 *            "source_embedding_model":"<unique or 'mixed'>","exported_at":"<ISO>"}
 *   line 2..N: {"kind":...,"title":...,..., "content_hash":..., "created_at":..., ...}
 *
 * Audit fields (status, valid_from, created_at, updated_at, valid_until) are
 * preserved exactly so import can roundtrip them — without this, an import
 * would silently re-activate `invalidated`/`archived` entries with NOW()
 * timestamps and falsify history.
 *
 * Help text reminder: backup files contain plaintext content_md. Treat as sensitive.
 */

import { createWriteStream, realpathSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { pathToFileURL } from "node:url";
import { runMigrations } from "@echo-agent/db/migrate.js";
import { closePool, query } from "@echo-agent/db/client.js";
import { streamAllForExport, type KnowledgeEntryForExport } from "@echo-agent/db/repos/knowledge.js";
import { assertSchemaUpToDate } from "./_preflight.js";
import logger from "@utils/logger.js";

/**
 * Export schema v2 — adds lifecycle lineage fields:
 *   supersedes_content_hash — stable cross-DB link to predecessor (not local id).
 *   status_reason / change_summary / what_failed — lifecycle audit text.
 *
 * Streaming order (by id ASC) guarantees every predecessor is emitted before its
 * successor, so the importer's content_hash-based resolution always finds the
 * predecessor row already inserted.
 */
export const EXPORT_SCHEMA_FIELDS = [
  "kind",
  "title",
  "summary",
  "content_md",
  "tags",
  "source_refs",
  "confidence",
  "status",
  "pinned",
  "valid_from",
  "valid_until",
  "content_hash",
  "supersedes_content_hash",
  "status_reason",
  "change_summary",
  "what_failed",
  "created_at",
  "updated_at",
] as const;

export const EXPORT_MANIFEST_VERSION = 2;

export interface ExportManifest {
  __type: "echoclaw_knowledge_export";
  version: typeof EXPORT_MANIFEST_VERSION;
  schema_fields: readonly string[];
  source_embedding_model: string;
  exported_at: string;
}

export interface ExportedRow {
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[];
  source_refs: Record<string, unknown>;
  confidence: number | null;
  status: string;
  pinned: boolean;
  valid_from: string;
  valid_until: string | null;
  content_hash: string;
  supersedes_content_hash: string | null;
  status_reason: string | null;
  change_summary: string | null;
  what_failed: string | null;
  created_at: string;
  updated_at: string;
}

function entryToExportRow(e: KnowledgeEntryForExport): ExportedRow {
  return {
    kind: e.kind,
    title: e.title,
    summary: e.summary,
    content_md: e.contentMd,
    tags: e.tags,
    source_refs: e.sourceRefs,
    confidence: e.confidence,
    status: e.status,
    pinned: e.pinned,
    valid_from: e.validFrom,
    valid_until: e.validUntil,
    content_hash: e.contentHash,
    supersedes_content_hash: e.supersedesContentHash,
    status_reason: e.statusReason,
    change_summary: e.changeSummary,
    what_failed: e.whatFailed,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

/**
 * Programmatic entry point for tests and CLI. Writes JSONL to the given sink.
 * Returns count of entries written (NOT including the manifest line).
 */
export async function exportKnowledge(sink: {
  write: (chunk: string) => boolean | void;
}): Promise<number> {
  await runMigrations();
  await assertSchemaUpToDate();

  // Compute source_embedding_model: 'mixed' if multiple distinct models exist,
  // the unique value if exactly one, '<empty>' if the table is empty.
  const modelRows = await query<{ embedding_model: string }>(
    "SELECT DISTINCT embedding_model FROM knowledge_entries",
  );
  let sourceModel: string;
  if (modelRows.length === 0) sourceModel = "<empty>";
  else if (modelRows.length === 1) sourceModel = modelRows[0]!.embedding_model;
  else sourceModel = "mixed";

  const manifest: ExportManifest = {
    __type: "echoclaw_knowledge_export",
    version: EXPORT_MANIFEST_VERSION,
    schema_fields: EXPORT_SCHEMA_FIELDS,
    source_embedding_model: sourceModel,
    exported_at: new Date().toISOString(),
  };
  sink.write(JSON.stringify(manifest) + "\n");

  let count = 0;
  for await (const entry of streamAllForExport(100)) {
    sink.write(JSON.stringify(entryToExportRow(entry)) + "\n");
    count++;
  }
  return count;
}

interface ExportArgs {
  out?: string;
}

function parseArgs(argv: readonly string[]): ExportArgs {
  const args: ExportArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      args.out = argv[++i];
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "knowledge-export — read-only backup of knowledge_entries\n\n" +
          "Usage: knowledge-export [--out FILE]\n\n" +
          "Writes a JSONL backup (manifest + one row per line) to stdout or FILE.\n" +
          "Vectors and embedding model are NOT included — import re-embeds locally.\n" +
          "WARNING: the backup file contains plaintext content_md. Treat as sensitive.\n",
      );
      process.exit(0);
    } else if (a !== undefined && a.startsWith("--")) {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const { assertExplicitDbUrl } = await import("./_preflight.js");
  assertExplicitDbUrl("knowledge-export");

  const args = parseArgs(process.argv.slice(2));

  let stream: WriteStream | undefined;
  let sink: { write: (chunk: string) => boolean | void };
  if (args.out) {
    stream = createWriteStream(args.out, { encoding: "utf-8" });
    sink = stream;
  } else {
    sink = { write: (chunk: string) => process.stdout.write(chunk) };
  }

  let count = 0;
  try {
    count = await exportKnowledge(sink);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge_export.failed", { error: msg });
    process.stderr.write(`knowledge-export failed: ${msg}\n`);
    process.exitCode = 2;
  } finally {
    if (stream) {
      await new Promise<void>((resolve) => stream!.end(resolve));
    }
    await closePool();
  }
  process.stderr.write(`knowledge-export: wrote ${count} entries\n`);
}

const isDirectInvocation = import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;

if (isDirectInvocation) {
  main().catch((err) => {
    logger.error("knowledge_export.unhandled", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(2);
  });
}
