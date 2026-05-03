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

export const RETTIWT_API_KEY_GUIDANCE = [
  "Rettiwt enables read-only Twitter/X account research through twitter_account.",
  "Use a secondary Twitter/X account. The key is a base64 encoding of account cookies, so treat it like a full session secret.",
  "How to get it:",
  "1. Follow the Rettiwt-API authentication instructions for the browser helper extension.",
  "2. Copy the generated API_KEY.",
  "3. Add RETTIWT_API_KEY to CONFIG_DIR/.env when you want Twitter/X account research.",
  "Do not use a primary personal account.",
].join("\n");

export interface ApiKeyGuidance {
  title: string;
  body: string;
}

export function collectOptionalApiKeyGuidance(
  fields: readonly EnvFieldStatus[],
): ApiKeyGuidance[] {
  const guidance: ApiKeyGuidance[] = [];
  const tavilyStatus = fields.find((field) => field.key === "TAVILY_API_KEY");
  if (tavilyStatus?.status === "missing") {
    guidance.push({
      title: "Optional: Tavily API Key",
      body: TAVILY_API_KEY_GUIDANCE,
    });
  }

  const rettiwtStatus = fields.find((field) => field.key === "RETTIWT_API_KEY");
  if (rettiwtStatus?.status === "missing") {
    guidance.push({
      title: "Optional: Rettiwt Twitter/X Key",
      body: RETTIWT_API_KEY_GUIDANCE,
    });
  }

  return guidance;
}
