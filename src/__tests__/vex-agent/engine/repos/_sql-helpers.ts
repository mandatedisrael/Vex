import { expect } from "vitest";

/**
 * Assert SQL placeholder indices form a contiguous 1..N set matching
 * `params.length`. Repeated placeholders (e.g. `WHERE x = $1 OR y = $1`) are
 * valid: the contract is "max placeholder index === params.length AND every
 * index 1..max appears at least once". Catches orphan placeholders without
 * false-positives on intentional reuse.
 */
export function expectSqlPlaceholdersContiguous(
  sql: string,
  params: readonly unknown[],
): void {
  const indices = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  if (indices.length === 0) {
    expect(params).toHaveLength(0);
    return;
  }
  // Postgres placeholders are 1-indexed; reject `$0` outright so a
  // typo can't pass with an empty params array.
  expect(Math.min(...indices)).toBeGreaterThanOrEqual(1);
  const max = Math.max(...indices);
  expect(max).toBe(params.length);
  for (let i = 1; i <= max; i++) {
    expect(indices).toContain(i);
  }
}
