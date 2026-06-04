---
id: module.vex-agent.tools-protocols
kind: module
paths:
  - "src/vex-agent/tools/protocols/**"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/tools/protocols/**"
  - "src/vex-agent/tools/dispatcher.ts"
  - "src/vex-agent/tools/registry/protocol.ts"
related:
  - module.vex-agent.tools-internal
  - module.vex-agent.data-memory-knowledge
  - module.vex-agent.inference
---

# module.vex-agent.tools-protocols — Protocol Tool System

## Purpose

Manifest-driven, two-meta-tool system that exposes ~120 active DeFi/data protocol
capabilities to the LLM without flooding the LLM's static tool list. The LLM calls
only two registered tools — `discover_tools` (semantic search → manifest shortlist)
and `execute_tool` (run a named handler) — and the protocol layer handles all
discovery retrieval, lifecycle/env gating, approval routing, capture, and projection
behind those two entry points.

## Retrieval keywords

- discover_tools, execute_tool, protocol tool, manifest-driven tools
- khalani, kyberswap, solana-jupiter, jupiter, polymarket, dexscreener
- bridge, cross-chain, EVM swap, limit order, zap, lend, prediction market, CLOB
- protocol execution, capture pipeline, mutation matrix, trade capture
- dense discovery, lexical scoring, tool embeddings, reembed
- actionKind override, preview dryRun, approval gate, context pressure

## State owned

- **`tool_embeddings` (DB table)**: per-manifest dense vector rows keyed by
  `(toolId, content_hash, embedding_model, embedding_dim)`. Written by
  `embeddings/reembed.ts:reembedAllTools`; read by
  `db/repos/tool-embeddings.ts:searchByVector` in the dense retrieval leg.
- **`protocol_executions` (DB table)**: audit log of every mutating protocol
  call (success + failure) — written via `db/repos/executions.ts:recordExecution`
  in `runtime.ts:captureExecution`.
- **`capture_items` (DB table)**: per-item `_tradeCapture` JSON rows. Written via
  `db/repos/capture-items.ts:recordCaptureItems` in `capture-pipeline.ts`.
- **`proj_activity` / `proj_positions` / `proj_lots` (DB tables)**: projection rows
  for business truth. Populated by `sync/activity-populator.ts:populateActivity`
  only for **successful** mutations; failed mutations → `protocol_executions` only.
- **`protocol_sync_jobs` / `protocol_sync_runs` (DB tables)**: enqueue-side written by
  `db/repos/sync.ts:enqueueRun` after each successful execution. Drained by the
  desktop sync worker (`vex-app/src/main/agent/sync-worker.ts`, F11/Bundle A).
- **Env gates**: each manifest's optional `requiresEnv` field is evaluated at module
  load (`catalog.ts:isProtocolToolAvailable`) and re-checked at runtime
  (`runtime.ts:executeProtocolTool`). No persistent state; runtime-env only.

## Boundary crossings

| Direction | Boundary |
|-----------|----------|
| Inbound | `tools/dispatcher.ts:dispatchTool` calls `discoverProtocolCapabilities` + `executeProtocolTool` when the LLM emits `discover_tools` / `execute_tool` |
| DB (engine pool) | `db/repos/executions.ts`, `db/repos/capture-items.ts`, `db/repos/tool-embeddings.ts`, `db/repos/sync.ts` — dynamic imports inside `captureExecution` + `populateCaptureItems` |
| Network | Per-protocol client libs under `src/tools/{khalani,kyberswap,polymarket,solana-ecosystem,dexscreener}/` called from handlers |
| Embeddings | `vex-agent/embeddings/client.ts:embedQuery` / `embedTool` → configured embedding base URL; bundled desktop compose default is `127.0.0.1:55134/v1` |
| Wallet/signing | Handlers resolve the session's selected wallet via `tools/wallet/multi-auth.ts:WalletResolution`; signing is delegated to the per-chain signer clients, never raw keys in this layer |
| Sync / projection | `sync/activity-populator.ts` (dynamic import post-execution) → `proj_*` tables |

## File map

### Infrastructure

- `protocols/types.ts:1` — all shared types: `ProtocolNamespace`, `ToolLifecycle` (only `"active"` inhabited post-PR1), `ToolDiscoveryMetadata`, `ProtocolToolManifest`, `ProtocolHandler`, `ProtocolExecutionContext`, `ProtocolDiscoveryRequest/Item/Result/RetrievalMeta`, `ProtocolExecuteRequest`, `PortfolioRole`, `CaptureSupport`
- `protocols/catalog.ts:69` `NAMESPACE_MODULES` — single registration table: 5 namespace entries, each binding namespace label → `manifests[]` + `handlers` record. O(1) `MANIFEST_BY_ID`/`HANDLER_BY_ID` maps built at module load; duplicate `toolId` throws immediately
  - `catalog.ts:113` `isProtocolToolAvailable` — lifecycle=`"active"` AND `requiresEnv` present in `process.env`
  - `catalog.ts:50` `isAdvertisedProtocolNamespace` — filter for LLM-visible namespaces (currently all 5)
- `protocols/lifecycle.ts:34` `NAMESPACE_LIFECYCLE` — `Record<ProtocolNamespace, "active" | "deprecated_hidden" | "reserved">`. All 5 currently `"active"`. `isExecutableNamespace` allows `deprecated_hidden` under `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`; `reserved` never executes
- `protocols/runtime.ts:53` `executeProtocolTool` — main execution path (see Internal flow)
  - `runtime.ts:21` re-exports `discoverProtocolCapabilities` from `discovery.ts`
  - `runtime.ts:47` `withActionKind` — local helper that stamps `actionKind` on any `ToolResult`; **always overwrites** handler-set value (manifest is authoritative)
  - `runtime.ts:268` `captureExecution` — private async function; guards on `dryRun`, dispatches `recordExecution` → optional `enqueueRun` → `populateCaptureItems` (after `validateCaptureContract`)
- `protocols/mutation-matrix.ts:66` `MUTATION_MATRIX: ReadonlyMap<string, MutationContract>` — 28 entries covering every mutating tool. Classifies `role` (`pnl_spot|pnl_prediction|projection|audit|utility`), `capture` (`full|none`), `expectedType`, `previewSupport`, `fanOut` (`single|items`), `requiredFields`, `valuationExpected` (`exact|conditional|none`), optional `requiredMetaFields`
- `protocols/capture-validator.ts:17` `validateCaptureContract` — validates `_tradeCapture` against `MUTATION_MATRIX` entry: missing capture, unexpected type, missing required fields (with exception logic), missing meta fields (e.g. `contracts` for `solana.predict.buy`), and W4A valuation guard (hard fail for `exact` handlers missing `inputValueUsd`/`outputValueUsd`)
  - `capture-validator.ts:143` `isPreviewExecution` — checks `contract.previewSupport === true && params.dryRun === true`
- `protocols/capture-pipeline.ts:17` `extractExternalRefs` — maps known result fields (`txHash`, `orderId`, `positionPubkey`, `orderKey`, `positionId`, `conditionId`, `signature`, `instrumentKey`, `positionKey`) + nested `_tradeCapture` fields to correlation dict
  - `capture-pipeline.ts:61` `populateCaptureItems` — fan-out: `_tradeCaptureItems` (batch) or `[_tradeCapture]` (single) → `recordCaptureItems` → per-item `populateActivity`
  - `capture-pipeline.ts:99` `replayActivityFromCapture` — replay path for historical correction without re-writing capture rows
- `protocols/discovery.ts:69` `discoverProtocolCapabilities` — filters to advertised+available manifests, resolves namespace, calls `denseScore` for queries, `catalog` listing for empty query; attaches `unavailable_at_pressure` flag on mutating tools at `barrier`/`critical` bands
- `protocols/dense-score.ts:19` `denseScore` — embed query via `embedQuery`; vector-search `tool_embeddings` via `searchByVector`; if empty or error → falls through to `lexicalScore`
- `protocols/lexical-score.ts:234` `lexicalScore` — token-based scoring over multi-field index (toolId w8, description w6, params w6, canonicalSummary w7, exampleIntents w6, namespace w5, navigationStrings w4, chains w3, exampleQueries w3); `preferredFor`/`avoidFor` ±5 bias at ≥40% catalog coverage
- `protocols/metadata-compile.ts:56` `compileToolDiscoveryMetadata` — 3-level merge: namespace nav defaults → facet hints → per-manifest `discovery` override; derives `ecosystems` from `groupId`, `sourceClass` from namespace, `operation`/`sideEffectLevel` from `mutating`
- `protocols/descriptions.ts:21` `PROTOCOL_NAMESPACE_NAVIGATION` — composed from `navigation/entries-market.ts`; powers `buildDiscoverNamespaceDescription`, `getDiscoveryStringsForTool`, `getMatchingFacetsForTool`
- `protocols/handler-helpers.ts` — shared handler utilities: `str/num/bool/strArray/numArray` param accessors, `ok`/`fail` result constructors, `toResultData` (unsafe cast bridge for typed SDK responses), `enumField` (re-export from `internal/types.ts`)
- `protocols/discovery.telemetry.ts:62` `logDiscoveryTelemetry` — logs `tools.discover.completed/empty` with privacy-gated query (`DISCOVERY_QUERY_PRIVACY=raw|normalized|sanitized|hashed`), `discoveryRunId`, retrieval method, top scored tool

### Navigation layer

- `protocols/navigation/types.ts` — `ProtocolNavigationGroupId`, `ProtocolNavigationFacet`, `ProtocolNamespaceNavigation`, `ProtocolNavigationGroup`, `PROTOCOL_NAVIGATION_GROUP_ORDER` (`cross-chain → evm-trading → solana → prediction-markets → market-research`)
- `protocols/navigation/entries-market.ts` `MARKET_PROTOCOL_NAVIGATION` — all 5 namespace nav entries with `groupId`, `advertised`, `summary`, `whenToUse`, `preferInstead`, `exampleQueries`, `aliases`, `discoveryHints`, per-namespace `facets[]` (facets carry `toolPrefixes[]` and `hints[]`)

### Embeddings infrastructure

- `protocols/embeddings/reembed.ts:50` `reembedAllTools` — single-flight (module-level `inFlight` promise); iterates `isReembeddableNamespace` manifests; computes `content_hash` over dense input + `FORMATTER_VERSION`; upserts to `tool_embeddings` only on hash change. CLI entry: `pnpm tool-reembed`
- `protocols/embeddings/health.ts:37` `assertToolEmbeddingsReady` — pre-flight gate for tests/evals; throws if `tool_embeddings` is empty or stale for the configured `(model, dim)` pair
- `protocols/embeddings/{khalani,kyberswap,polymarket,solana-jupiter,dexscreener}/` — per-namespace `.ts` files exporting `*_DISCOVERY` record with per-tool `ToolDiscoveryMetadata` overrides (canonicalSummary, embeddingText, aliases, exampleIntents, chains, etc.)

### Protocol: khalani (cross-chain bridge + token resolver)

- `protocols/khalani/manifest.ts:12` `KHALANI_TOOLS` — 9 tools (8 read + 1 mutating): `chains.list`, `tokens.top`, `tokens.search`, `tokens.autocomplete`, `tokens.balances`, `quote.get`, `orders.list`, `orders.get`, `bridge`
  - `khalani.bridge` — `mutating:true`, `actionKind:"user_wallet_broadcast"`, `previewSupport:true` (dryRun param), capture `role:"audit"`
- `protocols/khalani/handlers.ts` — aggregator: `READ_HANDLERS` (`handlers/read.ts`) + `BRIDGE_HANDLERS` (`handlers/bridge.ts`)
  - `handlers/bridge.ts` — executes quote → build-deposit → sign → broadcast → submit via `@tools/khalani/` client

### Protocol: kyberswap (EVM trading: swaps, limit orders, zap/LP)

- `protocols/kyberswap/manifest.ts:15` `KYBERSWAP_TOOLS` — 20 tools across 5 sub-modules:
  - `manifests/chains.ts` (2): `kyberswap.chains.list`, `kyberswap.chains.get`
  - `manifests/tokens.ts` (1): `kyberswap.tokens.check`
  - `manifests/swap.ts` (3): `kyberswap.swap.quote` (read), `kyberswap.swap.sell` (mutating, pnl_spot), `kyberswap.swap.buy` (mutating, pnl_spot) — both support `dryRun`
  - `manifests/limit-order.ts` (10): `kyberswap.limitOrder.{create,list,get,cancel,hardCancel,fill,batchFill,cancelAll,getActiveOrders,getFilledOrders}` — `create/fill/batchFill` support dryRun; capture role `projection`
  - `manifests/zap.ts` (4): `kyberswap.zap.{pools,in,out,migrate}` — `in/out/migrate` are mutating, support dryRun, role `projection`
- `protocols/kyberswap/handlers.ts` — aggregator: `SWAP_HANDLERS`, `LIMIT_ORDER_HANDLERS`, `ZAP_HANDLERS`

### Protocol: solana-jupiter (Solana swaps, lending, predictions)

- `protocols/solana-jupiter/manifest.ts:15` `SOLANA_JUPITER_TOOLS` — 20 tools across 4 sub-modules:
  - `manifests/core.ts` (3): `solana.prices.get`, `solana.tokens.search`, `solana.tokens.trending`
  - `manifests/swap.ts` (2): `solana.swap.quote` (read), `solana.swap.execute` (mutating, pnl_spot, no dryRun, `actionKind:"user_wallet_broadcast"`)
  - `manifests/predict.ts` (11): `solana.predict.{markets,events,search,positions,history,analyze,buy,sell,claim,closeAll,getStats}` — `buy/sell/claim/closeAll` are mutating; `closeAll` uses `fanOut:"items"` with `_tradeCaptureItems`
  - `manifests/lend.ts` (4): `solana.lend.{rates,positions,deposit,withdraw}` — `deposit/withdraw` are mutating, role `audit`
- `protocols/solana-jupiter/handlers.ts` — aggregator: `CORE_HANDLERS`, `PREDICT_HANDLERS`, `LEND_HANDLERS`

### Protocol: polymarket (Polygon prediction markets, CLOB, bridge, rewards)

- `protocols/polymarket/manifest.ts:14` `POLYMARKET_TOOLS` — 79 tools across 5 sub-modules:
  - `manifests/bridge.ts` (5): `polymarket.bridge.{supportedAssets,quote,status,deposit,withdraw}` — `deposit/withdraw` are mutating, capture `none` (address creation, no direct tx)
  - `manifests/clob.ts` (28): covers orderbook reads + `polymarket.clob.{buy,sell,cancel,cancelOrders,cancelAll,cancelMarket,heartbeat}` — `buy/sell` are mutating `pnl_prediction` (dual expectedType `["prediction","order"]`, conditional valuation); cancel variants are `projection`; `heartbeat` is `utility`
  - `manifests/data.ts` (14): positions, activity, holders, open interest, leaderboard, etc. — all read
  - `manifests/gamma.ts` (25): Gamma discovery — events, markets, tags, comments, profiles, sports — all read
  - `manifests/rewards.ts` (7): rewards/earnings reads
  - `requiresEnv: "POLYMARKET_API_KEY"` on all CLOB mutating tools (Polymarket credentials from vault)
- `protocols/polymarket/handlers.ts` — aggregator: `BRIDGE_HANDLERS`, `CLOB_HANDLERS`, `DATA_HANDLERS`, `GAMMA_HANDLERS`, `REWARDS_HANDLERS`

### Protocol: dexscreener (read-only multi-chain DEX research)

- `protocols/dexscreener/manifest.ts:13` `DEXSCREENER_TOOLS` — 11 tools across 3 sub-modules:
  - `manifests/core.ts` (4): `dexscreener.{search,pairs,tokens,tokenPairs}`
  - `manifests/trending.ts` (5): `dexscreener.{profiles,boosts,boosts.top,communityTakeovers,trending}`
  - `manifests/orders.ts` (2): `dexscreener.{orders,ads}`
  - No `requiresEnv` — no API key needed
  - All tools `mutating:false`, `actionKind:"read"`, `lifecycle:"active"`
- `protocols/dexscreener/handlers.ts` — inline flat record (no sub-modules); `dexscreener.trending` merges profiles+boosts in-handler (parallel fetch, deduped by `chainId:tokenAddress`, sorted by boostTotalAmount)

## Key types & invariants

- `ProtocolToolManifest` (`types.ts:72`) — `toolId`, `namespace`, `lifecycle`, `description`, `mutating`, `actionKind` (REQUIRED — enforced by TypeScript, never heuristic), `params[]`, `exampleParams`, optional `requiresEnv`, optional `discovery`
- `ProtocolExecutionContext` (`types.ts:113`) — `sessionPermission`, `approved`, `walletResolution`, `walletPolicy`, `sessionId?`, `contextUsageBand?`. Both wallet fields default to fail-closed values (`source:"default"` / `kind:"none"`) for legacy callers that omit them
- `MutationContract` (`mutation-matrix.ts:14`) — `role`, `capture`, `expectedType` (string | string[] for dual-type tools), `previewSupport`, `fanOut`, `requiredFields`, `valuationExpected`, optional `requiredMetaFields`
- `ToolLifecycle` (`types.ts:36`) — union narrowed to `"active"` only (PR1 removed `"declared"`); per-namespace lifecycle is a separate `lifecycle.ts:NAMESPACE_LIFECYCLE` map
- `MANIFEST_BY_ID` / `HANDLER_BY_ID` (`catalog.ts:79`) — eagerly-built `Map`s at module load; throw on duplicate `toolId`; O(1) runtime lookups
- **`actionKind` stamp invariant**: `executeProtocolTool` always overwrites `ToolResult.actionKind` with `manifest.actionKind` (or `"read"` for preview). Handler-returned `actionKind` is silently overwritten — handlers cannot downgrade a `user_wallet_broadcast` to `read` (documented in `runtime.ts:47`, tested in `execute-tool-taxonomy.test.ts`)
- **Preview invariant**: `isPreviewExecution` = `contract.previewSupport === true && params.dryRun === true`. Preview → `effectiveActionKind = "read"` AND approval gate skipped AND `shouldCapture = false`. All three must align
- **Capture invariant**: capture runs only when `manifest.mutating && !isPreview`; covers both `result.success=true` (→ audit + projections) and thrown exceptions (→ audit only, no projections). Preview never captured, even on throw
- **Projection invariant**: `populateCaptureItems` called only after `validateCaptureContract` passes AND `result.success=true`. Failed mutations write to `protocol_executions` audit log but NOT to `proj_activity`/`proj_positions`/`proj_lots`

## Capabilities (stable IDs)

- **CAP-protocol-khalani-bridge**: cross-chain bridge execute (quote→sign→broadcast) — `protocols/khalani/handlers/bridge.ts`
- **CAP-protocol-khalani-read**: chains/tokens/quotes/orders read surface — `protocols/khalani/handlers/read.ts`
- **CAP-protocol-kyberswap-swap**: EVM exact-input swap (sell/buy) — `protocols/kyberswap/handlers/swap.ts`
- **CAP-protocol-kyberswap-limit-order**: gasless limit order lifecycle (create/cancel/fill) — `protocols/kyberswap/handlers/limit-order.ts`
- **CAP-protocol-kyberswap-zap**: LP zap in/out/migrate — `protocols/kyberswap/handlers/zap.ts`
- **CAP-protocol-solana-swap**: Jupiter-backed Solana swap execute — `protocols/solana-jupiter/handlers/core.ts`
- **CAP-protocol-solana-predict**: Jupiter prediction market buy/sell/claim/closeAll — `protocols/solana-jupiter/handlers/predict.ts`
- **CAP-protocol-solana-lend**: Jupiter lending deposit/withdraw — `protocols/solana-jupiter/handlers/lend.ts`
- **CAP-protocol-polymarket-clob-order**: Polymarket CLOB buy/sell/cancel orders (EIP-712 signed) — `protocols/polymarket/handlers-clob.ts`
- **CAP-protocol-polymarket-bridge**: Polymarket deposit/withdraw bridge — `protocols/polymarket/handlers-bridge.ts`
- **CAP-protocol-dexscreener-research**: multi-chain DEX research (read-only) — `protocols/dexscreener/handlers.ts`
- **CAP-protocol-discovery-dense**: semantic tool discovery via vector search — `protocols/discovery.ts:69` + `protocols/dense-score.ts:19`
- **CAP-protocol-discovery-lexical**: lexical fallback tool discovery — `protocols/lexical-score.ts:234`
- **CAP-protocol-capture-pipeline**: mutating execution → DB audit + capture items + projection — `protocols/runtime.ts:268` + `protocols/capture-pipeline.ts`
- **CAP-protocol-reembed**: embed all active tool manifests into `tool_embeddings` — `protocols/embeddings/reembed.ts:50`

## Public API (consumed by)

- `tools/dispatcher.ts:148` — calls `discoverProtocolCapabilities(discoveryRequest)` for `call.name === "discover_tools"`
- `tools/dispatcher.ts:170` — calls `executeProtocolTool({toolId, params}, context)` for `call.name === "execute_tool"`
- `tools/registry/protocol.ts:29,51` — declares `discover_tools` + `execute_tool` as `ToolDef` entries with `mutating:false`, `pressureSafety:"read_only"`, `actionKind:"read"` (wrapper is read; runtime stamps target actionKind)
- `vex-agent/engine/prompts/protocols.ts` — reads `PROTOCOL_NAMESPACE_NAVIGATION`, `getGroupedAdvertisedProtocolNavigation` for prompt banners
- `vex-agent/engine/prompts/tool-usage.ts` — references `execute_tool`/`discover_tools` in DeFi safety rules
- `vex-agent/engine/core/approval-intent-preview.ts` — references `execute_tool` for approval intent preview extraction
- `vex-agent/sync/prediction-settlement-sync.ts` — reads protocol execution data for prediction settlement
- `protocols/embeddings/reembed.ts` / `protocols/embeddings/health.ts` — consumed by `pnpm tool-reembed` CLI and eval/test harnesses

## Internal flow

### discover_tools call

1. `dispatcher.ts:148 routeToolCall` — builds `ProtocolDiscoveryRequest` from `call.args`, forwards `context.contextUsageBand`
2. `discovery.ts:69 discoverProtocolCapabilities` — filters `PROTOCOL_TOOLS` to advertised+available manifests; resolves namespace; if `query.length > 0` → `denseScore`, else `catalog` listing
3. `dense-score.ts:19 denseScore` — `embedQuery(query)` → `searchByVector(embedding)` → join hits against candidate manifests → `ScoredManifest[]`; falls back to `lexicalScore` on empty or error
4. `lexical-score.ts:234 lexicalScore` — multi-field tokenized scoring with `preferredFor`/`avoidFor` bias
5. `discovery.ts:106` — `toDiscoveryItem` stamps `unavailable_at_pressure` on mutating results at `barrier`/`critical` bands
6. `discovery.telemetry.ts:62 logDiscoveryTelemetry` — logs event with privacy-gated query, retrieval metadata, top-k tool IDs
7. Returns `ProtocolDiscoveryResult` serialized as JSON in `ToolResult.output`

### execute_tool call

1. `dispatcher.ts:160 routeToolCall` — extracts `toolId`, `params`; calls `executeProtocolTool`
2. `runtime.ts:57 executeProtocolTool`:
   a. `getProtocolManifest(toolId)` — O(1) map lookup; unknown → `{success:false}` with no `actionKind`
   b. `effectiveActionKind` = `isPreviewExecution ? "read" : manifest.actionKind`
   c. Normalize `walletResolution`/`walletPolicy` with fail-closed defaults
   d. **Namespace lifecycle gate** (`isExecutableNamespace`) — block `deprecated_hidden`/`reserved`
   e. **Env gate** (`manifest.requiresEnv` check against `process.env`)
   f. **Pressure barrier gate** — `manifest.mutating && !isPreview && band ∈ {barrier,critical}` → deny
   g. **Param validation** — required presence + runtime type check (`typeof` vs `ProtocolParamDef.type`)
   h. `getProtocolHandler(toolId)` — O(1) map lookup; missing handler → structural bug error
   i. **Approval gate** — `manifest.mutating && !approved && permission==="restricted" && !isPreview` → `{pendingApproval:true}`
   j. `shouldCapture = manifest.mutating && !isPreview`
   k. `handler(params, scopedContext)` — calls protocol client
   l. `captureExecution(...)` if `shouldCapture` (awaited inline, non-blocking path on throw)
   m. `withActionKind(result, effectiveActionKind)` — **always overwrites** handler-set value
3. `captureExecution` (private):
   a. `recordExecution` → `protocol_executions` row (success + failure both captured)
   b. `enqueueRun` for namespace sync jobs (success only)
   c. `validateCaptureContract` against `MUTATION_MATRIX`; if invalid → skip projection pipeline
   d. `populateCaptureItems` → `recordCaptureItems` → per-item `populateActivity` → `proj_activity`/`proj_positions`/`proj_lots` (success only)

### actionKind override dynamics

`execute_tool` wrapper is registered with `actionKind:"read"` / `mutating:false` in the ToolDef registry (and therefore does NOT trigger the internal dispatcher's approval gate or context-pressure mutating block). The real `actionKind` is derived from the target `manifest.actionKind` inside `executeProtocolTool` and always stamped on the returned `ToolResult` via `withActionKind`, overwriting any value the handler may have set. This means:

- `dispatchTool → withActionKindFallback` sees a result that already has `actionKind` from the manifest, so the fallback (registry `execute_tool` = `"read"`) is never used for known manifests
- For an **unknown** manifest, `withActionKind` is never called (early-exit path), so `actionKind` stays `undefined` — the approval/audit layer treats `undefined` as the conservative "unknown" signal
- The pressure-barrier gate in `executeProtocolTool` evaluates `manifest.mutating` (not `actionKind`) to keep the check independent of taxonomy drift

## Dependencies

- **Imports FROM**:
  - `module.vex-agent.data-memory-knowledge` — `db/repos/{executions,capture-items,tool-embeddings,sync}.ts`; `embeddings/client.ts`
  - `module.vex-agent.inference` (indirect) — `embeddings/client.ts` reaches the configured local embedding service
  - `src/tools/{khalani,kyberswap,polymarket,solana-ecosystem,dexscreener}/` (Z5) — protocol client implementations
  - `tools/wallet/multi-auth.ts` (Z5) — `WalletResolution` type + wallet resolution helpers
  - `vex-agent/engine/types.ts` — `Permission`, `WalletPolicy`
  - `vex-agent/engine/core/context-band.ts` — `ContextUsageBand`
  - `vex-agent/db/params.ts` — `sanitizeJsonbValue`
  - `vex-agent/sync/activity-populator.ts` — `populateActivity`
  - `utils/logger.ts` — winston logger
- **Consumed BY**:
  - `tools/dispatcher.ts` (same Z3) — primary caller of `discoverProtocolCapabilities` + `executeProtocolTool`
  - `tools/registry/protocol.ts` (same Z3) — declares LLM-visible `discover_tools`/`execute_tool` ToolDefs
  - `vex-agent/engine/prompts/protocols.ts` (Z2) — reads navigation metadata for prompt banners
  - `vex-agent/engine/core/approval-intent-preview.ts` (Z1) — reads `execute_tool` structure
  - `protocols/embeddings/reembed.ts` + `health.ts` — CLI and test harnesses
  - **No vex-app/src consumers** — the protocol layer is engine-internal; vex-app reaches protocols only through the engine IPC chain, not via direct import

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-protocol-*`
- quality findings: `audits/current/quality-findings.md#FINDING-*`
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` (wallet is per-session, affects `walletResolution` threading)
- related modules: `module.vex-agent.tools-internal`, `module.vex-agent.data-memory-knowledge`

## Refresh triggers

This doc is stale if any path under `src/vex-agent/tools/protocols/` changes (new protocol, manifest update, capture contract change, discovery algorithm change). Also stale if `tools/dispatcher.ts` or `tools/registry/protocol.ts` changes the wiring between the two meta-tools and the protocol runtime.

## Open questions

1. **`pnpm tool-reembed` ownership at app boot**: `reembedAllTools` has no automatic desktop-boot callsite — the doc comment says "until the desktop local-service bootstrap owns this refresh path". First boot with a stale `tool_embeddings` silently degrades to lexical-only discovery (`dense_failed:true`). No `FINDING-` yet; worth a gap entry.
2. **`DISCOVERY_QUERY_PRIVACY` production default is `"raw"`**: requires operator discipline to set `sanitized`/`hashed` before enabling log aggregation. No enforcement today.
3. **polymarket.clob.* `requiresEnv: "POLYMARKET_API_KEY"` flow**: vault stores per-wallet CLOB credentials; confirm the env var is injected by `secrets/session.ts:applyUnlockedRuntime` before the first CLOB call (not verified in this audit pass).
4. **Solana `solana.swap.execute` lacks `previewSupport`** (matrix entry has `previewSupport:false`). KyberSwap swap does have it. Asymmetry is intentional per matrix but not documented in the manifest — worth a comment.
