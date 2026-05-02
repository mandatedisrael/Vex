import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMcpOnboardingGuide, buildOnboardingReadOrderLines } from "../../../mcp/docs/onboarding.js";
import { buildToolGroups } from "../../../mcp/docs/registry-projection.js";

describe("mcp docs — onboarding helper", () => {
  const ENV_KEYS = [
    "TAVILY_API_KEY",
    "POLYMARKET_API_KEY",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
    delete process.env.TAVILY_API_KEY;
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("keeps the shared read order stable and does not rely on docs://routing", () => {
    expect(buildOnboardingReadOrderLines()).toEqual([
      "- `docs://overview` — server purpose, live surface size, and runtime shape",
      "- `docs://tools` — direct internal tools you can call by name",
      "- `docs://protocols` — which protocol namespace matches the user's intent",
      "- `docs://protocols/{namespace}` — the chosen namespace's tool manifest before discover_tools",
      "- `runtime://env` — which integrations are currently gated by missing env",
      "- `surface://manifest` — optional machine-readable snapshot when you need raw surface data",
    ]);
  });

  it("splits direct internal tools from the two discovery meta tools", () => {
    const guide = buildMcpOnboardingGuide();
    const groups = buildToolGroups();
    const metaToolCount = groups.find((group) => group.group === "Discovery")?.tools.length ?? 0;
    const internalToolCount = groups
      .filter((group) => group.group !== "Discovery")
      .reduce((total, group) => total + group.tools.length, 0);

    expect(guide.metaToolCount).toBe(2);
    expect(guide.metaToolCount).toBe(metaToolCount);
    expect(guide.internalToolCount).toBe(internalToolCount);
    expect(guide.directToolPatterns).toContain("knowledge_*");
    expect(guide.directToolPatterns).toContain("document_*");
  });

  it("changes internal tool counts when env-gated web tools appear", () => {
    const withoutTavily = buildMcpOnboardingGuide();

    process.env.TAVILY_API_KEY = "test-tavily-key";
    const withTavily = buildMcpOnboardingGuide();

    expect(withoutTavily.directToolPatterns).not.toContain("web_*");
    expect(withTavily.directToolPatterns).toContain("web_*");
    // After consolidation, TAVILY_API_KEY unlocks one tool (web_research),
    // not two (web_search + web_fetch).
    expect(withTavily.internalToolCount).toBe(withoutTavily.internalToolCount + 1);
  });
});
