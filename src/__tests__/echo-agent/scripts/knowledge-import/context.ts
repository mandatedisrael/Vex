/**
 * Shared test context for knowledge-import suites.
 *
 * The entry point (`knowledge-import.test.ts`) owns `vi.mock()` registrations
 * and fixture factories — vi.mock is hoisted per-file, so sub-suites cannot
 * share mock state by re-declaring them. Instead, the entry point passes this
 * context object into each suite, which reads mocks/fixtures through it.
 */

import type { Mock } from "vitest";
import type { importKnowledge } from "@echo-agent/scripts/knowledge-import.js";
import type { computeContentHash } from "@echo-agent/knowledge/content-hash.js";

export interface MaintenanceActiveErrorMockCtor {
  new (ownerId: string): Error & { ownerId: string; code: "MAINTENANCE_ACTIVE" };
}

export interface SuiteCtx {
  importKnowledge: typeof importKnowledge;
  computeContentHash: typeof computeContentHash;
  mockInsertEntry: Mock;
  mockFindByContentHash: Mock;
  mockEmbedDocument: Mock;
  mockWithLeaseSharedLock: Mock;
  MaintenanceActiveErrorMock: MaintenanceActiveErrorMockCtor;
  makeManifestLine: () => string;
  makeRowLine: (overrides?: Record<string, unknown>) => string;
  makeEmbedding: () => number[];
  lines: (...ls: string[]) => AsyncIterable<string>;
  TEST_DIM: number;
  TEST_PROVIDER_MODEL: string;
}
