import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestContext } from "../_test-context.js";

const mockExecuteTwitterAccountRequest = vi.hoisted(() => vi.fn());

vi.mock("@tools/twitter-account/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tools/twitter-account/client.js")>();
  return {
    ...actual,
    executeTwitterAccountRequest: mockExecuteTwitterAccountRequest,
  };
});

const { handleTwitterAccount } = await import(
  "../../../../vex-agent/tools/internal/twitter-account.js"
);

const baseContext = makeTestContext();

describe("twitter_account", () => {
  const originalApiKey = process.env.RETTIWT_API_KEY;

  beforeEach(() => {
    mockExecuteTwitterAccountRequest.mockReset();
    if (originalApiKey === undefined) delete process.env.RETTIWT_API_KEY;
    else process.env.RETTIWT_API_KEY = originalApiKey;
  });

  it("rejects missing action", async () => {
    const result = await handleTwitterAccount({}, baseContext);

    expect(result.success).toBe(false);
    expect(result.output).toContain("twitter_account:");
    expect(mockExecuteTwitterAccountRequest).not.toHaveBeenCalled();
  });

  it("calls the Rettiwt client for a valid account_status request", async () => {
    mockExecuteTwitterAccountRequest.mockResolvedValueOnce({
      action: "account_status",
      data: { account: { id: "123", userName: "research" } },
    });

    const result = await handleTwitterAccount({ action: "account_status" }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("\"account_status\"");
    expect(mockExecuteTwitterAccountRequest).toHaveBeenCalledWith({ action: "account_status" });
  });

  it("normalizes leading @ in usernames before execution", async () => {
    mockExecuteTwitterAccountRequest.mockResolvedValueOnce({
      action: "user_details",
      data: { user: { userName: "openai" } },
    });

    const result = await handleTwitterAccount(
      { action: "user_details", username: "@openai" },
      baseContext,
    );

    expect(result.success).toBe(true);
    expect(mockExecuteTwitterAccountRequest).toHaveBeenCalledWith({
      action: "user_details",
      username: "openai",
    });
  });

  it("rejects tweet_search without a filter field", async () => {
    const result = await handleTwitterAccount(
      { action: "tweet_search", filter: {} },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("at least one tweet search filter field");
    expect(mockExecuteTwitterAccountRequest).not.toHaveBeenCalled();
  });

  it("redacts cookie names, bearer tokens, and the configured API key from errors", async () => {
    process.env.RETTIWT_API_KEY = "secret-do-not-leak";
    mockExecuteTwitterAccountRequest.mockRejectedValueOnce(
      new Error("failed secret-do-not-leak auth_token=abc; ct0=def Bearer token.value"),
    );

    const result = await handleTwitterAccount({ action: "account_status" }, baseContext);

    expect(result.success).toBe(false);
    expect(result.output).toContain("twitter_account:");
    expect(result.output).not.toContain("secret-do-not-leak");
    expect(result.output).not.toContain("auth_token=abc");
    expect(result.output).not.toContain("Bearer token.value");
    expect(result.output).toContain("auth_token=[redacted]");
    expect(result.output).toContain("Bearer [redacted]");
  });
});
