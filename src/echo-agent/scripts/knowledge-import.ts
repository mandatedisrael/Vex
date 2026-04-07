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

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { runMigrations } from "@echo-agent/db/migrate.js";
import { closePool } from "@echo-agent/db/client.js";
import { findByContentHash, insertEntry } from "@echo-agent/db/repos/knowledge.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { computeContentHash } from "@echo-agent/knowledge/content-hash.js";
import type { KnowledgeStatus } from "@echo-agent/knowledge/policy.js";
import { assertSchemaUpToDate } from "./_preflight.js";
import logger from "@utils/logger.js";

export interface ImportReport {
  inserted: number;
  skipped_duplicate: number;
  failed: number;
  total: number;
}

interface ImportedRow {
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags?: string[];
  source_refs?: Record<string, unknown>;
  confidence?: number | null;
  status?: string;
  pinned?: boolean;
  valid_from?: string;
  valid_until?: string | null;
  // content_hash is read but ignored — recomputed locally
  content_hash?: string;
  created_at?: string;
  updated_at?: string;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isKnowledgeStatus(s: unknown): s is KnowledgeStatus {
  return (
    s === "active" || s === "superseded" || s === "invalidated" || s === "archived"
  );
}

// ── Fail-loud audit field validators ─────────────────────────────
//
// Missing fields (undefined / null) are OK and map to defaults via SQL
// COALESCE in insertEntry. Present-but-bad values throw — and are caught
// by the per-row try/catch, counted as `failed`, and surfaced in the report.
// Silently coercing garbage to NOW() / 'active' would falsify history exactly
// where the importer should be most strict.

function requireValidStatusOrUndefined(
  s: unknown,
  lineNumber: number,
): KnowledgeStatus | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: status must be a string, got ${typeof s}`);
  }
  if (!isKnowledgeStatus(s)) {
    throw new Error(
      `line ${lineNumber}: status="${s}" is not a valid KnowledgeStatus ` +
        `(active|superseded|invalidated|archived)`,
    );
  }
  return s;
}

function requireValidDateOrUndefined(
  s: unknown,
  field: string,
  lineNumber: number,
): Date | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string ISO date, got ${typeof s}`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`line ${lineNumber}: ${field}="${s}" is not a parseable ISO date`);
  }
  return d;
}

function requireValidValidUntil(s: unknown, lineNumber: number): Date | null {
  // Special-case: explicit null is meaningful (evergreen / pinned).
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") {
    throw new Error(
      `line ${lineNumber}: valid_until must be a string ISO date or null, got ${typeof s}`,
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`line ${lineNumber}: valid_until="${s}" is not a parseable ISO date`);
  }
  return d;
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
      if (version !== 1) {
        throw new Error(
          `line 1: unsupported manifest version ${String(version)} (expected 1)`,
        );
      }
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
      // Validate audit fields BEFORE any expensive work. Throws are caught
      // here and surface as report.failed — silent coercion would falsify
      // history exactly where the importer should be most strict.
      const status = requireValidStatusOrUndefined(row.status, lineNumber);
      const validFrom = requireValidDateOrUndefined(row.valid_from, "valid_from", lineNumber);
      const validUntil = requireValidValidUntil(row.valid_until, lineNumber);
      const createdAt = requireValidDateOrUndefined(row.created_at, "created_at", lineNumber);
      const updatedAt = requireValidDateOrUndefined(row.updated_at, "updated_at", lineNumber);

      // Recompute content_hash locally — never trust the file's hash. A
      // tampered/corrupted hash in the backup is therefore a no-op.
      const contentHash = computeContentHash({
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        contentMd: row.content_md,
      });

      // Short-circuit on content_hash BEFORE embedding. Re-importing a
      // healthy backup must not require a working provider — re-running on
      // the same backup is a no-op (zero embed calls).
      const existing = await findByContentHash(contentHash);
      if (existing) {
        report.skipped_duplicate++;
        continue;
      }

      const { embedding, providerModel } = await embedDocument(row.title, row.summary, config);

      const { inserted } = await insertEntry({
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        contentMd: row.content_md,
        tags: isStringArray(row.tags) ? row.tags : [],
        sourceRefs:
          row.source_refs && typeof row.source_refs === "object" && !Array.isArray(row.source_refs)
            ? (row.source_refs as Record<string, unknown>)
            : {},
        confidence: typeof row.confidence === "number" ? row.confidence : null,
        pinned: row.pinned === true,
        validUntil,
        contentHash,
        // Honest provenance: stamp the model the provider actually reported
        // for THIS row, NOT the requested config.model.
        embeddingModel: providerModel,
        embeddingDim: embedding.length,
        embedding,
        // ── audit roundtrip
        status,
        validFrom,
        createdAt,
        updatedAt,
      });

      if (inserted) {
        report.inserted++;
      } else {
        // Race condition: someone else wrote the same hash between our
        // findByContentHash check and the INSERT. CTE upsert caught it.
        report.skipped_duplicate++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("knowledge_import.row_failed", { lineNumber, error: msg });
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

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("knowledge-import.ts") === true;

if (isDirectInvocation) {
  main().catch((err) => {
    logger.error("knowledge_import.unhandled", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(2);
  });
}
