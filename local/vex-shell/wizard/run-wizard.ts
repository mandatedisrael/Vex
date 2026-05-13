/**
 * Wizard orchestrator — linear @clack flow executed before Ink mounts.
 *
 * Pipeline (every step cancellable with Ctrl+C → returns `aborted: true`):
 *   1. system-check   — collectSystemChecks + startLocalServices + bootstrap
 *   2. keystore       — VEX_KEYSTORE_PASSWORD (create if missing)
 *   3. wallets        — create/import EVM + Solana keystores if missing
 *   4. api-keys       — JUPITER (req), TAVILY, POLYMARKET trio
 *   5. embedding      — optional EMBEDDING_{BASE_URL,MODEL,DIM,PROVIDER}
 *   6. agent-core     — optional AGENT_* + SUBAGENT_*
 *   7. provider       — OpenRouter (key + model picker)
 *   8. mode           — agent | mission + permission (restricted | full)
 *
 * Post-M12: wake step removed (always-on hardcoded); full_autonomous gone.
 */

import { cancel, intro, outro } from "@clack/prompts";
import type { BootstrapResult } from "../platform/bootstrap.js";
import type { ProviderSummary } from "../platform/render.js";
import { runSystemCheckStep } from "./system-check-step.js";
import { runKeystoreStep } from "./keystore-step.js";
import { runWalletsStep } from "./wallets-step.js";
import { runApiKeysStep } from "./api-keys-step.js";
import { runEmbeddingStep } from "./embedding-step.js";
import { runAgentCoreStep } from "./agent-core-step.js";
import { runProviderStep } from "./provider-step.js";
import { runModeStep, type WizardMode, type WizardPermission } from "./mode-step.js";

export interface WizardResult {
  aborted: boolean;
  bootstrap: BootstrapResult | null;
  provider: ProviderSummary;
  mode: WizardMode;
  permission?: WizardPermission;
  initialPrompt?: string;
}

const DEFAULT_ABORT: WizardResult = {
  aborted: true,
  bootstrap: null,
  provider: { name: "none", detail: "wizard cancelled" },
  mode: "agent",
};

export async function runWizard(): Promise<WizardResult> {
  intro("VEX Shell — setup");

  const systemCheck = await runSystemCheckStep();
  if (systemCheck.aborted) {
    cancel("Wizard cancelled during system check.");
    return DEFAULT_ABORT;
  }

  const keystore = await runKeystoreStep();
  if (keystore.aborted) {
    cancel("Wizard cancelled during keystore setup.");
    return { ...DEFAULT_ABORT, bootstrap: systemCheck.bootstrap };
  }

  const wallets = await runWalletsStep();
  if (wallets.aborted) {
    cancel("Wizard cancelled during wallet setup.");
    return { ...DEFAULT_ABORT, bootstrap: systemCheck.bootstrap };
  }

  const apiKeys = await runApiKeysStep();
  if (apiKeys.aborted) {
    cancel("Wizard cancelled during API keys.");
    return { ...DEFAULT_ABORT, bootstrap: systemCheck.bootstrap };
  }

  const embedding = await runEmbeddingStep();
  if (embedding.aborted) {
    cancel("Wizard cancelled during embedding setup.");
    return { ...DEFAULT_ABORT, bootstrap: systemCheck.bootstrap };
  }

  const agentCore = await runAgentCoreStep();
  if (agentCore.aborted) {
    cancel("Wizard cancelled during agent tuning.");
    return { ...DEFAULT_ABORT, bootstrap: systemCheck.bootstrap };
  }

  const provider = await runProviderStep();
  if (provider.aborted) {
    cancel("Wizard cancelled during provider setup.");
    return { ...DEFAULT_ABORT, bootstrap: systemCheck.bootstrap };
  }

  const mode = await runModeStep();
  if (mode.aborted) {
    cancel("Wizard cancelled during mode selection.");
    return {
      ...DEFAULT_ABORT,
      bootstrap: systemCheck.bootstrap,
      provider: provider.summary,
    };
  }

  outro("Setup complete — launching shell.");
  return {
    aborted: false,
    bootstrap: systemCheck.bootstrap,
    provider: provider.summary,
    mode: mode.mode,
    permission: mode.permission,
    initialPrompt: mode.initialPrompt,
  };
}
