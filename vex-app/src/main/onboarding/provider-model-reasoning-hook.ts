/**
 * Raw OpenRouter `/models` reasoning-capability extraction (D1/D1a).
 *
 * The installed `@openrouter/sdk` strips the upstream `reasoning: {...}`
 * object off every model row before app code ever sees it (`Model`'s Zod
 * schema has no catchall — verified against the installed SDK). The only
 * supported way to recover it is an `HTTPClient` response hook that reads
 * the raw JSON body BEFORE the SDK's own parser consumes it
 * (`res.clone().json()`), which is exactly what `createReasoningCapabilityHook`
 * does. `provider-model-catalog.ts` attaches the hook to the SAME client
 * that fetches the onboarding catalogue — no extra network call.
 *
 * Mechanical fail-open contract (D1a): the SDK AWAITS response hooks, and a
 * hook that throws REJECTS the underlying request (verified in the SDK's
 * `HTTPClient.request()`). So the entire hook body below runs inside a
 * catch-all that always resolves normally — a broken/absent capability
 * payload degrades the reasoning metadata to `null`, it never fails the
 * model catalogue fetch itself.
 */

import { z } from "zod";
import type { ResponseHook } from "@vex-lib/openrouter-client.js";
import {
  normalizeReasoningCapability,
  type ReasoningCapability,
} from "@shared/schemas/reasoning.js";

/**
 * Per-model reasoning capability, keyed by model id in the catalogue's
 * capability map. `reasoning` is the D4-set-normalized selectable set (or
 * `null` when the model has none); `supportsReasoningParameter` is the
 * coarser "does this model accept ANY reasoning-related parameter at all"
 * signal (from `supported_parameters`), used as the DTO fallback when
 * `reasoning` is `null` but the model still nominally supports reasoning
 * (see `get-model.ts`'s fallback chain).
 */
export interface ModelReasoningCapabilityEntry {
  readonly reasoning: ReasoningCapability | null;
  readonly supportsReasoningParameter: boolean;
}

// Narrow, LENIENT row schema — only the 3 fields this feature reads. Any
// other shape drift in the raw `/models` payload is irrelevant here; a row
// failing this schema is skipped (D1: "malformed rows skipped"). Individual
// unrecognized effort STRINGS inside a validly-shaped array are NOT
// rejected here — `normalizeReasoningCapability` filters those out as part
// of domain normalization, not row validation.
const rawReasoningRowSchema = z.object({
  id: z.string(),
  reasoning: z
    .object({
      supported_efforts: z.array(z.string()).nullable().optional(),
      default_effort: z.string().nullable().optional(),
      default_enabled: z.boolean().nullable().optional(),
      mandatory: z.boolean().nullable().optional(),
    })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
});

const rawReasoningPayloadSchema = z.object({
  data: z.array(z.unknown()),
});

/**
 * Build the capability map from the raw, unstripped `/models` JSON body.
 * Pure and independently testable — no HTTP/Response involved. Returns
 * `null` when the payload's outer shape (`{ data: [...] }`) doesn't even
 * parse; individual malformed ROWS are skipped, not fatal to the whole map.
 * Duplicate ids keep the FIRST occurrence (matches `provider-model-catalog`'s
 * own catalogue dedup).
 */
export function buildReasoningCapabilityMap(
  rawJson: unknown,
): ReadonlyMap<string, ModelReasoningCapabilityEntry> | null {
  const payload = rawReasoningPayloadSchema.safeParse(rawJson);
  if (!payload.success) return null;

  const map = new Map<string, ModelReasoningCapabilityEntry>();
  for (const rawRow of payload.data.data) {
    const row = rawReasoningRowSchema.safeParse(rawRow);
    if (!row.success) continue;

    const modelId = row.data.id.trim();
    if (modelId.length === 0 || map.has(modelId)) continue;

    const supportedParameters = row.data.supported_parameters ?? [];
    const supportsReasoningParameter =
      supportedParameters.includes("reasoning") ||
      supportedParameters.includes("reasoning_effort");

    const reasoning = normalizeReasoningCapability(
      row.data.reasoning === undefined
        ? undefined
        : {
            supportedEfforts: row.data.reasoning.supported_efforts,
            defaultEffort: row.data.reasoning.default_effort,
            defaultEnabled: row.data.reasoning.default_enabled,
            mandatory: row.data.reasoning.mandatory,
          },
    );

    map.set(modelId, { reasoning, supportsReasoningParameter });
  }
  return map;
}

/**
 * Create a fresh, request-LOCAL response hook + reader (D1a — no shared
 * mutable "latest result" across requests). Attach `hook` to a per-request
 * `HTTPClient`; after the awaited SDK call resolves, `read()` returns the
 * capability map built from that SAME response, or `null` if the hook never
 * ran, the response wasn't a 200, or ANY step of reading/parsing failed.
 */
export function createReasoningCapabilityHook(): {
  readonly hook: ResponseHook;
  read(): ReadonlyMap<string, ModelReasoningCapabilityEntry> | null;
} {
  let captured: ReadonlyMap<string, ModelReasoningCapabilityEntry> | null = null;

  const hook: ResponseHook = async (res) => {
    try {
      // Only a successful catalogue response carries the models payload;
      // non-200 bodies (error responses) are the SDK's own error path to
      // handle — this hook has nothing useful to extract from them.
      if (res.status !== 200) return;
      const rawJson: unknown = await res.clone().json();
      captured = buildReasoningCapabilityMap(rawJson);
    } catch {
      // Mechanical fail-open (D1a): clone()/json()/parse failures must
      // never reject the hook (which would reject the underlying
      // `models.list()` call for everyone). Degrade to null instead.
      captured = null;
    }
  };

  return { hook, read: () => captured };
}
