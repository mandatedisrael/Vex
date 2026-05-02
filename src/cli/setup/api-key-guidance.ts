import type { EnvFieldStatus } from "./status.js";

export const JUPITER_API_KEY_GUIDANCE = [
  "Jupiter is required to enable Solana swaps, lending, and prediction tools in Vex MCP.",
  "How to get it:",
  "1. Log in or create an account.",
  "2. Open https://developers.jup.ag/portal/api-keys",
  "3. Create a new API key.",
  "4. Copy it and paste it below.",
  "Jupiter offers a free tier with rate limits.",
].join("\n");

export const TAVILY_API_KEY_GUIDANCE = [
  "Tavily enables web_research (search + page fetch in one tool).",
  "How to get it:",
  "1. Log in or create an account at https://app.tavily.com/home",
  "2. Open API Keys.",
  "3. Copy the key and add TAVILY_API_KEY to CONFIG_DIR/.env when you want web access.",
  "Tavily includes 1,000 free credits per month.",
].join("\n");

export interface ApiKeyGuidance {
  title: string;
  body: string;
}

export function collectOptionalApiKeyGuidance(
  fields: readonly EnvFieldStatus[],
): ApiKeyGuidance[] {
  const tavilyStatus = fields.find((field) => field.key === "TAVILY_API_KEY");
  if (tavilyStatus?.status !== "missing") {
    return [];
  }

  return [
    {
      title: "Optional: Tavily API Key",
      body: TAVILY_API_KEY_GUIDANCE,
    },
  ];
}
