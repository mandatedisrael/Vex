import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEmbeddingConfig, REQUIRED_EMBEDDING_DIM } from "@echo-agent/embeddings/config.js";

const ENV_KEYS = ["EMBEDDING_BASE_URL", "EMBEDDING_MODEL", "EMBEDDING_DIM", "EMBEDDING_PROVIDER"] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
}

function setValid(): void {
  process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
  process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
  process.env.EMBEDDING_DIM = "768";
  process.env.EMBEDDING_PROVIDER = "local";
}

describe("loadEmbeddingConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── Happy path ───────────────────────────────────────────────

  it("returns parsed config when all env vars are set", () => {
    setValid();
    const config = loadEmbeddingConfig();
    expect(config.baseUrl).toBe("http://localhost:12434/engines/llama.cpp/v1");
    expect(config.model).toBe("ai/embeddinggemma:300M-Q8_0");
    expect(config.dim).toBe(REQUIRED_EMBEDDING_DIM);
    expect(config.provider).toBe("local");
  });

  it("strips trailing slash from baseUrl", () => {
    setValid();
    process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1/";
    const config = loadEmbeddingConfig();
    expect(config.baseUrl).toBe("http://localhost:12434/engines/llama.cpp/v1");
  });

  // ── Missing values ───────────────────────────────────────────

  it("throws when EMBEDDING_BASE_URL is missing", () => {
    setValid();
    delete process.env.EMBEDDING_BASE_URL;
    expect(() => loadEmbeddingConfig()).toThrow(/EMBEDDING_BASE_URL is required/);
  });

  it("throws when EMBEDDING_MODEL is missing", () => {
    setValid();
    delete process.env.EMBEDDING_MODEL;
    expect(() => loadEmbeddingConfig()).toThrow(/EMBEDDING_MODEL is required/);
  });

  it("throws when EMBEDDING_DIM is missing", () => {
    setValid();
    delete process.env.EMBEDDING_DIM;
    expect(() => loadEmbeddingConfig()).toThrow(/EMBEDDING_DIM is required/);
  });

  it("throws when EMBEDDING_PROVIDER is missing", () => {
    setValid();
    delete process.env.EMBEDDING_PROVIDER;
    expect(() => loadEmbeddingConfig()).toThrow(/EMBEDDING_PROVIDER is required/);
  });

  // ── Validation ───────────────────────────────────────────────

  it("rejects baseUrl without http:// or https://", () => {
    setValid();
    process.env.EMBEDDING_BASE_URL = "localhost:12434";
    expect(() => loadEmbeddingConfig()).toThrow(/must start with http/);
  });

  it("rejects EMBEDDING_DIM != 768 (schema lock)", () => {
    setValid();
    process.env.EMBEDDING_DIM = "1024";
    expect(() => loadEmbeddingConfig()).toThrow(/schema is locked at vector\(768\)/);
  });

  it("rejects non-numeric EMBEDDING_DIM", () => {
    setValid();
    process.env.EMBEDDING_DIM = "abc";
    expect(() => loadEmbeddingConfig()).toThrow(/EMBEDDING_DIM/);
  });

  it("aggregates multiple errors into a single throw", () => {
    clearEnv();
    expect(() => loadEmbeddingConfig()).toThrow(/EMBEDDING_BASE_URL[\s\S]*EMBEDDING_MODEL[\s\S]*EMBEDDING_DIM[\s\S]*EMBEDDING_PROVIDER/);
  });
});
