---
id: module.vex-agent.tools-internal
kind: module
paths:
  - "src/vex-agent/tools/registry.ts"
  - "src/vex-agent/tools/dispatcher.ts"
  - "src/vex-agent/tools/types.ts"
  - "src/vex-agent/tools/taxonomy.ts"
  - "src/vex-agent/tools/risk-level.ts"
  - "src/vex-agent/tools/registry/**"
  - "src/vex-agent/tools/internal/**"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/tools/registry.ts"
  - "src/vex-agent/tools/dispatcher.ts"
  - "src/vex-agent/tools/types.ts"
  - "src/vex-agent/tools/taxonomy.ts"
  - "src/vex-agent/tools/risk-level.ts"
  - "src/vex-agent/tools/registry/**"
  - "src/vex-agent/tools/internal/**"
related:
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.inference
  - module.vex-agent.tools-protocols
  - module.vex-agent.data-memory-knowledge
  - module.vex-agent.engine-wake-subagents-prompts
---

# module.vex-agent.tools-internal — Tool Registry, Dispatcher, and Internal Handlers

## Purpose

Defines every tool the LLM can call, routes incoming tool-call requests to the
correct handler, and implements all non-protocol internal handlers (wallet,
memory, knowledge, compaction, autonomy, mission, portfolio, subagent). The
module is the single source of truth for the tool surface exposed to the inference
provider: `getOpenAITools` builds the filtered OpenAI-format array that goes on
every provider call; `dispatchTool` is the sole engine entry point for executing
a tool call. Internal handlers are lazy-imported so no handler module is parsed
unless its tool is actually dispatched.

## Retrieval keywords

- tool registry, tool catalog, ToolDef, tool definitions
- getOpenAITools, isMutatingTool, getActionKind, dispatchTool, routeToolCall
- INTERNAL_TOOL_LOADERS, lazy loader, tool routing, tool dispatch
- ToolVisibilityContext, pressure safety, context band, barrier, compact_only
- ActionKind, RiskLevel, action taxonomy, approval taxonomy
- wallet_send_prepare, wallet_send_confirm, wallet intent, wallet broadcast
- loop_defer, wake, defer_until, engine signal
- compact_now, compact_committed, compaction tool
- knowledge_write, knowledge_recall, knowledge_supersede, knowledge_lineage
- memory_recall, mark_outstanding_resolved, session memory, narrative chunks
- mission_draft_update, mission_stop, mission signal
- subagent_spawn, subagent_status, subagent disabled, TODO subagent-disabled
- portfolio_inspect, inspect views, proj_balances, proj_pnl_lots
- evm_read, wallet_read, discover_tools, execute_tool, protocol meta-tool
- pressureSafety, safe_at_barrier, read_only, mutating, compact_only
- EngineSignal, stop_mission, defer_until, compact_committed, wait_for_parent
- InternalToolContext, WalletResolution, WalletPolicy, sessionPermission
- resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult
- summarizeWalletError, error fingerprint, errorHash, ExecuteOutcome
- wallet_intents DB, CAS-consume, intent TTL, session-scoped intent

## State owned

- `wallet_intents` DB table (via `@vex-agent/db/repos/wallet-intents.ts`) — prepare creates rows; confirm CAS-consumes them
- `loop_wake_requests` DB table (via `@vex-agent/db/repos/loop-wake.ts`) — `loop_defer` enqueues rows with one-pending-per-session partial unique index
- `knowledge_entries` DB table (via `@vex-agent/db/repos/knowledge/`) — knowledge_write/supersede/update_status mutate rows
- `session_memories` DB table (via `@vex-agent/db/repos/session-memories/`) — mark_outstanding_resolved updates JSONB + re-embeds
- `documents` / `folders` DB tables (via document_* handlers)
- `protocol_executions` DB table (read-only in portfolio_inspect `executions` view)
- `proj_*` DB tables (proj_activity, proj_pnl_lots, proj_pnl_matches, proj_open_positions, proj_balances) — read-only in inspect-views
- `tool_output_blobs` DB table — blob_key-keyed overflow blobs (tool_output_read)
- `subagents` / `session_links` DB tables — in-memory `activeSubagents: Map` (lifecycle.ts) + DB rows (DISABLED path)
- `TOOL_MAP_CATEGORIES` — static ordered label→toolName map used in system-prompt Tool Map

## Boundary crossings

- **DB (via engine pool)**: wallet_intents CAS (prepare + confirm), loop_wake_requests enqueue, knowledge CRUD+embed, session_memories mark-resolve+embed, documents CRUD, portfolio proj_* reads, blob reads
- **External EVM RPC** (via viem + Khalani chain registry): `executeEvmTransfer` — `sendTransaction` / `writeContract`, `waitForTransactionReceipt`
- **External Solana RPC**: `executeSolanaTransfer` — `signAndSubmitLegacyTxStaged`, SPL token ATA resolution
- **External Khalani API**: wallet_read calls `getKhalaniClient().getChains()` for chain resolution; Khalani internal alias tools proxy to khalani protocol
- **External Tavily API**: web_research (gated on `TAVILY_API_KEY`)
- **External Rettiwt API**: twitter_account (gated on `RETTIWT_API_KEY`)
- **Local EmbeddingGemma** (Docker Model Runner `:12434`): knowledge_write/supersede embed, knowledge_recall embed-query, memory_recall embed-query, mark_outstanding_resolved re-embed
- **Engine signal bus** (return value only): `EngineSignal` in `ToolResult` consumed by turn-loop (stop_mission, defer_until, compact_committed, wait_for_parent, complete_subagent)
- **`executeCompactNow`** (Z2 compact-jobs service): compact_now thin wrapper → `executeCompactNow`
- **`applyMissionPatch`** (Z2 mission/setup): mission_draft_update handler calls `applyMissionPatch`
- **`authorizeMissionStopReason`** (Z2 mission/stop-contract): mission_stop validates against accepted contract
- **Subagent runner** (`@vex-agent/engine/subagents/runner.ts`): lifecycle.ts fire-and-forget via dynamic import (DISABLED — no live dispatch entry)
- **Signing key decrypt** (Z5 `@tools/wallet/multi-auth.ts`): `resolveSigningWallet` decrypts keystore — ONLY called inside `handleWalletSendConfirm` AFTER approval gate and wallet match assertion

## File map

### Core infrastructure

- `tools/types.ts:67` `ToolDef` — registry row shape; `pressureSafety` and `actionKind` are REQUIRED fields
- `tools/types.ts:24` `ToolVisibility` — band/mission-run/setup/role visibility flags
- `tools/types.ts:61` `PressureSafety` — `safe_at_barrier | read_only | mutating | compact_only`
- `tools/types.ts:153` `ToolResult` — handler return: success/output/data/pendingApproval/engineSignal/actionKind
- `tools/types.ts:197` `EngineSignal` — structured engine command emitted by handlers (stop_mission, defer_until, compact_committed, wait_for_parent, complete_subagent)
- `tools/taxonomy.ts:55` `ACTION_KINDS` const array + `ActionKind` union — 7 variants (read, local_write, schedule, approval_prepare, user_wallet_broadcast, external_post, destructive)
- `tools/taxonomy.ts:72` `assertExhaustiveActionKind` — compile-time exhaustiveness helper
- `tools/risk-level.ts:36` `RISK_LEVELS` + `RiskLevel` — 5 levels (info, low, medium, high, critical); ordered ascending
- `tools/risk-level.ts:70` `riskLevelFromActionKind` — exhaustive switch: read→info, local_write/schedule→low, approval_prepare/external_post→medium, user_wallet_broadcast→high, destructive→critical
- `tools/registry.ts:35` `ToolVisibilityContext` — per-turn filter context (permission, role, sessionKind, missionRunActive, contextUsageBand)
- `tools/registry.ts:49` `defaultVisibilityContext` — test convenience constructor
- `tools/registry.ts:81` `TOOLS: readonly ToolDef[]` — master concat of all domain arrays, order is LLM-priority order
- `tools/registry.ts:103` `getToolDef`, `isInternalTool`, `isMutatingTool`, `getPressureSafety`, `getActionKind`, `getAllTools` — lookup helpers
- `tools/registry.ts:156` `getVisibleToolDefs(ctx)` — 5-layer filter (requiresEnv, showOnlyWhenEnvMissing, proactive, excludeRoles, passesVisibility, passesPressureSafety)
- `tools/registry.ts:172` `getOpenAITools(ctx)` — thin wrapper over `getVisibleToolDefs` + `toOpenAITools` projection
- `tools/registry.ts:192` `passesPressureSafety` — drops `mutating` at barrier+, drops `compact_only` below barrier
- `tools/registry.ts:244` `isToolBlockedForRole` — hard role gate at dispatch
- `tools/registry.ts:273` `TOOL_MAP_CATEGORIES` — ordered system-prompt Tool Map; `getVisibleToolsByCategory` projects per context
- `tools/dispatcher.ts:36` `withActionKindFallback` — stamps `ToolResult.actionKind` from registry when handler did not set it
- `tools/dispatcher.ts:49` `checkPressureDeny(toolName, band)` — hard-deny at barrier+: `mutating` tools blocked, `compact_only` below barrier blocked; returns synthetic error or null
- `tools/dispatcher.ts:85` `dispatchTool(call, context)` — main entry; calls `checkPressureDeny`, then `routeToolCall`, then `withActionKindFallback`; never throws
- `tools/dispatcher.ts:136` `routeToolCall` — dispatches: discover_tools→`discoverProtocolCapabilities`; execute_tool→`executeProtocolTool`; role-block check; `routeInternalTool`
- `tools/dispatcher.ts:285` `routeInternalTool` — approval gate (`isMutatingTool && restricted && !approved` → `pendingApproval:true`); then lazy-loads handler from `INTERNAL_TOOL_LOADERS`
- `tools/dispatcher.ts:217` `INTERNAL_TOOL_LOADERS` — 33 entries, lazy dynamic imports; subagent entries commented out (see Open questions)
- `tools/internal/types.ts:22` `InternalToolContext` — all handler context: sessionId, loadedDocuments, sessionPermission, approved, role, missionRunId, missionId, sessionKind, contextUsageBand, sourceSurface, sourceSession, walletResolution, walletPolicy
- `tools/internal/types.ts:80` `str/num/bool/enumField/ok/fail` — param accessor and result helpers

### Registry domain arrays

- `tools/registry/protocol.ts:29` `PROTOCOL_TOOLS` — `discover_tools` (read/read_only), `execute_tool` (read/read_only, actionKind stamped by executeProtocolTool runtime)
- `tools/registry/khalani.ts:16` `KHALANI_INTERNAL_TOOLS` — 4 read aliases (chains_list, tokens_top, tokens_search, tokens_balances); derived from KHALANI_TOOLS manifest; assertion: manifest must not be mutating
- `tools/registry/web.ts:9` `WEB_TOOLS` — `web_research` (read/read_only, requires TAVILY_API_KEY)
- `tools/registry/twitter-account.ts:9` `TWITTER_ACCOUNT_TOOLS` — `twitter_account` (read/read_only, requires RETTIWT_API_KEY); 13 read-only actions; never posts/mutates
- `tools/registry/documents.ts:10` `DOCUMENT_TOOLS` — document_read (read/read_only), document_write (local_write/mutating), document_list (read/read_only), document_delete (destructive/mutating)
- `tools/registry/knowledge.ts:13` `KNOWLEDGE_TOOLS` — 8 tools; knowledge_write/supersede/update_status (local_write/mutating); knowledge_recall/recall_overflow/get/lineage/history (read/read_only); recall requires EMBEDDING service at runtime
- `tools/registry/portfolio.ts:8` `PORTFOLIO_TOOLS` — `portfolio_inspect` (read/read_only); 14 views; wallet-scoped except `executions`
- `tools/registry/setup.ts:19` `SETUP_TOOLS` — `polymarket_setup` (local_write/mutating, excludeRoles:subagent); idempotent per-wallet EIP-712 credential derivation
- `tools/registry/mission.ts:5` `MISSION_TOOLS` — `mission_draft_update` (local_write/mutating, requiresMissionSetup), `mission_stop` (local_write/safe_at_barrier, requiresMissionRun); both excludeRoles:subagent
- `tools/registry/autonomy.ts:26` `AUTONOMY_TOOLS` — `tool_output_read` (read/read_only), `loop_defer` (schedule/mutating, requiresMissionActiveRun, excludeRoles:subagent)
- `tools/registry/subagents.ts:14` `SUBAGENT_TOOLS` — empty array; all 6 entries commented out (`TODO(subagent-disabled)`)
- `tools/registry/evm.ts:8` `EVM_TOOLS` — `evm_read` (read/read_only); 4 actions (tx_receipt, erc721_mint, erc20_metadata, balance)
- `tools/registry/wallet.ts:10` `WALLET_TOOLS` — `wallet_read` (read/read_only), `wallet_send_prepare` (approval_prepare/mutating:false), `wallet_send_confirm` (user_wallet_broadcast/mutating:true)
- `tools/registry/compact.ts:15` `COMPACT_TOOLS` — `compact_now` (local_write/compact_only, visibility.band:barrier, excludeRoles:subagent)
- `tools/registry/memory.ts:21` `MEMORY_TOOLS` — `memory_recall` (read/read_only), `mark_outstanding_resolved` (local_write/read_only — classified read_only for pressure because resolving items at barrier is productive pre-compact work)

### Internal handlers — wallet group

- `tools/internal/wallet/send.ts:57` `handleWalletSendPrepare` — validates args, resolves address-only (no decrypt), creates `wallet_intents` row (TTL=10min), returns intentId; actionKind:approval_prepare; mutating:false
- `tools/internal/wallet/send.ts:131` `handleWalletSendConfirm` — session-scoped intent lookup → status/expiry/network check → **approval gate** (restricted+!approved → pendingApproval:true, intent stays pending for retry) → `resolveSigningWallet` (decrypt AFTER gate) → wallet-match assertion → **CAS-consume** `consumeIfPending` → EVM or Solana executor → `finalizeOutcome`; actionKind:user_wallet_broadcast; mutating:true
- `tools/internal/wallet/send-types.ts:14` `ExecuteOutcome` — discriminated union: `confirmed | chain_failed | confirmation_unknown | pre_broadcast_failed`; tx hash transported structurally, never extracted from opaque throw
- `tools/internal/wallet/send-types.ts:43` `summarizeWalletError` — structural error fingerprint `{errorKind, errorHash}` via SHA-256; raw error messages NEVER surface in transcript or approval logs
- `tools/internal/wallet/send-execute-evm.ts:22` `executeEvmTransfer` — Khalani chain registry → viem walletClient; native / ERC-20 / ERC-721; try/catch split pre-broadcast vs post-broadcast (chain_failed / confirmation_unknown)
- `tools/internal/wallet/send-execute-solana.ts:54` `executeSolanaTransfer` — SOL / SPL token (Jupiter token resolve); ATA existence check + atomic create+transfer if needed; `signAndSubmitLegacyTxStaged` staged submission; no hidden side-effect `getOrCreateAssociatedTokenAccount`
- `tools/internal/wallet/read.ts:41` `handleWalletRead` — Zod-validated args; calls `resolveSelectedAddress` per family; `getTokenBalancesAcrossChains` via Khalani; all-wallet snapshot aggregation
- `tools/internal/wallet/resolve.ts:54` `resolveSelectedAddress` — address-only, no key decrypt; validates session selection + mission policy; throws VexError on drift/mismatch/policy violation
- `tools/internal/wallet/resolve.ts:130` `resolveSigningWallet` — decrypts key; same selection + policy validation PLUS `loadWalletFromEntry`; only called in confirm AFTER approval gate
- `tools/internal/wallet/resolve.ts:88` `resolveSelectedAddressSet` — resolves both EVM+Solana addresses for read-side scoping; empty set → no rows (never global); invalid policy fails closed first
- `tools/internal/wallet/resolve.ts:144` `walletScopeErrorToResult` — converts VexError → fail-closed ToolResult; re-throws unexpected non-VexErrors

### Internal handlers — autonomy / loop-defer

- `tools/internal/loop-defer.ts:62` `handleLoopDefer` — Zod validation (after_ms XOR wake_at, bounds 1s–24h, reason ≤500 chars) → runtime guard (`isMissionRunContext`) → `MISSION_ACTIVATION_WAIT_PATTERN` anti-hallucination check → `loopWakeRepo.enqueue` (one-pending-per-session partial unique; returns null on conflict) → returns `engineSignal:{type:"defer_until",dueAt,...}`; actionKind:schedule
- `tools/internal/loop-defer.ts:129` `isMissionRunContext` — returns true only when `role !== "subagent"` AND `sessionKind === "mission"` AND `missionRunId !== null`

### Internal handlers — compaction

- `tools/internal/compact/now.ts:56` `handleCompactNow` — Zod-validated args (conversation_summary, preserve_md, thread_themes_hints) → `executeCompactNow` → on committed: `engineSignal:{type:"compact_committed",generation,jobId}`; on noop: no signal, success with `{noop:true}`; visible only at band≥barrier (pressureSafety:compact_only)

### Internal handlers — knowledge

- `tools/internal/knowledge.ts:1` barrel re-exports from `./knowledge/{write,recall,get,update-status,supersede,lineage,history}.ts`
- `tools/internal/knowledge/write.ts` — Zod params, embed title+summary, insert `knowledge_entries`; English-only content; provenance tier determines hot-context eligibility (observed/user_confirmed→Active Knowledge; inferred/hypothesis→recall-only)
- `tools/internal/knowledge/supersede.ts` — atomic supersede: flip old row to `superseded` + insert new row; rejects identical content or non-active predecessor
- `tools/internal/knowledge/recall.ts` — embed query → `recallTopK`; overflow cache (15-min TTL); ACTIVE-ONLY by design
- `tools/internal/knowledge/get.ts` — fetch by id, no embedding required
- `tools/internal/knowledge/update-status.ts` — terminal lifecycle (invalidated/archived); irreversible; no re-activation path
- `tools/internal/knowledge/lineage.ts` — trace root→head version chain from any id; no embedding required
- `tools/internal/knowledge/history.ts` — non-active entry browsing by kind/status/limit; NOT semantic search

### Internal handlers — memory (per-session)

- `tools/internal/memory/recall.ts:45` `handleMemoryRecall` — Zod validation; empty-store short-circuit via `getSessionMemoryStats`; embed query → `recallTopK` on `session_memories`; scoped to caller's sessionId only
- `tools/internal/memory/mark-resolved.ts:38` `handleMarkOutstandingResolved` — Zod validation; session ownership check; `redact(resolution_note)` BEFORE DB write (symmetric with Track 2 redaction); `markOutstandingResolved` → re-embed → `updateEmbedding` with body_md_hash CAS (concurrent-resolution-safe); embedding failure is non-fatal (body persists, vector stale)

### Internal handlers — mission

- `tools/internal/mission.ts:48` `handleMissionDraftUpdate` — defense-in-depth session kind check; Zod-validated patch; `applyMissionPatch` → returns status/ready/missingFields/nextCommand ("`/mission start`" or "`/mission continue`" based on run history)
- `tools/internal/mission.ts:90` `handleMissionStop` — validates missionRunId; validates stop reason via `authorizeMissionStopReason` (goal_reached and emergency_stop bypass contract check); returns `engineSignal:{type:"stop_mission",reason,...}`

### Internal handlers — subagents (DISABLED)

- `tools/internal/subagent.ts:1` barrel re-exports from `./subagent/{parent,child,lifecycle}.ts`
- `tools/internal/subagent/lifecycle.ts:18` `activeSubagents: Map<string,ActiveSubagent>` — in-memory tracking; `startSubagentExecution` fire-and-forget via `runSubagentEngine`; `validateOwnership` session-link guard
- `tools/internal/subagent/parent.ts` — `handleSubagentSpawn` (permission inheritance: restricted parent always produces restricted child; full parent only broadens if `allow_trades===true`), `handleSubagentStatus`, `handleSubagentStop`, `handleSubagentReply`
- `tools/internal/subagent/child.ts` — `handleSubagentRequestParent` (emits `wait_for_parent` signal), `handleSubagentReportComplete` (emits `complete_subagent` signal)
- NOTE: all 6 `INTERNAL_TOOL_LOADERS` entries are commented out; `SUBAGENT_TOOLS` registry array is empty. Code is complete and tested but disabled for MVP scope.

### Internal handlers — portfolio inspect

- `tools/internal/portfolio-inspect.ts:45` `handlePortfolioInspect` — 14-view router; wallet-scoped views (13) call `resolveSelectedAddressSet` first — empty set → zero rows, never global; `executions` view unscoped (global protocol audit log)
- `tools/internal/inspect-views/portfolio.ts` — summary (FIFO lots + prediction MTM unrealized), balances, snapshots (7-day aggregate), executions (protocol_executions)
- `tools/internal/inspect-views/positions.ts` — open_positions, closed_positions, orders (proj_open_positions)
- `tools/internal/inspect-views/activity.ts` — activity, bridges, lp_history, non_trading_history (proj_activity)
- `tools/internal/inspect-views/trading.ts` — lots (proj_pnl_lots), profits (proj_pnl_matches grouped), unrealized (lots × proj_balances current price)

## Key types & invariants

- `ToolDef` (`tools/types.ts:67`) — `pressureSafety` and `actionKind` are REQUIRED (compiler-enforced); every new tool MUST be deliberately classified at registration time
- `ActionKind` (`tools/taxonomy.ts:65`) — derived from `ACTION_KINDS as const` array; 7 variants; adding a variant widens the type and forces exhaustive switch updates
- `RiskLevel` (`tools/risk-level.ts:44`) — derived from `RISK_LEVELS as const`; ordered ascending; `riskLevelFromActionKind` exhaustive switch enforces mapping at compile time
- `ToolVisibilityContext` (`tools/registry.ts:35`) — rebuilt per turn; `permission` and `sessionKind` immutable for session lifetime; `missionRunActive` and `contextUsageBand` recomputed each turn
- `InternalToolContext` (`tools/internal/types.ts:22`) — `walletResolution` + `walletPolicy` threaded to every handler; policy kind "invalid" always fails closed before any wallet operation
- `ExecuteOutcome` (`tools/internal/wallet/send-types.ts:14`) — discriminated union; post-broadcast tx hash lives in `txHash` field, never extracted from an opaque throw
- `EngineSignal.type` (`tools/types.ts:197`) — closed union; `compact_committed` carries `generation`+`jobId`; `defer_until` carries `dueAt`; turn-loop switches exhaustively on these
- Approval gate invariant: `isMutatingTool && sessionPermission === "restricted" && !approved` → `pendingApproval:true`, `intent.status` stays `pending`; the same intent is consumed on re-dispatch after operator approves
- CAS-consume invariant: `wallet_send_confirm` calls `consumeIfPending` atomically; race losers get null and receive a descriptive fail result; status audit trail continues via `markFailed` / `markExecuted` / `markAuditFailed`
- `summarizeWalletError` invariant: raw error messages MUST NOT surface in any `ToolResult.output`, approval log, or transcript. All error surfaces use the `{errorKind, errorHash}` fingerprint exclusively
- `resolveSigningWallet` called ONLY inside `handleWalletSendConfirm`, AFTER approval gate, and AFTER wallet-match assertion — no other handler decrypts a key
- `loop_defer` one-pending-per-session: enforced at DB level (partial unique index migration 011); handler surfaces null return as soft fail, not an exception
- `compact_now` noop: returns success with `{noop:true}` and NO `engineSignal` — turn-loop must not treat this as a committed compact
- subagent permission inheritance invariant: child permission = `full` only if `parent.permission === "full" && allow_trades === true`; restricted parent ALWAYS produces restricted child

## Capabilities (stable IDs)

- **CAP-tools-core-registry-filter**: Filter TOOLS array for a visibility context; ensures LLM-visible catalog and system-prompt Tool Map never drift — `tools/registry.ts:156 getVisibleToolDefs`
- **CAP-tools-core-dispatch**: Route any tool call to the correct handler; apply pressure hard-deny, approval gate, actionKind fallback stamp — `tools/dispatcher.ts:85 dispatchTool`
- **CAP-tools-core-pressure-deny**: Hard-deny mutating tools at band barrier/critical; hard-deny compact_only below barrier — `tools/dispatcher.ts:49 checkPressureDeny`
- **CAP-tools-core-approval-gate**: Gate mutating internal tools on `sessionPermission === "restricted" && !approved`; return `pendingApproval:true` — `tools/dispatcher.ts:293 routeInternalTool`
- **CAP-tools-core-action-kind-stamp**: Stamp `ToolResult.actionKind` from registry fallback when handler did not set it — `tools/dispatcher.ts:36 withActionKindFallback`
- **CAP-tools-wallet-read**: Read live token balances across EVM+Solana via Khalani — `tools/internal/wallet/read.ts:41 handleWalletRead`
- **CAP-tools-wallet-prepare**: Create DB-backed transfer intent (no key decrypt, no broadcast); return intentId with TTL — `tools/internal/wallet/send.ts:57 handleWalletSendPrepare`
- **CAP-tools-wallet-confirm**: Approval-gated, CAS-consuming transfer broadcast; EVM or Solana execution; raw errors fingerprinted — `tools/internal/wallet/send.ts:131 handleWalletSendConfirm`
- **CAP-tools-wallet-resolve-address**: Resolve session-selected wallet address without key decrypt; enforce mission policy — `tools/internal/wallet/resolve.ts:54 resolveSelectedAddress`
- **CAP-tools-wallet-resolve-signer**: Resolve + decrypt signing wallet; enforce mission policy; only called post-approval-gate — `tools/internal/wallet/resolve.ts:130 resolveSigningWallet`
- **CAP-tools-loop-defer-schedule**: Enqueue a timed wake row + emit `defer_until` engine signal; validates mission-run context; one-pending enforced at DB level — `tools/internal/loop-defer.ts:62 handleLoopDefer`
- **CAP-tools-compact-now**: Agent-driven compaction at pressure band≥barrier; emits `compact_committed` engine signal with generation+jobId — `tools/internal/compact/now.ts:56 handleCompactNow`
- **CAP-tools-knowledge-write**: Write + embed new cross-session knowledge entry with provenance tier — `tools/internal/knowledge/write.ts handleKnowledgeWrite`
- **CAP-tools-knowledge-supersede**: Atomic version replacement of a knowledge entry — `tools/internal/knowledge/supersede.ts handleKnowledgeSupersede`
- **CAP-tools-knowledge-recall**: Embed-query semantic recall over ACTIVE knowledge entries — `tools/internal/knowledge/recall.ts handleKnowledgeRecall`
- **CAP-tools-knowledge-lifecycle**: Terminal status transitions (invalidated/archived) — `tools/internal/knowledge/update-status.ts handleKnowledgeUpdateStatus`
- **CAP-tools-knowledge-lineage**: Trace knowledge version chain root→head — `tools/internal/knowledge/lineage.ts handleKnowledgeLineage`
- **CAP-tools-memory-recall**: Embed-query semantic recall over THIS session's narrative chunks — `tools/internal/memory/recall.ts:45 handleMemoryRecall`
- **CAP-tools-memory-mark-resolved**: Close outstanding item on session memory chunk; re-embed body; concurrent-resolution-safe — `tools/internal/memory/mark-resolved.ts:38 handleMarkOutstandingResolved`
- **CAP-tools-mission-draft-update**: Persist mission draft fields during setup — `tools/internal/mission.ts:48 handleMissionDraftUpdate`
- **CAP-tools-mission-stop**: Authorize + signal mission stop; validates against accepted contract for non-emergency reasons — `tools/internal/mission.ts:90 handleMissionStop`
- **CAP-tools-subagent-spawn**: Spawn child agent session with inherited permission; fire-and-forget execution — `tools/internal/subagent/parent.ts handleSubagentSpawn` (**DISABLED**)
- **CAP-tools-subagent-lifecycle**: In-memory tracking, ownership guard, run/finalize of subagent sessions — `tools/internal/subagent/lifecycle.ts` (**DISABLED**)
- **CAP-tools-portfolio-inspect**: 14-view read-only portfolio inspection; wallet-scoped except executions — `tools/internal/portfolio-inspect.ts:45 handlePortfolioInspect`

## Public API (consumed by)

| Consumer | Entry point |
|---|---|
| `src/vex-agent/engine/core/runner/agent.ts` | `getOpenAITools(ctx)` — build tool array per turn |
| `src/vex-agent/engine/core/runner/setup-turn.ts` | `getOpenAITools(ctx)` — build tools per band in mission setup |
| `src/vex-agent/engine/core/runner/mission-run.ts` | `getOpenAITools(ctx)` — build tools per band in mission run |
| `src/vex-agent/engine/subagents/runner.ts` | `getOpenAITools(ctx)` — build tools for subagent turn |
| `src/vex-agent/engine/core/turn-loop-tool-batch.ts` | `dispatchTool(call, context)` — dispatch each tool call in batch |
| `src/vex-agent/engine/core/run-tool.ts` | `dispatchTool(...)` — single tool dispatch wrapper |
| `src/vex-agent/engine/core/approval-runtime/post-tx.ts` | `dispatchTool(...)` — re-dispatch approved tool after operator confirmation |
| `src/vex-agent/engine/prompts/tool-catalog.ts` | `getOpenAITools` / `getVisibleToolsByCategory` — build system-prompt Tool Map section |
| `src/vex-agent/engine/core/runner/shared.ts` | `toToolDefinitions(getOpenAITools(...))` — adapter to engine ToolDefinition[] |

No consumers exist in `vex-app/src` (tool dispatch is engine-internal). The `wallet_send_prepare` tool name appears in `vex-app/src/main/database/__tests__/approval-intents-projection.test.ts` only as a test fixture string.

## Internal flow

### Tool dispatch (per tool call in a turn)

```
turn-loop-tool-batch.ts: dispatchTool(call, context)
  │
  ├─ checkPressureDeny(call.name, band)      ← soft catalog filter already ran; this is hard gate
  │    barrier/critical + mutating → return synthetic error (agent directed to compact_now)
  │    !barrier + compact_only    → return synthetic error
  │    null                       → proceed
  │
  └─ routeToolCall(call, context)
       ├─ "discover_tools" → discoverProtocolCapabilities(...)
       ├─ "execute_tool"   → executeProtocolTool(...) [actionKind stamped by TARGET manifest]
       ├─ isToolBlockedForRole → hard role reject
       ├─ !isInternalTool  → "Unknown tool" error
       └─ routeInternalTool(call, context)
            ├─ isMutatingTool && restricted && !approved → {pendingApproval:true} [intent stays pending]
            └─ loader() → handler(call.args, context) → ToolResult
  │
  └─ withActionKindFallback(result, call.name) ← stamp actionKind from registry if handler omitted it
```

### wallet_send_prepare → wallet_send_confirm flow

```
handleWalletSendPrepare:
  validate args (network/to/amount; chain required for eip155)
  resolveSelectedAddress(resolution, policy, network)  ← address only, no decrypt
  randomUUID() → intentId, expiresAt = now + 10min
  walletIntentsRepo.create({intentId, sessionId, walletAddress, ...})
  return {intentId, status:"prepared", expiresAt, ...}

handleWalletSendConfirm (later turn, same session):
  walletIntentsRepo.getById(intentId, sessionId)       ← session-scoped: cross-session → null
  intent.network === params.network check
  intent.status === "pending" check
  intent.expiresAt > now check
  approval gate: restricted && !approved → {pendingApproval:true, intent stays pending}
  resolveSigningWallet(resolution, policy, network)    ← DECRYPT after gate
  walletAddressesEqual(signer.address, intent.walletAddress) ← wallet-match before CAS
  walletIntentsRepo.consumeIfPending(intentId, sessionId)  ← atomic CAS; race losers → null
  executeEvmTransfer(intent, signer) OR executeSolanaTransfer(intent, signer)
    → ExecuteOutcome {confirmed | chain_failed | confirmation_unknown | pre_broadcast_failed}
  finalizeOutcome → markExecuted / markFailed / markAuditFailed + ToolResult
  ALL errors → {errorKind, errorHash} fingerprint; raw messages NEVER in output
```

### loop_defer flow

```
handleLoopDefer:
  LoopDeferArgs.safeParse (after_ms XOR wake_at; bounds; reason)
  isMissionRunContext(ctx) defense-in-depth check
  MISSION_ACTIVATION_WAIT_PATTERN anti-hallucination check on reason
  dueAt = now + after_ms OR Date.parse(wake_at)
  loopWakeRepo.enqueue({sessionId, missionRunId, dueAt, reason})
    → null if partial-unique conflict (one-pending-per-session)
  return {success:true, engineSignal:{type:"defer_until", dueAt, ...}}

Engine turn-loop on defer_until signal:
  → flips mission run to paused_wake
  → wake executor (Z2) polls loop_wake_requests, resumes at dueAt
```

### compact_now flow

```
handleCompactNow:
  CompactNowSchema.safeParse (conversation_summary, preserve_md, thread_themes_hints)
  executeCompactNow({sessionId, agentSummary, preserveMd, threadThemesHints, source:"agent_tool"})
    → {kind:"committed"} → engineSignal:{type:"compact_committed", generation, jobId}
    → {kind:"noop"}      → success + {noop:true}, NO engineSignal

Engine turn-loop on compact_committed signal:
  → drains remaining batch with batch_aborted_by_compact
  → reloads live messages
  → merges operator interrupts
  → updates mission_runs.last_checkpoint_at
  → injects deterministic resume packet for POST_COMPACT_BRIDGE_CYCLES turns
```

## Dependencies

**Imports FROM:**
- Z2 (`module.vex-agent.engine-wake-subagents-prompts`): `executeCompactNow` (compact-jobs/service), `applyMissionPatch` (engine/mission/setup), `authorizeMissionStopReason` / `isModelMissionStopReason` (engine/mission/stop-contract), `runSubagentEngine` (engine/subagents/runner — disabled path)
- Z4 (`module.vex-agent.data-memory-knowledge`): DB repos — wallet-intents, loop-wake, knowledge, session-memories, documents, balances, open-positions, pnl-lots, pnl-matches, activity, executions, subagents, session-links, sessions, subagent-messages; embeddings client
- Z5 (`@tools/wallet/*`): `multi-auth` (resolveSelectedEntry, loadWalletFromEntry, WalletResolution), `inventory` (walletAddressesEqual, familyToInventory); `khalani/evm-client`, `khalani/chains`, `khalani/balances`, `khalani/client`; `solana-ecosystem/shared/*`, `solana-ecosystem/jupiter/jupiter-tokens`
- Z5 (`@utils/logger`): structured logging throughout
- Z1 (`module.vex-agent.engine-runner`): engine types (Permission, SessionKind, WalletPolicy, BusinessStopReason)
- External: `viem` (EVM signing/receipts), `@solana/web3.js`, `@solana/spl-token`, `zod` (handler schemas)

**Consumed BY:**
- Z1 (`module.vex-agent.engine-runner`): turn-loop-tool-batch, run-tool, approval-runtime/post-tx call `dispatchTool`; runner/* call `getOpenAITools`; prompts/tool-catalog calls visibility helpers
- Z2 (`module.vex-agent.engine-wake-subagents-prompts`): subagents/runner calls `getOpenAITools`

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-tools-wallet-confirm` (approval card wired in F3, commit 0430072)
- related flows: `FLOW-chat-turn` (tool dispatch per turn), `FLOW-approval-restricted-resume` (pendingApproval path through approval-runtime/post-tx back to dispatchTool), `FLOW-loop-defer-wake` (loop_defer → wake executor)
- related decisions: `decisions/ADR-0001-global-model-session-wallet` (per-session wallet selection invariant)
- wallet intent schema: `src/vex-agent/db/repos/wallet-intents.ts` (mig 025, wallet_intents table)
- loop wake schema: `src/vex-agent/db/repos/loop-wake.ts` (mig 011, partial unique index)
- approval DB: `src/vex-agent/db/repos/approvals.ts` + `approval-intents.ts` (mig 024, action_kind CHECK constraint consumes ActionKind enum)
- protocols (out of scope): `src/vex-agent/tools/protocols/**` — separate `module.vex-agent.tools-protocols` agent

## Refresh triggers

Stale when any of the following change:

- Any file under `src/vex-agent/tools/` (registry, dispatcher, types, taxonomy, risk-level, registry/*, internal/*)
- `src/vex-agent/db/repos/wallet-intents.ts` (intent schema/CAS methods)
- `src/vex-agent/db/repos/loop-wake.ts` (enqueue/conflict behavior)
- `src/vex-agent/engine/types.ts` (Permission, SessionKind, WalletPolicy, BusinessStopReason)
- `src/vex-agent/engine/compact-jobs/service.ts` (executeCompactNow signature/return)
- `src/tools/wallet/multi-auth.ts` (WalletResolution shape, resolveSelectedEntry, loadWalletFromEntry)

## Open questions

1. **Subagent tools disabled (intentional MVP scope)**: `SUBAGENT_TOOLS` is an empty array and all 6 `INTERNAL_TOOL_LOADERS` entries are commented out with `TODO(subagent-disabled)`. The runtime code in `subagent/{parent,child,lifecycle}.ts` and `engine/subagents/runner.ts` is complete. Re-enabling requires uncommenting both the registry array entries (`tools/registry/subagents.ts`) AND the loader map entries (`tools/dispatcher.ts`). This is intentional — not a finding.

2. **`tool_output_read` blob TTL**: The `tool_output_blobs` table is used for overflow storage but the TTL enforcement mechanism is not visible in this module scope. Callers receive `blob_key` stubs; handler reads the blob without checking expiry inline. Confirm TTL cleanup is handled elsewhere (Z4 or a scheduled cleanup job).

3. **`portfolio_inspect` `executions` view is unscoped**: The `executions` view reads `protocol_executions` globally — no wallet_address filter. This is documented as a known design choice ("global protocol audit log") but may expose execution metadata from other sessions. Evaluate whether session-scoping is needed when privacy requirements are finalized.

4. **`mark_outstanding_resolved` actionKind is `local_write` but `pressureSafety` is `read_only`**: This is intentional — the pressure classification allows the tool at barrier/critical because closing outstanding items before compact is productive. Document this asymmetry explicitly for reviewers: `mutating:false, pressureSafety:read_only, actionKind:local_write` is a valid and deliberate combination.

5. **Solana ATA creation as hidden side effect**: `executeSolanaTransfer` atomically creates the destination ATA if it does not exist, funded by the signer. This is documented and intentional (single-signature atomicity), but the ATA creation fee is drawn from the signer's SOL balance without explicit user confirmation. The intent preview shown to the user (`buildWalletIntentPreview`) does not mention ATA creation cost. Consider surfacing this in the prepare response when a new ATA would be created.
