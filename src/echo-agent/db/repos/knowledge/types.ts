/**
 * Knowledge repo — row types, domain types, mappers.
 *
 * Pure-data module: interfaces + pg-row → domain conversions + small pgvector
 * serialization helpers. No imports from other submodules; everyone imports
 * from here. Prevents circular imports inside `./knowledge/`.
 */

import type { KnowledgeStatus } from "@echo-agent/knowledge/policy.js";
import type { RecallCandidate } from "@echo-agent/knowledge/ranking.js";

// ── Internal row types (not exported) ───────────────────────────

export interface KnowledgeRow {
  id: number;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[] | null;
  source_refs: Record<string, unknown> | null;
  confidence: number | null;
  status: string;
  pinned: boolean;
  valid_from: string;
  valid_until: string | null;
  content_hash: string;
  embedding_model: string;
  embedding_dim: number;
  source_surface: string;
  source_session: string | null;
  supersedes_id: number | null;
  status_reason: string | null;
  change_summary: string | null;
  what_failed: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRowWithInsertFlag extends KnowledgeRow {
  inserted: boolean;
}

export interface KnowledgeRecallRow extends KnowledgeRow {
  /** pgvector returns cosine distance via `<=>`; we expose similarity = 1 - distance. */
  cosine_distance: number;
}

// ── Public domain types ─────────────────────────────────────────

export interface KnowledgeEntry {
  id: number;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  sourceRefs: Record<string, unknown>;
  confidence: number | null;
  status: KnowledgeStatus;
  pinned: boolean;
  validFrom: string;
  validUntil: string | null;
  contentHash: string;
  embeddingModel: string;
  embeddingDim: number;
  sourceSurface: "echo_agent" | "mcp_local";
  sourceSession: string | null;
  /** FK to predecessor row this entry replaces (set by knowledge_supersede), or null. */
  supersedesId: number | null;
  /** Short "why" for any non-active status transition (superseded / invalidated / archived). */
  statusReason: string | null;
  /** Supersede-only: what's different about this new version. NULL on predecessors and plain entries. */
  changeSummary: string | null;
  /** Supersede-only: evidence that invalidated the predecessor. NULL on predecessors and plain entries. */
  whatFailed: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * getById() extension that also resolves the reverse lineage link:
 * `supersededBy` — the id of the row whose `supersedes_id = this.id`, or null.
 *
 * Single-successor lineage is enforced by the partial unique index on
 * `supersedes_id`, so this is at most one row.
 */
export interface KnowledgeEntryWithLineage extends KnowledgeEntry {
  supersededBy: number | null;
}

export interface ActiveKnowledgeListItem {
  id: number;
  kind: string;
  title: string;
  summary: string;
  pinned: boolean;
  validUntil: string | null;
  updatedAt: string;
}

export interface KnownKind {
  kind: string;
  count: number;
}

export interface InsertEntryInput {
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  sourceRefs: Record<string, unknown>;
  confidence: number | null;
  pinned: boolean;
  validUntil: Date | null;
  contentHash: string;
  embeddingModel: string;
  embeddingDim: number;
  /** Vector as plain number[]. Must match embeddingDim. Serialized to pgvector literal. */
  embedding: number[];
  // ── Optional provenance fields. Default 'echo_agent' / NULL when omitted.
  // Production MCP server (`src/mcp`) passes 'mcp_local' + its session id.
  sourceSurface?: "echo_agent" | "mcp_local";
  sourceSession?: string;
  // ── Optional audit fields (used by knowledge-import to preserve roundtrip).
  // knowledge_write does NOT pass these — defaults `'active'` / NOW() apply.
  status?: KnowledgeStatus;
  validFrom?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  // ── Optional lifecycle fields. knowledge_write leaves all null; knowledge_supersede
  // populates supersedesId + changeSummary + whatFailed on the new row; import v2
  // may set any of them when restoring historical state.
  supersedesId?: number | null;
  statusReason?: string | null;
  changeSummary?: string | null;
  whatFailed?: string | null;
  // ── Promotion provenance (PR4 Fase IV, migration 010). All three are
  // populated by the promotion pipeline; left undefined for entries written
  // via knowledge_write / knowledge_supersede.
  sourceEpisodeId?: number | null;
  sourceEpisodeHash?: string | null;
  promotionVersion?: number | null;
}

export interface InsertEntryResult {
  entry: KnowledgeEntry;
  /** True iff the row was newly inserted; false iff it already existed (content_hash collision). */
  inserted: boolean;
}

export interface RecallFilters {
  /** Required — current embedding model identifier. Recall ONLY returns rows produced by this model. */
  embeddingModel: string;
  /** Required — current embedding dim. Recall ONLY returns rows with matching dim (mixed-dim crash protection). */
  embeddingDim: number;
  /** Optional kind filter (free-form, no enum). */
  kind?: string;
  /** If true, include entries past their TTL. Default: true (TTL ≠ existence). */
  includeExpired?: boolean;
}

export interface ListActiveOptions {
  limit: number;
}

export interface ListKnownKindsOptions {
  limit: number;
}

/**
 * Export row shape: KnowledgeEntry plus the predecessor's content_hash (stable
 * cross-DB identifier). `supersedes_id` (local integer FK) is deliberately NOT
 * in the export — IDs are unstable across installations. The importer resolves
 * `supersedesContentHash` back to a local id via `findByContentHash`.
 */
export interface KnowledgeEntryForExport extends KnowledgeEntry {
  /** content_hash of the predecessor row (resolved via self-join), or null. */
  supersedesContentHash: string | null;
}

export interface ReembedRow {
  id: number;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
}

/**
 * Discriminated outcome of `updateStatus`.
 *
 * The previous boolean return could not distinguish "row didn't exist" from
 * "row exists but wasn't active" — after introducing the superseded lifecycle,
 * that distinction matters: blindly overwriting a row's status violates the
 * invariant that each row transitions from active at most once.
 */
export type UpdateStatusResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_active"; currentStatus: KnowledgeStatus };

// ── Mappers + helpers ───────────────────────────────────────────

export function mapRow(r: KnowledgeRow): KnowledgeEntry {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    tags: r.tags ?? [],
    sourceRefs: r.source_refs ?? {},
    confidence: r.confidence,
    status: r.status as KnowledgeStatus,
    pinned: r.pinned,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    contentHash: r.content_hash,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    sourceSurface: (r.source_surface as "echo_agent" | "mcp_local") ?? "echo_agent",
    sourceSession: r.source_session,
    supersedesId: r.supersedes_id,
    statusReason: r.status_reason,
    changeSummary: r.change_summary,
    whatFailed: r.what_failed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapRowToCandidate(r: KnowledgeRecallRow): RecallCandidate {
  // pgvector cosine distance is in [0, 2]; for normalized vectors it's in [0, 2] too
  // but TEI/embedding models normalize, so distance ∈ [0, 2]. Similarity = 1 - distance/2
  // is one convention; another is similarity = 1 - distance for unit-norm L2-distance.
  // pgvector docs use `1 - (embedding <=> query)` for similarity, treating distance as
  // cosine distance ∈ [0, 2]. We follow that.
  const similarity = clampUnit(1 - r.cosine_distance);
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    similarity,
    confidence: r.confidence,
    status: r.status as KnowledgeStatus,
    pinned: r.pinned,
    validUntil: r.valid_until ? new Date(r.valid_until) : null,
    validFrom: new Date(r.valid_from),
    updatedAt: new Date(r.updated_at),
    sourceRefs: r.source_refs ?? {},
    tags: r.tags ?? [],
  };
}

export function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Serialize a number[] to a pgvector literal: `[0.1,0.2,...]`.
 *
 * pgvector accepts text-format vectors via `$1::vector` cast. We do this in TS
 * so we don't need a special pg type adapter.
 */
export function vectorLiteral(v: readonly number[]): string {
  // Use minimal precision sufficient for embedding vectors. Float32 is what TEI returns.
  return "[" + v.join(",") + "]";
}

export function toIsoOrNull(d: Date | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ── Lineage / history (read-only browse) ─────────────────────────

/**
 * Compact lineage node — one entry in a version chain. Excludes embedding,
 * content_md, content_hash and source_refs because lineage browse must stay
 * cheap even for long chains. Use `getById` (or `knowledge_get`) when you
 * need the full entry.
 */
export interface KnowledgeLineageItem {
  id: number;
  kind: string;
  title: string;
  status: KnowledgeStatus;
  /** FK to predecessor in this chain, or null for the root. */
  supersedesId: number | null;
  /** "why" for any non-active transition (set on superseded/invalidated/archived rows). */
  statusReason: string | null;
  /** Successor-only: what's different about this node vs its predecessor. */
  changeSummary: string | null;
  /** Successor-only: evidence that invalidated the predecessor. */
  whatFailed: string | null;
  validFrom: string;
  validUntil: string | null;
  updatedAt: string;
}

/**
 * Result of `getLineageChain(id)` — the full ordered chain with head metadata.
 *
 * `chain` is ordered root → head, regardless of where `requestedId` sits.
 * `headId` is the id of the last entry in the chain (no successor exists);
 * `headStatus` lets the caller tell at a glance whether the chain is still
 * active or terminated on invalidated/archived without a follow-up fetch.
 */
export interface KnowledgeLineageResult {
  /** The id originally requested (may be root, middle, or head). */
  requestedId: number;
  /** Last-in-chain id — the entry no other row supersedes. */
  headId: number;
  /** Status of the head node. */
  headStatus: KnowledgeStatus;
  /** Ordered chain root → head. Length ≥ 1. */
  chain: KnowledgeLineageItem[];
}

/** Status filter set accepted by `listHistory`. Keep in sync with the tool's enum. */
export type HistoryStatus = KnowledgeStatus;

export interface ListHistoryFilters {
  /**
   * Optional status filter. When omitted, the repo returns only NON-ACTIVE
   * rows (superseded ∪ invalidated ∪ archived) — `active` browsing is opt-in
   * via this parameter. Tool description carries the same wording.
   */
  status?: HistoryStatus;
  /** Optional free-form snake_case kind filter. */
  kind?: string;
  /** Required — caller-clamped limit (handler clamps to [1,100]). */
  limit: number;
}

/**
 * One row in `listHistory` output. Same compact shape as a lineage node so
 * downstream UIs / agent reasoning can treat them uniformly. No content_md
 * — list browse is metadata-only.
 */
export type KnowledgeHistoryListItem = KnowledgeLineageItem;
