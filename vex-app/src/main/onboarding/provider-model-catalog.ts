/** OpenRouter model catalogue projected into renderer-safe metadata. */

import { OpenRouter } from "@vex-lib/openrouter-client.js";
import {
  PROVIDER_MODEL_CATALOG_MAX,
  type ProviderListModelsResult,
  type ProviderModelOption,
} from "@shared/schemas/provider.js";
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_APP_URL,
  OPENROUTER_NOOP_LOGGER,
} from "./openrouter-app-identity.js";

const CATALOG_TTL_MS = 3_600_000;
const CATALOG_TIMEOUT_MS = 15_000;

type ModelsClient = Pick<OpenRouter["models"], "list">;

export interface LoadProviderModelCatalogOptions {
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly clientFactory?: () => { readonly models: ModelsClient };
}

let cached: ProviderListModelsResult | null = null;
let cachedAtMs = 0;

function defaultClientFactory(): OpenRouter {
  return new OpenRouter({
    httpReferer: OPENROUTER_APP_URL,
    appTitle: OPENROUTER_APP_TITLE,
    timeoutMs: CATALOG_TIMEOUT_MS,
    retryConfig: { strategy: "none" },
    debugLogger: OPENROUTER_NOOP_LOGGER,
  });
}

function isCatalogueAbort(value: unknown): boolean {
  // The platform uses AbortError while OpenRouter SDK v0.12.79 wraps an
  // aborted request as RequestAbortedError. Keep this local so onboarding
  // does not depend on the IPC adapter's cancellation helpers.
  if (typeof value !== "object" || value === null || !("name" in value)) {
    return false;
  }
  return value.name === "AbortError" || value.name === "RequestAbortedError";
}

function parsePricePerMillion(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const perToken = Number(raw);
  if (!Number.isFinite(perToken) || perToken < 0) return null;
  const perMillion = perToken * 1_000_000;
  return Number.isFinite(perMillion) ? perMillion : null;
}

function providerIdFor(modelId: string): string {
  const slash = modelId.indexOf("/");
  const raw = slash > 0 ? modelId.slice(0, slash) : "openrouter";
  return raw.replace(/^~/, "").slice(0, 64) || "openrouter";
}

function normalizeModel(model: {
  readonly id: string;
  readonly name: string;
  readonly contextLength: number | null;
  readonly supportedParameters: ReadonlyArray<string>;
  readonly pricing: { readonly prompt: string; readonly completion: string };
}): ProviderModelOption | null {
  const modelId = model.id.trim();
  const displayName = model.name.trim();
  if (
    !model.supportedParameters.includes("tools") ||
    modelId.length === 0 ||
    modelId.length > 200 ||
    displayName.length === 0 ||
    displayName.length > 200
  ) {
    return null;
  }
  return {
    modelId,
    displayName,
    providerId: providerIdFor(modelId),
    contextLength:
      typeof model.contextLength === "number" &&
      Number.isInteger(model.contextLength) &&
      model.contextLength > 0
        ? model.contextLength
        : null,
    pricingInputPerMillion: parsePricePerMillion(model.pricing.prompt),
    pricingOutputPerMillion: parsePricePerMillion(model.pricing.completion),
  };
}

function compareModels(a: ProviderModelOption, b: ProviderModelOption): number {
  const providerOrder = a.providerId.localeCompare(b.providerId, undefined, {
    sensitivity: "base",
  });
  if (providerOrder !== 0) return providerOrder;
  return a.displayName.localeCompare(b.displayName, undefined, {
    sensitivity: "base",
  });
}

async function fetchCatalogue(
  options: LoadProviderModelCatalogOptions,
): Promise<ProviderListModelsResult> {
  const client = (options.clientFactory ?? defaultClientFactory)();
  const response = await client.models.list(
    { outputModalities: "text", supportedParameters: "tools" },
    {
      signal: options.signal,
      timeoutMs: CATALOG_TIMEOUT_MS,
      retries: { strategy: "none" },
    },
  );

  const unique = new Map<string, ProviderModelOption>();
  for (const rawModel of response.data) {
    const model = normalizeModel(rawModel);
    if (model !== null && !unique.has(model.modelId)) {
      unique.set(model.modelId, model);
    }
  }
  return {
    models: [...unique.values()]
      .sort(compareModels)
      .slice(0, PROVIDER_MODEL_CATALOG_MAX),
  };
}

export async function loadProviderModelCatalog(
  options: LoadProviderModelCatalogOptions = {},
): Promise<ProviderListModelsResult> {
  const now = (options.now ?? Date.now)();
  if (cached !== null && now - cachedAtMs < CATALOG_TTL_MS) return cached;

  try {
    const result = await fetchCatalogue(options);
    cached = result;
    cachedAtMs = (options.now ?? Date.now)();
    return result;
  } catch (cause: unknown) {
    if (isCatalogueAbort(cause)) throw cause;
    if (cached !== null) return cached;
    throw cause;
  }
}

export function __resetProviderModelCatalogForTests(): void {
  cached = null;
  cachedAtMs = 0;
}
