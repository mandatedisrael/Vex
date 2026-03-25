import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config/paths.js", () => ({ CONFIG_DIR: "/tmp/test-config" }));

const {
  getAgentImage,
  getAgentImageRepository,
  getAgentImageTag,
  getAgentComposeEnv,
  getAgentComposeArgs,
  getAgentComposeFailureInfo,
  AgentComposeError,
  getAgentUrl,
} = await import("../../agent/compose.js");

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...savedEnv };
  delete process.env.ECHO_AGENT_IMAGE;
  delete process.env.ECHO_AGENT_IMAGE_REPOSITORY;
  delete process.env.ECHO_AGENT_IMAGE_TAG;
  delete process.env.ECHO_CONFIG_DIR;
});

afterEach(() => { process.env = savedEnv; });

describe("getAgentImage", () => {
  it("uses ECHO_AGENT_IMAGE env when set", () => {
    process.env.ECHO_AGENT_IMAGE = "custom/image:v1";
    expect(getAgentImage()).toBe("custom/image:v1");
  });

  it("constructs from repository + tag when no override", () => {
    const image = getAgentImage();
    expect(image).toContain("ghcr.io");
    expect(image).toContain(":");
  });
});

describe("getAgentImageRepository", () => {
  it("returns default when no env", () => {
    expect(getAgentImageRepository()).toContain("ghcr.io");
  });

  it("respects ECHO_AGENT_IMAGE_REPOSITORY", () => {
    process.env.ECHO_AGENT_IMAGE_REPOSITORY = "my-registry/my-image";
    expect(getAgentImageRepository()).toBe("my-registry/my-image");
  });
});

describe("getAgentComposeEnv", () => {
  it("includes ECHO_AGENT_IMAGE and ECHO_CONFIG_DIR", () => {
    const env = getAgentComposeEnv();
    expect(env.ECHO_AGENT_IMAGE).toBeTruthy();
    expect(env.ECHO_CONFIG_DIR).toBeTruthy();
  });

  it("applies overrides", () => {
    const env = getAgentComposeEnv({ CUSTOM_VAR: "test" });
    expect(env.CUSTOM_VAR).toBe("test");
  });
});

describe("getAgentComposeArgs", () => {
  it("includes compose file and project name", () => {
    const args = getAgentComposeArgs(["up", "-d"]);
    expect(args).toContain("compose");
    expect(args).toContain("-p");
    expect(args).toContain("echo-agent");
    expect(args).toContain("up");
    expect(args).toContain("-d");
  });

  it("includes build override file when requested", () => {
    const args = getAgentComposeArgs(["build"], { includeBuildOverride: true });
    // Should have two -f flags
    const fCount = args.filter(a => a === "-f").length;
    expect(fCount).toBe(2);
  });
});

describe("getAgentComposeFailureInfo", () => {
  it("returns non-release error for generic failure", () => {
    const info = getAgentComposeFailureInfo(new Error("Docker not found"));
    expect(info.isReleaseIssue).toBe(false);
    expect(info.message).toContain("Docker not found");
  });

  it("returns release issue for access denied", () => {
    const err = new AgentComposeError("fail", "error from registry: denied");
    const info = getAgentComposeFailureInfo(err);
    // Only detects release issue if image matches default
    expect(info.detail).toContain("denied");
  });

  it("uses default hint when provided", () => {
    const info = getAgentComposeFailureInfo(new Error("fail"), { defaultHint: "Try again" });
    expect(info.hint).toBe("Try again");
  });
});

describe("getAgentUrl", () => {
  it("returns localhost URL with default port", () => {
    expect(getAgentUrl()).toBe("http://127.0.0.1:4201");
  });

  it("uses custom port", () => {
    expect(getAgentUrl(8080)).toBe("http://127.0.0.1:8080");
  });
});
