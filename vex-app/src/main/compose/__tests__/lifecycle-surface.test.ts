/**
 * Façade-surface guard for the compose lifecycle structural split. Pins
 * the exact set of RUNTIME exports of `../lifecycle.js` (functions only —
 * the result/option types erase at runtime) and asserts the public
 * type surface still compiles via type-only imports.
 *
 * Codex-requested extra guard: the cwd-based compose invocation contract
 * (project.ts `composeArgs`) must NEVER emit a `-f` flag for an up/down
 * invocation. Under Docker Desktop + WSL2 a `-f <abs-win-path>` triggers
 * the path-concatenation bug class (`docker/compose#12669`, `#7101`).
 */

import { describe, expect, it } from "vitest";
import * as lifecycle from "../lifecycle.js";
import { composeArgs } from "../project.js";
// Type-only imports: these must compile or the public type surface drifted.
import type {
  ComposeUpKind,
  ComposeUpResult,
  ComposeDownKind,
  ComposeDownResult,
  ComposeUpOptions,
} from "../lifecycle.js";

describe("compose lifecycle façade surface", () => {
  it("exposes exactly the documented runtime exports with correct typeof", () => {
    const expected = {
      composeUp: "function",
      composeDown: "function",
    } as const;

    for (const [name, kind] of Object.entries(expected)) {
      expect(typeof (lifecycle as Record<string, unknown>)[name]).toBe(kind);
    }

    // Pin the EXACT set of runtime export keys (types are compile-time
    // only, so they do not appear here).
    expect(Object.keys(lifecycle).sort()).toEqual(
      Object.keys(expected).sort()
    );
  });

  it("preserves the exported type surface (compile-time guard)", () => {
    // Referencing each exported type forces a compile error if any were
    // dropped or renamed. Values are constructed only to anchor the types.
    const upKind: ComposeUpKind = "running";
    const downKind: ComposeDownKind = "stopped";
    const upResult: ComposeUpResult = {
      kind: upKind,
      composeOutPath: "/x/docker-compose.yml",
      installId: "abc",
      message: "ok",
      pgPort: 5432,
      embedPort: 27134,
      pgPasswordPath: "/x/secrets/pg_password",
      embeddingsReadiness: null,
    };
    const downResult: ComposeDownResult = { kind: downKind, message: "ok" };
    const options: ComposeUpOptions = {};

    expect(upResult.kind).toBe("running");
    expect(downResult.kind).toBe("stopped");
    expect(options).toEqual({});
  });
});

describe("compose-args builder no-`-f` guard (project.ts)", () => {
  it("never emits `-f` for an `up -d` invocation", () => {
    const args = composeArgs(["up", "-d"]);
    expect(args).toEqual(["compose", "up", "-d"]);
    expect(args).not.toContain("-f");
  });

  it("never emits `-f` for a `pull` invocation", () => {
    const args = composeArgs(["pull"]);
    expect(args).not.toContain("-f");
  });

  it("never emits `-f` for a `-p <project> stop` (down) invocation", () => {
    const args = composeArgs(["-p", "vex-abc", "stop"]);
    expect(args).toEqual(["compose", "-p", "vex-abc", "stop"]);
    expect(args).not.toContain("-f");
  });

  it("never emits `-f` for a `-p <project> down --remove-orphans --volumes` (recovery) invocation", () => {
    const args = composeArgs([
      "-p",
      "vex-abc",
      "down",
      "--remove-orphans",
      "--volumes",
    ]);
    expect(args).not.toContain("-f");
  });

  it("never emits `-f` for a `version` pre-flight invocation", () => {
    const args = composeArgs(["version"]);
    expect(args).not.toContain("-f");
  });
});
