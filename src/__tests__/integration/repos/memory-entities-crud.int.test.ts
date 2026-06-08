/**
 * Integration: memory_entities repo — identity-keyed upsert idempotency,
 * re-assertion after invalidation, alias merge, invalidation precondition, and
 * the embedding-dim guard (S1d).
 *
 * Runs against the ephemeral pgvector container from `setup/globalSetup.ts`.
 * S1d does NOT embed: every entity is stored with a synthetic `randVector`
 * vector, so this suite exercises only DB + repo logic.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  upsertEntity,
  getEntityById,
  findActiveEntity,
  addEntityAliases,
  invalidateEntity,
  listEntities,
} from "@vex-agent/db/repos/memory-entities/index.js";
import { resetDb } from "../setup/fixtures.js";
import { entityInput, EMBEDDING_DIM, seedEntity } from "./_s1d-fixtures.js";

describe("memory_entities repo (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("inserts a new entity and round-trips every column via getEntityById", async () => {
    const input = entityInput("roundtrip", {
      name: "Solana",
      aliases: ["SOL"],
      summary: "Layer-1 chain.",
      attributes: { chain: "solana" },
    });
    const { entity, inserted } = await upsertEntity(input);
    expect(inserted).toBe(true);

    const fetched = await getEntityById(entity.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.entityType).toBe("token");
    expect(fetched!.name).toBe("Solana");
    expect(fetched!.normalizedName).toBe("solana");
    expect(fetched!.aliases).toEqual(["SOL"]);
    expect(fetched!.summary).toBe("Layer-1 chain.");
    expect(fetched!.attributes).toEqual({ chain: "solana" });
    expect(fetched!.embeddingModel).toBe("test-model");
    expect(fetched!.embeddingDim).toBe(EMBEDDING_DIM);
    expect(fetched!.validUntil).toBeNull();
  });

  it("upserts the same active identity idempotently (second call inserted=false, same row)", async () => {
    const first = await upsertEntity(entityInput("idem", { name: "Hyperliquid", entityType: "protocol" }));
    expect(first.inserted).toBe(true);
    // Case-folded + outer-whitespace variant of the SAME surface form — normalizes
    // to "hyperliquid" (normalizeEntityName lowercases + trims/collapses whitespace,
    // it does NOT strip internal spaces, so "Hyper Liquid" would be a DIFFERENT key).
    const second = await upsertEntity(entityInput("idem-2", { name: "  HYPERLIQUID  ", entityType: "protocol" }));
    expect(second.inserted).toBe(false);
    expect(second.entity.id).toBe(first.entity.id);

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_entities WHERE entity_type='protocol'",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("two parallel upserts of the same identity yield exactly one row (xmax upsert)", async () => {
    const a = upsertEntity(entityInput("race-a", { name: "ETH" }));
    const b = upsertEntity(entityInput("race-b", { name: "eth" }));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.entity.id).toBe(rb.entity.id);
    expect([ra.inserted, rb.inserted].filter(Boolean)).toHaveLength(1);

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_entities WHERE normalized_name='eth'",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("re-inserting after invalidation creates a NEW active row (partial-unique allows it)", async () => {
    const first = await upsertEntity(entityInput("revive", { name: "Bonk" }));
    const inv = await invalidateEntity(first.entity.id, null);
    expect(inv.ok).toBe(true);

    const second = await upsertEntity(entityInput("revive-2", { name: "Bonk" }));
    expect(second.inserted).toBe(true);
    expect(second.entity.id).not.toBe(first.entity.id);

    // The active finder returns ONLY the fresh row; both versions exist on disk.
    const active = await findActiveEntity("token", "bonk");
    expect(active!.id).toBe(second.entity.id);
    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_entities WHERE normalized_name='bonk'",
    );
    expect(rows[0]!.n).toBe("2");
  });

  it("invalidateEntity twice yields already_invalidated; a missing id yields not_found", async () => {
    const { entity } = await upsertEntity(entityInput("inv", { name: "Pyth" }));
    const first = await invalidateEntity(entity.id, null);
    expect(first.ok).toBe(true);
    const second = await invalidateEntity(entity.id, null);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reason).toBe("already_invalidated");

    const missing = await invalidateEntity("00000000-0000-4000-8000-000000000000", null);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.reason).toBe("not_found");
  });

  it("addEntityAliases merges and de-duplicates, active only", async () => {
    const { entity } = await upsertEntity(entityInput("alias", { name: "Jupiter", aliases: ["JUP"] }));
    const updated = await addEntityAliases(entity.id, ["JUP", "Jupiter Exchange"]);
    expect(updated).not.toBeNull();
    expect([...updated!.aliases].sort()).toEqual(["JUP", "Jupiter Exchange"].sort());

    // Once invalidated, alias merge is a no-op (returns null).
    await invalidateEntity(entity.id, null);
    expect(await addEntityAliases(entity.id, ["X"])).toBeNull();
  });

  it("rejects an embedding whose length does not match embeddingDim (repo fast-fail)", async () => {
    const bad = entityInput("badlen", { name: "Drift" });
    bad.embedding = bad.embedding.slice(0, EMBEDDING_DIM - 1);
    await expect(upsertEntity(bad)).rejects.toThrow(/does not match embeddingDim/);
  });

  it("the DB CHECK rejects a dim/vector mismatch on a raw insert", async () => {
    await expect(
      execute(
        `INSERT INTO memory_entities (entity_type, name, normalized_name, embedding, embedding_model, embedding_dim)
         VALUES ('token', 'X', 'x', $1::vector, 'm', 4)`,
        [`[${[0.1, 0.2, 0.3].join(",")}]`],
      ),
    ).rejects.toThrow(/me_embedding_dim_matches_vector/);
  });

  it("the DB CHECK rejects an out-of-vocabulary entity_type on a raw insert", async () => {
    await expect(
      execute(
        `INSERT INTO memory_entities (entity_type, name, normalized_name, embedding, embedding_model, embedding_dim)
         VALUES ('galaxy', 'X', 'x', $1::vector, 'm', 3)`,
        [`[${[0.1, 0.2, 0.3].join(",")}]`],
      ),
    ).rejects.toThrow(/me_entity_type_valid/);
  });

  it("listEntities filters by type and active state", async () => {
    await seedEntity("l1", { name: "SOL", entityType: "token" });
    const protoId = await seedEntity("l2", { name: "Uniswap", entityType: "protocol" });
    await invalidateEntity(await seedEntity("l3", { name: "Dead", entityType: "token" }), null);

    const tokensActive = await listEntities({ entityType: "token", activeOnly: true });
    expect(tokensActive.map((e) => e.name)).toEqual(["SOL"]);

    const tokensAll = await listEntities({ entityType: "token", activeOnly: false });
    expect(tokensAll.map((e) => e.name).sort()).toEqual(["Dead", "SOL"]);

    const protocols = await listEntities({ entityType: "protocol" });
    expect(protocols.map((e) => e.id)).toEqual([protoId]);
  });
});
