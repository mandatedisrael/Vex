/**
 * Microbenchmark for `getProtocolManifest(toolId)` — baseline before PR1.
 *
 * Purpose: measure current lookup cost so PR1 (Map-based O(1) lookup) can
 * be compared against pre-refactor `Array.find` O(n) behaviour. Captures
 * two code paths: hit (existing toolId) and miss (unknown toolId), because
 * `Array.find` scans the whole array on miss while `Map.get` is O(1) either
 * way.
 *
 * Not a CI gate. Run via:
 *   pnpm exec tsx src/__tests__/echo-agent/tools/manifest-lookup.bench.ts
 *
 * Report the two numbers in the PR1 commit message / PR description so the
 * refactor can show non-regression on the miss path and a measurable win on
 * the hit path.
 */

import {
  PROTOCOL_TOOLS,
  getProtocolManifest,
} from "@echo-agent/tools/protocols/catalog.js";

const ITERATIONS = 100_000;

function hrMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function measure(label: string, fn: () => void): { label: string; ms: number; perOp: number } {
  // Warmup.
  for (let i = 0; i < 10_000; i++) fn();
  const start = hrMs();
  for (let i = 0; i < ITERATIONS; i++) fn();
  const total = hrMs() - start;
  return { label, ms: total, perOp: total / ITERATIONS };
}

function main(): void {
  if (PROTOCOL_TOOLS.length === 0) {
    process.stderr.write("no PROTOCOL_TOOLS registered — benchmark aborted\n");
    process.exit(2);
  }

  const firstId = PROTOCOL_TOOLS[0]!.toolId;
  const lastId = PROTOCOL_TOOLS[PROTOCOL_TOOLS.length - 1]!.toolId;
  const missingId = "nonexistent.tool_id.benchmark_probe";

  const hitFirst = measure(`hit first  (${firstId})`, () => {
    getProtocolManifest(firstId);
  });
  const hitLast = measure(`hit last   (${lastId})`, () => {
    getProtocolManifest(lastId);
  });
  const miss = measure(`miss       (${missingId})`, () => {
    getProtocolManifest(missingId);
  });

  process.stdout.write(
    `manifest-lookup.bench — PROTOCOL_TOOLS.length=${PROTOCOL_TOOLS.length}, iterations=${ITERATIONS}\n`,
  );
  for (const r of [hitFirst, hitLast, miss]) {
    process.stdout.write(
      `  ${r.label.padEnd(46)}  total ${r.ms.toFixed(2)} ms  per-op ${(r.perOp * 1000).toFixed(2)} µs\n`,
    );
  }
  process.stdout.write(
    "\nExpectation post-PR1 (Map-based lookup):\n" +
      "  - hit paths: significantly faster (O(1) Map.get vs O(n) Array.find).\n" +
      "  - miss path: also faster — Array.find scans the whole array on miss; Map.get is O(1).\n" +
      "Record these numbers in the PR1 commit message / description.\n",
  );
}

main();
