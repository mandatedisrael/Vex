/**
 * Models IPC handler — read-only "configured global default".
 *
 * Reads `AGENT_PROVIDER` + `AGENT_MODEL` from `process.env` (populated
 * after vault unlock per the onboarding flow) and returns a single-option
 * list for the one global model every session uses. No network call, no
 * OpenRouter `/models` catalogue, no pricing/context claims; a future
 * catalogue fetch could enrich pricing + context length + brand.
 *
 * When the env vars are missing the handler returns
 * `{source: "unconfigured", models: [], fetchedAt: null}` — empty list,
 * never an error toast.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  modelsListAvailableInputSchema,
  modelsListAvailableResultSchema,
  type ModelOptionDto,
  type ModelsListAvailableResult,
} from "@shared/schemas/models.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

const MODEL_ID_MAX = 200;
const PROVIDER_ID_MAX = 64;

function readEnvDefault(): {
  readonly provider: string | null;
  readonly model: string | null;
} {
  const rawProvider = process.env["AGENT_PROVIDER"];
  const rawModel = process.env["AGENT_MODEL"];
  const provider =
    typeof rawProvider === "string" && rawProvider.trim().length > 0
      ? rawProvider.trim()
      : null;
  const model =
    typeof rawModel === "string" && rawModel.trim().length > 0
      ? rawModel.trim()
      : null;
  if (provider !== null && provider.length > PROVIDER_ID_MAX) return { provider: null, model };
  if (model !== null && model.length > MODEL_ID_MAX) return { provider, model: null };
  return { provider, model };
}

function buildResult(): ModelsListAvailableResult {
  const { provider, model } = readEnvDefault();
  if (provider === null || model === null) {
    return { source: "unconfigured", models: [], fetchedAt: null };
  }
  const option: ModelOptionDto = {
    providerId: provider,
    modelId: model,
    displayName: model,
    brand: provider,
    contextLength: null,
    pricingInputPerMillion: null,
    pricingOutputPerMillion: null,
  };
  return {
    source: "global_default",
    models: [option],
    fetchedAt: null,
  };
}

export function registerModelsHandlers(): ReadonlyArray<() => void> {
  return [
    registerHandler({
      channel: CH.models.listAvailable,
      domain: "models",
      inputSchema: modelsListAvailableInputSchema,
      outputSchema: modelsListAvailableResultSchema,
      handle: async (
        _input,
        ctx,
      ): Promise<Result<ModelsListAvailableResult>> => {
        const result = buildResult();
        log.info(
          `[ipc:vex:models:listAvailable] ok source=${result.source} ` +
            `count=${result.models.length} correlationId=${ctx.requestId}`,
        );
        return ok(result);
      },
    }),
  ];
}
