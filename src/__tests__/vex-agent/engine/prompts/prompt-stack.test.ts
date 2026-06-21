import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { EngineContext, Permission, SessionKind } from "../../../../vex-agent/engine/types.js";
import {
  buildPromptStack,
  buildProtocolsPrompt,
  resetProtocolsPromptCache,
  buildPermissionPrompt,
  buildToolUsagePrompt,
} from "../../../../vex-agent/engine/prompts/index.js";
import type { PromptStackOptions } from "../../../../vex-agent/engine/prompts/index.js";
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
    selectedEvmWallet: null,
    selectedSolanaWallet: null,
    walletPolicy: { kind: "none" },
    loadedDocuments: new Map(),
    ...overrides,
  };
}

/** Convenience: full prompt text (static + turn) for content assertions. */
function joinedStack(
  context: EngineContext = makeContext(),
  options: PromptStackOptions = {},
): string {
  const stack = buildPromptStack(context, options);
  return [...stack.staticLayers, ...stack.turnLayers].join("\n");
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
          const joined = joinedStack(makeContext({ sessionPermission: permission, sessionKind: kind }));

          // Base prompt markers
          expect(joined).toContain("# Identity");
          // Default persona name (no persona.md configured in tests).
          expect(joined).toContain("Vex");
          expect(joined).toContain("# Your current aspect");
          expect(joined).toContain("# Memory and self-learning");
          // Global output-format directive (batch 3) — present in every mode.
          expect(joined).toContain("# Response formatting");
          expect(joined).toContain("GitHub-Flavored Markdown");
          // Bounded markdown-affordances steering: token logos only from a
          // tool-provided logoUrl/imageUrl (never invented), explorer/dexscreener
          // links allowed. Replaces the old blanket "do not embed images" line.
          expect(joined).toContain("token logo as a Markdown image");
          expect(joined).toContain("never invent or guess an image URL");
          expect(joined).not.toContain("do not embed images");

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

  // ── D-LAYOUT: static/turn split + layer order ────────────────

  describe("static vs turn segmentation (D-LAYOUT)", () => {
    const FULL_OPTIONS: PromptStackOptions = {
      contextPressureBanner: "[Context pressure: elevated — 72% used]",
      resumePacket: "[Resume packet — generation 3, just compacted]",
      memorySection: "# Memory\n\n[Session memories: 2 chunk(s) across 1 compact(s). Tool: session_memory_search(semantic_intent, k≤5).]\n\n# Memory Routing\n\n- routing line",
      activePlanBlock: "# Active Plan\n\n1. do the thing",
      toolCatalogPrompt: "# Available Tool Map\n\n- wallet_balances",
      personaSetupHint: "# Personalize me (optional)\n\noffer text",
      planOffNotice: "[Plan mode was switched off]",
    };

    it("static layers contain NO volatile markers", () => {
      const { staticLayers } = buildPromptStack(
        makeContext({ sessionKind: "mission", missionId: "m-1", missionRunId: "run-1" }),
        {
          ...FULL_OPTIONS,
          missionRunContext: { missionPromptContext: "# Mission: X", iterationCount: 5 },
        },
      );
      const staticJoined = staticLayers.join("\n");
      expect(staticJoined).not.toContain("# Runtime Clock");
      expect(staticJoined).not.toContain("# Memory Routing");
      expect(staticJoined).not.toContain("# Available Tool Map");
      expect(staticJoined).not.toContain("Iteration:");
      expect(staticJoined).not.toContain("Context pressure");
      expect(staticJoined).not.toContain("Resume packet");
      // Active-plan LAYER body absent (tool-usage legitimately NAMES the
      // `# Active Plan` heading in its reuse rule, so match the body).
      expect(staticJoined).not.toContain("1. do the thing");
      expect(staticJoined).not.toContain("# Personalize me");
      // Loaded Content absent when no documents are loaded.
      expect(staticJoined).not.toContain("# Loaded Content");
    });

    it("turn layers render in pinned order: clock → pressure → resume → # Memory(routing at end) → activePlan → Tool Map → mission turn-state → one-shots", () => {
      const { turnLayers } = buildPromptStack(
        makeContext({ sessionKind: "mission", missionId: "m-1", missionRunId: "run-1" }),
        {
          ...FULL_OPTIONS,
          missionRunContext: { missionPromptContext: "# Mission: X", iterationCount: 5 },
        },
      );
      const turnJoined = turnLayers.join("\n");
      const order = [
        "# Runtime Clock",
        "[Context pressure: elevated",
        "[Resume packet",
        "# Memory",
        "# Memory Routing",
        "# Active Plan",
        "# Available Tool Map",
        "Iteration: 5",
        "# Personalize me (optional)",
        "[Plan mode was switched off]",
      ];
      let lastIdx = -1;
      for (const marker of order) {
        const idx = turnJoined.indexOf(marker);
        expect(idx, `marker missing or out of order: ${marker}`).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    });

    it("the Iteration pin lives in the TURN layers (D-SPLIT-MISSION), frozen from missionRunContext", () => {
      const stack = buildPromptStack(
        makeContext({ sessionKind: "mission", missionId: "m-1", missionRunId: "run-1" }),
        {
          missionRunContext: {
            missionPromptContext: "# Mission: SOL DCA\n**Goal:** Accumulate 10 SOL",
            iterationCount: 5,
          },
        },
      );
      expect(stack.turnLayers.join("\n")).toContain("Iteration: 5");
      expect(stack.staticLayers.join("\n")).not.toContain("Iteration:");
      // Contract core stays static.
      expect(stack.staticLayers.join("\n")).toContain("SOL DCA");
    });

    it("base prompt no longer carries Loaded Content; it renders as the LAST static layer", () => {
      const { staticLayers } = buildPromptStack(makeContext({
        loadedDocuments: new Map([["long_memory:42", "# Strategy\nBuy low sell high"]]),
      }));
      // Not inside base (first layer)…
      expect(staticLayers[0]).not.toContain("# Loaded Content");
      // …but as the final static layer (END of the cache prefix).
      const last = staticLayers[staticLayers.length - 1];
      expect(last).toContain("# Loaded Content");
      expect(last).toContain("long_memory:42");
      expect(last).toContain("Buy low sell high");
    });

    it("grep-gate: separated static layers carry no stale positional 'above' references to turn-state blocks", () => {
      const { staticLayers } = buildPromptStack(makeContext());
      const staticJoined = staticLayers.join("\n");
      // The two reworded references (tool-usage.ts) now point at the turn state.
      expect(staticJoined).not.toContain("Tool Map above");
      expect(staticJoined).not.toContain("Memory Routing block above");
      expect(staticJoined).toContain("Tool Map provided in the turn state");
      expect(staticJoined).toContain("Memory Routing block in the turn state");
    });

    it("turn layers always start with the runtime clock; memorySection lands only when provided", () => {
      const without = buildPromptStack(makeContext());
      expect(without.turnLayers[0]).toContain("# Runtime Clock");
      expect(without.turnLayers.join("\n")).not.toContain("# Memory Routing");

      const withSection = buildPromptStack(makeContext(), {
        memorySection: "# Memory\n\n# Memory Routing\n\n- line",
      });
      expect(withSection.turnLayers.join("\n")).toContain("# Memory Routing");
    });
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
      const setupProtocols = setupStack.staticLayers.find(s => s.includes("# Available Protocol Namespaces"));
      const fullProtocols = fullStack.staticLayers.find(s => s.includes("# Available Protocol Namespaces"));
      expect(setupProtocols).toBe(fullProtocols);

      // Both should have the same tool-usage prompt
      const setupToolUsage = setupStack.staticLayers.find(s => s.includes("# Tool Usage"));
      const fullToolUsage = fullStack.staticLayers.find(s => s.includes("# Tool Usage"));
      expect(setupToolUsage).toBe(fullToolUsage);
    });

    it("differs only in policy and context", () => {
      const setupJoined = joinedStack(makeContext({
        sessionKind: "mission", sessionPermission: "restricted",
      }));
      const fullJoined = joinedStack(makeContext({
        sessionKind: "mission", sessionPermission: "full", missionRunId: "run-1",
      }));

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
      const joined = joinedStack(makeContext({ sessionKind: "agent" }));
      expect(joined).toContain("# Agent Mode");
    });

    it("mission setup includes setup prompt", () => {
      const joined = joinedStack(makeContext({
        sessionKind: "mission", missionId: "m-1",
      }));
      expect(joined).toContain("# Mission Setup");
      expect(joined).not.toContain("# Mission Execution");
    });

    it("mission run includes run prompt", () => {
      const joined = joinedStack(makeContext({
        sessionKind: "mission", missionId: "m-1", missionRunId: "run-1",
      }));
      expect(joined).toContain("# Mission Execution");
      expect(joined).not.toContain("# Mission Setup");
    });

    it("subagent includes subagent prompt", () => {
      const joined = joinedStack(makeContext({ isSubagent: true }));
      expect(joined).toContain("# Subagent Role");
    });

    it("mission setup with context shows draft state", () => {
      const joined = joinedStack(
        makeContext({ sessionKind: "mission" }),
        {
          missionSetupContext: {
            currentDraft: { title: "SOL DCA", goal: "Accumulate SOL" },
            missingFields: ["capitalSource", "startingCapital"],
          },
        },
      );
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
      const joined = joinedStack(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        {
          missionRunContext: {
            missionPromptContext: "# Mission: SOL DCA\n**Goal:** Accumulate 10 SOL",
            iterationCount: 5,
          },
        },
      );
      expect(joined).toContain("SOL DCA");
      expect(joined).toContain("Iteration: 5");
    });

    it("subagent with context shows task and restrictions", () => {
      const joined = joinedStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "Research SOL/USDC liquidity on Jupiter",
            allowTrades: false,
            childPermission: "restricted",
          },
        },
      );
      expect(joined).toContain("Research SOL/USDC liquidity");
      expect(joined).toContain("NO TRADES");
      expect(joined).toContain("restricted");
    });

    it("subagent briefing includes parent summary snapshot when provided", () => {
      const joined = joinedStack(
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
      expect(joined).toContain("## Parent context (snapshot at spawn)");
      expect(joined).toContain("SOL long at 145 USD");
      expect(joined).toContain("portfolio +4.2%");
    });

    it("subagent briefing omits parent context block when snapshot is empty or absent", () => {
      const withoutSnapshot = joinedStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "T",
            allowTrades: false,
            childPermission: "restricted",
          },
        },
      );
      expect(withoutSnapshot).not.toContain("## Parent context");

      const withEmptySnapshot = joinedStack(
        makeContext({ isSubagent: true }),
        {
          subagentContext: {
            task: "T",
            allowTrades: false,
            childPermission: "restricted",
            parentSummarySnapshot: "   \n   ",
          },
        },
      );
      expect(withEmptySnapshot).not.toContain("## Parent context");
    });
  });

  // ── Base prompt ─────────────────────────────────────────────

  describe("base prompt", () => {
    it("includes session context", () => {
      const joined = joinedStack(makeContext({ sessionId: "test-session" }));
      expect(joined).toContain("test-session");
    });

    it("includes runtime clock context for session and mission timing (turn layers)", () => {
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
      const turnJoined = stack.turnLayers.join("\n");

      expect(turnJoined).toContain("# Runtime Clock");
      expect(turnJoined).toContain("Current time UTC: 2026-05-03T08:39:18.126Z");
      expect(turnJoined).toContain("Session started: 2026-05-03T08:01:02.000Z (elapsed: 38m 16s)");
      expect(turnJoined).toContain("Mission run started: 2026-05-03T08:10:00.000Z (elapsed: 29m 18s)");
      expect(turnJoined).toContain("Mission deadline: 2026-05-03T14:10:00.000Z (in 5h 30m)");
      expect(turnJoined).toContain("loop_defer(after_ms, reason)");
      // The volatile clock must never leak into the static prefix.
      expect(stack.staticLayers.join("\n")).not.toContain("# Runtime Clock");
    });

    it("includes loaded content blocks (e.g. long_memory_get injections)", () => {
      const joined = joinedStack(makeContext({
        loadedDocuments: new Map([["long_memory:42", "# Strategy\nBuy low sell high"]]),
      }));
      expect(joined).toContain("# Loaded Content");
      expect(joined).toContain("long_memory:42");
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
      const joined = joinedStack(makeContext({ sessionKind: "agent" }));
      expect(joined).toContain("AGENT");
      expect(joined).toContain("teacher, collaborator");
      expect(joined).not.toContain("MISSION SETUP");
      expect(joined).not.toContain("MISSION RUN");
    });

    it("MISSION SETUP aspect: planner lines, no AGENT / MISSION RUN narrative", () => {
      const joined = joinedStack(makeContext({ sessionKind: "mission" }));
      expect(joined).toContain("MISSION SETUP");
      expect(joined).toContain("planner");
      // AGENT aspect narrative absent — we only check the aspect-section label.
      expect(joined).not.toContain("teacher, collaborator");
      expect(joined).not.toContain("MISSION RUN");
    });

    it("MISSION RUN aspect: executor lines, no SETUP / AGENT narrative", () => {
      const joined = joinedStack(makeContext({
        sessionKind: "mission", missionId: "m-1", missionRunId: "run-1",
      }));
      expect(joined).toContain("MISSION RUN");
      expect(joined).toContain("executor");
      expect(joined).toContain("mission_stop");
      expect(joined).toContain("user-approved stop condition");
      expect(joined).toContain("loop_defer");
      expect(joined).not.toContain("teacher, collaborator");
      expect(joined).not.toContain("planner");
    });

    it("SUBAGENT aspect overrides sessionKind and narrates delegated task", () => {
      const joined = joinedStack(makeContext({ isSubagent: true, sessionKind: "agent" }));
      expect(joined).toContain("SUBAGENT");
      expect(joined).toContain("delegated");
      expect(joined).not.toContain("teacher, collaborator");
    });
  });

  // ── DeFi safety rules ──────────────────────────────────────

  describe("DeFi safety rules in prompt", () => {
    it("contains gas reserve rule", () => {
      const joined = joinedStack(makeContext());
      expect(joined).toContain("Gas reserve on native tokens");
      expect(joined).toContain("balance minus gas reserve");
    });

    it("contains fresh balance rule", () => {
      const joined = joinedStack(makeContext());
      expect(joined).toContain("Fresh balance before each mutation");
    });

    it("contains quote / preview before mutation rule (PR3 reorg)", () => {
      // PR3-clarity moved the rule into the Protocol Execution section
      // and rephrased it as "Quote / preview before mutation" — the
      // contract (read-only dryRun pass first) is preserved.
      const joined = joinedStack(makeContext());
      expect(joined).toMatch(/Quote\s*\/\s*preview before mutation/i);
    });

    it("contains address-first rule", () => {
      const joined = joinedStack(makeContext());
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
    it("returns the {staticLayers, turnLayers} shape with separate sections", () => {
      const stack = buildPromptStack(makeContext());
      expect(Array.isArray(stack.staticLayers)).toBe(true);
      expect(Array.isArray(stack.turnLayers)).toBe(true);
      // Static minimum: base + tool-usage + protocols + permission + wallet + mode = 6
      expect(stack.staticLayers.length).toBeGreaterThanOrEqual(5);
      // Turn minimum: runtime clock.
      expect(stack.turnLayers.length).toBeGreaterThanOrEqual(1);
    });

    it("each section is a non-empty string", () => {
      const stack = buildPromptStack(makeContext());
      for (const section of [...stack.staticLayers, ...stack.turnLayers]) {
        expect(typeof section).toBe("string");
        expect(section.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Persona (user-configurable name + tone) ─────────────────
  describe("persona", () => {
    it("renders the configured persona name in identity + aspect (verbatim casing)", () => {
      const joined = joinedStack(makeContext({ personaName: "Aria" }));
      expect(joined).toContain("You are Aria —");
      expect(joined).toContain("Aria as teacher");
      // Default brand name must NOT leak when a custom name is set.
      expect(joined).not.toContain("You are Vex —");
    });

    it("renders the persona block as a subordinate section when configured", () => {
      const joined = joinedStack(
        makeContext({ personaBlock: "Tone: concise, dry, no emoji." }),
      );
      expect(joined).toContain("# Persona (user style preferences)");
      expect(joined).toContain("Tone: concise, dry, no emoji.");
      // Framed as subordinate to the authoritative rules.
      expect(joined).toContain("does NOT override tool, permission, mission, approval, or safety rules");
    });

    it("omits the persona section when no block is configured", () => {
      const joined = joinedStack(makeContext());
      expect(joined).not.toContain("# Persona (user style preferences)");
    });

    it("renders the one-time persona-setup hint only when supplied via options (turn layers)", () => {
      const withHint = buildPromptStack(makeContext(), {
        personaSetupHint: "# Personalize me (optional)\n\noffer text",
      });
      expect(withHint.turnLayers.join("\n")).toContain("# Personalize me (optional)");
      expect(withHint.staticLayers.join("\n")).not.toContain("# Personalize me (optional)");

      const without = joinedStack(makeContext());
      expect(without).not.toContain("# Personalize me (optional)");
    });
  });
});
