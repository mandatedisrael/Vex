/**
 * Knowledge DB helper — read-only management list of the GLOBAL
 * `knowledge_entries` store (agent integration stage 7-2a).
 *
 * Mirrors `usage-db.ts`: own `pg.Client` per call, no `@vex-agent/db/repos/*`
 * import. Knowledge is a global store (no session scope; `source_session` is
 * provenance only), so this is NOT app-scoped.
 *
 * SANITIZATION (codex 7-2a guardrail): the SELECT deliberately omits
 * `content_md`, `source_refs`, `content_hash`, `embedding`, `embedding_model`,
 * and `embedding_dim`. Only short-form metadata leaves the main process.
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  KNOWLEDGE_SOURCES,
  type KnowledgeEntryDto,
  type KnowledgeListInput,
  type KnowledgeListResult,
  type KnowledgeSourceDto,
  type KnowledgeStatusDto,
} from "@shared/schemas/knowledge.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "knowledge",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[knowledge-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "knowledge",
    message: "Unable to load knowledge.",
    retryable: true,
    userActionable: false,
    redacted: true,
  });
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[knowledge-db] buildPoolConfig threw", cause);
    return dbUnavailable();
  }
  if (cfg === null) return dbUnavailable();

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[knowledge-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[knowledge-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface KnowledgeRow {
  readonly id: number;
  readonly kind: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: string[] | null;
  readonly confidence: number | string | null;
  readonly status: string;
  readonly source: string | null;
  readonly source_session: string | null;
  readonly pinned: boolean;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNum(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function coerceSource(raw: string | null): KnowledgeSourceDto | null {
  return raw !== null && (KNOWLEDGE_SOURCES as readonly string[]).includes(raw)
    ? (raw as KnowledgeSourceDto)
    : null;
}

function mapRow(r: KnowledgeRow): KnowledgeEntryDto {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    tags: r.tags ?? [],
    confidence: toNum(r.confidence),
    status: r.status as KnowledgeStatusDto,
    source: coerceSource(r.source),
    sourceSession: r.source_session,
    pinned: r.pinned,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/**
 * List knowledge entries (newest first), optionally filtered by status.
 * Bounded by `input.limit` (validated + capped in the shared schema).
 */
export async function listKnowledge(
  input: KnowledgeListInput,
): Promise<Result<KnowledgeListResult, VexError>> {
  return withClient(async (client) => {
    try {
      const params: unknown[] = [];
      let whereClause = "";
      if (input.status !== undefined) {
        params.push(input.status);
        whereClause = `WHERE status = $${params.length}`;
      }
      params.push(input.limit);
      const limitParam = params.length;
      const result = await client.query<KnowledgeRow>(
        `SELECT id, kind, title, summary, tags, confidence, status, source,
                source_session, pinned, created_at, updated_at
           FROM knowledge_entries
           ${whereClause}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${limitParam}`,
        params,
      );
      return ok(result.rows.map(mapRow));
    } catch (cause) {
      return dbError("listKnowledge query failed", cause);
    }
  });
}
