/**
 * v3 — discover_tools failure smoke (dense fallback).
 *
 * Verifies the graceful degradation path: when the embedding sidecar is
 * unreachable, `discoverProtocolCapabilities`:
 *   1. Does NOT throw — the caller gets a valid result.
 *   2. Returns lexical results (tools.length > 0 for an English query).
 *   3. Sets `retrieval.denseFailed = true` in the result metadata.
 *   4. Sets `retrieval.method = "lexical"` (fallback path).
 *
 * Technique: override `EMBEDDING_BASE_URL` to a port that nothing listens
 * on (127.0.0.1:1). The embedding client will fail immediately on connect.
 * We restore the original value in `afterAll` so the test doesn't leak.
 *
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
// Load provider dotenv before any module reading process.env — mirrors the
// baseline test and CLI scripts.
import { loadProviderDotenv } from "../../providers/env-resolution.js";
loadProviderDotenv();
import { discoverProtocolCapabilities } from "../../vex-agent/tools/protocols/runtime.js";

const UNREACHABLE_URL = "http://127.0.0.1:1";

describe("v3 — discover_tools failure smoke (dense fallback)", () => {
  const envKeys = [
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
  ] as const;
  const originalEnv: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeAll(() => {
    // Override env to point the embedding sidecar at an unreachable address.
    for (const key of envKeys) {
      const value = process.env[key];
      if (value !== undefined) originalEnv[key] = value;
    }
    process.env.EMBEDDING_BASE_URL = UNREACHABLE_URL;
    process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
    process.env.EMBEDDING_DIM = "768";
    process.env.EMBEDDING_PROVIDER = "local";
  });

  afterAll(() => {
    // Restore original values so subsequent tests in the same runner aren't
    // affected (env is process-global state).
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("does not throw when embedding sidecar is unreachable", async () => {
    // Must not throw — user-facing code must not crash on sidecar failure.
    await expect(
      discoverProtocolCapabilities({ query: "swap usdc on base", limit: 5 }),
    ).resolves.toBeDefined();
  });

  it("returns lexical results (tools.length > 0) when DMR is down", async () => {
    const result = await discoverProtocolCapabilities({ query: "swap usdc on base", limit: 5 });
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it("sets denseFailed: true in retrieval metadata when DMR is down", async () => {
    const result = await discoverProtocolCapabilities({ query: "swap usdc on base", limit: 5 });
    expect(result.retrieval).toBeDefined();
    expect(result.retrieval!.denseFailed).toBe(true);
  });

  it("sets retrieval.method to 'lexical' on dense fallback", async () => {
    const result = await discoverProtocolCapabilities({ query: "swap usdc on base", limit: 5 });
    expect(result.retrieval!.method).toBe("lexical");
  });
});
