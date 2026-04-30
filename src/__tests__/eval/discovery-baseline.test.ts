/**
 * discover_tools v3 dataset contract.
 *
 * This file is intentionally fast and stack-free: default `pnpm test` must not
 * require Postgres, pgvector, or an embedding sidecar, and must not rewrite
 * baseline JSON. Real dense quality/latency captures live in `.int.ts` files
 * behind explicit `pnpm test:eval:*` scripts.
 */

import { describe, expect, it } from "vitest";
import { discoverProtocolCapabilities } from "../../vex-agent/tools/protocols/runtime.js";
import {
  loadDataset,
  validateDatasetExpectedTools,
  validateDatasetPrompts,
  type SeedQuery,
} from "./retrieval-eval-harness.js";

const EXPECTED_QUERY_COUNT = 200;
const EXPECTED_AWARENESS_COUNT = 100;

const dataset = loadDataset();

function countByAwareness(queries: readonly SeedQuery[], awareness: SeedQuery["awareness"]): number {
  return queries.filter((query) => query.awareness === awareness).length;
}

describe("discover_tools English v3 dataset contract", () => {
  it("loads exactly 200 English seed queries split 100/100 by awareness", () => {
    expect(dataset).toHaveLength(EXPECTED_QUERY_COUNT);
    expect(countByAwareness(dataset, "blind")).toBe(EXPECTED_AWARENESS_COUNT);
    expect(countByAwareness(dataset, "protocol-aware")).toBe(EXPECTED_AWARENESS_COUNT);

    const nonAsciiQueries = dataset
      .filter((query) => !/^[\x00-\x7F]+$/.test(query.query))
      .map((query) => query.query);
    expect(nonAsciiQueries, `Non-ASCII seed queries:\n${nonAsciiQueries.join("\n")}`).toEqual([]);
  });

  it("keeps blind prompts protocol-free and protocol-aware prompts function-blind", () => {
    expect(validateDatasetPrompts(dataset)).toEqual([]);
  });

  it("references only active, real tool IDs or active tool prefixes", () => {
    expect(validateDatasetExpectedTools(dataset)).toEqual([]);
  });

  it("catalog listing does not touch dense retrieval", async () => {
    const result = await discoverProtocolCapabilities({ limit: 5 });
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.retrieval).toEqual({
      method: "catalog",
      denseFailed: false,
      candidateCount: result.totalCount,
    });
  });
});
