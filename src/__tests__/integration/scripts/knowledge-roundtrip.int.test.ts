/**
 * Integration: knowledge export → wipe → import round-trip (FIX-2 evidence).
 *
 * Proves the v3 backup format preserves EVERY durable field — provenance
 * (`source`), lifecycle audit (status / status_reason / valid_from /
 * valid_until / created_at / updated_at), and the memory-v2 influence +
 * bi-temporal block (maturity_state, activation_strength, influence_scope,
 * decay_policy, regime_tags, first_promoted_at / last_reinforced_at /
 * next_review_at, outcome_version) — through a full programmatic
 * export-to-file → targeted DELETE → import-from-file cycle against the real
 * DB. Embeddings are deliberately NOT exported: import re-embeds with the
 * live endpoint, so the assertion is "non-null vector + provider model
 * stamped", never vector equality.
 *
 * Seeds use NON-DEFAULT values everywhere defaults exist, so a regression
 * that silently re-defaults a column (the original FIX-2 bug class) fails
 * loudly instead of passing by coincidence.
 *
 * Uses the PROGRAMMATIC APIs (`exportKnowledge` / `importKnowledge`) — no
 * CLI spawning — and a TARGETED `DELETE FROM knowledge_entries` (NOT
 * `resetDb`) so `maintenance_leases` / `schema_version` stay intact.
 */

import { mkdtempSync, writeFileSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execute, query, queryOne } from "@vex-agent/db/client.js";
import {
  findByContentHash,
  insertEntry,
  type InsertEntryInput,
} from "@vex-agent/db/repos/knowledge.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { exportKnowledge } from "@vex-agent/scripts/knowledge-export.js";
import { importKnowledge } from "@vex-agent/scripts/knowledge-import.js";
import { randVector } from "../setup/fixtures.js";

const SEED_EMBEDDING_MODEL = "seed-model-int-test";
const SEED_EMBEDDING_DIM = 8;

/** ISO-normalize a timestamp that may surface as a Date or an ISO string. */
function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}

interface SeedSpec {
  readonly input: InsertEntryInput;
  readonly contentHash: string;
}

function seed(spec: {
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  overrides: Partial<InsertEntryInput>;
}): SeedSpec {
  const contentHash = computeContentHash({
    kind: spec.kind,
    title: spec.title,
    summary: spec.summary,
    contentMd: spec.contentMd,
  });
  return {
    contentHash,
    input: {
      kind: spec.kind,
      title: spec.title,
      summary: spec.summary,
      contentMd: spec.contentMd,
      tags: [],
      sourceRefs: {},
      confidence: null,
      pinned: false,
      validUntil: null,
      contentHash,
      embeddingModel: SEED_EMBEDDING_MODEL,
      embeddingDim: SEED_EMBEDDING_DIM,
      embedding: randVector(SEED_EMBEDDING_DIM, contentHash),
      ...spec.overrides,
    },
  };
}

// ── Seeds: non-default values across all durable columns ─────────

// A — the "every memory-v2 field non-default" entry (plan-mandated values).
const seedA = seed({
  kind: "strategy_lesson",
  title: "Roundtrip A — reinforced retrieval-boost lesson",
  summary: "Inferred lesson with full influence block",
  contentMd: "# Lesson A\nBody survives byte-identically.",
  overrides: {
    tags: ["risk", "kyber"],
    sourceRefs: { messageIds: [11, 12] },
    confidence: 0.83,
    pinned: true,
    status: "active",
    validFrom: new Date("2026-01-02T03:04:05.000Z"),
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    sourceSurface: "vex_agent",
    sourceSession: "roundtrip-session-a",
    source: "inferred",
    maturityState: "reinforced",
    activationStrength: 0.42,
    influenceScope: "retrieval_boost",
    decayPolicy: "regime_aware",
    regimeTags: ["bull", "high_vol"],
    firstPromotedAt: new Date("2026-02-01T00:00:00.000Z"),
    lastReinforcedAt: new Date("2026-03-01T00:00:00.000Z"),
    nextReviewAt: new Date("2026-04-01T00:00:00.000Z"),
    outcomeVersion: 3,
  },
});

// B — status variety: archived with audit reason, decayed maturity.
const seedB = seed({
  kind: "risk_rule",
  title: "Roundtrip B — archived decayed rule",
  summary: "Archived rule with status_reason",
  contentMd: "Body B.",
  overrides: {
    tags: ["legacy"],
    confidence: null,
    status: "archived",
    statusReason: "obsolete after venue rotation",
    validFrom: new Date("2025-06-01T00:00:00.000Z"),
    createdAt: new Date("2025-06-01T00:00:00.000Z"),
    updatedAt: new Date("2025-12-01T00:00:00.000Z"),
    source: "user_confirmed",
    maturityState: "decayed",
    activationStrength: 0.05,
    influenceScope: "advisory",
    decayPolicy: "time",
    regimeTags: [],
    lastReinforcedAt: new Date("2025-08-15T12:00:00.000Z"),
    outcomeVersion: 0,
  },
});

// C — hypothesis provenance, probationary maturity, review scheduled.
const seedC = seed({
  kind: "market_observation",
  title: "Roundtrip C — probationary hypothesis",
  summary: "Hypothesis pending review",
  contentMd: "Body C.",
  overrides: {
    status: "active",
    validFrom: new Date("2026-05-01T00:00:00.000Z"),
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    source: "hypothesis",
    maturityState: "probationary",
    activationStrength: 0.9,
    decayPolicy: "outcome_aware",
    nextReviewAt: new Date("2026-07-01T00:00:00.000Z"),
    outcomeVersion: 1,
  },
});

const SEEDS = [seedA, seedB, seedC];

async function* readLines(file: string): AsyncIterable<string> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    yield line;
  }
}

describe("knowledge export → wipe → import round-trip (integration, FIX-2)", () => {
  beforeAll(async () => {
    // Targeted clean: the export streams the WHOLE table, so prior suite
    // residue must go — but ONLY knowledge_entries (never resetDb here).
    await execute("DELETE FROM knowledge_entries");
    // Defensive: re-seed the maintenance-lease singleton in case an earlier
    // test file's resetDb truncated it (the import path takes the lease's
    // SHARE lock and fails loudly when the row is missing). Idempotent —
    // mirrors the migration-009 seed exactly.
    await execute(
      `INSERT INTO maintenance_leases (id, owner_id, active)
       VALUES (1, '', FALSE)
       ON CONFLICT (id) DO NOTHING`,
    );
    for (const s of SEEDS) {
      const { inserted } = await insertEntry(s.input);
      expect(inserted).toBe(true);
    }
  });

  afterAll(async () => {
    await execute("DELETE FROM knowledge_entries");
  });

  it(
    "preserves every durable field through export → DELETE → import, re-deriving only the embedding",
    { timeout: 60_000 },
    async () => {
      // 1. Programmatic export to a temp dir (no CLI spawning).
      const tmpDir = mkdtempSync(join(tmpdir(), "vex-knowledge-roundtrip-"));
      const exportPath = join(tmpDir, "knowledge-export.jsonl");
      const chunks: string[] = [];
      const exportedCount = await exportKnowledge({
        write: (chunk: string) => {
          chunks.push(chunk);
        },
      });
      writeFileSync(exportPath, chunks.join(""), "utf-8");
      expect(exportedCount).toBe(SEEDS.length);

      // 2. Targeted wipe — knowledge_entries ONLY (maintenance_leases and
      //    schema_version must stay intact; resetDb is deliberately NOT used).
      await execute("DELETE FROM knowledge_entries");
      const empty = await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM knowledge_entries",
      );
      expect(empty[0]?.n).toBe(0);

      // 3. Programmatic import from the export file (re-embeds live).
      const report = await importKnowledge(readLines(exportPath));
      expect(report).toEqual({
        inserted: SEEDS.length,
        skipped_duplicate: 0,
        failed: 0,
        total: SEEDS.length,
      });

      // 4. Field-level fidelity per seed.
      for (const s of SEEDS) {
        const restored = await findByContentHash(s.contentHash);
        expect(restored, s.input.title).not.toBeNull();
        if (restored === null) continue;
        const input = s.input;

        // Text payload — byte-identical.
        expect(restored.kind).toBe(input.kind);
        expect(restored.title).toBe(input.title);
        expect(restored.summary).toBe(input.summary);
        expect(restored.contentMd).toBe(input.contentMd);
        expect(restored.tags).toEqual(input.tags);
        expect(restored.sourceRefs).toEqual(input.sourceRefs);

        // Lifecycle audit.
        expect(restored.status).toBe(input.status ?? "active");
        expect(restored.statusReason).toBe(input.statusReason ?? null);
        expect(restored.pinned).toBe(input.pinned);
        expect(iso(restored.validFrom)).toBe(iso(input.validFrom ?? null));
        expect(iso(restored.validUntil)).toBe(iso(input.validUntil));
        expect(iso(restored.createdAt)).toBe(iso(input.createdAt ?? null));
        expect(iso(restored.updatedAt)).toBe(iso(input.updatedAt ?? null));

        // Provenance (the original FIX-2 regression: v1/v2 dropped `source`).
        expect(restored.source).toBe(input.source ?? "observed");
        expect(restored.sourceSurface).toBe(input.sourceSurface ?? "vex_agent");
        expect(restored.sourceSession).toBe(input.sourceSession ?? null);

        // Confidence (REAL column — float4 precision).
        if (input.confidence === null) {
          expect(restored.confidence).toBeNull();
        } else {
          expect(restored.confidence).not.toBeNull();
          expect(restored.confidence ?? 0).toBeCloseTo(input.confidence, 5);
        }

        // Memory-v2 influence + bi-temporal block.
        expect(restored.maturityState).toBe(input.maturityState ?? "established");
        expect(restored.activationStrength).toBeCloseTo(
          input.activationStrength ?? 1.0,
          5,
        );
        expect(restored.influenceScope).toBe(input.influenceScope ?? "advisory");
        expect(restored.decayPolicy).toBe(input.decayPolicy ?? "none");
        expect(restored.regimeTags).toEqual(input.regimeTags ?? []);
        expect(iso(restored.firstPromotedAt)).toBe(
          iso(input.firstPromotedAt ?? null),
        );
        expect(iso(restored.lastReinforcedAt)).toBe(
          iso(input.lastReinforcedAt ?? null),
        );
        expect(iso(restored.nextReviewAt)).toBe(iso(input.nextReviewAt ?? null));
        expect(restored.outcomeVersion).toBe(input.outcomeVersion ?? 0);

        // Embedding is RE-DERIVED, never round-tripped: non-null vector,
        // provider model stamped (NOT the seed marker), sane dim. Vector
        // equality is deliberately NOT asserted.
        const embeddingRow = await queryOne<{
          has_embedding: boolean;
          embedding_model: string;
          embedding_dim: number;
        }>(
          `SELECT (embedding IS NOT NULL) AS has_embedding,
                  embedding_model, embedding_dim
             FROM knowledge_entries
            WHERE content_hash = $1`,
          [s.contentHash],
        );
        expect(embeddingRow?.has_embedding).toBe(true);
        expect(embeddingRow?.embedding_model).not.toBe("");
        expect(embeddingRow?.embedding_model).not.toBe(SEED_EMBEDDING_MODEL);
        expect(embeddingRow?.embedding_dim ?? 0).toBeGreaterThan(0);
      }

      // 5. No extra rows materialized.
      const finalCount = await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM knowledge_entries",
      );
      expect(finalCount[0]?.n).toBe(SEEDS.length);

      // 6. Idempotency: re-importing the same backup is a pure no-op
      //    (dedup on recomputed content_hash — zero embed calls needed).
      const rerun = await importKnowledge(readLines(exportPath));
      expect(rerun).toEqual({
        inserted: 0,
        skipped_duplicate: SEEDS.length,
        failed: 0,
        total: SEEDS.length,
      });
    },
  );
});
