/**
 * OpenRouter model catalogue projected into renderer-safe metadata, plus
 * (S6) a per-model reasoning-capability map built from the SAME `/models`
 * fetch via a response hook (see `provider-model-reasoning-hook.ts`).
 *
 * Caching (D1/D1a): the two projections are cached and refreshed TOGETHER —
 * one snapshot, one TTL, one in-flight fetch. A successful refresh always
 * replaces BOTH fields atomically (a hook failure on an otherwise-successful
 * catalog fetch degrades `modelMetadata` to `null`, never to a stale older
 * map). Concurrent cold calls share ONE in-flight fetch; a caller's own
 * `AbortSignal` only detaches THAT caller's wait — it never cancels the
 * shared fetch, so one cancelled IPC request can't starve every other
 * waiter (D1a).
 */

import {
  HTTPClient,
  OpenRouter,
  type Fetcher,
  type ResponseHook,
} from "@vex-lib/openrouter-client.js";
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
import {
  createReasoningCapabilityHook,
  type ModelReasoningCapabilityEntry,
} from "./provider-model-reasoning-hook.js";

export type { ModelReasoningCapabilityEntry } from "./provider-model-reasoning-hook.js";

const CATALOG_TTL_MS = 3_600_000;
const CATALOG_TIMEOUT_MS = 15_000;
/**
 * After ANY refresh failure — cold (nothing to serve) or warm (a stale
 * cache past its TTL) — skip re-hitting the network for every call inside
 * this window, serving the stale cache (or failing fast when there is none)
 * instead. Short enough that a genuine recovery (network blip) is picked up
 * quickly, long enough to avoid hammering OpenRouter when many callers race
 * a degraded catalogue during an outage.
 */
const CATALOG_FAILURE_COOLDOWN_MS = 10_000;

type ModelsClient = Pick<OpenRouter["models"], "list">;

export interface LoadProviderModelCatalogOptions {
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly clientFactory?: () => { readonly models: ModelsClient };
  /**
   * Test-only: override the underlying `fetch` used by the REAL default
   * client (ignored when `clientFactory` is set). Lets tests drive the
   * production wiring — default client + `HTTPClient` + reasoning hook —
   * end to end with a controlled network layer instead of a real fetch.
   */
  readonly fetcher?: Fetcher;
}

interface CatalogSnapshot {
  readonly catalog: ProviderListModelsResult;
  readonly modelMetadata: ReadonlyMap<string, ModelReasoningCapabilityEntry> | null;
}

let cached: CatalogSnapshot | null = null;
let cachedAtMs = 0;
let inFlight: Promise<CatalogSnapshot> | null = null;
let cooldownUntilMs = 0;
let lastFailureCause: unknown = null;

function defaultClientFactory(responseHook: ResponseHook, fetcher?: Fetcher): OpenRouter {
  return new OpenRouter({
    httpReferer: OPENROUTER_APP_URL,
    appTitle: OPENROUTER_APP_TITLE,
    timeoutMs: CATALOG_TIMEOUT_MS,
    retryConfig: { strategy: "none" },
    debugLogger: OPENROUTER_NOOP_LOGGER,
    httpClient: new HTTPClient({ fetcher }).addHook("response", responseHook),
    // SECURITY: this client fetches the PUBLIC `/models` catalogue and must
    // NEVER carry the user's OpenRouter key, even after vault unlock has
    // populated `process.env.OPENROUTER_API_KEY` for the privileged engine
    // client. Omitting `apiKey` here does NOT achieve that: the SDK's
    // `resolveGlobalSecurity` (node_modules/@openrouter/sdk/esm/lib/security.js:128)
    // reads `security?.apiKey ?? env().OPENROUTER_API_KEY` — a nullish
    // (omitted/undefined) `apiKey` silently falls back to the env var and
    // attaches it as `Authorization: Bearer <key>` (confirmed with an
    // intercepted fetcher). An explicit empty string is NOT nullish, so it
    // defeats that `??` fallback; `resolveSecurity`'s own value check then
    // treats an empty string as "no security provided" (`!!"" === false`)
    // and skips the Authorization header entirely — verify both steps
    // against the installed SDK before changing this.
    apiKey: "",
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

function callerAbortError(): Error {
  return Object.assign(new Error("Catalogue request cancelled"), { name: "AbortError" });
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
  options: Pick<LoadProviderModelCatalogOptions, "clientFactory" | "fetcher">,
): Promise<CatalogSnapshot> {
  const capability = createReasoningCapabilityHook();
  // NOTE: no per-caller `signal` here — this fetch is shared across every
  // concurrent waiter (see `loadCatalogSnapshot`'s in-flight dedup). It is
  // bounded only by its own `timeoutMs`, never by any one caller's
  // AbortSignal (D1a).
  const client = (
    options.clientFactory ?? (() => defaultClientFactory(capability.hook, options.fetcher))
  )();
  const response = await client.models.list(
    { outputModalities: "text", supportedParameters: "tools" },
    { timeoutMs: CATALOG_TIMEOUT_MS, retries: { strategy: "none" } },
  );

  const unique = new Map<string, ProviderModelOption>();
  for (const rawModel of response.data) {
    const model = normalizeModel(rawModel);
    if (model !== null && !unique.has(model.modelId)) {
      unique.set(model.modelId, model);
    }
  }
  return {
    catalog: {
      models: [...unique.values()].sort(compareModels).slice(0, PROVIDER_MODEL_CATALOG_MAX),
    },
    modelMetadata: capability.read(),
  };
}

function startFetch(options: LoadProviderModelCatalogOptions): Promise<CatalogSnapshot> {
  const now = options.now ?? Date.now;
  return fetchCatalogue(options)
    .then((snapshot) => {
      cached = snapshot;
      cachedAtMs = now();
      cooldownUntilMs = 0;
      lastFailureCause = null;
      return snapshot;
    })
    .catch((cause: unknown) => {
      if (isCatalogueAbort(cause)) throw cause;
      // Arm the cooldown on EVERY non-abort failure, warm cache or cold —
      // otherwise a cache that goes stale past its TTL during an outage
      // re-fires the network on every single subsequent call instead of
      // respecting the cooldown window (the bug this comment replaces).
      lastFailureCause = cause;
      cooldownUntilMs = now() + CATALOG_FAILURE_COOLDOWN_MS;
      if (cached !== null) return cached;
      throw cause;
    })
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Let a caller detach from a SHARED in-flight fetch without affecting it.
 * When `signal` fires, this caller's promise rejects immediately with an
 * abort-shaped error; the underlying `sharedFetch` keeps running (and will
 * still commit to the module cache) for every other waiter.
 */
function attachCaller(
  sharedFetch: Promise<CatalogSnapshot>,
  signal: AbortSignal | undefined,
): Promise<CatalogSnapshot> {
  if (signal === undefined) return sharedFetch;
  if (signal.aborted) return Promise.reject(callerAbortError());
  return new Promise<CatalogSnapshot>((resolve, reject) => {
    const onAbort = (): void => reject(callerAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    sharedFetch.then(
      (snapshot) => {
        signal.removeEventListener("abort", onAbort);
        resolve(snapshot);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(cause);
      },
    );
  });
}

async function loadCatalogSnapshot(
  options: LoadProviderModelCatalogOptions,
): Promise<CatalogSnapshot> {
  const now = (options.now ?? Date.now)();

  if (cached !== null && now - cachedAtMs < CATALOG_TTL_MS) {
    return cached;
  }

  if (inFlight === null) {
    // Inside the cooldown window, never attempt the network regardless of
    // whether a stale cache exists — serve the stale snapshot when there is
    // one, or fail fast with the last cause when there is none.
    if (now < cooldownUntilMs) {
      if (cached !== null) return cached;
      throw lastFailureCause ?? new Error("OpenRouter model catalogue temporarily unavailable");
    }
    inFlight = startFetch(options);
  }

  return attachCaller(inFlight, options.signal);
}

export async function loadProviderModelCatalog(
  options: LoadProviderModelCatalogOptions = {},
): Promise<ProviderListModelsResult> {
  const snapshot = await loadCatalogSnapshot(options);
  return snapshot.catalog;
}

/**
 * Read API for `sessions.getModel` (D3/D7): resolve the reasoning
 * capability for ONE model id, triggering/awaiting the same bounded,
 * deduplicated catalogue fetch `loadProviderModelCatalog` uses. Returns
 * `null` when the capability map is unavailable (fetch failed) OR the
 * model id isn't present in it — both cases are "we don't know", and the
 * caller (get-model.ts) falls back to the pricing-proxy probe either way.
 */
export async function getModelReasoningCapability(
  modelId: string,
  options: LoadProviderModelCatalogOptions = {},
): Promise<ModelReasoningCapabilityEntry | null> {
  const snapshot = await loadCatalogSnapshot(options);
  return snapshot.modelMetadata?.get(modelId) ?? null;
}

export function __resetProviderModelCatalogForTests(): void {
  cached = null;
  cachedAtMs = 0;
  inFlight = null;
  cooldownUntilMs = 0;
  lastFailureCause = null;
}
