# Deprecated protocol namespaces

These five namespaces are still wired into the catalog (`catalog.ts:NAMESPACE_MODULES`)
but are **deprecated** for the dense discovery surface. They have no `embeddings/<ns>/`
directory by design, will not be re-embedded on startup, and `execute_tool` refuses
to invoke them by default.

| Namespace  | Lifecycle             |
|------------|-----------------------|
| `chainscan`  | `deprecated_hidden` |
| `jaine`      | `deprecated_hidden` |
| `slop`       | `deprecated_hidden` |
| `echobook`   | `deprecated_hidden` |
| `slop-app`   | `deprecated_hidden` |

Two more namespaces are reserved (no `NAMESPACE_MODULES` row, present only in the
allowlist for navigation purposes):

| Namespace      | Lifecycle  |
|----------------|------------|
| `0g-compute`   | `reserved` |
| `0g-storage`   | `reserved` |

## Enforcement

Lifecycle is encoded in `src/vex-agent/tools/protocols/lifecycle.ts:NAMESPACE_LIFECYCLE`.
Three boundaries enforce it:

1. **`discover_tools`** — only `active` namespaces appear (already gated via
   `descriptions.ts:advertised: false` for the deprecated/reserved rows).
2. **`execute_tool`** — `runtime.ts:executeProtocolTool` refuses non-active
   namespaces. Override per-process by setting `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`.
3. **`tool_embeddings` reembed** — `embeddings/reembed.ts:reembedAllTools` filters
   through `isReembeddableNamespace` so deprecated/reserved tools never enter the
   pgvector index.

This file is **reference, not enforcement** — mutating it has no runtime effect.

## Do NOT (without flipping the lifecycle enum first)

- Do **not** add `embeddings/{chainscan,jaine,slop,echobook,slop-app}/` directories
  with passages.
- Do **not** add `discovery: ...` metadata to the manifests under
  `tools/protocols/{0g/chainscan,0g/jaine,0g/slop,echobook,0g/slop-app}/manifest.ts`.
- Do **not** include them in `tool_embeddings` reembed iteration — `reembed.ts`
  filters them out and the eval seed dataset (when added in A5) excludes them.

## Reactivation steps

1. Flip the row in `src/vex-agent/tools/protocols/lifecycle.ts:NAMESPACE_LIFECYCLE`
   from `"deprecated_hidden"` → `"active"`.
2. Update `src/vex-agent/tools/protocols/descriptions.ts` to set `advertised: true`
   for the namespace (so `discover_tools` starts surfacing it).
3. Add `embeddings/<namespace>/` with passages mirroring the shape of
   `embeddings/khalani/manifest.ts` (canonicalSummary, embeddingText, aliases,
   exampleIntents, preferredFor, chains).
4. Wire each manifest in `tools/protocols/<namespace>/manifest.ts` to its
   discovery metadata: `discovery: <NAMESPACE>_DISCOVERY[toolId]`.
5. Run `pnpm tool-reembed` to populate `tool_embeddings` with the new vectors.
6. Update this file: move the namespace out of the deprecated table.
7. Update the `runtime-deprecated.test.ts` cohort.

If reactivating a `reserved` namespace, additionally add a `NAMESPACE_MODULES`
row in `catalog.ts` with its `manifests` and `handlers`.
