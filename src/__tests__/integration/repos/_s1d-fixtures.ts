/**
 * Shared seeding helpers for the S1d integration suites (memory_entities /
 * memory_entry_entities / memory_edges). NOT a test file (underscore prefix → not
 * collected by `*.int.test.ts`). S1d does NOT embed: entities/edges are stored
 * with synthetic `randVector` vectors, so these suites exercise only DB + repo
 * logic, never the embeddings endpoint.
 */

import {
  upsertEntity,
  type MemoryEntityType,
  type UpsertEntityInput,
} from "@vex-agent/db/repos/memory-entities/index.js";
import {
  upsertEdge,
  type MemoryEdgeRelation,
  type UpsertEdgeInput,
} from "@vex-agent/db/repos/memory-edges/index.js";
import { makeSession, randVector } from "../setup/fixtures.js";
import { seedKnowledgeEntry } from "./_s1c-fixtures.js";

export const EMBEDDING_DIM = 8;
export const EMBEDDING_MODEL = "test-model";

export interface SeedEntityOverrides {
  entityType?: MemoryEntityType;
  name?: string;
  aliases?: string[];
  summary?: string;
  attributes?: Record<string, unknown>;
  validFrom?: Date | null;
}

function entityInput(seed: string, o: SeedEntityOverrides = {}): UpsertEntityInput {
  const name = o.name ?? `Entity ${seed}`;
  return {
    entityType: o.entityType ?? "token",
    name,
    aliases: o.aliases ?? [],
    summary: o.summary ?? "",
    attributes: o.attributes ?? {},
    embedding: randVector(EMBEDDING_DIM, `entity-${seed}`),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    validFrom: o.validFrom ?? null,
  };
}

/** Upsert one entity (synthetic vector) and return its uuid. */
export async function seedEntity(seed: string, o: SeedEntityOverrides = {}): Promise<string> {
  const { entity } = await upsertEntity(entityInput(seed, o));
  return entity.id;
}

export interface SeedEdgeOverrides {
  relation?: MemoryEdgeRelation;
  fact?: string;
  withFactEmbedding?: boolean;
  originEntryId?: number | null;
  validFrom?: Date | null;
}

function edgeInput(
  sourceEntityId: string,
  targetEntityId: string,
  seed: string,
  o: SeedEdgeOverrides = {},
): UpsertEdgeInput {
  const withEmbedding = o.withFactEmbedding ?? false;
  return {
    sourceEntityId,
    targetEntityId,
    relation: o.relation ?? "traded_on",
    fact: o.fact ?? "",
    factEmbedding: withEmbedding ? randVector(EMBEDDING_DIM, `edge-${seed}`) : null,
    embeddingModel: withEmbedding ? EMBEDDING_MODEL : null,
    embeddingDim: withEmbedding ? EMBEDDING_DIM : null,
    originEntryId: o.originEntryId ?? null,
    validFrom: o.validFrom ?? null,
  };
}

/** Upsert one edge between two entities and return its uuid. */
export async function seedEdge(
  sourceEntityId: string,
  targetEntityId: string,
  seed: string,
  o: SeedEdgeOverrides = {},
): Promise<string> {
  const { edge } = await upsertEdge(edgeInput(sourceEntityId, targetEntityId, seed, o));
  return edge.id;
}

export { makeSession, randVector, seedKnowledgeEntry, entityInput, edgeInput };
