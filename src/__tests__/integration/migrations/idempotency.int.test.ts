/**
 * Integration: `runMigrations` is idempotent and `schema_version` stays at
 * exactly one row per migration file after repeated invocations.
 *
 * globalSetup already ran the migrations once before this suite loads, so the
 * test effectively asserts a second run is a no-op.
 */

import { describe, it, expect } from "vitest";

import { runMigrations } from "@echo-agent/db/migrate.js";
import { query } from "@echo-agent/db/client.js";
import { readdirSync } from "node:fs";
import { getEchoAgentMigrationsDir } from "@utils/package-assets.js";

function countMigrationFiles(): number {
  return readdirSync(getEchoAgentMigrationsDir()).filter(
    (f) => f.endsWith(".sql") && /^\d{3}_/.test(f),
  ).length;
}

describe("runMigrations idempotency (integration)", () => {
  it("second run does not throw and does not add rows to schema_version", async () => {
    const expected = countMigrationFiles();

    const before = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM schema_version",
    );
    expect(Number(before[0].count)).toBe(expected);

    await expect(runMigrations()).resolves.toBeUndefined();

    const after = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM schema_version",
    );
    expect(Number(after[0].count)).toBe(expected);
  });
});
