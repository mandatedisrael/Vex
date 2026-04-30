/**
 * Protocol namespace lifecycle — single source of truth.
 *
 * Each protocol namespace registered in `catalog.ts:NAMESPACE_MODULES` (or
 * sitting in the allowlist as reserved) carries one of three lifecycle
 * states. The lifecycle is enforced at three boundaries:
 *
 *   1. **discover_tools** — only `active` namespaces appear in the
 *      LLM-facing catalog. Already gated today via the `advertised: false`
 *      flag in `descriptions.ts` for `deprecated_hidden`/`reserved` rows.
 *   2. **execute_tool** — only `active` namespaces are executable by
 *      default. `deprecated_hidden` namespaces refuse with a clear
 *      message; the user can opt-in via `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`
 *      for migration-period workflows. `reserved` namespaces never
 *      execute (they have no `NAMESPACE_MODULES` row anyway).
 *   3. **tool_embeddings reembed** — only `active` namespaces are
 *      re-embedded for dense discovery. Deprecated/reserved are skipped
 *      silently.
 *
 * Why a separate map (vs adding `lifecycle` to `ProtocolNamespaceNavigation`):
 * less intrusive, single audit point, easy to test, decoupled from the
 * navigation/descriptions concern.
 *
 * To reactivate a deprecated namespace:
 *   1. Flip its row here from `"deprecated_hidden"` → `"active"`.
 *   2. Add fresh passages under `embeddings/<namespace>/` (mirror khalani
 *      for shape).
 *   3. Run `pnpm tool-reembed` to populate `tool_embeddings`.
 *   4. Update `embeddings/_DEPRECATED.md` to reflect the change.
 */

import type { ProtocolNamespace } from "./types.js";

export type NamespaceLifecycle = "active" | "deprecated_hidden" | "reserved";

/**
 * Per-namespace lifecycle assignment. Adding a new namespace requires
 * a row here — TypeScript enforces totality via `Record<ProtocolNamespace, ...>`.
 */
export const NAMESPACE_LIFECYCLE: Record<ProtocolNamespace, NamespaceLifecycle> = {
  // Active — discover_tools advertises, execute_tool runs, reembed embeds.
  khalani: "active",
  kyberswap: "active",
  solana: "active",
  polymarket: "active",
  dexscreener: "active",
  // Deprecated_hidden — manifests + handlers exist, but discovery hides them
  // and execute_tool refuses by default. See `embeddings/_DEPRECATED.md`.
  chainscan: "deprecated_hidden",
  jaine: "deprecated_hidden",
  slop: "deprecated_hidden",
  echobook: "deprecated_hidden",
  "slop-app": "deprecated_hidden",
  // Reserved — namespace exists in allowlist (`PROTOCOL_NAMESPACE_ALLOWLIST`)
  // but has no `NAMESPACE_MODULES` row. Discovery + execution + reembed
  // never see them.
  "0g-compute": "reserved",
  "0g-storage": "reserved",
};

/** True iff the namespace is currently `deprecated_hidden`. */
export function isDeprecatedNamespace(ns: ProtocolNamespace): boolean {
  return NAMESPACE_LIFECYCLE[ns] === "deprecated_hidden";
}

/**
 * True iff `execute_tool` may run a tool in this namespace.
 *
 * - `active` → always executable.
 * - `deprecated_hidden` → executable only when `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`.
 * - `reserved` → never executable.
 *
 * Defensive default: namespace not present in `NAMESPACE_LIFECYCLE` is treated
 * as `active`. The TS union `ProtocolNamespace` already covers every legitimate
 * value at compile time; a missing row would only happen for a freshly added
 * namespace whose `NAMESPACE_LIFECYCLE` row hasn't been added yet, or for test
 * fixtures that cast a synthetic name through the type. Failing open here is
 * safer than failing closed because the surface is gated upstream by
 * `isAdvertisedProtocolNamespace` for discovery and by `manifest.requiresEnv`
 * for execution.
 */
export function isExecutableNamespace(ns: ProtocolNamespace): boolean {
  const status = NAMESPACE_LIFECYCLE[ns];
  if (status === undefined || status === "active") return true;
  if (status === "deprecated_hidden") {
    return process.env.VEX_ALLOW_DEPRECATED_PROTOCOLS === "1";
  }
  return false;
}

/**
 * True iff the namespace should be included in `tool_embeddings` reembed.
 *
 * Same defensive default as `isExecutableNamespace`: missing row defaults to
 * `active` (we'd rather embed an unknown namespace than skip it silently —
 * the lint will catch it).
 */
export function isReembeddableNamespace(ns: ProtocolNamespace): boolean {
  const status = NAMESPACE_LIFECYCLE[ns];
  return status === undefined || status === "active";
}
