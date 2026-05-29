---
id: module.vex-app.renderer-appshell-runtime
kind: module
title: Renderer AppShell + Chat Runtime Layer
description: Active-session UI orchestration, chat transcript, approvals, composer, slash commands, and TanStack Query integration for the Vex Electron renderer.
paths:
  - vex-app/src/renderer/App.tsx
  - vex-app/src/renderer/main.tsx
  - vex-app/src/renderer/vex.d.ts
  - vex-app/src/renderer/app/queryClient.ts
  - vex-app/src/renderer/features/appShell/
  - vex-app/src/renderer/stores/uiStore.ts
  - vex-app/src/renderer/stores/streamStore.ts
  - vex-app/src/renderer/lib/api/
related:
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.main-agent-bridge
  - module.vex-app.renderer-onboarding-bootstrap-secrets
  - module.vex-agent.engine-runtime-events
  - fix-plan.F3
  - audit.current.quality-findings
  - ADR-0001-global-model-session-wallet
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/src/renderer/**
  - vex-app/src/preload/**
  - vex-app/src/shared/schemas/**
  - vex-app/src/shared/types/bridge.ts
  - src/vex-agent/engine/events.ts
  - src/vex-agent/repos/runtime-control-state.ts
  - src/vex-agent/approvals/**
---

# Renderer AppShell + Chat Runtime Layer

## Purpose

This module owns the active-session UI layer of the Vex desktop app: the multi-session shell, live chat transcript rendering, streaming message preview, approval cards, slash command parsing and dispatch, and all TanStack Query integration for real-time data synchronization between the Electron renderer and the backend runtime.

The renderer remains **untrusted UI** and must not import `src/vex-agent`, Node/Electron privileged APIs, DB, Docker, wallet, or signing authority. All backend calls flow exclusively through `window.vex.*` IPC bridge methods. The module enforces strict process boundaries and maintains a single source of truth for domain data in TanStack Query.

---

## Retrieval Keywords

- AppShell multi-session shell, session sidebar, session panel
- SessionPanel active session orchestration, no-session welcome
- SessionTranscript transcript rendering, infinite paging, 500-node cap
- ApprovalsRegion, ApprovalCard F3 two-step confirm, 5s polling
- SessionComposer chat input, quick actions, error notices
- Slash commands /mission, /rewind, /restore, /mission-renew, /retry
- TanStack Query cache, queryKeys, invalidation patterns
- StreamStore ephemeral preview, token-by-token streaming
- uiStore Zustand routing, activeSessionId, appShellView
- F3 approval card UX evidence, F5 control-state bridge RESOLVED (Bundle B): onControlState push + 5s fast fallback, F9 transcript virtualization
- Window.vex IPC bridge, preload contract, renderer-main boundary

---

## State Owned

### Zustand Stores

**uiStore** (`stores/uiStore.ts`)
- `currentView`: top-level route (splash → systemCheck → ... → appShell)
- `activeSessionId`: currently selected session in the shell sidebar (null = welcome hero)
- `appShellView`: sub-view of the panel area (session | sessionsLibrary | knowledge)
- `createSessionOpen`: state of the new-session modal + initial message draft
- `pendingFirstMessage`: session id + message handed off from create dialog to composer
- `sessionModeFilter`: filter sidebar rows (all | agent | mission)
- `sidebarOpen`: sidebar visibility (desktop only)
- **Persisted:** `sidebarOpen` only; session selection and views are launch-ephemeral

**streamStore** (`stores/streamStore.ts`, Stage 9-3)
- `bySessionId[sessionId]`: ephemeral `StreamPreview` (id, text, phase, toolName)
- Populated by `useStreamPreviewSync` → `onStreamDelta` IPC events
- Cleared when transcript-append event arrives (persisted message replaces preview)
- Orphan net: auto-clear after 60s idle (STREAM_PREVIEW_IDLE_MS)
- **Never persisted** — agent traces must not be written to disk

### TanStack Query Cache (per `lib/api/queryKeys.ts`)

**messagesKeys**: infinite transcript per session
- `forSession(sessionId)`: prefix for all message queries (used by invalidation)
- `infinite(sessionId, limit)`: newest page first, paging backward via cursor
- Invalidated by `useTranscriptLiveSync` on `EV.engine.transcriptAppend` + 30s fallback poll
- **500-node cap:** MAX_TRANSCRIPT_PAGES = 10, DEFAULT_LIMIT = 50 per page → 10 × 50 = 500 nodes max (F9)

**sessionsKeys**: list + detail per session
- `list()`: sidebar rows (invalidated on create/delete/pin mutations)
- `detail(id)`: session metadata (invalidated when selecting a session)

**approvalsKeys**: pending + history + detail
- `pending(sessionId)`: array of pending approval summaries (polled every 5s by ApprovalsRegion, F3)
- `history(sessionId, limit)`: resolved approvals audit trail
- Invalidated on approve/reject mutation success

**runtimeKeys, usageKeys, compactionKeys, missionKeys, knowledgeKeys, memoryKeys, modelsKeys, walletsKeys**
- All scoped by sessionId, model, or capability
- Auto-invalidated on relevant mutations or invalidation cascades

**queryClient** defaults (`app/queryClient.ts`)
- staleTime: 5s (conservative, favors freshness)
- gcTime: 5 min
- retry: 1 for queries, 0 for mutations (dangerous actions never auto-retry)

### Session Context & Browser Lifecycle

**Focus management:** ApprovalCard uses `useRef<HTMLButtonElement>` to focus the Reject button on initial mount when `focusOnMount === true` (empty deps → fires only once per card instance).

**Scroll pinning:** SessionTranscript pins to the bottom when user is within 48px of the bottom; loads older pages when within 64px of the top. Scroll position is restored after a load-older prepend via height delta calculation.

---

## Boundary Crossings

### Renderer → Backend (All IPC)

All backend calls are method calls on `window.vex.*`, never direct HTTP or Node APIs:

| Domain | Method | Source |
|--------|--------|--------|
| **Chat** | `chat.submit(input)` → stream chunks + cancel handle | `lib/api/chat.ts` |
| **Sessions** | `sessions.list()`, `sessions.get(id)`, `sessions.create(input)`, `sessions.delete(id)`, `sessions.setPinned(id, pinned)` | `lib/api/sessions.ts` |
| **Messages** | `messages.list({ sessionId, cursor, limit })` | `lib/api/messages.ts` |
| **Approvals** | `approvals.listPending(sessionId)`, `approvals.get(id)`, `approvals.getHistory(sessionId, limit)`, `approvals.approve/reject(id)` | `lib/api/approvals.ts` |
| **Runtime** | `runtime.getState(sessionId)`, `runtime.requestPause/Stop/Resume(sessionId)`, `runtime.cancelWake(sessionId)` | `lib/api/runtime.ts` |
| **Mission** | `mission.getDraft(sessionId)`, `mission.start/continue/recover/stop(sessionId)`, `mission.rewind/restore/renew(sessionId)`, `mission.getDiff(sessionId, missionId)`, `mission.getRenewableSource(sessionId)`, `mission.updateDraft(sessionId, draft)` | `lib/api/mission.ts` |
| **Usage** | `usage.sessionTotals/lastTurn/contextWindow(sessionId)` | `lib/api/usage.ts` |
| **Compaction** | `compaction.status(sessionId)`, `compaction.history(sessionId)` | `lib/api/compaction.ts` |
| **Knowledge** | `knowledge.list(status)`, `knowledge.add/remove(knowledgeId)` | `lib/api/knowledge.ts` |
| **Memory** | `memory.sessionList(sessionId)`, `memory.stats(sessionId)`, `memory.mark/unmark/delete(sessionId, id)` | `lib/api/memory.ts` |
| **Models** | `models.listAvailable()` | `lib/api/models.ts` |
| **Wallets** | `wallets.listAvailable()`, `wallets.sessionScope(sessionId)`, `wallets.preparedIntent(sessionId, intentId)` | `lib/api/wallets.ts` |
| **System** | `system.health()` | `lib/api/system.ts` |
| **Capabilities** | `capabilities.get()` | Dev diagnostics only |

### Backend → Renderer (Subscriptions)

Three live-event subscriptions (engine spine) via `window.vex.engine` (F5 RESOLVED Bundle B added `onControlState`):

| Event | Handler | Impact |
|-------|---------|--------|
| `onStreamDelta(event)` | Applied to `streamStore` in `useStreamPreviewSync` | Accumulates ephemeral preview text/tool/phase |
| `onTranscriptAppend(event)` | Invalidates `messagesKeys.forSession()` + clears matching preview | Fetches and renders persisted transcript row |
| `onControlState(event)` | `useControlStateLiveSync` invalidates `runtimeKeys.state()` + `approvalsKeys.pending()` (re-validated at preload via `controlStateEventSchema`) | Push-refreshes runtime status + pending approvals; 5s ApprovalsRegion poll is the fast fallback |

---

## File Map

### Top-Level Routing

- **App.tsx** (48 lines): View dispatch machine (splash → systemCheck → ... → appShell)
  - `views[currentView]()` dispatch, dev-only M0 diagnostics panel
- **main.tsx** (123 lines): React root + QueryClientProvider + error reporting (unhandledrejection + error boundary)
  - Deduped auto-reports via `safeSupportReport` / `safeSentryReport`
- **vex.d.ts** (24 lines): `window.vex: VexBridge` type declaration + `__VEX_APP_VERSION__` injection

### Shell Architecture

- **AppShell.tsx** (129 lines): Layout orchestration, health indicator footer, create-session modal
  - SessionsList (sidebar) + appShellView routing (session | sessionsLibrary | knowledge)
  - Runtime status color indicator (online / degraded / unavailable)
- **SessionsList.tsx** (180+ lines): Sidebar: sessions grouped by mode/status, filter controls, pin/delete, create button
  - Uses ResizeObserver for virtualization budgeting; `computeVisibleGroups` limits rendered rows
  - Filters via `filterSessionsByMode`; groups via `groupSessions`
- **SessionRows.tsx**: Shared UI components for session rows (icons, delete dialog, etc.)
- **SessionCreator.tsx**: Modal form for new session creation (mode + wallet selection)

### Active Session (SessionPanel Cluster)

- **SessionPanel.tsx** (126 lines): Orchestration—branches on activeSessionId
  - No session → welcome hero + composer; selected session → header + mission card (if applicable) + transcript + approvals + composer
  - Mounts live-sync hooks: `useTranscriptLiveSync`, `useUsageLiveSync`, `useStreamPreviewSync`, `useControlStateLiveSync` (F5 RESOLVED Bundle B — invalidates `runtimeKeys.state(sessionId)` + `approvalsKeys.pending(sessionId)` on each `EV.engine.controlState` event; 30s runtime-state fallback interval)
  - Renders sub-components: SessionContext, MissionContractCard, SessionTranscript, ApprovalsRegion, SessionComposer

#### Transcript & Streaming

- **SessionTranscript.tsx** (250+ lines): Infinite-scrolling chat display
  - Pages via `useTranscriptInfinite` (newest first, older via cursor)
  - **CAP AT 500 NODES:** MAX_TRANSCRIPT_PAGES=10 × DEFAULT_LIMIT=50 (F9: no virtualization)
  - Scroll pinning: 48px threshold for bottom-follow, 64px for load-older
  - Renders loading spinner (DotmHex3) / error / empty / list
  - Each row rendered by `TranscriptMessage`; preview bubble by `StreamingBubble`
- **TranscriptMessage.tsx**: Switches on `TranscriptRowVariant` (user | assistant | tool | notice | compaction | recall | assistant_stopped)
  - Safe markdown rendering for assistant role; plain text for others
- **StreamingBubble.tsx**: Renders in-flight stream preview (text + optional tool-name indicator)
- **transcriptRowModel.ts** (107 lines): Pure presentation model mapping DTO role/kind → variant
  - Exhaustive switch over `MessageKind` ensures new kinds fail the build

#### Approvals (F3 Evidence)

- **ApprovalsRegion.tsx** (106 lines): Inline approval container between transcript and composer
  - **5s refetch** (REFETCH_INTERVAL_MS = 5_000) — F5 RESOLVED (Bundle B): now a FAST FALLBACK, not a workaround. Push via `useControlStateLiveSync` (mounted in SessionPanel) is primary; the 5s poll catches events dropped at the preload Zod gate or fired before the renderer subscribed (controlState emit is post-commit on lease release, not part of the approval transaction)
  - Bounded height (max-h-[40vh]) so multiple pending cards don't push composer off-screen
  - Tracks seen approval IDs in ref; focuses only the FIRST newly-appearing card
  - Errors surface inline via `kind: "error"`
- **ApprovalCard.tsx** (306 lines): **F3 TWO-STEP CONFIRM** for high-risk
  - `isHighRisk = riskLevel ∈ {high, critical} OR actionKind ∈ {destructive, user_wallet_broadcast}`
  - First click arms state; second within CONFIRM_RESET_MS (4s) fires; timeout resets
  - Focus starts on Reject button (least destructive, per UX skill)
  - On approve/reject success: invalidates pending → history (prefix match) → messages → runtime
  - Inline error display (not misleading success)
  - `aria-live="polite"` for screen readers
- **ConfirmDestructiveDialog.tsx**: Modal confirmation for slash commands marked `destructive: true` (rewind, restore, mission-renew)

#### Composer & Slash Commands

- **SessionComposer.tsx** (250+ lines): Chat input, auto-grow textarea, slash dispatch, quick actions, notices
  - Sends to `useSubmitChat` (IPC) on plain text OR dispatches via `useSlashCommandDispatch` on recognized slash command
  - First message hand-off: `pendingFirstMessage` from SessionCreator flows through normal submit on mount (reuses success/error UX)
  - Gating: free-text disabled in certain runtime states (mission-running, paused, etc.); read from `readRunStatus(runtimeQuery.data)`
  - Quick actions (QUICK_ACTIONS) hidden in mission mode
  - Composer notice displays result tone (info | error)
  - Confirmation dialog shown for destructive commands
- **composer-helpers.ts**: Pure utilities (gating reasons, placeholders, confirm labels)
- **composer-quick-actions.ts**: Preset quick-action chips
- **SlashCommandMenu.tsx**: Dropdown menu of slash command hints (filtered by current draft text)

##### Slash Command Pipeline

- **slash/types.ts** (70 lines): Discriminated union `SlashCommand` (mission-start | mission-continue | mission-recover | mission-stop | retry | rewind | restore | mission-renew | mission-edit) + `ParseResult` + `DispatchOutcome`
- **slash/catalog.ts** (95 lines): Single source of truth—SLASH_COMMAND_CATALOG array with template, label, hint, destructive flag
  - `filterSlashCatalog(draft)`: returns matching entries; tests ensure every template parses and every command kind is catalogued
- **slash/parser.ts**: Free-text → `ParseResult` (not-a-command | unknown | invalid | ok)
- **slash/dispatch.ts** (170+ lines): `useSlashCommandDispatch` hook — wires mission mutation hooks, routes via exhaustive switch
  - Renderer preflight: mission-start requires missionId; mission-renew fetches renewableSource; mission-edit maps outcome:"unavailable" to success notice
  - Every result flows through per-command outcome mapper (dispatch-outcomes.ts)
  - Engine refusals (not_accepted, no_active_run, etc.) surface as `blocked` (not misleading success)
- **slash/dispatch-outcomes.ts**: Pure mappers (result → friendly outcome message per command kind)
- **slash/use-slash-menu.ts**: Menu visibility/filtering logic for the command hint popup

#### Session State & Context

- **SessionContext.tsx**: Header strip showing session name, model, wallet, runtime controls (pause/stop/resume), memory/knowledge/compaction status
- **SessionRuntimeBar.tsx**: Token usage, context-window gauge, compaction/memory chips
- **MissionContractCard.tsx**: Mission metadata, accept button, contract diff previewer
- **SessionWelcomeHero.tsx**: Welcome copy + trust badges for new sessions (no session selected)
- **SessionWalletSelect.tsx** (F7): Modal to pick wallet at session creation

### Stores

- **uiStore.ts** (155 lines): Zustand with persist middleware; only `sidebarOpen` persisted
  - Actions: setCurrentView, setActiveSessionId, setAppShellView, openCreateSession, closeCreateSession, setPendingFirstMessage, clearPendingFirstMessage, appendLog, clearLogs
  - Logging bounded to MAX_RENDER_LOGS = 500
- **streamStore.ts** (95 lines): Zustand (no persist) for ephemeral preview state per session
  - `reducePreview`: pure reducer mapping delta event + previous preview → next preview
  - `useStreamPreview(sessionId)`: selector returning `StreamPreview | null`

### API Layer (TanStack Query Hooks)

All in `lib/api/`:

| File | Hooks | Role |
|------|-------|------|
| **queryKeys.ts** | Key factories (systemKeys, dockerKeys, onboardingKeys, messagesKeys, ..., approvalsKeys, walletsKeys, modelsKeys) | Centralized cache structure |
| **chat.ts** | `useSubmitChat()` → `UseSubmitChatResult` + `.stop()` | Chat submission with cancellation (9-5b) |
| **sessions.ts** | `useSessionsList()`, `useSession(id)`, `useCreateSession()`, `useDeleteSession()`, `useSetSessionPinned()` | Session CRUD + list |
| **messages.ts** | `useTranscriptInfinite()`, `useTranscriptLiveSync()`, `flattenTranscriptPages()` | Transcript infinite query + live sync |
| **streams.ts** | `useStreamPreviewSync()` (effect hook) | Subscribes to onStreamDelta/onTranscriptAppend |
| **approvals.ts** | `usePendingApprovals()` (with optional refetchInterval), `useApprove()`, `useReject()`, `useApprovalHistory()` | Approval queries + mutations |
| **runtime.ts** | `useRuntimeState()`, `useRequestPause/Stop/Resume()`, `useCancelWake()` | Runtime state + control requests (fail-closed until Puzzle 03) |
| **mission.ts** | `useMissionDraft()`, `useMissionStart/Continue/Recover/Stop/Rewind/Restore/Renew()`, `useMissionDiff()`, `useUpdateMissionDraft()` | Mission operations |
| **usage.ts** | `useUsageSessionTotals()`, `useUsageLastTurn()`, `useContextWindow()`, `useUsageLiveSync()` | Token usage tracking |
| **compaction.ts** | `useCompactionStatus()`, `useCompactionHistory()` | Memory compaction audit |
| **knowledge.ts** | `useKnowledgeList()`, `useKnowledgeAdd()`, `useKnowledgeRemove()` | Knowledge base management |
| **memory.ts** | `useMemorySessionList()`, `useMemoryStats()`, `useMemoryMark/Unmark/Delete()` | Session-scoped memory |
| **models.ts** | `useAvailableModels()` | Global model resolution (source: global_default or unconfigured) |
| **wallets.ts** | `useWalletsAvailable()`, `useSessionScope()`, `usePreparedIntent()` | Wallet inventory |
| **system.ts** | `useSystemHealth()` | Docker + DB health |
| **capabilities.ts** | `useCapabilities()` | Dev diagnostics (app phase) |
| **queryClient.ts** | `createQueryClient()`, singleton `queryClient` | TanStack Client factory + config |

---

## Key Types & Invariants

### Process Boundary Enforcement

1. **Renderer never imports:**
   - `src/vex-agent` or any backend modules
   - `node:` APIs (fs, path, crypto node variants, etc.)
   - Electron privileged APIs directly (preload exposes safe wrapper methods)
   - Database or Docker modules

2. **All backend calls flow through `window.vex.*`** — the IPC bridge defined in `src/shared/types/bridge.ts` and implemented by preload + main handlers

3. **Verification:** `grep -r "from.*vex-agent" /mnt/x/Vex/vex-app/src/renderer` → empty (no violations)

### TanStack Query Patterns

- **Cache keys are structured:** position of `sessionId` is consistent for batch invalidation (e.g., `messagesKeys.forSession()` prefix)
- **Mutations never auto-retry dangerous operations:** `retry: 0` for approve/reject/delete/mission mutations
- **Invalidation is cascading:** e.g., approve/reject success invalidates pending → history (prefix) → messages → runtime at once
- **Query options use `staleTime` conservatively:** 3–5s typical (favors freshness over reducing IPC calls)

### Approvals (F3) Specifics

1. **Polling:** ApprovalsRegion calls `usePendingApprovals(sessionId, { refetchInterval: 5_000 })` — F5 RESOLVED (Bundle B): the control-state bridge now exists (`useControlStateLiveSync` push is primary), so this 5s refetch is RETAINED as a fast fallback for events dropped at the preload Zod gate or fired before subscription, not the only refresh path
2. **Two-step confirm:** High-risk card arms on first click, fires on second within 4s; switching buttons or timeout resets
3. **Focus:** Reject button focused on initial mount (empty useEffect deps); subsequent refetches never re-focus (parent detects newly-appearing IDs)
4. **Invalidation scope:** `approvalsKeys.pending(sessionId)` + `["approvals", "history", sessionId]` prefix match + `messagesKeys.forSession()` + `runtimeKeys.state()`

### Transcript & Streaming (F9)

1. **500-node hard cap:** MAX_TRANSCRIPT_PAGES = 10, each page 50 messages → 500 max rows in the DOM
   - No virtualization (F9 future work)
   - Prevents OOM on very long chats; load-older stops fetching at cap
2. **Stream preview lifecycle:**
   - OnStreamDelta → accumulate in `streamStore`
   - OnTranscriptAppend (assistant role) → await invalidation, then clear preview
   - Orphan safety: 60s idle timeout clears orphaned preview
3. **Scroll pinning:** User pinned = bottom 48px threshold; load-older = top 64px threshold; scroll restored on prepend via height delta

### Session & Model Invariants

- **Global model is per-app, not per-session:** Model selected at startup; all sessions use same model (per ADR-0001)
  - `useAvailableModels()` returns single env-derived option
  - Session wallet selected at creation (F7) and stored in session metadata
- **activeSessionId is launch-ephemeral:** Not persisted; on app restart, sidebar opens with no session selected
- **Welcome state (activeSessionId = null) renders hero + composer:** First message typed seeds new-session modal; created session receives it as first turn

### Slash Command Invariants

- **Every `SlashCommand` kind must appear in SLASH_COMMAND_CATALOG:** `catalog.test.ts` ensures bidirectional coverage
- **Parser + Dispatcher are separate:** Parser is pure (`parseSlashCommand(text)` → ParseResult); dispatcher is effect-based (`useSlashCommandDispatch` wires mutations)
- **Destructive commands require confirmation dialog:** Marked in catalog; confirmed by parent before `dispatchSlash` called
- **Renderer-side gating before dispatch:**
  - mission-start: blocked if missionId is null
  - mission-renew: blocked if renewableSource is null
  - mission-edit: success (not error) on outcome:"unavailable"

---

## Capabilities (Stable IDs)

Renderer-owned UI surface capabilities:

### Shell Navigation & Sessions

| ID | Feature | Trigger |
|----|---------|---------|
| `CAP-vexapp-ui-sessions-list` | Sidebar session list render | SessionsList mount, query.data change |
| `CAP-vexapp-ui-sessions-filter` | Session mode filter (all/agent/mission) | setSessionModeFilter action |
| `CAP-vexapp-ui-sessions-pin` | Pin/unpin session in sidebar | useSetSessionPinned mutation |
| `CAP-vexapp-ui-sessions-delete` | Delete session + confirm dialog | useDeleteSession mutation |
| `CAP-vexapp-ui-sessions-create` | New session modal + form | SessionCreator, useCreateSession |

### Active Session Display

| ID | Feature | Trigger |
|----|---------|---------|
| `CAP-vexapp-ui-session-mount` | SessionPanel branches on activeSessionId | useUiStore activeSessionId change |
| `CAP-vexapp-ui-session-compose-submit` | Chat submit button enabled/disabled | useSubmitChat, runStatus gate |
| `CAP-vexapp-ui-session-stream-preview` | Ephemeral streaming bubble | useStreamPreviewSync, streamStore delta |
| `CAP-vexapp-ui-session-transcript-render` | Infinite transcript display (500-node max) | useTranscriptInfinite pages, SessionTranscript |
| `CAP-vexapp-ui-session-runtime-bar` | Token usage + status chips | SessionRuntimeBar, useUsageLiveSync |
| `CAP-vexapp-ui-session-memory-list` | Session-scoped memory markers | useMemorySessionList, MemoryMarker |
| `CAP-vexapp-ui-session-knowledge-list` | Knowledge + recall markers | useKnowledgeList, KnowledgeSection |
| `CAP-vexapp-ui-session-compaction-history` | Compaction audit trail | useCompactionHistory, CompactionHistorySection |
| `CAP-vexapp-ui-session-mission-card` | Mission contract + accept button | MissionContractCard, mission mode only |
| `CAP-vexapp-ui-session-wallet-select` | Wallet picker at session creation | SessionWalletSelect, F7 |

### Approvals (F3)

| ID | Feature | Trigger |
|----|---------|---------|
| `CAP-vexapp-ui-approvals-list` | ApprovalsRegion polls pending array | usePendingApprovals 5s refetch |
| `CAP-vexapp-ui-approvals-card-render` | ApprovalCard displays tool + risk + reasoning | ApprovalsRegion.view.rows map |
| `CAP-vexapp-ui-approvals-card-confirm-high-risk` | Two-step confirm for critical/high/destructive | ApprovalCard isHighRisk + armedAction state |
| `CAP-vexapp-ui-approvals-card-resolve` | Approve/Reject buttons + cascade invalidation | useApprove/useReject mutations |

### Slash Commands

| ID | Feature | Trigger |
|----|---------|---------|
| `CAP-vexapp-ui-slash-parse` | Text → SlashCommand via parseSlashCommand | SessionComposer form submit |
| `CAP-vexapp-ui-slash-menu` | Hint dropdown filtered by draft text | SlashCommandMenu, filterSlashCatalog |
| `CAP-vexapp-ui-slash-dispatch-mission-start` | /mission start dispatch + gating | useSlashCommandDispatch case:mission-start |
| `CAP-vexapp-ui-slash-dispatch-mission-continue` | /mission continue + /retry dispatch | useSlashCommandDispatch case:mission-continue |
| `CAP-vexapp-ui-slash-dispatch-rewind` | /rewind N dispatch + confirm | useSlashCommandDispatch case:rewind |
| `CAP-vexapp-ui-slash-dispatch-restore` | /restore dispatch + idempotency key | useSlashCommandDispatch case:restore |
| `CAP-vexapp-ui-slash-dispatch-mission-renew` | /mission-renew dispatch + renewable-source gating | useSlashCommandDispatch case:mission-renew |

### Global

| ID | Feature | Trigger |
|----|---------|---------|
| `CAP-vexapp-ui-route-decide` | App.tsx view dispatch + currentView routing | useUiStore.setCurrentView action |
| `CAP-vexapp-ui-query-client-config` | TanStack Query defaults (staleTime, retry, gc) | createQueryClient factory |
| `CAP-vexapp-ui-error-normalize` | Renderer error reporting + dedup | main.tsx onCaughtError/onUncaughtError |

---

## Public API (Consumed By)

The renderer module exposes nothing publicly—it is the final UI presentation layer. Instead, it **consumes**:

### From Preload / Main IPC

- `window.vex.*` (full VexBridge interface per `src/shared/types/bridge.ts`)
  - All query/mutation methods return `Promise<Result<T>>` (success/error discriminated union)
  - Stream methods (`chat.submit`) return `{ promise, cancel }`
  - Event subscription methods (`onStreamDelta`, `onTranscriptAppend`) return unsubscribe function

### From Shared Schemas

- DTOs: `SessionListItem`, `SessionMessageDto`, `ApprovalSummaryDto`, `RuntimeStateDto`, `StreamDeltaEvent`, etc.
- Input types: `ChatSubmitInput`, `SessionCreateInput`, `ApprovalActionInput`, etc.
- Result wrapper: `Result<T>` (ok-case + error-case)

### From React Ecosystem

- React 19.2, React Hooks (useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect)
- React Query 5 (useQuery, useMutation, useInfiniteQuery, useQueryClient)
- Zustand 5 (create, persist middleware)
- React Hook Form (if used in forms; typically shadcn/ui Combobox handles validation)
- Tailwind 4 + shadcn/ui primitives (Button, Dialog, Input, Select, etc.)

---

## Internal Flow

### Chat Submit Flow

```
SessionComposer form submit
  → draft.trim() → parseSlashCommand(text)
    → not-a-command: useSubmitChat.mutate({ sessionId, message })
      → window.vex.chat.submit(input).promise
        ← stream chunk #1 (delta.kind=text) → useStreamPreviewSync → applyDelta → streamStore
        ← stream chunk #2 (delta.kind=done)
        ← (async settle) await onTranscriptAppend event
          → invalidateQueries(messagesKeys.forSession(sessionId))
          ← refetch settles, new row in cache
          → clear(sessionId) streamStore preview
      → onSuccess: invalidateQueries(sessionKeys.list/detail + usageKeys predicate)
      → setNotice(success tone)
```

### Approval Resolve Flow

```
ApprovalCard Approve button click (high-risk check)
  → onApproveClick → fireApprove
    → approve.mutate({ id: summary.id })
      → window.vex.approvals.approve(input)
        → (main) runResumeAfterDecision async
    ← onSuccess: result.ok
      → invalidateOnResolve()
        → invalidateQueries(approvalsKeys.pending)
        → invalidateQueries(["approvals", "history", sessionId] prefix)
        → invalidateQueries(messagesKeys.forSession)
        → invalidateQueries(runtimeKeys.state)
      ← ApprovalsRegion 5s refetch
        → approvalsKeys.pending fresh → no pending cards
        → transcript re-renders with new rows (mission resumed, new turns)
```

### Slash Command Dispatch Flow

```
SessionComposer form submit
  → parseSlashCommand("/rewind 5") → { kind: "ok", command: { kind: "rewind", turns: 5 }, requiresConfirm: true }
  → ConfirmDestructiveDialog mount + user clicks "Rewind"
    → dispatchSlash(command)
      → slashDispatch.dispatch({ kind: "rewind", turns: 5 })
        ← useSlashCommandDispatch case:rewind
          → rewind.mutateAsync({ sessionId, turns: 5 })
            → window.vex.mission.rewind(input)
          ← result → mapRewindOutcome(data, turns)
            ← (pure) outcome message (success | blocked | error)
      → setNotice(outcome)
```

### Streaming Preview Lifecycle

```
window.vex.engine.onStreamDelta event
  → useStreamPreviewSync listener
    → applyDelta(sessionId, event)
      → useStreamStore.applyDelta
        → reducePreview (pure) prev + delta → next
          → { streamId: "...", text: "accum...", phase: "streaming", toolName: null }
    → SessionTranscript useStreamPreview selector
      → StreamingBubble renders text
    → Reset idle timer

(later)
window.vex.engine.onTranscriptAppend event (role=assistant)
  → useStreamPreviewSync listener
    → queryClient.invalidateQueries(messagesKeys.forSession)
      → useTranscriptInfinite refetch settles
        → new message row in cache
    → await settle, then clear(sessionId)
      → streamStore preview cleared
      → StreamingBubble unmounts, persisted row renders
```

---

## Dependencies

### Direct Node/npm

- **react** 19.2: component framework
- **@tanstack/react-query** 5: async state management, caching, invalidation
- **zustand** 5: lightweight client-side state (UI routing, stream preview)
- **react-hook-form**: form state management (if used)
- **zod** 4.x: schema validation at boundaries (imported from shared)
- **@hugeicons/react** + **@hugeicons/core-free-icons**: icon library
- **tailwindcss** 4: utility CSS
- **shadcn/ui**: pre-styled component primitives

### Internal

- `vex-app/src/shared/schemas/*`: Zod schemas (SessionListItem, SessionMessageDto, etc.)
- `vex-app/src/shared/types/bridge.ts`: VexBridge interface
- `vex-app/src/renderer/lib/errors/*`: Error normalization utilities
- `vex-app/src/renderer/lib/markdown/*`: Safe markdown rendering
- `vex-app/src/renderer/components/ui/*`: shadcn/ui button, dialog, input, etc.
- `vex-app/src/renderer/components/common/*`: Vex-specific reusable components

### Excluded (Never Imported)

- `src/vex-agent` ❌ (backend only)
- `node:fs`, `node:path`, `node:crypto` ❌ (preload provides safe wrappers)
- `electron` directly ❌ (preload exposes methods)
- Database modules ❌
- Docker/Compose modules ❌

---

## Cross-References

### Related Modules

- **module.vex-app.preload-channels-events-errors**: Implements `window.vex.*` methods; renderer calls these
- **module.vex-app.shared-schemas-bridge-types**: DTOs and Result wrapper consumed by every query hook
- **module.vex-app.main-ipc-engine-orchestration**: Main process IPC handlers that renderer calls
- **module.vex-app.main-agent-bridge**: Backend integration that fulfills requests
- **module.vex-agent.engine-runtime-events**: Event sources (onStreamDelta, onTranscriptAppend) subscribed by renderer

### Fix Plans

- **F3 (Approval Unblock)**: ApprovalsRegion implementation + two-step confirm ✅ shipped; 5s polling retained as a fast fallback behind the F5 control-state push (Bundle B), no longer a workaround
- **F5 (Control State Bridge)**: ✅ RESOLVED (Bundle B). `EV.engine.controlState` now bridged end-to-end: preload `onControlState` (re-validates via `controlStateEventSchema`), `EngineEventsBridge.onControlState`, and renderer `useControlStateLiveSync(sessionId)` (mounted in SessionPanel) invalidating `runtimeKeys.state()` + `approvalsKeys.pending()`. Push is primary; ApprovalsRegion's 5s refetch is retained as a fast fallback (controlState emit is post-commit on lease release, so an event can drop at the Zod gate or fire pre-subscription)
- **F9 (Transcript Virtualization)**: 500-node cap prevents large chats; no virtualization yet (future stage 8-2c)

### ADRs

- **ADR-0001-global-model-session-wallet**: Model is global per app; wallet selected per session at creation

---

## Refresh Triggers

Cache is refreshed when:

1. **Live events from engine:** `onStreamDelta` + `onTranscriptAppend` + `onControlState` (F5 RESOLVED Bundle B — control-state push invalidates `runtimeKeys.state()` + `approvalsKeys.pending()`)
2. **Explicit user action:** create/delete/pin session, approve/reject, submit chat, dispatch slash
3. **Polling (fast fallbacks, not workarounds):**
   - ApprovalsRegion: 5s refetch — F5 RESOLVED (Bundle B): retained as fast fallback behind the primary `useControlStateLiveSync` push (catches events dropped at the preload Zod gate or fired pre-subscription)
   - useControlStateLiveSync: 30s runtime-state fallback interval
   - TranscriptLiveSync: 30s fallback if onTranscriptAppend missed
4. **Window focus:** refetchOnWindowFocus: true (TanStack Query default)
5. **Network reconnect:** refetchOnReconnect: true

Manual invalidation patterns (Codex §11):
- Single row change: `queryClient.invalidateQueries({ queryKey: messagesKeys.forSession(sessionId) })`
- Multiple queries: `Promise.all([invalidateQueries(...), invalidateQueries(...), ...])`
- Prefix match: `queryClient.invalidateQueries({ queryKey: ["approvals", "history", sessionId] })`
- Predicate (usage): `queryClient.invalidateQueries({ predicate: (query) => isUsageQueryForSession(...) })`

---

## Open Questions

### F5: Control-State Bridge Evidence — ✅ RESOLVED (Bundle B)

- **Status:** Resolved. Full control-state bridged end-to-end via `EV.engine.controlState`.
- **Resolution:** preload `onControlState` (re-validates via `controlStateEventSchema`), `EngineEventsBridge.onControlState`, and renderer `useControlStateLiveSync(sessionId)` (mounted in SessionPanel) invalidating `runtimeKeys.state(sessionId)` + `approvalsKeys.pending(sessionId)` on each event, with a 30s runtime-state fallback interval.
- **Push vs. poll:** Push (controlState) is primary. ApprovalsRegion's 5s refetch is retained as a fast fallback — the controlState emit is post-commit (on lease release via `releaseLeaseAndEmitControlState`), NOT part of the approval/transition transaction, so an event can be dropped at the preload Zod gate or fire before the renderer subscribes.
- **Historical question (now answered):** which UI states relied on the poll — the approval list and runtime-state query; both are now push-refreshed by `useControlStateLiveSync`, with the 5s poll as backstop.

### F9: Transcript 500-Node Cap

- **Status:** Documented; no virtualization
- **Confirmation:** `MAX_TRANSCRIPT_PAGES = 10`, `DEFAULT_LIMIT = 50` (line 36 in messages.ts)
- **Virtualization timeline:** Stage 8-2c (future)
- **Hot paths:** SessionTranscript scroll listener (onScroll fires on every scroll pixel); `flattenTranscriptPages` accumulates all pages into one array (O(n) per refetch, n ≤ 500)

### Slash Command Menu Completeness

- **Catalog entries:** 9 (mission-start, mission-continue, mission-recover, mission-stop, mission-edit, retry, rewind, restore, mission-renew)
- **Question:** Are there undiscovered commands or placeholder slots in the catalog? Does the parser handle all listed kinds?
  - Parser regex patterns match templates; `catalog.test.ts` ensures bidirectionality
  - Commands shown in SlashCommandMenu = filtered SLASH_COMMAND_CATALOG entries

### Composition & Re-render Performance

- **Hypothesis:** ApprovalsRegion rerenders every 5s even if no new approvals; SessionPanel owns three live-sync hooks
- **Evidence:** No `React.memo` observed on approval cards; pure functions (dispatchers) may re-instantiate
- **Action:** Verify if memoization or subscription deduping is needed at scale

### Direct Fetch/Axios Usage

- **Confirmation:** No raw fetch() or axios in renderer source (all queries via `lib/api/*` → `window.vex.*`)
- **Grep result:** `grep -r "fetch\|axios" /mnt/x/Vex/vex-app/src/renderer --include="*.ts" --include="*.tsx"` (only hits in comments/tests expected)

### useChatStream Cleanup on Session Change

- **Evidence:** `useStreamPreviewSync` dependency array includes `[sessionId, queryClient, applyDelta, clear]`
- **Behavior:** On activeSessionId change, previous subscriptions (offDelta, offAppend) unsubscribe; idle timer clears; preview cleared
- **Verification needed:** Does unsubscribe safely cancel async operations in flight? Are multiple sessions' streams isolated?

---

## Handoff to Main Claude

### Recommended Next Action

This module is stable for read-only reference and feature development. Before implementing new features in this layer:

1. **Check this doc's F5 (RESOLVED Bundle B) / F9 evidence** if touching approvals, control-state push/polling, or transcript scaling
2. **Verify process boundaries** before adding any new renderer files (no vex-agent imports)
3. **Use existing patterns** for queries (queryKeys factory), mutations (no auto-retry for dangerous ops), and component structure (split concerns into sub-components)
4. **Test invariants:** catalog bidirectionality, approval focus tracking, transcript page cap, streaming preview lifecycle

### Files to Read Next

- If implementing a new feature touching IPC: `vex-app/src/shared/types/bridge.ts` (full contract)
- If adding approval behavior: `vex-app/src/renderer/features/appShell/ApprovalCard.tsx` (two-step, invalidation pattern)
- If implementing slash commands: `vex-app/src/renderer/features/appShell/slash/catalog.ts` + `dispatch.ts` (catalog-first rule)
- If modifying transcript: `vex-app/src/renderer/lib/api/messages.ts` (max pages + pagination contract)
- If adding a new query: `vex-app/src/renderer/lib/api/queryKeys.ts` (centralize key factory)

### What the Main Claude Must Not Assume

1. Control-state bridge is complete and the only refresh path (F5 RESOLVED Bundle B, but push is best-effort) — `useControlStateLiveSync` push primary; ApprovalsRegion's 5s poll is retained as a fast fallback because the post-commit controlState emit can drop at the preload Zod gate or fire pre-subscription
2. Transcript virtualization exists (F9 open) — 500-node hard cap active; no virtual scrolling
3. Model is per-session (ADR-0001 specifies global) — only one model per app; wallet picked at session creation
4. Renderer can call any backend function (process boundary enforced) — all calls through `window.vex.*`, never direct imports
5. Query cache is automatically invalidated (manual invalidation required) — mutations must explicitly call `queryClient.invalidateQueries(...)`
6. Slash commands are discovery-complete (catalog test gates this) — every new kind must be added to SLASH_COMMAND_CATALOG or catalog.test.ts fails

---

## Summary Stats

- **Total files scoped:** 68 TypeScript/TSX files under `features/appShell/` + `lib/api/` + stores
- **Lines of code:** ~5,272 in appShell TSX; ~1,500+ in lib/api hooks
- **Capabilities documented:** 24 stable IDs across shell, session, approvals, slash
- **Approval cards:** F3 shipped; two-step confirm, focus on Reject, 5s polling for new pending
- **Transcript cap:** 500 nodes (10 pages × 50 messages), no virtualization (F9 future)
- **Slash commands:** 9 kinds, 100% catalog coverage tested
- **Process boundary:** Clean; zero vex-agent imports; all backend calls through window.vex.*
