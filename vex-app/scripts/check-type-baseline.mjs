#!/usr/bin/env node
/**
 * Type-error baseline-and-ratchet gate for the currently-ungated tsconfig
 * projects (`tsconfig.main.json`, `tsconfig.renderer.json`, `tsconfig.preload.json`).
 *
 * WHY this exists: `lint:tsc` hard-typechecks shared/e2e, but main, renderer,
 * and preload still carry pre-existing type errors (see
 * docs/audit/type-safety-remediation-plan.md §1). We cannot block launch on
 * fixing all of them, but we MUST stop NEW ones from shipping. This script
 * snapshots the known errors into `type-baseline.json` and fails CI if any
 * project::file::code group grows beyond its recorded count.
 *
 * KEY CHOICE — `${project}::${file}::${TScode}` (project-aware):
 *   main and renderer both pull in overlapping `src/shared` + `../src/lib`
 *   files through aliases. A bare `file::code` aggregate key could let a
 *   same-file/same-code error SWAP across the two projects (appear in renderer,
 *   vanish from main) go undetected. Scoping the key per project closes that.
 *   We deliberately DROP line/col/message from the key so that edits, renames
 *   within a file, and message churn do not produce false ratchet failures.
 *
 * FAIL CLOSED — a silent under-count is worse than a loud stop:
 *   (a) any tsc line that looks like a first-line error (contains "): error TS")
 *       but does NOT parse to the expected shape => output-format drift => exit 1.
 *   (b) tsc exits non-zero yet yields ZERO parseable errors => config breakage
 *       or OOM, not a clean compile => exit 1.
 *   (c) installed TypeScript version != the version recorded in the baseline =>
 *       error text is version-specific, comparison would be invalid => exit 1.
 *
 * Regenerate the baseline (intentional cleanup / new pre-existing debt):
 *   pnpm run lint:tsc:ratchet:update
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, ".."); // vex-app/
const baselinePath = path.join(appRoot, "type-baseline.json");

// Ungated projects the ratchet watches. All three carry pre-existing errors:
// main/renderer under the strict profile; preload from the dual-zod install
// version skew (root 4.3.6 vs vex-app 4.4.3). The zod alignment that would clear
// preload broke root-tree money-path validation on zod 4.4 (`.nonoptional()`
// semantics) and is deferred post-launch, so preload stays RATCHETED here rather
// than hard-gated in `lint:tsc`. When a project reaches zero it graduates into
// the hard `lint:tsc` and is deleted from the baseline.
const PROJECTS = [
  { name: "main", tsconfig: "tsconfig.main.json" },
  { name: "renderer", tsconfig: "tsconfig.renderer.json" },
  { name: "preload", tsconfig: "tsconfig.preload.json" },
];

// A first-line tsc diagnostic: `path/to/file.ts(12,34): error TS2345: message`.
const ERROR_LINE = /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+):/;
// Substring that marks a line as an error we MUST be able to parse (fail-closed a).
const ERROR_MARKER = "): error TS";

const BASELINE_COMMENT =
  "Baseline of PRE-EXISTING type errors in ungated projects. Ratchet: no NEW " +
  "errors may ship (scripts/check-type-baseline.mjs, wired into `lint`). Burn " +
  "down per docs/audit/type-safety-remediation-plan.md; when a project hits 0, " +
  "fold it into lint:tsc and delete it here. Regenerate: pnpm run lint:tsc:ratchet:update";

// Installed compiler version — read from the same package we execute below, so
// the assertion and the actual run can never disagree.
const tscVersion = require("typescript/package.json").version;

/**
 * Run the pinned tsc against one project and return its combined output.
 * We resolve `typescript/bin/tsc` from vex-app's node_modules and run it with
 * the current node binary. This is deterministic and version-consistent with
 * `tscVersion` above, and — unlike `pnpm exec tsc` — does not depend on `.bin`
 * shim symlinks existing (they may not, depending on the pnpm node-linker).
 * tsc exits non-zero when errors exist; that is EXPECTED here, not a failure.
 */
function runTsc(tsconfig) {
  const tscBin = require.resolve("typescript/bin/tsc");
  const res = spawnSync(
    process.execPath,
    // Explicit heap ceiling: the main project's type graph (whole root ../src
    // tree via aliases) peaks >3 GB RSS. CI runners derive Node's DEFAULT heap
    // limit from machine/cgroup memory and land below that, so V8 kills the
    // child mid-compile (status null, zero output) while dev machines pass.
    ["--max-old-space-size=4096", tscBin, "--noEmit", "--pretty", "false", "-p", tsconfig],
    { cwd: appRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) {
    console.log(`${RED}✗ failed to spawn tsc for ${tsconfig}: ${res.error.message}${RESET}`);
    process.exit(1);
  }
  return { output: `${res.stdout ?? ""}${res.stderr ?? ""}`, status: res.status, signal: res.signal };
}

/**
 * Parse one project's tsc output into per-`file::code` counts, the raw lines
 * behind each key (for readable violation reporting), and any drift lines.
 */
function parseProject({ name, tsconfig }) {
  const { output, status, signal } = runTsc(tsconfig);
  const counts = new Map(); // "file::code" -> integer count
  const rawByKey = new Map(); // "file::code" -> string[] raw offending lines
  const drift = []; // lines that look like errors but did not parse
  for (const line of output.split(/\r?\n/)) {
    const m = ERROR_LINE.exec(line);
    if (m) {
      // Normalize win32 backslashes so keys match across dev (win32) and CI (linux).
      const file = m.groups.file.replace(/\\/g, "/");
      const key = `${file}::${m.groups.code}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!rawByKey.has(key)) rawByKey.set(key, []);
      rawByKey.get(key).push(line);
    } else if (line.includes(ERROR_MARKER)) {
      drift.push(line);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { name, counts, rawByKey, drift, status, signal, total };
}

/** Fail-closed checks (a) + (b). Returns true if the project is unusable. */
function isFailClosed(project) {
  if (project.drift.length > 0) {
    console.log(
      `${RED}✗ ${project.name}: tsc emitted ${project.drift.length} error-shaped ` +
        `line(s) the parser did not recognize — output-format drift. Update the ` +
        `parser in scripts/check-type-baseline.mjs.${RESET}`,
    );
    for (const l of project.drift.slice(0, 10)) console.log(`    ${l}`);
    return true;
  }
  if (project.status !== 0 && project.total === 0) {
    const killed = project.signal ? ` (killed by ${project.signal})` : "";
    console.log(
      `${RED}✗ ${project.name}: tsc exited ${project.status}${killed} but produced ZERO ` +
        `parseable errors — config breakage or OOM, not a clean compile.${RESET}`,
    );
    return true;
  }
  return false;
}

/** Build the on-disk baseline object with sorted, stable ordering. */
function buildBaseline(projects) {
  const out = { $comment: BASELINE_COMMENT, tscVersion, projects: {} };
  for (const p of projects) {
    const obj = {};
    for (const key of [...p.counts.keys()].sort()) obj[key] = p.counts.get(key);
    out.projects[p.name] = obj;
  }
  return out;
}

function updateBaseline(projects) {
  const baseline = buildBaseline(projects);
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`${GREEN}✓ Wrote ${path.relative(appRoot, baselinePath)} (tsc ${tscVersion}).${RESET}`);
  for (const p of projects) {
    console.log(`  ${p.name}: ${p.total} error(s) across ${p.counts.size} file::code group(s)`);
  }
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    console.log(
      `${RED}✗ ${path.relative(appRoot, baselinePath)} not found. ` +
        `Generate it with: pnpm run lint:tsc:ratchet:update${RESET}`,
    );
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (e) {
    console.log(`${RED}✗ ${path.relative(appRoot, baselinePath)} is not valid JSON: ${e.message}${RESET}`);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.projects !== "object") {
    console.log(`${RED}✗ ${path.relative(appRoot, baselinePath)} is malformed (missing "projects").${RESET}`);
    process.exit(1);
  }
  return parsed;
}

function compareBaseline(projects, baseline) {
  // Version assertion (c) already ran in main() before the slow tsc pass.
  const violations = []; // { project, key, current, base }
  const improvements = []; // { project, key, current, base }

  for (const p of projects) {
    const base = baseline.projects[p.name] ?? {};
    // New or grown groups => violations.
    for (const [key, current] of p.counts) {
      const prior = base[key] ?? 0;
      if (current > prior) violations.push({ project: p, key, current, base: prior });
    }
    // Shrunk or vanished groups => tighten opportunity (never a failure).
    for (const [key, prior] of Object.entries(base)) {
      const current = p.counts.get(key) ?? 0;
      if (current < prior) improvements.push({ project: p.name, key, current, base: prior });
    }
  }

  if (violations.length > 0) {
    console.log(
      `${RED}✗ ${violations.length} new type error group(s) beyond baseline:${RESET}`,
    );
    for (const v of violations) {
      console.log(
        `\n  ${YELLOW}${v.project.name}::${v.key}${RESET} — baseline ${v.base}, now ${v.current}:`,
      );
      for (const line of v.project.rawByKey.get(v.key) ?? []) console.log(`    ${line}`);
    }
    console.log(
      `\n${RED}${violations.length} new type error(s) beyond baseline — fix them ` +
        `or, if intentional cleanup, run \`pnpm run lint:tsc:ratchet:update\`.${RESET}`,
    );
    process.exit(1);
  }

  if (improvements.length > 0) {
    console.log(
      `${YELLOW}baseline can be tightened: ${improvements.length} group(s) improved ` +
        `— run \`pnpm run lint:tsc:ratchet:update\` to lock in the gains.${RESET}`,
    );
    for (const i of improvements.slice(0, 20)) {
      console.log(`  ${i.project}::${i.key} — baseline ${i.base}, now ${i.current}`);
    }
  }
  const total = projects.reduce((a, p) => a + p.total, 0);
  console.log(`${GREEN}✓ Type ratchet green — ${total} known error(s) at or below baseline (tsc ${tscVersion}).${RESET}`);
}

function main() {
  const update = process.argv.includes("--update");
  // In compare mode, load + version-assert BEFORE the slow tsc runs so a stale
  // baseline fails fast.
  const baseline = update ? null : loadBaseline();
  if (!update && baseline.tscVersion !== tscVersion) {
    console.log(
      `${RED}✗ TypeScript version mismatch: installed ${tscVersion}, baseline ` +
        `recorded ${baseline.tscVersion}. Regenerate: pnpm run lint:tsc:ratchet:update${RESET}`,
    );
    process.exit(1);
  }

  const projects = PROJECTS.map(parseProject);
  let failedClosed = false;
  for (const p of projects) if (isFailClosed(p)) failedClosed = true;
  if (failedClosed) process.exit(1);

  if (update) updateBaseline(projects);
  else compareBaseline(projects, baseline);
}

main();
