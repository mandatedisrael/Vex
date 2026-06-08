/**
 * Integration: memory_entry_entities junction — idempotent link with MAX
 * mention_count, composite PK, reverse lookups, and cascade deletes (S1d).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  linkEntryEntity,
  listEntitiesForEntry,
  listEntriesForEntity,
} from "@vex-agent/db/repos/memory-entry-entities/index.js";
import { resetDb } from "../setup/fixtures.js";
import { seedEntity, seedKnowledgeEntry } from "./_s1d-fixtures.js";

describe("memory_entry_entities junction (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("links an entry to an entity and reports the fresh insert", async () => {
    const entryId = await seedKnowledgeEntry("link");
    const entityId = await seedEntity("link", { name: "SOL" });
    const { link, inserted } = await linkEntryEntity(entryId, entityId, 3);
    expect(inserted).toBe(true);
    expect(link.entryId).toBe(entryId);
    expect(link.entityId).toBe(entityId);
    expect(link.mentionCount).toBe(3);
  });

  it("re-linking the same (entry, entity) is idempotent and mention_count becomes MAX(stored, supplied)", async () => {
    const entryId = await seedKnowledgeEntry("max");
    const entityId = await seedEntity("max", { name: "ETH" });

    const first = await linkEntryEntity(entryId, entityId, 5);
    expect(first.inserted).toBe(true);

    // A lower retry count must NOT lower the stored value.
    const lower = await linkEntryEntity(entryId, entityId, 2);
    expect(lower.inserted).toBe(false);
    expect(lower.link.mentionCount).toBe(5);

    // A higher count raises it.
    const higher = await linkEntryEntity(entryId, entityId, 9);
    expect(higher.inserted).toBe(false);
    expect(higher.link.mentionCount).toBe(9);

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_entry_entities WHERE entry_id=$1 AND entity_id=$2",
      [entryId, entityId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("reverse lookups list entities for an entry and entries for an entity", async () => {
    const entryA = await seedKnowledgeEntry("rev-a");
    const entryB = await seedKnowledgeEntry("rev-b");
    const entity1 = await seedEntity("rev-1", { name: "SOL" });
    const entity2 = await seedEntity("rev-2", { name: "USDC" });

    await linkEntryEntity(entryA, entity1, 2);
    await linkEntryEntity(entryA, entity2, 5);
    await linkEntryEntity(entryB, entity1, 1);

    // Entities for entryA, ordered by mention_count DESC.
    const forEntry = await listEntitiesForEntry(entryA);
    expect(forEntry.map((l) => l.entityId)).toEqual([entity2, entity1]);

    // Entries that mention entity1 (both A and B).
    const forEntity = await listEntriesForEntity(entity1);
    expect(forEntity.map((l) => l.entryId).sort()).toEqual([entryA, entryB].sort());
  });

  it("cascades the link when the entry is deleted", async () => {
    const entryId = await seedKnowledgeEntry("casc-entry");
    const entityId = await seedEntity("casc-entry", { name: "SOL" });
    await linkEntryEntity(entryId, entityId, 1);

    await execute("DELETE FROM knowledge_entries WHERE id=$1", [entryId]);
    expect(await listEntriesForEntity(entityId)).toHaveLength(0);
    // The entity itself survives.
    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_entities WHERE id=$1",
      [entityId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("cascades the link when the entity is deleted", async () => {
    const entryId = await seedKnowledgeEntry("casc-entity");
    const entityId = await seedEntity("casc-entity", { name: "ETH" });
    await linkEntryEntity(entryId, entityId, 1);

    await execute("DELETE FROM memory_entities WHERE id=$1", [entityId]);
    expect(await listEntitiesForEntry(entryId)).toHaveLength(0);
  });

  it("the composite PK forbids a duplicate raw insert", async () => {
    const entryId = await seedKnowledgeEntry("pk");
    const entityId = await seedEntity("pk", { name: "SOL" });
    await linkEntryEntity(entryId, entityId, 1);
    await expect(
      execute(
        "INSERT INTO memory_entry_entities (entry_id, entity_id) VALUES ($1, $2)",
        [entryId, entityId],
      ),
    ).rejects.toThrow(/memory_entry_entities_pkey|duplicate key/);
  });
});
