import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { EngineContext, LoopMode, SessionKind } from "../../../../echo-agent/engine/types.js";
import {
  buildPromptStack,
  buildProtocolsPrompt,
  resetProtocolsPromptCache,
  buildModePrompt,
  buildToolUsagePrompt,
} from "../../../../echo-agent/engine/prompts/index.js";
import { PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST, PROTOCOL_TOOLS } from "../../../../echo-agent/tools/protocols/catalog.js";

function makeContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    sessionId: "session-1",
    sessionKind: "chat",
    loopMode: "off",
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map(),
    memoryScopeKey: "session-1",
    ...overrides,
  };
}

describe("prompt-stack", () => {
  beforeEach(() => {
    resetProtocolsPromptCache();
  });

  // ── Constant block present in every mode ────────────────────

  describe("constant layer always present", () => {
    const modes: LoopMode[] = ["off", "restricted", "full"];
    const kinds: SessionKind[] = ["chat", "mission"];

    for (const mode of modes) {
      for (const kind of kinds) {
        it(`includes base + tool-usage + protocols in ${kind}/${mode}`, () => {
          const stack = buildPromptStack(makeContext({ loopMode: mode, sessionKind: kind }));
          const joined = stack.join("\n");

          // Base prompt markers
          expect(joined).toContain("# Identity");
          expect(joined).toContain("Echo");

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

      // Group actual tools by namespace to find which ones have tools
      const namespacesWithTools = new Set(PROTOCOL_TOOLS.map(t => t.namespace));

      for (const ns of namespacesWithTools) {
        expect(prompt).toContain(`## ${ns}`);
      }
    });

    it("renders explicit product groups instead of heuristic families", () => {
      const prompt = buildProtocolsPrompt();
      expect(prompt).toContain("### 0G Ecosystem");
      expect(prompt).toContain("### Cross-chain");
      expect(prompt).not.toContain("Families:");
    });

    it("marks namespaces with mutating tools", () => {
      const prompt = buildProtocolsPrompt();

      // Check that namespaces with mutating tools are marked
      const namespacesWithMutating = new Set(
        PROTOCOL_TOOLS.filter(t => t.mutating).map(t => t.namespace),
      );

      for (const ns of namespacesWithMutating) {
        // The namespace section should mention mutating
        const nsSection = prompt.split(`## ${ns}`)[1]?.split("##")[0] ?? "";
        expect(nsSection).toContain("mutating");
      }
    });

    it("is not hardcoded — count changes with catalog", () => {
      const prompt = buildProtocolsPrompt();
      // The total count in the prompt should match the actual catalog
      expect(prompt).toContain(String(PROTOCOL_TOOLS.length));
    });
  });

  // ── Mission setup has same protocol knowledge ───────────────

  describe("mission setup vs full mode protocol knowledge", () => {
    it("has identical protocol block", () => {
      const setupStack = buildPromptStack(makeContext({
        sessionKind: "mission", loopMode: "restricted",
      }));
      const fullStack = buildPromptStack(makeContext({
        sessionKind: "mission", loopMode: "full", missionRunId: "run-1",
      }));

      // Both should have the same protocols prompt
      const setupProtocols = setupStack.find(s => s.includes("# Available Protocol Namespaces"));
      const fullProtocols = fullStack.find(s => s.includes("# Available Protocol Namespaces"));
      expect(setupProtocols).toBe(fullProtocols);

      // Both should have the same tool-usage prompt
      const setupToolUsage = setupStack.find(s => s.includes("# Tool System"));
      const fullToolUsage = fullStack.find(s => s.includes("# Tool System"));
      expect(setupToolUsage).toBe(fullToolUsage);
    });

    it("differs only in policy and context", () => {
      const setupStack = buildPromptStack(makeContext({
        sessionKind: "mission", loopMode: "restricted",
      }));
      const fullStack = buildPromptStack(makeContext({
        sessionKind: "mission", loopMode: "full", missionRunId: "run-1",
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

  // ── Mode prompts ────────────────────────────────────────────

  describe("mode prompts", () => {
    it("off mode restricts proactive actions", () => {
      const prompt = buildModePrompt("off");
      expect(prompt).toContain("passive");
      expect(prompt).toContain("do not take proactive actions");
    });

    it("restricted mode requires approval for mutations", () => {
      const prompt = buildModePrompt("restricted");
      expect(prompt).toContain("approval");
      expect(prompt).toContain("Mutating tools");
    });

    it("full mode allows everything", () => {
      const prompt = buildModePrompt("full");
      expect(prompt).toContain("full authority");
      expect(prompt).toContain("No approval gates");
    });
  });

  // ── Contextual layers ───────────────────────────────────────

  describe("contextual layers", () => {
    it("chat mode includes chat prompt", () => {
      const stack = buildPromptStack(makeContext({ sessionKind: "chat" }));
      const joined = stack.join("\n");
      expect(joined).toContain("# Chat Mode");
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
            parentLoopMode: "restricted",
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
            parentLoopMode: "restricted",
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
            parentLoopMode: "restricted",
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
            parentLoopMode: "restricted",
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

    it("includes loaded documents", () => {
      const stack = buildPromptStack(makeContext({
        loadedDocuments: new Map([["strategy.md", "# Strategy\nBuy low sell high"]]),
      }));
      const joined = stack.join("\n");
      expect(joined).toContain("strategy.md");
      expect(joined).toContain("Buy low sell high");
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

    it("contains quote before execute rule", () => {
      const stack = buildPromptStack(makeContext());
      const joined = stack.join("\n");
      expect(joined).toContain("Quote before execute");
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

    it("chainscan is described as 0G-only in protocols", () => {
      const prompt = buildProtocolsPrompt();
      const chainscanSection = prompt.split("## chainscan")[1]?.split("##")[0] ?? "";
      expect(chainscanSection).toContain("0G-only");
    });

    it("polymarket section exposes subarea guidance", () => {
      const prompt = buildProtocolsPrompt();
      const polymarketSection = prompt.split("## polymarket")[1]?.split("##")[0] ?? "";
      expect(polymarketSection).toContain("Paths:");
      expect(polymarketSection).toContain("Gamma discovery");
      expect(polymarketSection).toContain("CLOB trading");
    });

    it("echobook section renders 'Feeds, posts, and comments' path label", () => {
      const prompt = buildProtocolsPrompt();
      const echobookSection = prompt.split("## echobook")[1]?.split("##")[0] ?? "";
      expect(echobookSection).toContain("Feeds, posts, and comments");
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
