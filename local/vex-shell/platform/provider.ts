/**
 * Provider selection flow — wires the shell to `inference/registry::switchProvider`
 * for explicit, in-process OpenRouter activation.
 */

import {
  promptMenu,
  promptText,
  renderSection,
} from "../../../src/cli/setup/ui.js";
import {
  getActiveProvider,
  switchProvider,
} from "../../../src/vex-agent/inference/registry.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";
import type { ProviderSummary } from "./render.js";
import { writeLine } from "./render.js";
import { providerLog, withTiming } from "./log.js";

export async function detectInitialProvider(): Promise<ProviderSummary> {
  if (process.env.OPENROUTER_API_KEY?.trim() && process.env.AGENT_MODEL?.trim()) {
    process.env.AGENT_PROVIDER = "openrouter";
    return summarize("openrouter", `model=${process.env.AGENT_MODEL}`);
  }
  return { name: "none", detail: "Not configured. Run /provider to configure OpenRouter." };
}

export async function chooseProvider(): Promise<ProviderSummary> {
  renderSection("Select provider");

  const target = await promptMenu("Which inference provider should this shell drive?", [
    {
      id: "openrouter",
      label: "OpenRouter",
      description: "Hosted inference. Shell will prompt for API key and model if missing.",
    },
    {
      id: "cancel",
      label: "Cancel",
      description: "Keep the current provider.",
    },
  ]);

  if (target === "cancel") return summarizeCurrent();
  return await activateOpenRouter();
}

async function activateOpenRouter(): Promise<ProviderSummary> {
  return withTiming(providerLog, "provider.openrouter.activate", async () => {
    await ensureOpenRouterCredentials();

    const provider = await switchProvider("openrouter");
    if (!provider) {
      writeLine("OpenRouter provider failed to initialise. See logs above.");
      return summarizeCurrent();
    }
    const model = process.env.AGENT_MODEL ?? "?";
    writeLine(`OpenRouter active. model=${model}`);
    return summarize("openrouter", `model=${model}`);
  });
}

async function ensureOpenRouterCredentials(): Promise<void> {
  let apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    writeLine("OPENROUTER_API_KEY is missing. Get one at https://openrouter.ai/keys.");
    apiKey = (await promptText("Paste OpenRouter API key:", false)).trim();
    if (!apiKey) {
      throw new Error("OpenRouter API key is required");
    }
    writeAppEnvValue("OPENROUTER_API_KEY", apiKey);
    process.env.OPENROUTER_API_KEY = apiKey;
    providerLog.info("provider.openrouter.api_key_persisted");
  }

  let model = process.env.AGENT_MODEL?.trim();
  if (!model) {
    writeLine("AGENT_MODEL is missing. Examples: anthropic/claude-sonnet-4-6, openai/gpt-4o.");
    model = (await promptText("Model id:", false)).trim();
    if (!model) {
      throw new Error("AGENT_MODEL is required");
    }
    writeAppEnvValue("AGENT_MODEL", model);
    process.env.AGENT_MODEL = model;
    providerLog.info("provider.openrouter.model_persisted", { model });
  }

  synchronizeTrackedEnv();
}

function summarizeCurrent(): ProviderSummary {
  const active = getActiveProvider();
  if (!active) return { name: "none", detail: "No provider resolved." };
  return summarize("openrouter", `model=${process.env.AGENT_MODEL ?? "?"}`);
}

function summarize(name: ProviderSummary["name"], detail: string): ProviderSummary {
  return { name, detail };
}
