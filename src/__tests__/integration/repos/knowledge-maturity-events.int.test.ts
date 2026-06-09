/**
 * Integration (real pgvector): the S6a maturity FSM end-to-end on a fresh DB.
 *
 * Covers the risk surface the non-DB unit tests cannot:
 *   - `recordMaturityEvent` writes an append-only audit row with the bounded
 *     enums + the DB CHECKs accept the closed vocabulary;
 *   - `reinforceEntry` on a recurrence: activation↑, maturity advances
 *     (probationary → established → reinforced), `last_reinforced_at` bumped, one
 *     audit row per transition;
 *   - decay via `decayEntry`/`runDecaySweep` LOWERS activation without deleting
 *     the row, floors it > 0, and tips the entry to `decayed` — the row survives;
 *   - decayed → established REACTIVATION via a fresh reinforcement (audit
 *     `reactivated`);
 *   - `none` policy is frozen (the sweep skips it);
 *   - the audit anchor (`entry_id`) is a plain non-FK column.
 *
 * Seeds knowledge_entries via raw SQL (no embeddings endpoint) — the maturity
 * path never re-embeds.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import {
  recordMaturityEvent,
  getMaturityEventsForEntry,
} from "@vex-agent/db/repos/knowledge-maturity-events/index.js";
import {
  getMaturityEntry,
  listDecayableEntries,
} from "@vex-agent/db/repos/knowledge/crud.js";
import { recallLongMemoryTopK } from "@vex-agent/db/repos/knowledge/recall.js";
import { reinforceEntry, decayEntry } from "@vex-agent/memory/manager/maturity.js";
import {
  DECAY_FLOOR,
  REACTIVATION_ACTIVATION,
  REINFORCE_STEP,
} from "@vex-agent/memory/manager/maturity-policy.js";
import { withTransaction } from "@vex-agent/db/client.js";
import { resetDb, randVector } from "../setup/fixtures.js";
import { hex64, EMBEDDING_DIM, EMBEDDING_MODEL } from "./_s1c-fixtures.js";

/** Seed a knowledge_entries row with explicit maturity/activation/decay state. */
async function seedEntry(args: {
  seed: string;
  maturityState: string;
  activation: number;
  decayPolicy: string;
  lastReinforcedAt: string | null;
  firstPromotedAt?: string | null;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_hash, embedding_model, embedding_dim, embedding,
        source, maturity_state, activation_strength, decay_policy,
        first_promoted_at, last_reinforced_at)
     VALUES ('strategy_lesson', 't', 's', $1, $2, $3, $4::vector,
        'observed', $5, $6, $7, $8::timestamptz, $9::timestamptz)
     RETURNING id`,
    [
      hex64(`kme-${args.seed}`),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      `[${randVector(EMBEDDING_DIM, args.seed).join(",")}]`,
      args.maturityState,
      args.activation,
      args.decayPolicy,
      args.firstPromotedAt ?? args.lastReinforcedAt,
      args.lastReinforcedAt,
    ],
  );
  return rows[0]!.id;
}

async function readEntry(id: number): Promise<{
  maturity_state: string;
  activation_strength: number;
  last_reinforced_at: string | null;
}> {
  const rows = await query<{
    maturity_state: string;
    activation_strength: number;
    last_reinforced_at: string | null;
  }>(
    "SELECT maturity_state, activation_strength, last_reinforced_at FROM knowledge_entries WHERE id = $1",
    [id],
  );
  return rows[0]!;
}

describe("knowledge maturity FSM (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("recordMaturityEvent appends an immutable audit row with the bounded enums", async () => {
    const id = await seedEntry({
      seed: "audit",
      maturityState: "probationary",
      activation: 0.5,
      decayPolicy: "regime_aware",
      lastReinforcedAt: "2026-01-01T00:00:00Z",
    });

    const rec = await recordMaturityEvent({
      entryId: id,
      event: "matured",
      fromState: "probationary",
      toState: "established",
      reasonCode: "recurrence_confirmation",
      activationBefore: 0.5,
      activationAfter: 0.75,
      triggerRefs: { executionId: 9 },
      decidedBy: "system",
      rationale: "second confirmation",
    });

    expect(rec.event).toBe("matured");
    const history = await getMaturityEventsForEntry(id);
    expect(history).toHaveLength(1);
    expect(history[0]!.reasonCode).toBe("recurrence_confirmation");
    expect(history[0]!.triggerRefs).toEqual({ executionId: 9 });

    // entry_id is a plain non-FK anchor (column has no FK constraint).
    const fk = await query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
        WHERE tc.table_name = 'knowledge_maturity_events'
          AND tc.constraint_type = 'FOREIGN KEY'`,
    );
    expect(fk[0]!.n).toBe("0");
  });

  it("reinforceEntry on recurrence advances the FSM, bumps activation + last_reinforced_at, audits", async () => {
    const id = await seedEntry({
      seed: "reinf",
      maturityState: "probationary",
      activation: 0.5,
      decayPolicy: "regime_aware",
      lastReinforcedAt: "2026-01-01T00:00:00Z",
    });

    // First confirmation: probationary → established.
    await withTransaction((tx) => reinforceEntry(id, { candidateId: "11111111-1111-4111-8111-111111111111" }, tx));
    let row = await readEntry(id);
    expect(row.maturity_state).toBe("established");
    expect(row.activation_strength).toBeCloseTo(0.5 + REINFORCE_STEP, 6);
    expect(row.last_reinforced_at).not.toBe("2026-01-01T00:00:00.000Z");

    // Second confirmation: established → reinforced.
    await withTransaction((tx) => reinforceEntry(id, {}, tx));
    row = await readEntry(id);
    expect(row.maturity_state).toBe("reinforced");

    const history = await getMaturityEventsForEntry(id);
    expect(history.map((h) => h.event)).toEqual(["matured", "matured"]); // newest first; both tier advances
    expect(history.every((h) => h.reasonCode === "recurrence_confirmation")).toBe(true);
  });

  it("decay lowers activation, floors it > 0, tips to decayed, and NEVER deletes the row", async () => {
    // last_reinforced_at far in the past → strong decay below the threshold.
    const id = await seedEntry({
      seed: "decay",
      maturityState: "established",
      activation: 0.5,
      decayPolicy: "regime_aware",
      lastReinforcedAt: "2020-01-01T00:00:00Z",
    });

    const entry = await getMaturityEntry(id);
    expect(entry).not.toBeNull();
    const result = await decayEntry(entry!, new Date());
    expect(result.ok).toBe(true);

    const row = await readEntry(id);
    expect(row.activation_strength).toBeGreaterThan(0); // never 0 / deleted
    expect(row.activation_strength).toBeGreaterThanOrEqual(DECAY_FLOOR);
    expect(row.activation_strength).toBeLessThan(0.5); // eroded
    expect(row.maturity_state).toBe("decayed"); // tipped below the threshold

    // The row still exists (decay is influence erosion, never deletion).
    const stillThere = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM knowledge_entries WHERE id = $1",
      [id],
    );
    expect(stillThere[0]!.n).toBe("1");

    const history = await getMaturityEventsForEntry(id);
    expect(history[0]!.event).toBe("decayed");
    expect(history[0]!.reasonCode).toBe("time_decay");
  });

  it("reactivates a decayed entry to established on a fresh recurrence (decayed is never a dead end)", async () => {
    const id = await seedEntry({
      seed: "react",
      maturityState: "decayed",
      activation: DECAY_FLOOR,
      decayPolicy: "regime_aware",
      lastReinforcedAt: "2020-01-01T00:00:00Z",
    });

    await withTransaction((tx) => reinforceEntry(id, {}, tx));
    const row = await readEntry(id);
    expect(row.maturity_state).toBe("established");
    expect(row.activation_strength).toBeCloseTo(REACTIVATION_ACTIVATION, 6);

    const history = await getMaturityEventsForEntry(id);
    expect(history[0]!.event).toBe("reactivated");
    expect(history[0]!.reasonCode).toBe("recurrence_confirmation");
  });

  it("recallLongMemoryTopK surfaces activation_strength for the rerank factor", async () => {
    const id = await seedEntry({
      seed: "recall",
      maturityState: "established",
      activation: 0.42,
      decayPolicy: "regime_aware",
      lastReinforcedAt: "2026-01-01T00:00:00Z",
    });
    const candidates = await recallLongMemoryTopK(
      randVector(EMBEDDING_DIM, "recall"),
      { embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM },
      8,
    );
    const hit = candidates.find((c) => c.id === id);
    expect(hit).toBeDefined();
    expect(hit!.activationStrength).toBeCloseTo(0.42, 6);
  });

  it("the decay sweep query skips 'none'-policy (frozen) entries", async () => {
    await seedEntry({
      seed: "frozen",
      maturityState: "established",
      activation: 1.0,
      decayPolicy: "none",
      lastReinforcedAt: "2020-01-01T00:00:00Z",
    });
    const decayable = await seedEntry({
      seed: "active",
      maturityState: "established",
      activation: 0.5,
      decayPolicy: "regime_aware",
      lastReinforcedAt: "2020-01-01T00:00:00Z",
    });

    const batch = await listDecayableEntries({ afterId: 0, limit: 100 });
    const ids = batch.map((e) => e.id);
    expect(ids).toContain(decayable);
    expect(ids).not.toContain(
      // the 'none' entry must be excluded
      batch.find((e) => e.decayPolicy === "none")?.id,
    );
  });
});
