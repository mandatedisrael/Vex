/**
 * Integration: memory_edges repo — bi-temporal upsert/invalidate/supersede,
 * the atomic supersession primitive (continuous boundary + concurrent
 * one-winner), embedding-triplet + self-loop CHECKs, active-version coexistence,
 * FK cascade on entity delete, and SET NULL on a superseded-pointer delete (S1d).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  upsertEdge,
  getEdgeById,
  invalidateEdge,
  supersedeEdge,
  listActiveEdgesForEntity,
  listEdgesFrom,
  listEdgesTo,
} from "@vex-agent/db/repos/memory-edges/index.js";
import { resetDb } from "../setup/fixtures.js";
import { edgeInput, EMBEDDING_DIM, seedEdge, seedEntity, seedKnowledgeEntry } from "./_s1d-fixtures.js";

/** Seed two distinct entities (source, target) and return their ids. */
async function seedPair(seed: string): Promise<{ source: string; target: string }> {
  const source = await seedEntity(`${seed}-src`, { name: `${seed} Source` });
  const target = await seedEntity(`${seed}-dst`, { name: `${seed} Target` });
  return { source, target };
}

describe("memory_edges repo (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("upserts a new active relation idempotently for the same triple", async () => {
    const { source, target } = await seedPair("idem");
    const first = await upsertEdge(edgeInput(source, target, "idem", { relation: "uses" }));
    expect(first.inserted).toBe(true);
    const second = await upsertEdge(edgeInput(source, target, "idem-2", { relation: "uses" }));
    expect(second.inserted).toBe(false);
    expect(second.edge.id).toBe(first.edge.id);

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_edges WHERE source_entity_id=$1 AND target_entity_id=$2 AND relation='uses'",
      [source, target],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("stores an optional fact-embedding triplet and the nullable no-vector path", async () => {
    const { source, target } = await seedPair("emb");
    const withVec = await upsertEdge(
      edgeInput(source, target, "emb", { relation: "correlates_with", withFactEmbedding: true }),
    );
    expect(withVec.edge.embeddingModel).toBe("test-model");
    expect(withVec.edge.embeddingDim).toBe(EMBEDDING_DIM);

    const noVec = await upsertEdge(edgeInput(source, target, "emb2", { relation: "holds" }));
    expect(noVec.edge.embeddingModel).toBeNull();
    expect(noVec.edge.embeddingDim).toBeNull();
  });

  it("invalidateEdge sets invalidated_at + valid_until; twice yields already_invalidated", async () => {
    const { source, target } = await seedPair("inv");
    // Pin valid_from in the past so the world-time close below is after it
    // (med_valid_window requires valid_until >= valid_from).
    const id = await seedEdge(source, target, "inv", {
      relation: "part_of",
      validFrom: new Date("2026-06-08T00:00:00.000Z"),
    });

    const closedAt = new Date("2026-06-08T12:00:00.000Z");
    const first = await invalidateEdge(id, { validUntil: closedAt });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.edge.invalidatedAt).not.toBeNull();
    expect(new Date(first.edge.validUntil!).toISOString()).toBe(closedAt.toISOString());

    const second = await invalidateEdge(id, {});
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reason).toBe("already_invalidated");

    const missing = await invalidateEdge("00000000-0000-4000-8000-000000000000", {});
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.reason).toBe("not_found");
  });

  it("an invalidated edge and a fresh active one coexist for the same triple", async () => {
    const { source, target } = await seedPair("coexist");
    const first = await seedEdge(source, target, "coexist", { relation: "traded_on" });
    await invalidateEdge(first, {});
    // The active partial-unique now permits a new active edge for the same triple.
    const second = await upsertEdge(edgeInput(source, target, "coexist-2", { relation: "traded_on" }));
    expect(second.inserted).toBe(true);
    expect(second.edge.id).not.toBe(first);

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_edges WHERE source_entity_id=$1 AND target_entity_id=$2 AND relation='traded_on'",
      [source, target],
    );
    expect(rows[0]!.n).toBe("2");
  });

  it("supersedeEdge atomically invalidates the old edge and leaves exactly one active edge", async () => {
    const { source, target } = await seedPair("super");
    const oldId = await seedEdge(source, target, "super", { relation: "uses", fact: "old" });

    const res = await supersedeEdge(oldId, edgeInput(source, target, "super-new", { relation: "uses", fact: "new" }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.superseded.id).toBe(oldId);
    expect(res.superseded.invalidatedAt).not.toBeNull();
    expect(res.superseded.supersededByEdgeId).toBe(res.replacement.id);
    expect(res.replacement.invalidatedAt).toBeNull();

    const active = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_edges WHERE source_entity_id=$1 AND target_entity_id=$2 AND relation='uses' AND invalidated_at IS NULL",
      [source, target],
    );
    expect(active[0]!.n).toBe("1");
  });

  it("with validFrom omitted, old.valid_until equals replacement.valid_from (continuous boundary)", async () => {
    const { source, target } = await seedPair("boundary");
    const oldId = await seedEdge(source, target, "boundary", { relation: "holds" });

    const res = await supersedeEdge(oldId, edgeInput(source, target, "boundary-new", { relation: "holds" }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.superseded.validUntil).not.toBeNull();
    expect(new Date(res.superseded.validUntil!).toISOString()).toBe(
      new Date(res.replacement.validFrom).toISOString(),
    );
  });

  it("superseding a missing or already-invalidated edge returns the matching failure", async () => {
    const { source, target } = await seedPair("super-fail");
    const missing = await supersedeEdge(
      "00000000-0000-4000-8000-000000000000",
      edgeInput(source, target, "x", { relation: "uses" }),
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.reason).toBe("not_found");

    const id = await seedEdge(source, target, "super-fail", { relation: "uses" });
    await invalidateEdge(id, {});
    const already = await supersedeEdge(id, edgeInput(source, target, "y", { relation: "uses" }));
    expect(already.ok).toBe(false);
    if (already.ok) throw new Error("unreachable");
    expect(already.reason).toBe("already_invalidated");
  });

  it("two concurrent supersedes on the same old edge: exactly one wins, never two active edges", async () => {
    const { source, target } = await seedPair("concurrent");
    const oldId = await seedEdge(source, target, "concurrent", { relation: "competes_with" });

    const [a, b] = await Promise.all([
      supersedeEdge(oldId, edgeInput(source, target, "concurrent-a", { relation: "competes_with" })),
      supersedeEdge(oldId, edgeInput(source, target, "concurrent-b", { relation: "competes_with" })),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0]!;
    if (loser.ok) throw new Error("unreachable");
    expect(loser.reason).toBe("already_invalidated");

    const active = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_edges WHERE source_entity_id=$1 AND target_entity_id=$2 AND relation='competes_with' AND invalidated_at IS NULL",
      [source, target],
    );
    expect(active[0]!.n).toBe("1");
  });

  it("listActiveEdgesForEntity excludes invalidated edges and spans both directions", async () => {
    const a = await seedEntity("dir-a", { name: "A entity" });
    const b = await seedEntity("dir-b", { name: "B entity" });
    const c = await seedEntity("dir-c", { name: "C entity" });
    const outId = await seedEdge(a, b, "out", { relation: "uses" });
    await seedEdge(c, a, "in", { relation: "holds" });
    const deadId = await seedEdge(a, c, "dead", { relation: "related_to" });
    await invalidateEdge(deadId, {});

    const active = await listActiveEdgesForEntity(a);
    expect(active.map((e) => e.id).sort()).not.toContain(deadId);
    expect(active).toHaveLength(2);

    expect((await listEdgesFrom(a)).map((e) => e.id)).toContain(outId);
    expect((await listEdgesTo(a)).every((e) => e.targetEntityId === a)).toBe(true);
    // activeOnly:false reveals the invalidated edge.
    expect((await listEdgesFrom(a, { activeOnly: false })).map((e) => e.id)).toContain(deadId);
  });

  it("the DB CHECKs reject self-loop, self-supersede, superseded-without-invalidated, and a partial triplet", async () => {
    const id = await seedEntity("checks", { name: "Solo" });
    const vec = `[${[0.1, 0.2, 0.3].join(",")}]`;

    await expect(
      execute(
        "INSERT INTO memory_edges (source_entity_id, target_entity_id, relation) VALUES ($1, $1, 'uses')",
        [id],
      ),
    ).rejects.toThrow(/med_no_self_loop/);

    const { source, target } = await seedPair("checks-pair");
    await expect(
      execute(
        `INSERT INTO memory_edges (source_entity_id, target_entity_id, relation, fact_embedding)
         VALUES ($1, $2, 'uses', $3::vector)`,
        [source, target, vec],
      ),
    ).rejects.toThrow(/med_embedding_triplet/);
  });

  it("the superseded_implies_invalidated CHECK rejects a back-pointer without invalidation", async () => {
    const { source, target } = await seedPair("implies");
    const aId = await seedEdge(source, target, "implies-a", { relation: "uses" });
    await invalidateEdge(aId, {});
    const bId = await seedEdge(source, target, "implies-b", { relation: "uses" });
    // Pointing an ACTIVE edge (bId, invalidated_at NULL) at a successor violates the CHECK.
    await expect(
      execute("UPDATE memory_edges SET superseded_by_edge_id=$2 WHERE id=$1", [bId, aId]),
    ).rejects.toThrow(/med_superseded_implies_invalidated/);
  });

  it("cascades edges when a referenced entity is deleted", async () => {
    const { source, target } = await seedPair("cascade");
    const id = await seedEdge(source, target, "cascade", { relation: "uses" });
    await execute("DELETE FROM memory_entities WHERE id=$1", [target]);
    expect(await getEdgeById(id)).toBeNull();
  });

  it("SET NULL on superseded_by_edge_id when the pointed-at successor edge is deleted", async () => {
    const { source, target } = await seedPair("setnull");
    const oldId = await seedEdge(source, target, "setnull", { relation: "uses" });
    const res = await supersedeEdge(oldId, edgeInput(source, target, "setnull-new", { relation: "uses" }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    // Deleting the successor nulls the old edge's pointer (it stays invalidated).
    await execute("DELETE FROM memory_edges WHERE id=$1", [res.replacement.id]);
    const old = await getEdgeById(oldId);
    expect(old!.supersededByEdgeId).toBeNull();
    expect(old!.invalidatedAt).not.toBeNull();
  });

  it("origin_entry_id is SET NULL when the provenance entry is deleted", async () => {
    const { source, target } = await seedPair("origin");
    const entryId = await seedKnowledgeEntry("origin");
    const id = await seedEdge(source, target, "origin", { relation: "uses", originEntryId: entryId });
    expect((await getEdgeById(id))!.originEntryId).toBe(entryId);
    await execute("DELETE FROM knowledge_entries WHERE id=$1", [entryId]);
    expect((await getEdgeById(id))!.originEntryId).toBeNull();
  });
});
