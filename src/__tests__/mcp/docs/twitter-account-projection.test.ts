import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuntimeEnv, buildToolGroups } from "../../../mcp/docs/registry-projection.js";

describe("mcp docs — twitter account projection", () => {
  const ENV_KEYS = ["RETTIWT_API_KEY"] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("groups twitter_account into Social when configured", () => {
    process.env.RETTIWT_API_KEY = "test-rettiwt-key";

    const groups = buildToolGroups();
    const social = groups.find((group) => group.group === "Social");

    expect(social).toBeDefined();
    expect(social!.tools.map((tool) => tool.name)).toContain("twitter_account");
  });

  it("reports RETTIWT_API_KEY presence without returning the value", () => {
    process.env.RETTIWT_API_KEY = "secret-do-not-leak";

    const env = buildRuntimeEnv();

    expect(env.envFlags.RETTIWT_API_KEY).toBe("present");
    expect(JSON.stringify(env)).not.toContain("secret-do-not-leak");
  });

  it("reports RETTIWT_API_KEY as missing when unset", () => {
    delete process.env.RETTIWT_API_KEY;

    const env = buildRuntimeEnv();

    expect(env.envFlags.RETTIWT_API_KEY).toBe("missing");
  });
});
