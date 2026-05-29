---
id: FLOW-approval-restricted
kind: flow
paths:
  - src/vex-agent/tools/dispatcher.ts
  - src/vex-agent/engine/core/runner/**
  - src/vex-agent/engine/core/approval-runtime.ts
  - src/vex-agent/engine/core/approval-intent-preview.ts
  - vex-app/src/main/ipc/approvals.ts
  - vex-app/src/main/ipc/approvals/**
  - vex-app/src/main/agent/control-bridge.ts
  - vex-app/src/preload/agent/approvals.ts
  - vex-app/src/renderer/features/appShell/ApprovalsRegion.tsx
  - vex-app/src/renderer/features/appShell/ApprovalCard.tsx
  - vex-app/src/renderer/lib/api/approvals.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - src/vex-agent/tools/dispatcher.ts
  - src/vex-agent/engine/core/runner/**
  - src/vex-agent/engine/core/approval-runtime*
  - src/vex-agent/engine/core/approval-runtime/**
  - src/vex-agent/engine/core/approval-intent-preview.ts
  - vex-app/src/main/ipc/approvals.ts
  - vex-app/src/main/ipc/approvals/**
  - vex-app/src/main/database/approvals-db.ts
  - vex-app/src/main/agent/control-bridge.ts
  - vex-app/src/preload/agent/approvals.ts
  - vex-app/src/renderer/features/appShell/ApprovalsRegion.tsx
  - vex-app/src/renderer/features/appShell/ApprovalCard.tsx
  - vex-app/src/renderer/lib/api/approvals.ts
  - vex-app/src/shared/schemas/approvals.ts
related:
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.main-agent-bridge
  - module.vex-app.main-database-migrations
  - module.vex-app.renderer-appshell-runtime
  - module.vex-app.preload-channels-events-errors
  - module.vex-agent.engine-runner
  - module.vex-agent.tools-internal
  - module.vex-agent.tools-protocols
  - fix-plan.F3
---

# FLOW-approval-restricted: Restricted-mode approval gate → user resolve → engine resume

## Trigger
Engine's tool dispatcher (`src/vex-agent/tools/dispatcher.ts`) encounters a tool call where:
- session permission is `restricted`, AND
- tool registry flag `mutating: true`, AND
- run is not already in an approved state for this specific call.

Round-1 fact: the approval gate uses **`mutating`**, NOT `actionKind`. `actionKind` flows through for UI / risk / audit only.

## Preconditions
- Session is in mode `agent` (or `mission` running) with `permission: restricted`.
- Vault unlocked; provider ready (otherwise we never reach a mutating tool call).
- F3 SHIPPED: `ApprovalCard` + `ApprovalsRegion` are mounted in `SessionPanel`.

## Steps

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|---------------|
| 1 | `src/vex-agent/engine/core/turn-loop.ts` calls `runTool` → `tools/dispatcher.ts` | dispatcher checks `restricted && mutating && !approved` | computes approval intent preview via `approval-intent-preview.ts` | none | malformed manifest → error |
| 2 | dispatcher invokes `approval-runtime` to register pending approval | `engine/core/approval-runtime.ts` (or subfolder modules) | inserts pending approval row, transitions run to `paused_approval` | row `approvals` insert; row `runs.status='paused_approval'`; control-state event | duplicate pending approval → idempotent merge |
| 3 | engine `controlBus.publish(controlStateChanged)` | `vex-app/src/main/agent/control-bridge.ts` → preload `onControlState` → renderer `useControlStateLiveSync` | broadcasts `EV.engine.controlState` to all BrowserWindows; renderer invalidates `approvalsKeys.pending` + `runtimeKeys.state` | window send | **F5 RESOLVED (Bundle B)**: preload now exposes `onControlState`; push refresh reaches renderer. Emit is post-commit on lease release (step 2's row insert is in a separate txn), so the 5s poll below is retained as a fast fallback. |
| 4 | renderer `useControlStateLiveSync` push + `ApprovalsRegion` 5s poll (fast fallback) | `lib/api/runtime.ts useControlStateLiveSync` + `lib/api/approvals.ts usePendingApprovals(sessionId, {refetchInterval: 5000})` | TanStack Query refetch `approvals.listPending` (on event, else ≤5s) | TanStack cache | none |
| 5 | poll returns pending row | renderer mounts `ApprovalCard` per row; first-new card focuses Reject | local state `armedAction`, `seenIds` | none | none |
| 6 | user inspects card; reads risk/actionKind/args; for high-risk presses Approve once → armed → presses Approve again within 4s | `useApprove({approvalId})` / `useReject({approvalId})` | `window.vex.approvals.resolve({approvalId, decision, correlationId})` | preload envelope | armed timeout clears state |
| 7 | preload `agent/approvals.ts resolve` | `invokeWithSchema(CH.approvals.resolve)` | none | request | invalid envelope |
| 8 | main `vex-app/src/main/ipc/approvals.ts` via `registerHandler` | input zod → engine `approval-runtime.resolve(approvalId, decision)` | engine updates row `approvals.status='approved'/'rejected'`; transitions run | row update; control-state event; transcript appendMessage | already-resolved approval → conflict |
| 9 | if approved → engine resumes turn from approval point (`engine/core/resume.ts` / `runner/approval-resume.ts`) → executes the previously-blocked tool call | turn loop continues | tool result + transcript append | provider failure same as FLOW-chat-turn |
| 10 | if rejected → engine appends a rejected-tool result message and continues turn loop with that as the tool response (or finalizes if no path) | turn loop processes "rejected" outcome | transcript append; run status returns to `running` (or finalizes) | none |
| 11 | renderer `ApprovalCard.tsx invalidateOnResolve()` (line ~105) | invalidates `approvalsKeys.pending(sessionId)`, `approvalsKeys.history(sessionId)` prefix, `messagesKeys.forSession(sessionId)`, `runtimeKeys.forSession(sessionId)` | cache refresh | none | none |

## Invariants
- Approval gate uses `mutating`, not `actionKind`.
- F3: `ApprovalCard` two-step confirm fires only for `risk in {high, critical}` OR `actionKind in {destructive, user_wallet_broadcast}`.
- First new card focuses Reject (`focusOnMount`); subsequent refetches never re-focus.
- `invalidateOnResolve` MUST invalidate all four key prefixes to keep UI coherent.
- Engine is the authority on approval state; renderer is purely the UI for user decision.
- `approvals.expired` is enforced server-side by `approvals/_sweep.ts`; renderer countdown is non-blocking (current finding: `expiresAt` countdown not yet shown on the card).
- `execute_tool` is a read-only wrapper; the **target manifest's** `actionKind` and `mutating` are authoritative (not `execute_tool`'s).

## Related modules / capabilities
- `module.vex-app.main-ipc-engine-orchestration` — `CAP-vexapp-approvals-list-pending`, `CAP-vexapp-approvals-resolve`, `CAP-vexapp-approvals-sweep`
- `module.vex-app.renderer-appshell-runtime` — `CAP-vexapp-ui-approvals-list`, `CAP-vexapp-ui-approvals-card-render`, `CAP-vexapp-ui-approvals-card-confirm-high-risk`, `CAP-vexapp-ui-approvals-card-resolve`
- `module.vex-app.main-database-migrations` — `CAP-vexapp-db-approvals-*` (read paths)
- `module.vex-agent.engine-runner` — approval-runtime + resume capabilities
- `module.vex-agent.tools-internal` — registry sets `mutating` and `actionKind`
- `module.vex-agent.tools-protocols` — protocol manifests provide `actionKind` for `execute_tool`-wrapped calls; mutation matrix authoritative

## Known failure modes
- **F5 latency — RESOLVED (Bundle B).** Control-state is now bridged end-to-end (`onControlState` in preload → `useControlStateLiveSync` in renderer), so approval cards refresh on push the moment the event arrives. The control-state emit is post-commit on lease release (separate txn from the pending-approval insert) and can be dropped at the preload Zod gate or fire before the renderer subscribes, so the `ApprovalsRegion` 5s poll is retained as a fast fallback rather than the primary path. Worst-case latency is bounded by that ≤5s poll only when the push is missed.
- **Stale pending after backend expiry.** If backend sweep expires the approval before user resolves, resolve IPC returns `approvals.expired`; renderer invalidates and the card disappears.
- **Concurrent resolve.** Two windows both press resolve → engine returns conflict for the second; first wins.
- **Manifest drift.** Round 2 finding: `document_delete` is `actionKind:"destructive"` but `mutating:false` — flagged as a security/quality finding (FINDING-security-005). Approval gate would NOT fire today for that call.
- **Provider-hot-wallet disclosure.** Approval UI relies on backend preview fields for `user_wallet_broadcast` (gas, target chain, amount, recipient); incomplete preview = informed-consent risk.
