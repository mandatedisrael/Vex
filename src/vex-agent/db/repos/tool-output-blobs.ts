/**
 * Tool output blobs repo — ephemeral per-session storage for oversized
 * tool results. Schema lives in `013_tool_output_blobs.sql`.
 *
 * Lifecycle:
 *   - `writeBlob(blobKey, sessionId, payload, ttlMs)` — called by turn-loop
 *     when a tool result exceeds `TOOL_OUTPUT_OVERFLOW_BYTES`.
 *   - `readBlob(blobKey)` — used by the `tool_output_read` handler. Returns
 *     null when the blob is missing or already expired.
 *   - `cleanupExpired()` — lazy cleanup, called from read paths.
 *   - `refreshTtl(blobKeys, ttlMs)` — resume paths (mission / full-autonomous)
 *     bump TTLs for recent messages so long waits don't expire the blobs.
 *
 * Scope: per-session. `session_id` is persisted and handlers enforce the
 * match on read so no other session can access a session's blobs.
 */

import { createHash, randomBytes } from "node:crypto";

import { getPool, query, queryOne, execute } from "../client.js";
import { jsonb } from "../params.js";

// ── Types ───────────────────────────────────────────────────────

export type ToolOutputShapeKind = "text" | "json" | "list" | "unknown";

export interface ToolOutputBlobPayload {
  /** Full tool output text — verbatim from the tool handler. */
  fullOutput: string;
  /** Best-effort shape classification set by the producer. */
  shapeKind: ToolOutputShapeKind;
  /** Size in UTF-8 bytes — redundant with `fullOutput.length`, kept for indexing. */
  sizeBytes: number;
  /** Optional pointer into structured output (e.g. JSON path) for follow-up reads. */
  primaryPath?: string;
  /** Optional highlighted field names the producer thinks the agent will want. */
  fieldHints?: string[];
}

export interface ToolOutputBlob {
  blobKey: string;
  sessionId: string;
  payload: ToolOutputBlobPayload;
  expiresAt: string;
  createdAt: string;
}

interface ToolOutputBlobRow {
  blob_key: string;
  session_id: string;
  payload: ToolOutputBlobPayload;
  expires_at: string | Date;
  created_at: string | Date;
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : v;
}

function mapRow(r: ToolOutputBlobRow): ToolOutputBlob {
  return {
    blobKey: r.blob_key,
    sessionId: r.session_id,
    payload: r.payload,
    expiresAt: toIso(r.expires_at),
    createdAt: toIso(r.created_at),
  };
}

// ── Key generation ──────────────────────────────────────────────

/**
 * Generate a stable-looking blob key — `tob-<yyyymmdd>-<16hex>`. The
 * hash component is derived from session + toolName + callId + now.ms +
 * random so concurrent writes on the same turn stay unique even when the
 * provider reuses callIds (seen in rare recovery paths).
 */
export function generateBlobKey(
  sessionId: string,
  toolName: string,
  callId: string,
): string {
  const now = new Date();
  const yyyymmdd =
    now.getUTCFullYear().toString().padStart(4, "0") +
    (now.getUTCMonth() + 1).toString().padStart(2, "0") +
    now.getUTCDate().toString().padStart(2, "0");
  const seed = `${sessionId}:${toolName}:${callId}:${now.getTime()}:${randomBytes(4).toString("hex")}`;
  const hex = createHash("md5").update(seed).digest("hex").slice(0, 16);
  return `tob-${yyyymmdd}-${hex}`;
}

// ── Write ───────────────────────────────────────────────────────

export async function writeBlob(
  blobKey: string,
  sessionId: string,
  payload: ToolOutputBlobPayload,
  ttlMs: number,
): Promise<ToolOutputBlob> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const row = await queryOne<ToolOutputBlobRow>(
    `INSERT INTO tool_output_blobs (blob_key, session_id, payload, expires_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)
     RETURNING *`,
    [blobKey, sessionId, jsonb(payload), expiresAt.toISOString()],
  );
  if (!row) {
    throw new Error(`writeBlob: INSERT RETURNING produced no row for ${blobKey}`);
  }
  return mapRow(row);
}

// ── Read ────────────────────────────────────────────────────────

/**
 * Read a blob. Returns `null` when the row is missing or already expired.
 * Callers that follow up with `cleanupExpired()` keep the table compact.
 */
export async function readBlob(blobKey: string): Promise<ToolOutputBlob | null> {
  const row = await queryOne<ToolOutputBlobRow>(
    `SELECT * FROM tool_output_blobs
     WHERE blob_key = $1 AND expires_at > NOW()`,
    [blobKey],
  );
  return row ? mapRow(row) : null;
}

// ── Cleanup / refresh ───────────────────────────────────────────

export async function cleanupExpired(): Promise<number> {
  return execute("DELETE FROM tool_output_blobs WHERE expires_at <= NOW()");
}

/**
 * Bump TTL on every blob whose key appears in `blobKeys`. Returns the
 * number of rows actually refreshed (may be less than `blobKeys.length`
 * when some have already been purged).
 */
export async function refreshTtl(
  blobKeys: readonly string[],
  ttlMs: number,
): Promise<number> {
  if (blobKeys.length === 0) return 0;
  const newExpiry = new Date(Date.now() + ttlMs);
  return execute(
    `UPDATE tool_output_blobs
     SET expires_at = $2::timestamptz
     WHERE blob_key = ANY($1::text[])`,
    [blobKeys as string[], newExpiry.toISOString()],
  );
}

// ── Test-only helpers ───────────────────────────────────────────

export async function __deleteAllForSessionTestOnly(sessionId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "DELETE FROM tool_output_blobs WHERE session_id = $1",
    [sessionId],
  );
}

/** Low-level read that ignores TTL — test harnesses only. */
export async function __readIgnoringTtlTestOnly(blobKey: string): Promise<ToolOutputBlob | null> {
  const rows = await query<ToolOutputBlobRow>(
    "SELECT * FROM tool_output_blobs WHERE blob_key = $1",
    [blobKey],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}
