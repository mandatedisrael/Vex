/**
 * Migration numeric-prefix uniqueness — prerequisite guard for WP-J.
 *
 * `src/lib/db/migrate-runner.ts`'s `listPendingMigrations` derives each
 * migration's `version` from `parseInt(file.slice(0, 3), 10)` and records
 * applied versions in `schema_version` keyed by that integer. Two files
 * sharing a numeric prefix collide on the SAME version:
 *   - if pending together in one run, the second INSERT into
 *     `schema_version` violates the PRIMARY KEY and the run fails; but
 *   - if the first is applied in an EARLIER run (schema_version already has
 *     that version), a later-added colliding file is silently excluded by
 *     `version > currentVersion` and never runs at all.
 *
 * This test asserts the invariant holds in the source directory AND in the
 * vex-app mirror produced by `vex-app/scripts/copy-migrations.mjs` (the
 * mirror is gitignored/generated, so the script is invoked here rather than
 * relying on a prior `predev`/`prebuild` run).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const SRC_DIR = resolve(process.cwd(), "src/vex-agent/db/migrations");
const APP_DIR = resolve(process.cwd(), "vex-app");
const MIRROR_DIR = resolve(APP_DIR, "resources/migrations");

// Mirrors the exact filter used by `listPendingMigrations` (migrate-runner)
// and `isMigrationFile` (copy-migrations.mjs) — both must agree with this.
function isMigrationFile(name: string): boolean {
  return name.endsWith(".sql") && /^\d{3}_/.test(name);
}

function migrationPrefixes(dir: string): string[] {
  return readdirSync(dir)
    .filter(isMigrationFile)
    .map((name) => name.slice(0, 3));
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes].sort();
}

describe("migration numeric-prefix uniqueness", () => {
  it("has no duplicate numeric prefixes in the source migrations directory", () => {
    const prefixes = migrationPrefixes(SRC_DIR);
    expect(prefixes.length).toBeGreaterThan(0);
    expect(findDuplicates(prefixes)).toEqual([]);
  });

  it("has no duplicate numeric prefixes in the vex-app mirror (copy-migrations.mjs output)", () => {
    execFileSync("node", ["scripts/copy-migrations.mjs"], {
      cwd: APP_DIR,
      stdio: "pipe",
    });
    const prefixes = migrationPrefixes(MIRROR_DIR);
    expect(prefixes.length).toBeGreaterThan(0);
    expect(findDuplicates(prefixes)).toEqual([]);
  });

  it("mirror prefixes exactly match source prefixes (copy-script filter parity)", () => {
    execFileSync("node", ["scripts/copy-migrations.mjs"], {
      cwd: APP_DIR,
      stdio: "pipe",
    });
    const sourcePrefixes = new Set(migrationPrefixes(SRC_DIR));
    const mirrorPrefixes = new Set(migrationPrefixes(MIRROR_DIR));
    expect(mirrorPrefixes).toEqual(sourcePrefixes);
  });
});
