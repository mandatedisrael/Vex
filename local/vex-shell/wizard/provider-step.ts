/**
 * Provider step — Ink-side OpenRouter configuration.
 *
 * The operator picks the model id from https://openrouter.ai/models — we
 * do not fetch the catalog (avoids the 400-entry list and a network
 * round-trip that fails offline).
 */

import { isCancel, log, password, select, text } from "@clack/prompts";
import { readAppEnvMap } from "../../../src/cli/setup/status.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";
import { switchProvider } from "../../../src/vex-agent/inference/registry.js";
import type { ProviderSummary } from "../platform/render.js";
import { detectInitialProvider } from "../platform/provider.js";

export interface ProviderOutcome {
  aborted: boolean;
  summary: ProviderSummary;
}

async function activateOpenRouter(): Promise<ProviderOutcome> {
  const envMap = readAppEnvMap();
  let apiKey = envMap.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    const input = await password({
      message: "OPENROUTER_API_KEY (create one at https://openrouter.ai/keys)",
      validate: (v) => (v?.trim() ? undefined : "API key is required"),
    });
    if (isCancel(input)) return { aborted: true, summary: currentSummary() };
    apiKey = String(input).trim();
    writeAppEnvValue("OPENROUTER_API_KEY", apiKey);
    process.env.OPENROUTER_API_KEY = apiKey;
  }

  const picked = await text({
    message: "OpenRouter model id (find IDs at https://openrouter.ai/models)",
    placeholder: envMap.AGENT_MODEL ?? "e.g. anthropic/claude-sonnet-4.5",
    initialValue: envMap.AGENT_MODEL,
    validate: (v) => (v?.trim() ? undefined : "Model id is required"),
  });
  if (isCancel(picked)) return { aborted: true, summary: currentSummary() };
  const modelId = String(picked).trim();
  writeAppEnvValue("AGENT_MODEL", modelId);
  process.env.AGENT_MODEL = modelId;

  synchronizeTrackedEnv();
  const provider = await switchProvider("openrouter");
  if (!provider) {
    log.error("switchProvider('openrouter') returned null — check key and model.");
    return { aborted: false, summary: { name: "none", detail: "OpenRouter activation failed." } };
  }
  log.success(`OpenRouter active. model=${modelId}`);
  return { aborted: false, summary: { name: "openrouter", detail: `model=${modelId}` } };
}

function currentSummary(): ProviderSummary {
  if (process.env.OPENROUTER_API_KEY?.trim() && process.env.AGENT_MODEL?.trim()) {
    return { name: "openrouter", detail: `model=${process.env.AGENT_MODEL}` };
  }
  return { name: "none", detail: "Not configured." };
}

export async function runProviderStep(): Promise<ProviderOutcome> {
  log.step("Provider");
  const existing = await detectInitialProvider();
  log.info(`Current: ${existing.name}${existing.detail ? ` (${existing.detail})` : ""}`);

  const choice = await select<"openrouter" | "keep">({
    message: "Inference provider",
    options: [
      { value: "openrouter", label: "OpenRouter (hosted inference, manual model id)" },
      { value: "keep", label: "Keep current" },
    ],
    initialValue: "openrouter",
  });
  if (isCancel(choice)) return { aborted: true, summary: existing };
  if (choice === "keep") return { aborted: false, summary: existing };
  return activateOpenRouter();
}
