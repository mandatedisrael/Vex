/**
 * Shared test context for db/repos/knowledge suites.
 *
 * Entry point (`knowledge.test.ts`) owns `vi.mock("@echo-agent/db/client.js")`
 * and fixture factories; suites read them through this context type.
 */

import type { Mock } from "vitest";
import type * as KnowledgeRepo from "@echo-agent/db/repos/knowledge.js";

type SampleRow = {
  id: number;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[];
  source_refs: Record<string, unknown>;
  confidence: number | null;
  status: string;
  pinned: boolean;
  valid_from: string;
  valid_until: string | null;
  content_hash: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
  updated_at: string;
};

type BaseInsertInput = Parameters<typeof KnowledgeRepo.insertEntry>[0];

export interface SuiteCtx {
  // Repo API
  insertEntry: typeof KnowledgeRepo.insertEntry;
  getById: typeof KnowledgeRepo.getById;
  findByContentHash: typeof KnowledgeRepo.findByContentHash;
  updateStatus: typeof KnowledgeRepo.updateStatus;
  updateEmbedding: typeof KnowledgeRepo.updateEmbedding;
  recallTopK: typeof KnowledgeRepo.recallTopK;
  listActiveForHotContext: typeof KnowledgeRepo.listActiveForHotContext;
  listKnownKinds: typeof KnowledgeRepo.listKnownKinds;
  streamAllForExport: typeof KnowledgeRepo.streamAllForExport;
  streamRowsForReembed: typeof KnowledgeRepo.streamRowsForReembed;
  findRowsWithDimNotMatching: typeof KnowledgeRepo.findRowsWithDimNotMatching;
  isRuntimeActive: typeof KnowledgeRepo.isRuntimeActive;
  // Mocks — `@echo-agent/db/client.js`
  mockExecute: Mock;
  mockQueryOne: Mock;
  mockQuery: Mock;
  // Fixtures
  SAMPLE_HASH: string;
  SAMPLE_ROW: SampleRow;
  makeEmbedding: (dim?: number) => number[];
  baseInsertInput: () => BaseInsertInput;
}
