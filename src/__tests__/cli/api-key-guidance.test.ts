import { describe, expect, it } from "vitest";
import {
  collectOptionalApiKeyGuidance,
  JUPITER_API_KEY_GUIDANCE,
  RETTIWT_API_KEY_GUIDANCE,
  TAVILY_API_KEY_GUIDANCE,
} from "../../cli/setup/api-key-guidance.js";

describe("setup API key guidance", () => {
  it("includes Jupiter portal instructions for the required key", () => {
    expect(JUPITER_API_KEY_GUIDANCE).toContain("https://developers.jup.ag/portal/api-keys");
    expect(JUPITER_API_KEY_GUIDANCE).toContain("Create a new API key.");
    expect(JUPITER_API_KEY_GUIDANCE).toContain("paste it below");
  });

  it("includes Tavily acquisition steps for the optional web key", () => {
    expect(TAVILY_API_KEY_GUIDANCE).toContain("https://app.tavily.com/home");
    expect(TAVILY_API_KEY_GUIDANCE).toContain("Open API Keys.");
    expect(TAVILY_API_KEY_GUIDANCE).toContain("1,000 free credits");
  });

  it("includes Rettiwt guidance for the optional Twitter/X key", () => {
    expect(RETTIWT_API_KEY_GUIDANCE).toContain("twitter_account");
    expect(RETTIWT_API_KEY_GUIDANCE).toContain("base64 encoding of account cookies");
    expect(RETTIWT_API_KEY_GUIDANCE).toContain("secondary Twitter/X account");
  });

  it("shows optional Tavily guidance only when the key is missing", () => {
    expect(
      collectOptionalApiKeyGuidance([
        {
          key: "TAVILY_API_KEY",
          required: false,
          description: "Optional web access key.",
          status: "missing",
        },
      ]),
    ).toEqual([
      {
        title: "Optional: Tavily API Key",
        body: TAVILY_API_KEY_GUIDANCE,
      },
    ]);

    expect(
      collectOptionalApiKeyGuidance([
        {
          key: "TAVILY_API_KEY",
          required: false,
          description: "Optional web access key.",
          status: "configured",
        },
      ]),
    ).toEqual([]);
  });

  it("shows optional Rettiwt guidance only when the key is missing", () => {
    expect(
      collectOptionalApiKeyGuidance([
        {
          key: "RETTIWT_API_KEY",
          required: false,
          description: "Optional Twitter/X research key.",
          status: "missing",
        },
      ]),
    ).toEqual([
      {
        title: "Optional: Rettiwt Twitter/X Key",
        body: RETTIWT_API_KEY_GUIDANCE,
      },
    ]);

    expect(
      collectOptionalApiKeyGuidance([
        {
          key: "RETTIWT_API_KEY",
          required: false,
          description: "Optional Twitter/X research key.",
          status: "configured",
        },
      ]),
    ).toEqual([]);
  });
});
