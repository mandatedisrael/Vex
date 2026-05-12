/**
 * Wake state probe — coherent .env parse for the wizard skip-card
 * decision (M11 Step 8, codex v3 D13).
 *
 *   enabled=false  — coherent regardless of interval/batch (writer
 *                    deletes them, but a partial manual edit could
 *                    leave them; presence does not invalidate the
 *                    "off" intent).
 *   enabled=true   — additionally requires interval ∈ [60..60000] and
 *                    batch ∈ [1..100]; otherwise renderer pre-fills
 *                    rather than skipping.
 */

import {
  WAKE_RANGES,
  type WakeState,
} from "@shared/schemas/wake.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { readEnvValue } from "./env-state.js";

function parseEnabled(raw: string | null): boolean | null {
  if (raw === null) return null;
  const norm = raw.trim().toLowerCase();
  if (norm === "true") return true;
  if (norm === "false") return false;
  return null;
}

function parseRangedInt(
  raw: string | null,
  min: number,
  max: number,
): number | null {
  if (raw === null) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export interface ProbeWakeOptions {
  readonly envFile?: string;
}

export async function probeWake(
  options: ProbeWakeOptions = {},
): Promise<WakeState> {
  const envFile = options.envFile ?? ENV_FILE;
  const [rawEnabled, rawInterval, rawBatch] = await Promise.all([
    readEnvValue(envFile, "AGENT_WAKE_ENABLED"),
    readEnvValue(envFile, "AGENT_WAKE_INTERVAL_MS"),
    readEnvValue(envFile, "AGENT_WAKE_BATCH_SIZE"),
  ]);

  const enabledOrNull = parseEnabled(rawEnabled);
  const intervalMs = parseRangedInt(
    rawInterval,
    WAKE_RANGES.intervalMin,
    WAKE_RANGES.intervalMax,
  );
  const batchSize = parseRangedInt(
    rawBatch,
    WAKE_RANGES.batchMin,
    WAKE_RANGES.batchMax,
  );

  const enabled = enabledOrNull ?? false;
  let coherent = false;
  if (enabledOrNull === false) {
    coherent = true;
  } else if (enabledOrNull === true) {
    coherent = intervalMs !== null && batchSize !== null;
  }

  return {
    enabled,
    intervalMs,
    batchSize,
    coherent,
  };
}
