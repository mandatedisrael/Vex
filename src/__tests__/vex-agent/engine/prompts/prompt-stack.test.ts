import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { EngineContext, Permission, SessionKind } from "../../../../vex-agent/engine/types.js";
import {
  buildPromptStack,
  buildProtocolsPrompt,
  resetProtocolsPromptCache,
  buildPermissionPrompt,
  buildToolUsagePrompt,
} from "../../../../vex-agent/engine/prompts/index.js";
import { buildRuntimeClockSnapshot } from "../../../../vex-agent/engine/runtime-clock.js";
import { PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST, PROTOCOL_TOOLS } from "../../../../vex-agent/tools/protocols/catalog.js";

function makeContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    sessionId: "session-1",
    sessionKind: "agent",
    sessionPermission: "restricted",
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map(),
    ...overrides,
  };
}

describe("prompt-stack", () => {
  beforeEach(() => {
    resetProtocolsPromptCache();
  });

  // ── Constant block present in every mode ────────────────────

  describe("constant layer always present", () => {
    const permissions: Permission[] = ["restricted", "full"];
    const kinds: SessionKind[] = ["agent", "mission"];

    for (const permission of permissions) {
      for (const kind of kinds) {
        it(`includes base + tool-usage + protocols in ${kind}/${permission}`, () => {
          const stack = buildPromptStack(makeContext({ sessionPermission: permission, sessionKind: kind }));
          const joined = stack.join("\n");

          // Base prompt markers
          expect(joined).toContain("# Identity");
          expect(joined).toContain("VEX");
          expect(joined).toContain("# Your current aspect");
          expect(joined).toContain("# Memory and self-learning");

          // Tool usage markers
          expect(joined).toContain("discover_tools");
          expect(joined).toContain("execute_tool");
          expect(joined).toContain("2-step transfer rule");

          // Protocols marker
          expect(joined).toContain("# Available Protocol Namespaces");
        });
      }
    }
  });

  // ── Protocols generated from catalog ────────────────────────

  describe("protocols prompt", () => {
    it("mentions total tool count from actual catalog", () => {
      const prompt = buildProtocolsPrompt();
      const advertisedToolCount = PROTOCOL_TOOLS.filter((tool) =>
        PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(tool.namespace),
      ).length;
      expect(prompt).toContain(`Total: ${advertisedToolCount} tools`);
    });

    it("contains all active namespaces from catalog", () => {
      const prompt = buildProtocolsPrompt();

      // Only advertised namespaces appear in the prompt — non-advertised
      // ones (e.g. reserved or temporarily disabled) are filtered out by
      // `buildProtocolsPrompt` via `PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST`.
      const advertisedNamespacesWithTools = new Set(
        PROTOCOL_TOOLS
          .filter(t => (PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST as readonly string[]).includes(t.namespace))
          .map(t => t.namespace),
      );

      for (const ns of advertisedNamespacesWithTools) {
        expect(prompt).toContain(`## ${ns}`);
      }
    });

    it("renders explicit product groups instead of heuristic families", () => {
      const prompt = buildProtocolsPrompt();
      expect(prompt).toContain("### Cross-chain");
      expect(prompt).not.toContain("Families:");
    });

    it("marks namespaces with mutating tools", () => {
      const prompt = buildProtocolsPrompt();

      // Only advertised namespaces are rendered into the prompt — apply the
      // same filter when collecting "namespaces with mutating tools".
      const namespacesWithMutating = new Set(
        PROTOCOL_TOOLS
          .filter(t => t.mutating)
          .filter(t => (PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST as readonly string[]).includes(t.namespace))
          .map(t => t.namespace),
      );

      for (const ns of namespacesWithMutating) {
        // The namespace section should mention mutating
        const nsSection = prompt.split(`## ${ns}`)[1]?.split("##")[0] ?? "";
        expect(nsSection).toContain("mutating");
      }
    });

    it("is not hardcoded — count changes with catalog", () => {
      const prompt = buildProtocolsPrompt();
      // The total count rendered in the prompt is the advertised tool count
      // (see `buildProtocolsPrompt`), not the full catalog size.
      const advertisedToolCount = PROTOCOL_TOOLS.filter((tool) =>
        (PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST as readonly string[]).includes(tool.namespace),
      ).length;
      expect(prompt).toContain(String(advertisedToolCount));
    });
  });

  // ── Mission setup has same protocol knowledge ───────────────

  describe("mission setup vs full permission protocol knowledge", () => {
    it("has identical protocol block", () => {
      const setupStack = buildPromptStack(makeContext({
        sessionKind: "mission", sessionPermission: "restricted",
      }));
      const fullStack = buildPromptStack(makeContext({
        sessionKind: "mission", sessionPermission: "full", missionRunId: "run-1",
      }));

      // Both should have the same protocols prompt
      const setupProtocols = setupStack.find(s => s.includes("# Available Protocol Namespaces"));
      const fullProtocols = fullStack.find(s => s.includes("# Available Protocol Namespaces"));
      expect(setupProtocols).toBe(fullProtocols);

      // Both should have the same tool-usage prompt
      const setupToolUsage = setupStack.find(s => s.includes("# Tool Usage"));
      const fullToolUsage = fullStack.find(s => s.includes("# Tool Usage"));
      expect(setupToolUsage).toBe(fullToolUsage);
    });

    it("differs only in policy and context", () => {
      const setupStack = buildPromptStack(makeContext({
        sessionKind: "mission", sessionPermission: "restricted",
      }));
      const fullStack = buildPromptStack(makeContext({
        sessionKind: "mission", sessionPermission: "full", missionRunId: "run-1",
      }));

      const setupJoined = setupStack.join("\n");
      const fullJoined = fullStack.join("\n");

      // Setup has setup-specific content
      expect(setupJoined).toContain("# Mission Setup");
      expect(setupJoined).not.toContain("# Mission Execution");

      // Full has run-specific content
      expect(fullJoined).toContain("# Mission Execution");
      expect(fullJoined).not.toContain("# Mission Setup");
    });
  });

  // ── Permission prompts ──────────────────────────────────────

  describe("permission prompts", () => {
    it("agent / restricted requires approval for mutations", () => {
      const prompt = buildPermissionPrompt({ mode: "agent", permission: "restricted" });
      expect(prompt).toContain("approval");
      expect(prompt).toContain("Mutating tools");
    });

    it("agent / full grants full authority", () => {
      const prompt = buildPermissionPrompt({ mode: "agent", permission: "full" });
      expect(prompt).toContain("full authority");
    });

    it("mission / restricted requires approval and supports loop_defer", () => {
      const prompt = buildPermissionPrompt({ mode: "mission", permission: "restricted" });
      expect(prompt).toContain("approval");
      expect(prompt).toContain("loop_defer");
    });

    it("mission / full grants full authority", () => {
      const prompt = buildPermissionPrompt({ mode: "mission", permission: "full" });
      expect(prompt).toContain("full authority");
    });
  });

  // ── Contextual layers ───────────────────────────────────────

  describe("contextual layers", () => {
    it("agent mode includes agent prompt", () => {
      const stack = buildPromptStack(makeContext({ sessionKind: "agent" }));
      const joined = stack.join("\n");
      expect(joined).toContain("# Agent Mode");
    });

    it("mission setup includes setup prompt", () => {
      const stack = buildPromptStack(makeContext({
        sessionKind: "mission", missionId: "m-1",
      }));
      const joined = stack.join("\n");
      expect(joined).toContain("# Mission Setup");
      expect(joined).not.toContain("# Mission Execution");
    });

    it("mission run includes run prompt", () => {
      const stack = buildPromptStack(makeContext({
        sessionKind: "mission", missionId: "m-1", missionRunId: "run-1",
      }));
      const joined = stack.join("\n");
      expect(joined).toContain("# Mission Execution");
      expect(joined).not.toContain("# Mission Setup");
    });

    it("subagent includes subagent prompt", () => {
      const stack = buildPromptStack(makeContext({ isSubagent: true }));
      const joined = stack.join("\n");
      expect(joined).toContain("# Subagent Role");
    });

    it("mission setup with context shows draft state", () => {
      const stack = buildPromptStack(
        makeContext({ sessionKind: "mission" }),
        {
          missionSetupContext: {
            currentDraft: { title: "SOL DCA", goal: "Accumulate SOL" },
            missingFields: ["capitalSource", "startingCapital"],
          },
        },
      );
      const joined = stack.join("\n");
      expect(joined).toContain("SOL DCA");
      expect(joined).toContain("Still Missing");
      expect(joined).toContain("capitalSource");
      expect(joined).toContain("Stop conditions are user-owned contract terms");
      // Puzzle 04: prompt no longer instructs the model about
      // `stopConditionsAccepted=true` — acceptance is host-only. The
      // mission-setup prompt instead points the model at the host
      // `Accept contract` step.
      expect(joined).toContain("Acceptance is a separate host-only step");
    });

    it("mission run with context shows mission contract", () => {
      const stack = buildPromptStack(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        {
          missionRunContext: {
            missionPromptContext: "# Mission: SOL DCA\n**Goal:** Accumulate 10 SOL",
            iterationCount: 5,
          },
        },
      );
      const joined = stack.join("\n");
      expect(joined).toContain("SOL DCA");
      expect(joined).toContain("Iteration: 5");
    });

    it("subagent with context shows task and restrictions", () => {
      const stack = buildPromptStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "Research SOL/USDC liquidity on Jupiter",
            allowTrades: false,
            childPermission: "restricted",
          },
        },
      );
      const joined = stack.join("\n");
      expect(joined).toContain("Research SOL/USDC liquidity");
      expect(joined).toContain("NO TRADES");
      expect(joined).toContain("restricted");
    });

    it("subagent briefing includes parent summary snapshot when provided", () => {
      const stack = buildPromptStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "Research L2 gas costs",
            allowTrades: false,
            childPermission: "restricted",
            parentSummarySnapshot:
              "User opened a SOL long at 145 USD, closed BTC short at 62500, portfolio +4.2% 7d.",
          },
        },
      );
      const joined = stack.join("\n");
      expect(joined).toContain("## Parent context (snapshot at spawn)");
      expect(joined).toContain("SOL long at 145 USD");
      expect(joined).toContain("portfolio +4.2%");
    });

    it("subagent briefing omits parent context block when snapshot is empty or absent", () => {
      const withoutSnapshot = buildPromptStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "T",
            allowTrades: false,
            childPermission: "restricted",
          },
        },
      ).join("\n");
      expect(withoutSnapshot).not.toContain("## Parent context");

      const withEmptySnapshot = buildPromptStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "T",
            allowTrades: false,
            childPermission: "restricted",
            parentSummarySnapshot: "   \n   ",
          },
        },
      ).join("\n");
      expect(withEmptySnapshot).not.toContain("## Parent context");
    });
  });

  // ── Base prompt ─────────────────────────────────────────────

  describe("base prompt", () => {
    it("includes session context", () => {
      const stack = buildPromptStack(makeContext({ sessionId: "test-session" }));
      const joined = stack.join("\n");
      expect(joined).toContain("test-session");
    });

    it("includes runtime clock context for session and mission timing", () => {
      const runtimeClock = buildRuntimeClockSnapshot({
        now: new Date("2026-05-03T08:39:18.126Z"),
        timezone: "UTC",
        sessionStartedAt: "2026-05-03T08:01:02.000Z",
        missionRunStartedAt: "2026-05-03T08:10:00.000Z",
        missionDeadline: "2026-05-03T14:10:00.000Z",
      });
      const stack = buildPromptStack(
        makeContext({
          sessionKind: "mission",
          missionId: "m-1",
          missionRunId: "run-1",
          sessionStartedAt: "2026-05-03T08:01:02.000Z",
          missionRunStartedAt: "2026-05-03T08:10:00.000Z",
          missionDeadline: "2026-05-03T14:10:00.000Z",
        }),
        { runtimeClock },
      );
      const joined = stack.join("\n");

      expect(joined).toContain("# Runtime Clock");
      expect(joined).toContain("Current time UTC: 2026-05-03T08:39:18.126Z");
      expect(joined).toContain("Session started: 2026-05-03T08:01:02.000Z (elapsed: 38m 16s)");
      expect(joined).toContain("Mission run started: 2026-05-03T08:10:00.000Z (elapsed: 29m 18s)");
      expect(joined).toContain("Mission deadline: 2026-05-03T14:10:00.000Z (in 5h 30m)");
      expect(joined).toContain("loop_defer(after_ms, reason)");
    });

    it("includes loaded documents", () => {
      const stack = buildPromptStack(makeContext({
        loadedDocuments: new Map([["strategy.md", "# Strategy\nBuy low sell high"]]),
      }));
      const joined = stack.join("\n");
      expect(joined).toContain("strategy.md");
      expect(joined).toContain("Buy low sell high");
    });
  });

  // ── Dynamic aspect injection ────────────────────────────────

  describe("base prompt — dynamic aspect", () => {
    /**
     * Aspect narration in base.ts is modal: only the currently active mode's
     * aspect lands in the prompt. Prevents model from reading about modes it
     * can't reach from this session.
     */
    it("AGENT aspect: only teacher/collaborator lines, no MISSION narrative", () => {
      const stack = buildPromptStack(makeContext({ sessionKind: "agent" }));
      const joined = stack.join("\n");
      expect(joined).toContain("AGENT");
      expect(joined).toContain("teacher, collaborator");
      expect(joined).not.toContain("MISSION SETUP");
      expect(joined).not.toContain("MISSION RUN");
    });

    it("MISSION SETUP aspect: planner lines, no AGENT / MISSION RUN narrative", () => {
      const stack = buildPromptStack(makeContext({ sessionKind: "mission" }));
      const joined = stack.join("\n");
      expect(joined).toContain("MISSION SETUP");
      expect(joined).toContain("planner");
      // AGENT aspect narrative absent — we only check the aspect-section label.
      expect(joined).not.toContain("teacher, collaborator");
      expect(joined).not.toContain("MISSION RUN");
    });

    it("MISSION RUN aspect: executor lines, no SETUP / AGENT narrative", () => {
      const stack = buildPromptStack(makeContext({
        sessionKind: "mission", missionId: "m-1", missionRunId: "run-1",
      }));
      const joined = stack.join("\n");
      expect(joined).toContain("MISSION RUN");
      expect(joined).toContain("executor");
      expect(joined).toContain("mission_stop");
      expect(joined).toContain("user-approved stop condition");
      expect(joined).toContain("loop_defer");
      expect(joined).not.toContain("teacher, collaborator");
      expect(joined).not.toContain("planner");
    });

    it("SUBAGENT aspect overrides sessionKind and narrates delegated task", () => {
      const stack = buildPromptStack(makeContext({ isSubagent: true, sessionKind: "agent" }));
      const joined = stack.join("\n");
      expect(joined).toContain("SUBAGENT");
      expect(joined).toContain("delegated");
      expect(joined).not.toContain("teacher, collaborator");
    });
  });

  // ── Stack composition ───────────────────────────────────────

  // ── DeFi safety rules ──────────────────────────────────────

  describe("DeFi safety rules in prompt", () => {
    it("contains gas reserve rule", () => {
      const stack = buildPromptStack(makeContext());
      const joined = stack.join("\n");
      expect(joined).toContain("Gas reserve on native tokens");
      expect(joined).toContain("balance minus gas reserve");
    });

    it("contains fresh balance rule", () => {
      const stack = buildPromptStack(makeContext());
      const joined = stack.join("\n");
      expect(joined).toContain("Fresh balance before each mutation");
    });

    it("contains quote / preview before mutation rule (PR3 reorg)", () => {
      // PR3-clarity moved the rule into the Protocol Execution section
      // and rephrased it as "Quote / preview before mutation" — the
      // contract (read-only dryRun pass first) is preserved.
      const stack = buildPromptStack(makeContext());
      const joined = stack.join("\n");
      expect(joined).toMatch(/Quote\s*\/\s*preview before mutation/i);
    });

    it("contains address-first rule", () => {
      const stack = buildPromptStack(makeContext());
      const joined = stack.join("\n");
      expect(joined).toContain("Address-first for EVM mutations");
      expect(joined).toContain("khalani.tokens.search");
    });

    it("khalani is canonical resolver in protocols section, kyberswap is not primary", () => {
      const prompt = buildProtocolsPrompt();
      // kyberswap section should reference khalani as resolver, not itself
      const kyberSection = prompt.split("## kyberswap")[1]?.split("##")[0] ?? "";
      expect(kyberSection).toContain("khalani");
      expect(kyberSection).not.toContain("kyberswap.tokens.search");
    });

    it("polymarket section exposes subarea guidance", () => {
      const prompt = buildProtocolsPrompt();
      const polymarketSection = prompt.split("## polymarket")[1]?.split("##")[0] ?? "";
      expect(polymarketSection).toContain("Paths:");
      expect(polymarketSection).toContain("Gamma discovery");
      expect(polymarketSection).toContain("CLOB trading");
    });

  });

  // ── Env-aware availability in protocols prompt ──────────────────

  describe("protocols prompt — env awareness", () => {
    const ENV_KEYS = ["JUPITER_API_KEY", "POLYMARKET_API_KEY"] as const;
    const original: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of ENV_KEYS) original[k] = process.env[k];
      resetProtocolsPromptCache();
    });

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (original[k] === undefined) delete process.env[k];
        else process.env[k] = original[k];
      }
      resetProtocolsPromptCache();
    });

    it("renders 'Requires env' hint for a fully env-gated namespace with 0 available tools", () => {
      delete process.env.JUPITER_API_KEY;
      resetProtocolsPromptCache();
      const prompt = buildProtocolsPrompt();
      const solanaSection = prompt.split("## solana")[1]?.split("##")[0] ?? "";
      expect(solanaSection).toContain("Tools: 0 active");
      expect(solanaSection).toContain("Requires env: JUPITER_API_KEY");
    });

    it("does not render 'Requires env' hint when env is present", () => {
      process.env.JUPITER_API_KEY = "test-jupiter-key";
      resetProtocolsPromptCache();
      const prompt = buildProtocolsPrompt();
      const solanaSection = prompt.split("## solana")[1]?.split("##")[0] ?? "";
      expect(solanaSection).not.toContain("Requires env:");
    });
  });

  // ── Stack structure ───────────────────────────────────────

  describe("stack structure", () => {
    it("returns array of separate sections", () => {
      const stack = buildPromptStack(makeContext());
      expect(Array.isArray(stack)).toBe(true);
      // Minimum: base + tool-usage + protocols + mode + chat = 5
      expect(stack.length).toBeGreaterThanOrEqual(5);
    });

    it("each section is a non-empty string", () => {
      const stack = buildPromptStack(makeContext());
      for (const section of stack) {
        expect(typeof section).toBe("string");
        expect(section.length).toBeGreaterThan(0);
      }
    });
  });
});
