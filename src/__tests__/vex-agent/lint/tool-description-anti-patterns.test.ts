/**
 * Anti-pattern lint for ToolDef descriptions + prompt-stack builders.
 *
 * Codex PR3 LLM-shoes review flagged confabulation-inducing framings
 * ("long-term brain", etc) that the cutover purged. This guard prevents
 * them from sneaking back via future ToolDef edits or prompt-builder
 * tweaks. ALSO enforces the orthogonal-classification contract: a tool
 * with `mutating: false` must not advertise "approval required" — the
 * mutating flag is what controls the approval gate, not pressure-safety.
 *
 * Allowlist for `execute_tool`: codex green-light note (round 1).
 * `execute_tool` is `mutating: false` but legitimately describes
 * approval semantics for discovered protocol tools (whose mutating
 * flag varies). Discovery surface ≠ tool surface — pin the exception.
 */

import { describe, it, expect } from "vitest";

import { getAllTools, getToolDef } from "../../../vex-agent/tools/registry.js";
// P3 decomposition: the old `tool-usage.ts` mega-file was split into these
// static-prefix layers. The anti-pattern lint now scans every split builder
// that carries the former tool-usage prose, so a confabulation-inducing framing
// cannot sneak back into any of them.
import { buildToolModelPrompt } from "../../../vex-agent/engine/prompts/tool-model.js";
import { buildSafetyContractPrompt } from "../../../vex-agent/engine/prompts/safety-contract.js";
import { buildMemoryPolicyPrompt } from "../../../vex-agent/engine/prompts/memory-policy.js";
import { buildResearchPrompt } from "../../../vex-agent/engine/prompts/research.js";

const TOOL_PROMPT_BUILDERS: ReadonlyArray<{ name: string; build: () => string }> = [
  { name: "tool-model.ts", build: buildToolModelPrompt },
  { name: "safety-contract.ts", build: buildSafetyContractPrompt },
  { name: "memory-policy.ts", build: buildMemoryPolicyPrompt },
  { name: "research.ts", build: buildResearchPrompt },
];

// ── Anti-pattern phrases (codex round-2 list) ──────────────────────
//
// Targets confabulation-inducing framings the LLM internalises as
// false affordances. `mind` and bare `long-term` are NOT linted — both
// have benign idiomatic uses ("change your mind", "long-term TTL") that
// would generate false positives.
const ANTI_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: "long-term brain", regex: /\blong-term brain\b/i },
  { name: "brain (as agent memory)", regex: /\bbrain\b/i },
  { name: "remembers everything", regex: /\bremembers everything\b/i },
  { name: "permanent truth", regex: /\bpermanent truth\b/i },
];

describe("ToolDef anti-pattern lint", () => {
  for (const pattern of ANTI_PATTERNS) {
    it(`no ToolDef.description contains "${pattern.name}"`, () => {
      const offenders: string[] = [];
      for (const def of getAllTools()) {
        if (pattern.regex.test(def.description)) {
          offenders.push(def.name);
        }
      }
      expect(
        offenders,
        `anti-pattern "${pattern.name}" found in ToolDef descriptions: ${offenders.join(", ")}. `
          + `Codex flagged these framings as confabulation-inducing; rephrase to operational language.`,
      ).toEqual([]);
    });

    for (const builder of TOOL_PROMPT_BUILDERS) {
      it(`${builder.name} does not contain "${pattern.name}"`, () => {
        const prompt = builder.build();
        expect(
          pattern.regex.test(prompt),
          `anti-pattern "${pattern.name}" found in ${builder.name}. Rephrase to operational language.`,
        ).toBe(false);
      });
    }
  }
});

describe("orthogonal classification lint: `mutating: false` tools must not promise approval", () => {
  // Codex PR3 GREEN LIGHT round 1, implementation note 2: `execute_tool`
  // is `mutating: false` but legitimately describes approval semantics
  // for discovered protocol tools. Allow exactly this one tool.
  const APPROVAL_WORDING_ALLOWLIST = new Set<string>(["execute_tool"]);
  const APPROVAL_PATTERN =
    /\b(requires?\s+approval|approval\s+required|needs?\s+approval|requires?\s+confirmation)\b/i;

  it("only `execute_tool` (allowlisted) mentions approval among mutating:false tools", () => {
    const offenders: string[] = [];
    for (const def of getAllTools()) {
      if (def.mutating) continue;
      if (APPROVAL_WORDING_ALLOWLIST.has(def.name)) continue;
      if (APPROVAL_PATTERN.test(def.description)) {
        offenders.push(def.name);
      }
    }
    expect(
      offenders,
      `non-mutating ToolDef.description promises approval gating: ${offenders.join(", ")}. `
        + `Approval is controlled by the \`mutating\` flag, not pressureSafety. `
        + `These tools have \`mutating: false\` so they NEVER trigger an approval prompt; `
        + `the description must not imply otherwise.`,
    ).toEqual([]);
  });

  it("execute_tool retains its approval-semantics paragraph (allowlist invariant)", () => {
    // Sanity check the allowlist remains meaningful — execute_tool's
    // description SHOULD still mention approval because that's how it
    // describes the gate for discovered mutating protocol tools.
    const def = getToolDef("execute_tool");
    expect(def).toBeDefined();
    expect(def?.description).toMatch(APPROVAL_PATTERN);
  });
});

describe("long_memory_suggest provenance contract (S9 — manager-derived `source`)", () => {
  it("does NOT expose a `source` param — provenance is derived by the memory manager", () => {
    const def = getToolDef("long_memory_suggest");
    expect(def).toBeDefined();
    const sourceProp = (def?.parameters.properties as Record<string, unknown> | undefined)?.source;
    expect(sourceProp).toBeUndefined();
  });

  it("description explains the staged write-door (manager reviews, never a direct write)", () => {
    const def = getToolDef("long_memory_suggest");
    expect(def?.description).toMatch(/STAGES a candidate/);
    expect(def?.description).toMatch(/async manager/i);
    expect(def?.description.toLowerCase()).toContain("does not write memory directly");
  });

  it("description advertises the secret / live-state reject policy", () => {
    const def = getToolDef("long_memory_suggest");
    expect(def?.description).toMatch(/Never include secrets/i);
    expect(def?.description).toMatch(/live values/i);
  });
});
