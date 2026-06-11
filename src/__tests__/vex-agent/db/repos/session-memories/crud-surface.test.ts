/**
 * Façade-surface guard for the session-memories CRUD structural split (A-011).
 *
 * `src/vex-agent/db/repos/session-memories/crud.ts` was split into sibling
 * modules under `./session-memories/` (render, create, read, stats,
 * resolution, embeddings) while the original `crud.ts` path stays a
 * compatibility façade. This test pins the EXACT public runtime surface so a
 * later edit cannot silently drop, rename, or add an export. Behavior of each
 * symbol is covered by the dedicated DB-backed integration suites
 * (insert-conflict, outstanding-resolution, stale-embedding) plus the
 * `body-md-hash` pure unit; here we only assert presence + runtime typeof +
 * the exact runtime export-key set. Type-only re-exports
 * (`InsertResult`/`PreparedMemoryRender`/`SessionMemoryStats`/
 * `ResolveOutstandingResult`) are imported below so `tsc --noEmit` rejects any
 * signature drift.
 */

import { describe, it, expect } from "vitest";

import * as crudFacade from "../../../../../vex-agent/db/repos/session-memories/crud.js";

import {
  prepareMemoryRender,
  insertPreparedMemory,
  insertMemories,
  getById,
  listActiveBySession,
  listUnresolvedOutstandingItems,
  getSessionMemoryStats,
  markOutstandingResolved,
  updateEmbedding,
} from "../../../../../vex-agent/db/repos/session-memories/crud.js";

// Type-only imports must compile against the façade re-exports.
import type {
  InsertResult,
  PreparedMemoryRender,
  SessionMemoryStats,
  ResolveOutstandingResult,
  UnresolvedOutstandingItem,
} from "../../../../../vex-agent/db/repos/session-memories/crud.js";

describe("session-memories crud façade — public surface", () => {
  it("exposes every expected function with the correct runtime typeof", () => {
    expect(typeof prepareMemoryRender).toBe("function");
    expect(typeof insertPreparedMemory).toBe("function");
    expect(typeof insertMemories).toBe("function");
    expect(typeof getById).toBe("function");
    expect(typeof listActiveBySession).toBe("function");
    expect(typeof listUnresolvedOutstandingItems).toBe("function");
    expect(typeof getSessionMemoryStats).toBe("function");
    expect(typeof markOutstandingResolved).toBe("function");
    expect(typeof updateEmbedding).toBe("function");
  });

  it("named re-exports are identity-equal to the namespace import", () => {
    expect(crudFacade.prepareMemoryRender).toBe(prepareMemoryRender);
    expect(crudFacade.insertPreparedMemory).toBe(insertPreparedMemory);
    expect(crudFacade.insertMemories).toBe(insertMemories);
    expect(crudFacade.getById).toBe(getById);
    expect(crudFacade.listActiveBySession).toBe(listActiveBySession);
    expect(crudFacade.listUnresolvedOutstandingItems).toBe(listUnresolvedOutstandingItems);
    expect(crudFacade.getSessionMemoryStats).toBe(getSessionMemoryStats);
    expect(crudFacade.markOutstandingResolved).toBe(markOutstandingResolved);
    expect(crudFacade.updateEmbedding).toBe(updateEmbedding);
  });

  it("type-only re-exports compile against the façade", () => {
    // Compile-time assertions only — exercise each re-exported type so the
    // file fails `tsc --noEmit` if any interface/type drops off the façade.
    const insertResult: InsertResult | null = null;
    const prepared: PreparedMemoryRender | null = null;
    const stats: SessionMemoryStats | null = null;
    const resolveResult: ResolveOutstandingResult | null = null;
    const unresolvedItem: UnresolvedOutstandingItem | null = null;
    expect(insertResult).toBeNull();
    expect(prepared).toBeNull();
    expect(stats).toBeNull();
    expect(resolveResult).toBeNull();
    expect(unresolvedItem).toBeNull();
  });

  it("exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(crudFacade).sort();
    expect(keys).toEqual(
      [
        "prepareMemoryRender",
        "insertPreparedMemory",
        "insertMemories",
        "getById",
        "listActiveBySession",
        "listUnresolvedOutstandingItems",
        "getSessionMemoryStats",
        "markOutstandingResolved",
        "updateEmbedding",
      ].sort(),
    );
  });
});
