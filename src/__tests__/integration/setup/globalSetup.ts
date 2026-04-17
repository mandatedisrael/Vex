/**
 * Vitest globalSetup for integration tests.
 *
 * Spins up an ephemeral Postgres (pgvector) container via testcontainers,
 * wires `ECHO_AGENT_DB_URL`, and runs the full migration chain. The Gemma
 * embeddings endpoint is NOT managed here — it's a Docker Desktop Model
 * Runner feature that must be running independently. A reachability probe
 * fails fast with an actionable message so tests don't hang on first embed.
 *
 * Dynamic imports are deliberate: the db client pool singleton reads
 * `ECHO_AGENT_DB_URL` on first `getPool()` call, so we MUST set the env var
 * BEFORE any repo module resolves `client.js`.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer | null = null;

const PGVECTOR_IMAGE = "pgvector/pgvector:0.8.2-pg18-trixie";
const FALLBACK_EMBED_MODEL = "ai/embeddinggemma:300M-Q8_0";

export async function setup(): Promise<void> {
  try {
    container = await new PostgreSqlContainer(PGVECTOR_IMAGE)
      .withDatabase("echo_agent_test")
      .withUsername("echo_agent")
      .withPassword("echo_agent")
      .start();
  } catch (err) {
    throw new Error(
      `Failed to start pgvector container (image=${PGVECTOR_IMAGE}). ` +
        `Is Docker running? Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  process.env.ECHO_AGENT_DB_URL = container.getConnectionUri();

  await assertEmbeddingsReachable();

  const { runMigrations } = await import("@echo-agent/db/migrate.js");
  await runMigrations();
}

export async function teardown(): Promise<void> {
  try {
    const { closePool } = await import("@echo-agent/db/client.js");
    await closePool();
  } catch {
    // Best-effort — pool teardown errors shouldn't mask container.stop().
  }
  if (container) {
    await container.stop();
    container = null;
  }
}

async function assertEmbeddingsReachable(): Promise<void> {
  const baseUrl = process.env.EMBEDDING_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "EMBEDDING_BASE_URL is not set. Integration suite needs a live embeddings endpoint. " +
        "Start Gemma + proxy with: `pnpm echo docker dev` (requires Docker Model Runner).",
    );
  }
  const model = process.env.EMBEDDING_MODEL ?? FALLBACK_EMBED_MODEL;
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: "probe" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `Embeddings endpoint unreachable at ${baseUrl} (model=${model}). ` +
        `Start it with: \`pnpm echo docker dev\`. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
