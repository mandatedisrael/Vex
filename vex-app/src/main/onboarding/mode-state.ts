/**
 * Mode state probe — coherent .env parse for the wizard skip-card
 * decision (M11 Step 7, codex v3 D13).
 *
 * Skip-card semantics: the renderer treats a step as "configured"
 * (skippable on revisit) only when the persisted .env values together
 * satisfy the same shape the IPC contract requires:
 *
 *   chat            — AGENT_MODE === "chat", no other prerequisites
 *   mission         — AGENT_MODE === "mission" AND AGENT_LOOP_MODE valid
 *                     enum AND AGENT_INITIAL_PROMPT length ≥ 5
 *   full_autonomous — AGENT_MODE === "full_autonomous", initial prompt
 *                     OPTIONAL
 *
 * Anything else returns `coherent: false` so the renderer pre-fills
 * the form from whatever partial state survived rather than skipping
 * (avoids the "manual edit produced AGENT_MODE=mission with no goal"
 * pitfall codex called out).
 */

import {
  loopModeSchema,
  wizardModeValueSchema,
  type LoopMode,
  type ModeState,
  type WizardModeValue,
} from "@shared/schemas/mode.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { readEnvValue } from "./env-state.js";

const MISSION_PROMPT_MIN = 5;

function parseMode(raw: string | null): WizardModeValue | null {
  if (raw === null) return null;
  const parsed = wizardModeValueSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseLoopMode(raw: string | null): LoopMode | null {
  if (raw === null) return null;
  const parsed = loopModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface ProbeModeOptions {
  readonly envFile?: string;
}

export async function probeMode(
  options: ProbeModeOptions = {},
): Promise<ModeState> {
  const envFile = options.envFile ?? ENV_FILE;
  const [rawMode, rawLoop, rawPrompt] = await Promise.all([
    readEnvValue(envFile, "AGENT_MODE"),
    readEnvValue(envFile, "AGENT_LOOP_MODE"),
    readEnvValue(envFile, "AGENT_INITIAL_PROMPT"),
  ]);

  const selected = parseMode(rawMode);
  const loopMode = parseLoopMode(rawLoop);
  const trimmedPrompt = rawPrompt !== null ? rawPrompt.trim() : "";
  const hasInitialPrompt = trimmedPrompt.length > 0;

  let coherent = false;
  if (selected === "chat") {
    coherent = true;
  } else if (selected === "mission") {
    coherent =
      loopMode !== null && trimmedPrompt.length >= MISSION_PROMPT_MIN;
  } else if (selected === "full_autonomous") {
    coherent = true;
  }

  return {
    selected,
    loopMode,
    hasInitialPrompt,
    coherent,
  };
}
