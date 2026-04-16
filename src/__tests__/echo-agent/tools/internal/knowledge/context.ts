/**
 * Shared test context for internal/knowledge handler suites.
 *
 * The entry point (`knowledge.test.ts`) owns `vi.mock()` registrations and
 * fixture factories — vi.mock is hoisted per-file, so sub-suites cannot
 * re-declare mocks and share state. Instead, the entry point builds this
 * context object and passes it into each suite.
 */

import type { Mock } from "vitest";
import type { handleKnowledgeWrite } from "@echo-agent/tools/internal/knowledge-write.js";
import type {
  handleKnowledgeRecall,
  handleKnowledgeRecallOverflow,
} from "@echo-agent/tools/internal/knowledge-recall.js";
import type { handleKnowledgeGet } from "@echo-agent/tools/internal/knowledge-get.js";
import type { handleKnowledgeUpdateStatus } from "@echo-agent/tools/internal/knowledge-update-status.js";
import type { makeTestContext } from "../../_test-context.js";

export interface SuiteCtx {
  // Handlers
  handleKnowledgeWrite: typeof handleKnowledgeWrite;
  handleKnowledgeRecall: typeof handleKnowledgeRecall;
  handleKnowledgeRecallOverflow: typeof handleKnowledgeRecallOverflow;
  handleKnowledgeGet: typeof handleKnowledgeGet;
  handleKnowledgeUpdateStatus: typeof handleKnowledgeUpdateStatus;
  // Engine context factory
  makeTestContext: typeof makeTestContext;
  // Mocks — DB repos
  mockInsertEntry: Mock;
  mockFindByContentHash: Mock;
  mockGetById: Mock;
  mockUpdateStatus: Mock;
  mockRecallTopK: Mock;
  mockCacheWrite: Mock;
  mockCacheRead: Mock;
  mockCacheCleanup: Mock;
  mockGenerateCacheKey: Mock;
  // Mocks — embeddings
  mockEmbedDocument: Mock;
  mockEmbedQuery: Mock;
  // Fixtures
  makeEmbedding: () => number[];
  makeEmbedResult: (providerModel?: string) => { embedding: number[]; providerModel: string };
  makeInsertEntryRecord: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  makeInsertResult: (overrides?: Record<string, unknown>, inserted?: boolean) => { entry: Record<string, unknown>; inserted: boolean };
  makeCandidate: (id: number, contentMd?: string) => Record<string, unknown>;
  // Constants
  TEST_DIM: number;
  TEST_PROVIDER_MODEL: string;
}
