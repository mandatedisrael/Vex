# Fix Plan — F3: approval card UI missing (restricted mode soft-locks)

Harness session: `harness-integration-blockers`. Status: awaiting Codex plan GREEN LIGHT.

## Goal
In restricted mode the agent's mutating tool calls pause the run at `paused_approval` and enqueue
an approval. **Backend is fully live** (puzzle-5 phase-3 — `vex:approvals:approve/reject` →
`prepareApprove/prepareReject` → background `runResumeAfterDecision`), and **renderer hooks are
live** (`useApprove`/`useReject` in `lib/api/approvals.ts`). But there is **no UI component**
consuming them, so the user is soft-locked: composer blocks free text (composer-helpers gates
`paused_approval`) AND there's no card to click. Fix: build the inline approval card + mount it.

## Rules/skills read
CLAUDE.md + rules/{00,10,20,30,60,70,80}; router → `vex-renderer-frontend` (component patterns —
already have strong context from Z8 indexing), `vex-ui-ux-quality` (financial-action UX, two-step
confirm, default focus on least destructive), `vex-provider-hot-wallet` (user-wallet approval flow
— Vex uses local user wallets, no provider hot wallet; same approval card pattern).

## Files inspected
- `vex-app/src/renderer/lib/api/approvals.ts` — `usePendingApprovals`, `useApproval`,
  `useApprovalHistory`, `useApprove`, `useReject` — all wired to `window.vex.approvals.*`; stale
  docstring claims "feature_unavailable until puzzle 05".
- `vex-app/src/shared/schemas/approvals.ts` — `ApprovalSummaryDto`: id, sessionId, toolCallId,
  toolName, status, permissionAtEnqueue, createdAt, resolvedAt, reasoningPreview,
  **actionKind** (7 vals), **riskLevel** (info|low|medium|high|critical), **preview**
  ({toolName, namespace?, criticalArgs: Record<string, string|number|boolean|null>}),
  **expiresAt**, decision, decisionReason, executionStatus.
  `ApprovalActionResult`: status, resolvedAt, **runtimeOutcome** ('resumed'|'stopped'|'unavailable'),
  executionStatus, missionRunId, cached, message.
- `vex-app/src/main/ipc/approvals.ts` — confirms approve/reject are live (puzzle-5 phase-3).
- `vex-app/src/renderer/features/appShell/SessionPanel.tsx` — active-session layout:
  `SessionContext` → optional `MissionContractCard` → `SessionTranscript` → `SessionComposer`.
  Natural mount: between `SessionTranscript` and `SessionComposer`.
- `vex-app/src/renderer/features/appShell/composer-helpers.ts` — `FREE_TEXT_DISALLOWED` includes
  `paused_approval` (composer already blocks free text in that state).

## Current state
Hooks live + backend live; ZERO renderer UI consuming them. No approval card component, no mount,
no polling. `usePendingApprovals` exists but is imported by nothing in the appShell.

## Directions
- **A (chosen)**: inline `ApprovalsRegion` in `SessionPanel`, between `SessionTranscript` and
  `SessionComposer`. Renders 0..N `ApprovalCard`s from `usePendingApprovals` (polling).
- B (rejected): modal dialog on `paused_approval` transition. Worse UX (interrupts the transcript,
  hides earlier messages); contradicts the "inline approval card in chat" UX intent.

## Implementation steps
1. **`lib/api/approvals.ts`**: extend `usePendingApprovals(sessionId, options?: { refetchInterval?: number })`
   so the consumer can opt into modest polling without duplicating `pendingOptions`. Update the stale
   "feature_unavailable" docstring (puzzle-05 landed).
2. **NEW `features/appShell/ApprovalCard.tsx`**:
   - Props: `summary: ApprovalSummaryDto`, `sessionId: string`.
   - Header row: tool icon + `toolName` (+ `namespace` if present), `riskLevel` chip (color-coded),
     `actionKind` chip, `expiresAt` countdown when present.
   - Body: `reasoningPreview` (italic, secondary color), then a key/value table of `preview.criticalArgs`
     (chain, asset, amount, recipient — whatever the main-side mapper allow-listed).
   - Footer: **Reject** (left, neutral) + **Approve** (right, primary/risk-tinted). Default focus on
     **Reject** (least destructive per UI/UX skill). Two-step confirm for **high-risk**
     (`riskLevel in {"high","critical"}` OR `actionKind in {"destructive","user_wallet_broadcast"}`):
     first click toggles "Click again to confirm"; second click fires. A short timeout resets.
   - States: in-flight → buttons disabled, show spinner on the active button. Error → inline message
     under the buttons (specific + safe per error-copy rules). Success → no toast needed; the card
     disappears on the next `usePendingApprovals` refetch. `retry: false` already on the hooks.
   - On `useApprove`/`useReject` success: invalidate `approvalsKeys.pending(sessionId)`,
     `approvalsKeys.history(sessionId, *)`, `messages` (transcript) and `runtime.getState(sessionId)`
     (the resume changes status). Uses TanStack `queryClient.invalidateQueries`.
   - Accessibility: `aria-live="polite"` on the card; focus on Reject when first mounted.
3. **NEW `features/appShell/ApprovalsRegion.tsx`**:
   - Props: `sessionId: string`.
   - Subscribes `usePendingApprovals(sessionId, { refetchInterval: 5_000 })`.
   - Empty pending → returns `null` (no chrome). Loading first-mount → also `null` (avoid flicker —
     this is a transient state without an interesting UI). Error → small inline notice on retry.
   - Renders `<ApprovalCard key={summary.id} summary={summary} sessionId={sessionId} />` per item.
4. **Edit `features/appShell/SessionPanel.tsx`**: mount `<ApprovalsRegion sessionId={activeSession.id} />`
   between `<SessionTranscript>` and `<SessionComposer>` in the active-session branch.

## Verification plan
- NEW `__tests__/ApprovalCard.test.tsx` (jsdom): renders DTO fields (toolName, riskLevel chip,
  actionKind, criticalArgs); default focus is on Reject; **two-step** required for high-risk; approve
  → `window.vex.approvals.approve({id})` called with right id; reject → `window.vex.approvals.reject`;
  error → inline; buttons disabled while in-flight.
- NEW `__tests__/ApprovalsRegion.test.tsx` (jsdom): empty list → null; one pending → one card; many →
  N cards; refetchInterval respected (mock TanStack `useQuery` or assert the option).
- vex-app `pnpm run lint` (tsc + boundary) + targeted vitest on the two new tests.
- Manual QA: restricted-mode tx tool call → card appears within ~5s → click Approve → run resumes
  (runtime status flips out of `paused_approval`; transcript continues); Reject → run resumes with
  a tool-result rejection (per engine semantics) OR terminates per backend rule; high-risk → two-step.

## Risks / mitigations
- **5s poll** while no pending is a small but real background cost. F5 (Bundle B) bridged
  `EV.engine.controlState` and `useControlStateLiveSync` now pushes a pending-approval refresh, so
  the happy path is near-instant; the 5s poll is retained as a fast fallback (the emit is post-commit
  on lease release, not part of the approval transaction, and can be missed).
- **Two-step heuristic** (`risk in {high,critical} OR actionKind in {destructive,user_wallet_broadcast}`)
  is a defensible default; Codex may want it tightened/loosened.
- **Stale state**: the backend already handles the cached/already-resolved race (`runtimeOutcome` +
  `cached`) and `useApprove`/`useReject` have `retry: false` — no auto-retry of dangerous actions.
- **Focus management on dynamic mount**: focus moves to Reject on FIRST appearance only (avoid
  hijacking focus on every refetch). Use a flag/effect.

## Open questions (for Codex)
- Two-step trigger rule above — is the criterion right, or do you want a stricter rule (e.g., only
  `actionKind === "user_wallet_broadcast"`)?
- Polling interval 5s — too aggressive given typical idle? Should I gate the poll on the runtime
  status being `paused_approval` to avoid background load on healthy sessions?
- Hook signature change (`refetchInterval` option) vs consumer-side `useQuery` re-creation — agree
  the hook extension is cleaner?
- Invalidate `runtime.getState` after approve/reject — confirm needed (resume changes status)?
