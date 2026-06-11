/**
 * `vex.sessions.getModel` — resolve the global runtime model for a
 * session.
 *
 * Vex uses one global model for every session. `AGENT_PROVIDER` +
 * `AGENT_MODEL` from `process.env` (loaded after vault unlock by the
 * onboarding flow) are the only sources; when either is absent we
 * return `source: "unconfigured"`. There is no per-session model write
 * — the chat header reads this to display the active model.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  sessionGetModelInputSchema,
  sessionModelDtoSchema,
  type SessionModelDto,
} from "@shared/schemas/sessions.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

const MODEL_ID_MAX = 200;
const PROVIDER_ID_MAX = 64;

/**
 * Upper bound for the engine capability probe (S6). `loadConfig()` is
 * TTL-cached inside the provider, so the warm path resolves immediately;
 * only a cold `/models` catalog fetch can be slow (SDK retries up to 60s),
 * and this handler must stay snappy for the runtime bar + composer. On
 * timeout we report "unknown" (`null`) and the renderer's 30s stale-time
 * refetch picks up the warmed cache.
 */
const REASONING_PROBE_TIMEOUT_MS = 3_000;

/**
 * Resolve whether the active model supports reasoning, from the same
 * engine inference config the chat turn uses (`reasoningPricePerM` comes
 * from the OpenRouter catalog's internal-reasoning pricing). Fail-open to
 * `null` ("unknown" → control hidden) on every degraded path: provider
 * unresolved (vault locked / unconfigured), config unavailable, probe
 * timeout, or unexpected import failure.
 */
async function resolveSupportsReasoning(): Promise<boolean | null> {
  try {
    const { resolveProvider } = await import(
      "@vex-agent/inference/registry.js"
    );
    const provider = await resolveProvider();
    if (provider === null) return null;
    const config = await Promise.race([
      provider.loadConfig().catch(() => null),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), REASONING_PROBE_TIMEOUT_MS);
        // Never keep the process alive for a lost race.
        timer.unref();
      }),
    ]);
    if (config === null) return null;
    return config.reasoningPricePerM !== null;
  } catch {
    return null;
  }
}

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
  if (provider !== null && provider.length > PROVIDER_ID_MAX) {
    return { provider: null, model };
  }
  if (model !== null && model.length > MODEL_ID_MAX) {
    return { provider, model: null };
  }
  return { provider, model };
}

export function registerSessionsGetModelHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.getModel,
    domain: "sessions",
    inputSchema: sessionGetModelInputSchema,
    outputSchema: sessionModelDtoSchema,
    handle: async (input, ctx): Promise<Result<SessionModelDto>> => {
      const { provider, model } = readEnvDefault();
      const dto: SessionModelDto =
        provider !== null && model !== null
          ? {
              sessionId: input.sessionId,
              provider,
              modelId: model,
              source: "global_default",
              updatedAt: null,
              supportsReasoning: await resolveSupportsReasoning(),
            }
          : {
              sessionId: input.sessionId,
              provider: null,
              modelId: null,
              source: "unconfigured",
              updatedAt: null,
              // No configured model — capability is unknowable.
              supportsReasoning: null,
            };
      log.info(
        `[ipc:vex:sessions:getModel] ok sessionId=${input.sessionId} ` +
          `source=${dto.source} supportsReasoning=${String(dto.supportsReasoning)} ` +
          `correlationId=${ctx.requestId}`,
      );
      return ok(dto);
    },
  });
}
