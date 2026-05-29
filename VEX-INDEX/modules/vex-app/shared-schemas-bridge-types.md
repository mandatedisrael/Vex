---
id: module.vex-app.shared-schemas-bridge-types
kind: module
title: Vex Electron Shared Schemas and Bridge Types
paths:
  - vex-app/src/shared/schemas/**/*.ts
  - vex-app/src/shared/types/bridge.ts
  - vex-app/src/shared/types/bridge/**/*.ts
  - vex-app/src/shared/embedding-defaults.ts
  - vex-app/src/shared/ipc/envelope.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/src/shared/schemas/**
  - vex-app/src/shared/types/bridge/**
  - vex-app/src/shared/ipc/result.ts
  - vex-app/src/shared/ipc/envelope.ts
related:
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.renderer-appshell-runtime
  - module.src-root.lib-env-config
  - module.src-root.lib-diagnostics
---

## Purpose

Single source of truth for cross-process IPC contracts between renderer, preload/preload validators, and main process handlers. Every schema defined here via Zod 4.x must be:

1. **Validated at preload boundary** — input from renderer is untrusted; preload re-validates before passing to main.
2. **Re-validated at main process boundary** — main never trusts preload output; all handlers re-parse inbound payloads.
3. **Derived to TypeScript types** — via `z.infer<typeof Schema>` so types and runtime validation stay in sync.
4. **Exposed via bridge interfaces** — `VexBridge` extends `VexShellBridge` + `VexAgentBridge`; each method declares its input + result schemas.
5. **Free of secrets** — sensitive data (passwords, API keys, private keys) never crosses the boundary; only success/failure outcomes are returned.

This layer also owns the cancellation envelope, result discriminators, and error codes that flow back to the renderer.

---

## Retrieval Keywords

Zod schema, z.infer, bridge type, RuntimeBridge, per-action result, cancellation envelope, mission contract, mission draft, mission run lifecycle, transcript schema, approvals schema, wallets schema, secrets schema, F6 RESOLVED (Bundle B), discriminated union, result.ts, VexError domain, VexErrorCode.

---

## State Owned

None. This module is pure types, schemas, and validation contracts. No runtime state, no databases, no handlers. State lives in:
- **Main**: DB schema (`vex-app/src/vex-agent/` runtime + Electron main handlers)
- **Renderer**: Component state (React hooks)
- **Preload**: Temporary envelope state only (requestId → promise mapping)

---

## Boundary Crossings

**Data flow:**

```
Renderer → Preload Validator → Main Handler → Preload Promise → Renderer Hook
  (untrusted)   (validate once)  (re-validate)   (result)        (consume)
```

1. **Renderer → Preload**: Raw IPC payload from renderer window (untrusted)
   - Preload unpacks `RequestEnvelope<T>` → validates `T` against schema
   - If validation fails: preload returns `Err(validation.invalid_input)` directly to renderer, logs correlationId, never calls main
   - If valid: preload calls main via `ipcMain.handle(channel, handler)`

2. **Preload → Main**: Trusted call (preload is privileged)
   - Main re-validates input (defense in depth; preload could be compromised)
   - Main handlers return `Result<T, VexError>`; never throws to renderer
   - Main logs all errors with `correlationId` for tracing

3. **Main → Renderer**: Result envelope over IPC
   - `Result<T>` is the only shape that crosses
   - Success: `{ ok: true, data: T }` where `T` is schema-derived
   - Failure: `{ ok: false, error: VexError }` with redacted message (no secrets, stack traces, or PII)
   - Renderer always `await` promises and switch on `.ok`

**Crucially:** Secret data (passwords, API keys, private keys) is stored in the main process vault and validated there. Success results return only non-secret metadata (e.g., address, status, field names written) — never the secrets themselves.

---

## File Map

### Schemas (vex-app/src/shared/schemas/)

**Core request/response infrastructure:**
- `runtime.ts:28-171` — `RuntimeStateDto`, `RuntimeRequestInput`, `RuntimeRequestPauseResult`, `RuntimeRequestStopResult`, `RuntimeRequestResumeResult`, `RuntimeCancelWakeResult`, `ControlStateEvent` (F6 RESOLVED (Bundle B): the legacy backwards-compat `runtimeRequestResultSchema`/`RuntimeRequestResult` alias was deleted — file now ends at `ControlStateEvent` ~line 171)
- `cancel.ts` — cancellation intent schemas
- `sessions.ts` — session lifecycle, mission run statuses, session chat metadata

**Agent integration (puzzle 1+):**
- `agent-core.ts` — agent configuration and core runtime inputs
- `chat.ts:2` — chat submission, stream events
- `messages.ts:2` — message append, transcript events
- `mission.ts` — mission list/get inputs (see mission/ subfolder for per-command details)
- `mission/_common.ts` — shared field schemas (sessionId, missionId)
- `mission/contract.ts` — `acceptContract`, `getDiff`, `updateDraft` commands with outcome discriminators
- `mission/draft.ts` — draft lifecycle mutations
- `mission/commands.ts` — mission command catalogue
- `mission/run-lifecycle.ts` — mission run state machine
- `mission/transcript.ts` — transcript + approval checkpoint schemas
- `approvals.ts:6` — approval action lifecycle, action queue
- `wallets.ts:6` — wallet scope, export, balance queries (puzzle 5 B-UI)
- `models.ts:2` — model catalogue, availability checks
- `usage.ts` — token/credit meter per-session
- `knowledge.ts:4` — read-only knowledge list, disable/archive mutations (stage 7-2a)
- `memory.ts:1` — per-session memory management (stage 7-2a)
- `compaction.ts:1` — compaction job status, retry endpoint (stage 7-1, 8-5)

**Shell integration (vex-app desktop-specific):**
- `docker.ts:9` — Docker service status, install, compose logs
- `database.ts:3` — migration progress, health
- `system.ts:1` — app version, OS metadata
- `onboarding.ts:1` — env state (configured keys, provider, wizard step)
- `wizard.ts:1` — setup wizard field schemas
- `secrets.ts:1` — vault unlock/lock, status
- `api-keys.ts:2` — API key persistence (Jupiter, Tavily, Rettiwt, Polymarket)
- `provider.ts:2` — OpenRouter provider config, verify-then-persist
- `capabilities.ts:1` — capability flags, permissions
- `preferences.ts` — user settings
- `bug-reports.ts` — bug report creation
- `embedding.ts` — embedding config, defaults
- `embedding-defaults.ts` — DEFAULT_EMBEDDING_DIMENSION constant
- `finalize.ts` — complete setup payload
- `usage.ts` — empty; usage data accessed via sessions bridge

**IPC infrastructure:**
- `ipc/envelope.ts:8-19` — `RequestEnvelope<T>` generic wrapper (requestId + payload)
- `ipc/result.ts:1-325` — `Result<T, VexError>` type, `VexError`, `VexDomain`, `VexErrorCode` enums, error code + domain exhaustiveness checks

### Bridge Types (vex-app/src/shared/types/bridge/)

**Compositors:**
- `bridge.ts:1-47` — Legacy entrypoint (re-exports from bridge/index)
- `bridge/index.ts:1-52` — `VexBridge` = `VexShellBridge` + `VexAgentBridge` (compile-time collision guard via interface `extends`)
- `bridge/shell/index.ts` — `VexShellBridge` composer
- `bridge/agent/index.ts:44-65` — `VexAgentBridge` composer, 12 domains

**Common:**
- `bridge/common.ts` — `AbortableInvocation<T>`, `TelemetryReportInput`

**Agent bridges (vex-app/src/shared/types/bridge/agent/):**
- `agent/runtime.ts:14-30` — `RuntimeBridge` (**F6 RESOLVED (Bundle B): now declares the per-action discriminated unions**)
  - `getState: (RuntimeRequestInput) => Promise<Result<RuntimeStateDto>>`
  - `requestPause/requestStop/requestResume/cancelWake` now return their per-action unions (`RuntimeRequestPauseResult`, `RuntimeRequestStopResult`, `RuntimeRequestResumeResult`, `RuntimeCancelWakeResult`); the puzzle-01 `RuntimeRequestResult` alias was deleted
- `agent/sessions.ts` — `SessionsBridge`
- `agent/chat.ts` — `ChatBridge`
- `agent/messages.ts` — `MessagesBridge`
- `agent/mission.ts` — `MissionBridge`
- `agent/approvals.ts` — `ApprovalsBridge`
- `agent/wallets.ts` — `WalletsBridge`
- `agent/models.ts` — `ModelsBridge`
- `agent/usage.ts` — `UsageBridge`
- `agent/knowledge.ts` — `KnowledgeBridge`
- `agent/memory.ts` — `MemoryBridge`
- `agent/compaction.ts` — `CompactionBridge`
- `agent/engine.ts` — `EngineEventsBridge` (push events from main → renderer)

**Shell bridges (vex-app/src/shared/types/bridge/shell/):**
- `shell/docker.ts` — `DockerBridge`
- `shell/database.ts` — `DatabaseBridge`
- `shell/system.ts` — `SystemBridge`
- `shell/onboarding.ts` — `OnboardingBridge`
- `shell/secrets.ts` — `SecretsBridge`
- `shell/capabilities.ts` — `CapabilitiesBridge`
- `shell/wallet.ts` — `WalletBridge`
- `shell/settings.ts` — `SettingsBridge`
- `shell/support.ts` — `SupportBridge`
- `shell/telemetry.ts` — `TelemetryBridge`

---

## Key Types & Invariants

### Zod & Type Derivation

- **All schemas use Zod 4.x** (`pnpm list zod` in root confirms version)
- **Strict mode enforced**: Every schema ends with `.strict()` to reject extra fields
- **Type derivation**: `export type FooResult = z.infer<typeof fooResultSchema>`
  - Example: `runtime.ts:57` → `RuntimeStateDto = z.infer<typeof runtimeStateDtoSchema>`
  - Type and schema stay in sync; breaking the schema fails TS compilation on the infer line

### Request/Result Patterns

**Input validation:**
- Every IPC method has an `XxxInput` schema and `z.infer` type
- Input is wrapped in `RequestEnvelope<XxxInput>` by preload
- Preload validates the envelope + payload; main re-validates before handler dispatch

**Result patterns:**
1. **Success + typed data**: `Result<T>` where `T` is a schema-derived type
   - Example: `runtime.ts:57` → `getState` returns `Promise<Result<RuntimeStateDto>>`
2. **Failure**: `Result<T, VexError>` where `VexError` is the unified error type
   - `domain: VexDomain` — which service failed (e.g., "runtime", "wallet", "internal")
   - `code: VexErrorCode` — specific failure reason (e.g., "runtime.feature_unavailable")
   - `retryable: boolean` — whether the caller should retry
   - `userActionable: boolean` — whether the user can fix it
   - `redacted: true` — marker that secrets/PII have been scrubbed
   - `correlationId: string` — trace UUID for logs

**Per-action discriminators (preferred over generic Result):**
- Example: `runtime.ts:70-145` — `runtimeRequestPauseResultSchema` uses `.discriminatedUnion("outcome", [...])`
- Renderer's mutation hook switches on `outcome` literal to drive UI state
- **F6 RESOLVED (Bundle B)**: `RuntimeBridge.requestPause/Stop/Resume/cancelWake` now return the per-action union; the generic `RuntimeRequestResult` alias was deleted

### Secret Handling

**Forbidden:**
- Never store or return raw API keys, passwords, private keys across IPC
- Never log secrets (even in redacted errors)
- Never send secret material in telemetry

**Patterns:**
- **Input schemas validate secrets at boundary** (e.g., `secrets.ts:20` → password `.min(PASSWORD_MIN_LENGTH)`)
- **Success results return only non-secret metadata**:
  - Example: `api-keys.ts:107-113` → `apiKeysSetResultSchema` returns `fieldsWritten: ["JUPITER_API_KEY", ...]` (field names, not values)
  - Example: `provider.ts:60-67` → `providerPersistResultSchema` returns `verifiedLatencyMs` (timing, not key or model internals)
  - Example: `api-keys.ts:173-180` → `polymarketConfiguredAddressesResultSchema` returns public EVM addresses only
- **Vault unlocking is idempotent per-session**: `secrets.ts:18-32` → `unlock` input is password + output is success flag (no vault contents leak)

### Cancellation Envelope

- Defined in `ipc/envelope.ts:8-19` and `ipc/result.ts:297-299`
- **Every** request from renderer is wrapped: `{ requestId: UUID, payload: T }`
- **Every** response from main is a `Result<T>` with a `correlationId` in error case
- Preload maps `requestId` → promise so concurrent requests don't collide
- Main logs `correlationId` for every error so renderer can provide it to support

### Mission Lifecycle (Puzzle 04+)

**State machine:**
- `sessions.ts` — `MissionRunStatus` enum: "draft" → "active" → "paused_*" → "completed" / "failed"
- `mission/run-lifecycle.ts` — transitions, pause reasons, error codes
- `mission/transcript.ts` — step transcript + approvals (coupled to DB `mission_steps` schema)

**Command contracts (outcome discriminators):**
- `mission/contract.ts:25-69` — `acceptContract` returns 6 outcomes (accepted, not_found, hash_mismatch, status_blocked, run_active, session_mismatch)
- `mission/draft.ts` — updateDraft outcomes
- `mission/commands.ts` — command catalogue + execution results

### Runtime Control Plane (Puzzle 03+)

**State DTO:**
- `runtime.ts:28-56` — `RuntimeStateDto` is read-only snapshot of `mission_runs` row + lease summary (never raw owner IDs)
- `hasActiveRun: boolean` — true if session has an active/paused run
- `status: MissionRunStatus | null` — current run status
- `pendingControlKind` — topmost queued pause/stop/resume/cancelWake request

**Control mutations:**
- `requestPause/Stop/Resume/cancelWake` each take `RuntimeRequestInput` (sessionId only)
- **F6 RESOLVED (Bundle B)**: Bridge now declares the per-action discriminated unions (matching the puzzle-03 live handlers); the puzzle-01 `RuntimeRequestResult` alias was deleted
  - `runtimeRequestPauseResultSchema` → 5 outcomes: queued, already_pending, no_active_run, already_paused, terminal
  - `runtimeRequestStopResultSchema` → 3 outcomes: queued, already_terminal, no_active_run
  - `runtimeRequestResumeResultSchema` → 6 outcomes: resumed, already_running, no_active_run, blocked_approval, blocked_error, lease_busy
  - `runtimeCancelWakeResultSchema` → 2 outcomes: cancelled_wake, no_pending_wake
- Bridge type and renderer mutation hooks now align with the live handlers' per-action schemas

### Error Codes by Domain

**Agent integration domains:**
- `runtime.feature_unavailable` — control plane not yet available (puzzle 03 stub)
- `mission.feature_unavailable` — mission command not yet available (puzzle 04 stub)
- `approvals.feature_unavailable`, `approvals.expired`, `approvals.already_resolved`, `approvals.run_terminated`, `approvals.dispatch_failed` — approval queue (puzzle 05)
- `wallets.feature_unavailable`, `wallets.invalid_selection` — wallet scope (puzzle 05, 10)
- `knowledge.not_found`, `knowledge.invalid_state` — knowledge disable/archive (stage 7-2b)
- `compaction.not_found`, `compaction.invalid_state` — compaction retry (stage 8-5)

**Shell domains:**
- `wallet.*`, `secrets.unlock_throttled`, `provider.*`, `services.*`, `data.*`, `update.*`, `onboarding.*`, `embedding.*`, etc.

---

## Capabilities (Stable IDs)

**Schema capabilities** — each Zod schema produces a CAP for its domain/purpose:

### Agent Integration

- **CAP-vexapp-schema-runtime-state** — `runtimeStateDtoSchema` (line 28)
  - Read-only snapshot of mission run state; bounds lease summary
  - Linked constant: `CONTROL_STATE_EVENT_TYPE`

- **CAP-vexapp-schema-runtime-control-pause** — `runtimeRequestPauseResultSchema` (line 70)
  - Per-action discriminator for pause requests
  - Outcomes: queued, already_pending, no_active_run, already_paused, terminal

- **CAP-vexapp-schema-runtime-control-stop** — `runtimeRequestStopResultSchema` (line 96)
  - Per-action discriminator for stop requests
  - Outcomes: queued, already_terminal, no_active_run

- **CAP-vexapp-schema-runtime-control-resume** — `runtimeRequestResumeResultSchema` (line 110)
  - Per-action discriminator for resume requests
  - Outcomes: resumed, already_running, no_active_run, blocked_approval, blocked_error, lease_busy

- **CAP-vexapp-schema-runtime-control-cancel-wake** — `runtimeCancelWakeResultSchema` (line 136)
  - Per-action discriminator for cancelWake requests
  - Outcomes: cancelled_wake, no_pending_wake

- **CAP-vexapp-schema-mission-contract-accept** — `missionAcceptContractInputSchema` + `missionAcceptContractResultSchema` (mission/contract.ts:13-69)
  - Accepts a contract with hash validation
  - Result outcomes: accepted, mission_not_found, session_mismatch, hash_mismatch, status_blocked, run_active

- **CAP-vexapp-schema-mission-contract-diff** — `missionGetDiffInputSchema` + `missionGetDiffResultSchema` (mission/contract.ts:71+)
  - Fetches contract diff for approval UI
  - Outcome: ready (with hashes + acceptance metadata) or not_found/session_mismatch

- **CAP-vexapp-schema-approvals-action** — `approvalActionInputSchema` + `approvalActionResultSchema` (approvals.ts)
  - Approve or reject a queued tool execution
  - Result includes pending approvals list, current session approval, or feature unavailable

- **CAP-vexapp-schema-chat-submit** — `chatSubmitInputSchema` + `chatSubmitResultSchema` (chat.ts)
  - Submit chat message; returns stream subscription channel
  - Result: chat_started (with streamId) or feature_unavailable

- **CAP-vexapp-schema-messages-append** — `transcriptAppendEventSchema` + push envelope (messages.ts)
  - Transcript append event fired by main → renderer
  - Includes step metadata, input/output, role

- **CAP-vexapp-schema-wallets-export** — `walletExportPrivateKeyInputSchema` + `walletExportPrivateKeyResultSchema` (wallets.ts)
  - Export private key with password re-auth + risk acknowledgment
  - Result: success (address + keystore format) or risk_confirmation_required / wallet_not_found

- **CAP-vexapp-schema-models-list** — `modelsListAvailableInputSchema` + result (models.ts)
  - List available models for the configured provider
  - Returns model entries with IDs, display names, context windows

- **CAP-vexapp-schema-usage-meter** — usage.ts schemas
  - Session token count, pending charges, historical meter readings

- **CAP-vexapp-schema-knowledge-list** — knowledge.ts schemas (stage 7-2a)
  - Read-only knowledge entries per session
  - Disable/archive mutations (invalid_state on already-disabled)

- **CAP-vexapp-schema-memory-list** — memory.ts schemas (stage 7-2a)
  - Read-only per-session memory entries

- **CAP-vexapp-schema-compaction-status** — compaction.ts (stage 7-1, 8-5)
  - Compaction job status query and retry endpoint

### Shell Integration

- **CAP-vexapp-schema-docker-install** — `dockerInstallResultSchema` (docker.ts)
  - Docker service installation progress
  - Results: installed / already_installed / unsupported / user_rejected

- **CAP-vexapp-schema-secrets-vault** — `secretsUnlockInputSchema` + `secretsUnlockResultSchema` (secrets.ts)
  - Unlock encrypted vault with master password
  - Input: password (min 8 chars, validated at boundary)
  - Result: success flag only (vault contents never cross IPC)

- **CAP-vexapp-schema-api-keys-persist** — `apiKeysSetInputSchema` + `apiKeysSetResultSchema` (api-keys.ts)
  - Persist Jupiter, Tavily, Rettiwt, Polymarket keys to vault
  - Result: fieldsWritten list (keys only, not values)
  - Polymarket: all or none (presence check + strict mode)

- **CAP-vexapp-schema-provider-persist** — `providerPersistInputSchema` + `providerPersistResultSchema` (provider.ts)
  - Verify OpenRouter key+model; persist to vault + .env
  - Input: apiKey, model (trimmed, 1-200 chars)
  - Result: fieldsWritten + verifiedLatencyMs (no secret material returned)
  - Atomic: if verify fails, persist does not happen

- **CAP-vexapp-schema-onboarding-env-state** — `envStateSchema` (onboarding.ts)
  - Current state of .env configuration (api keys configured, provider, wizard step)
  - Read-only snapshot for onboarding UI

- **CAP-vexapp-schema-wizard-finalize** — `completeSetupInputSchema` (finalize.ts)
  - Final wizard step; runs onboarding validation + schema migrations

- **CAP-vexapp-schema-database-migrate** — `migrateProgressSchema` (database.ts)
  - Database migration progress (pending, running, completed)
  - Emitted by main → renderer as event stream

- **CAP-vexapp-schema-system-info** — system.ts
  - App version, OS, build info

- **CAP-vexapp-schema-capabilities** — capabilities.ts
  - Capability flags (features available in this build)

- **CAP-vexapp-schema-bug-report** — `createBugReportInputSchema` (bug-reports.ts)
  - Bug report submission with session/mission context
  - No secrets in the payload (field names only, not values)

---

## Public API (Consumed By)

### Preload validators (vex-app/src/preload/index.ts + per-domain handlers)

Every preload domain imports its schemas:

```typescript
import {
  chatSubmitInputSchema,
  transcriptAppendEventSchema,
  runtimeRequestInputSchema,
  apiKeysSetInputSchema,
  secretsUnlockInputSchema,
  // ... per-domain schemas
} from "../../shared/schemas/*.js";

// Preload wrapper validates inbound payload before calling main
const validateInput = (channel: string, payload: unknown) => {
  try {
    return chatSubmitInputSchema.parse(payload); // throws ZodError if invalid
  } catch (e) {
    return err(validation.invalid_input); // return error to renderer directly
  }
};
```

### Main process handlers (vex-app/src/main/ipc/*.ts)

Every main handler re-validates its input:

```typescript
import { chatSubmitInputSchema } from "@shared/schemas/chat.js";

ipcMain.handle(EV.chat.submit, async (event, envelope: RequestEnvelope<unknown>) => {
  const input = chatSubmitInputSchema.parse(envelope.payload); // re-validate
  // ... handler logic
  return ok(result); // or err(vexError)
});
```

### Renderer hooks (vex-app/src/renderer/hooks/*.ts)

Renderer imports bridge types (not schemas directly):

```typescript
import type { ChatBridge } from "@shared/types/bridge.js";

// Renderer calls typed preload method
const result = await window.vex.chat.submit({ message: "hello" });

// Result type is Result<ChatSubmitResult>
if (result.ok) {
  // result.data is typed ChatSubmitResult
  console.log(result.data.streamId);
} else {
  // result.error is typed VexError
  console.log(result.error.message);
}
```

---

## Internal Flow

**Schema definition → Export → Preload validation → Main handler → Result → Renderer:**

1. **Schema defined** in `/vex-app/src/shared/schemas/<domain>.ts`
   - Always uses Zod 4.x, `.strict()`, and `z.infer` for type derivation
   - Input + result pairs; both tested in `__tests__/<domain>.test.ts`

2. **Exported in schema file** (line-by-line):
   - `export const fooInputSchema = z.object(...).strict()`
   - `export type FooInput = z.infer<typeof fooInputSchema>`
   - `export const fooResultSchema = z.object(...).strict()`
   - `export type FooResult = z.infer<typeof fooResultSchema>`

3. **Bridge type declared** in `/vex-app/src/shared/types/bridge/<domain>.ts`
   - `export interface FooBridge { readonly method: (input: FooInput) => Promise<Result<FooResult>> }`
   - Bridge imports **types only**, not schemas (schemas are validation-time artifacts)

4. **Preload validator** in `/vex-app/src/preload/handlers/<domain>.ts`
   - Imports `fooInputSchema`, `fooResultSchema`
   - Wraps handler call: parses inbound payload, calls main, validates result

5. **Main handler** in `/vex-app/src/main/ipc/<domain>.ts`
   - Imports both schemas (input + result)
   - Re-validates input: `const parsed = fooInputSchema.parse(envelope.payload)`
   - Returns `Result<FooResult>`

6. **Renderer hook** in `/vex-app/src/renderer/hooks/useFoo.ts`
   - Imports bridge type: `import type { FooBridge } from "@shared/types/bridge"`
   - Calls `window.vex.foo.method(input)` → receives `Result<FooResult>`
   - Switches on `.ok` to render success/error state

**Drift candidates** (schemas not imported by both preload AND main):
- None found in current codebase; all schemas under `/vex-app/src/shared/schemas/` are symmetrically imported by preload + main
- Test files confirm validation on both sides

---

## Dependencies

- **`zod` 4.x** — schema validation library (required; no alternatives)
- **`@vex-lib` (alias to /src/lib)** — Pure metadata imports only (e.g., embedding dimension constant)
  - No runtime dependencies on vex-agent engine code in schemas
  - Renderer can never import from vex-agent; typed bridge is the contract

---

## Cross-References

- **vex-app/src/shared/ipc/channels.ts** — Channel name constants (EV.chat.submit, EV.runtime.getState, etc.) that match schema domain/method pairs
- **vex-app/src/shared/ipc/result.ts** — `Result<T>`, `VexError`, `VexDomain`, `VexErrorCode` (unified error type for all IPC boundaries)
- **vex-app/src/shared/ipc/envelope.ts** — `RequestEnvelope<T>` (wraps every request)
- **vex-app/src/preload/index.ts** — Preload bridge surface that satisfies `VexBridge` and re-exports all validators
- **vex-app/src/main/ipc-engine.ts** — Main orchestrator that registers all handlers
- **vex-app/src/renderer/vex.d.ts** — Type augmentation for `window.vex` (imports `VexBridge` type)
- **src/lib/diagnostics/bug-report-schema.ts** (root) — Bug report schema used by main; vex-app bug report schema is a sibling wrapper
- **src/lib/agent-config.ts** (root) — Agent configuration; vex-app agent-core schemas are parallel contracts for the renderer-facing API

---

## Refresh Triggers

This document should be refreshed when:

1. **New schema added** under `/vex-app/src/shared/schemas/` (new CAP-vexapp-schema-* added)
2. **Bridge type signature changes** (input/result types, new methods)
3. **Error codes added** in `/vex-app/src/shared/ipc/result.ts` (VexDomain, VexErrorCode arrays)
4. **Zod version upgraded** (major version change may affect validation semantics)
5. **Cancellation/envelope contract changes** (RequestEnvelope, Result shape)
6. **Mission lifecycle state machine changes** (MissionRunStatus, control outcomes)

---

## Open Questions

### F6 RESOLVED (Bundle B): `RuntimeBridge` Type-Schema Mismatch

**Resolution (commit 85ed941):** the recommendation below shipped verbatim — `RuntimeBridge` and the renderer mutation hooks now declare the per-action discriminated unions, and the legacy `runtimeRequestResultSchema`/`RuntimeRequestResult` alias (+ its legacy test) was deleted. Preload needed no change (`satisfies RuntimeBridge` re-infers `T`). `tsc --noEmit` clean; Codex GREEN LIGHT. The historical analysis is kept below.

**Issue (historical):** `RuntimeBridge` declared control mutations with an outdated return type.

**Bridge declaration** (vex-app/src/shared/types/bridge/agent/runtime.ts:14-30):
```typescript
export interface RuntimeBridge {
  readonly requestPause: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestResult>>;
  readonly requestStop: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestResult>>;
  readonly requestResume: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestResult>>;
  readonly cancelWake: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestResult>>;
}
```

**Schema definitions** (vex-app/src/shared/schemas/runtime.ts:70-145):
```typescript
export const runtimeRequestPauseResultSchema = z.discriminatedUnion("outcome", [...]);  // 5 outcomes
export const runtimeRequestStopResultSchema = z.discriminatedUnion("outcome", [...]);   // 3 outcomes
export const runtimeRequestResumeResultSchema = z.discriminatedUnion("outcome", [...]); // 6 outcomes
export const runtimeCancelWakeResultSchema = z.discriminatedUnion("outcome", [...]);    // 2 outcomes
```

**Backwards-compat fallback** (vex-app/src/shared/schemas/runtime.ts:180-187):
```typescript
// Puzzle-01 placeholder result. Kept around for the existing failing
// stub `getState` test scaffold; the live handlers in puzzle 03 use
// the per-action discriminated unions above.
export const runtimeRequestResultSchema = z.object({
  status: z.enum(["queued", "already_terminal", "unavailable"]),
  missionRunId: z.string().nullable(),
  message: z.string(),
}).strict();
export type RuntimeRequestResult = z.infer<typeof runtimeRequestResultSchema>;
```

**Finding:**
- Live puzzle-03 handlers return per-action discriminators (e.g., `runtimeRequestPauseResultSchema`)
- Bridge type still declares `RuntimeRequestResult` (puzzle-01 alias)
- Renderer mutation hooks expect the per-action outcome literal for `switch` branching
- Type mismatch does not currently break because `RuntimeRequestResult` is a superset in the error case, but the specific outcome literals are missing

**Recommendation:**
- Update `RuntimeBridge` interface in `vex-app/src/shared/types/bridge/agent/runtime.ts` to declare the per-action result types:
  ```typescript
  readonly requestPause: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestPauseResult>>;
  readonly requestStop: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestStopResult>>;
  readonly requestResume: (input: RuntimeRequestInput) => Promise<Result<RuntimeRequestResumeResult>>;
  readonly cancelWake: (input: RuntimeRequestInput) => Promise<Result<RuntimeCancelWakeResult>>;
  ```

### Other Questions

**Passthrough risk:**
- Grep search found zero `.passthrough()` calls in `/vex-app/src/shared/schemas/`
- All schemas use `.strict()` to reject extra fields
- Status: ✓ No passthrough risk

**Secret leakage via API keys schemas:**
- `api-keys.ts:81-113` — Input accepts raw secrets (jupiterApiKey, tavilyApiKey, polymarket); validator trims whitespace but does NOT log
- Result (`apiKeysSetResultSchema`) returns only `fieldsWritten: string[]` (field names, not values)
- `provider.ts:30-67` — Input accepts raw OPENROUTER_API_KEY; result returns `verifiedLatencyMs` only
- Vault unlock (`secrets.ts:18-32`) — Input accepts password; result returns success flag only
- Status: ✓ Secrets are accepted as input at boundary but never returned in success results; failure paths redact secrets via `VexError.redacted`

**Cross-contamination with root lib:**
- `src/lib/agent-config.ts` defines Agent configuration for vex-agent runtime
- `vex-app/src/shared/schemas/agent-core.ts` defines the renderer-facing Agent configuration input
- The two are parallel; vex-app never imports from root `agent-config.ts`
- Status: ✓ No cross-contamination

---

## Handoff Summary

**Document purpose:** Complete wire-contract reference for the Vex Electron app's cross-process IPC layer.

**Key takeaways:**
1. Every IPC boundary has a Zod schema + derived type pair; both sides re-validate
2. Secrets never cross IPC; success results return only non-secret metadata
3. Errors use unified `VexError` type with domain, code, and correlation ID for tracing
4. Mission lifecycle and runtime control plane use per-action discriminated unions for renderer state branching
5. F6 RESOLVED (Bundle B): RuntimeBridge now declares per-action result types matching the schemas; the legacy `RuntimeRequestResult` alias was deleted

**For implementation:**
- When adding a new IPC surface, create schema + bridge type pair in parallel
- Always validate at both preload AND main boundaries (defense in depth)
- Never return secret material; use success/failure flags instead
- Test schemas in `__tests__/` to ensure validation works as intended
- Use discriminated unions for multi-outcome scenarios (not generic optional fields)

---

**Module indexed:** 2025-05-28
**Thoroughness:** Very thorough (60+ schemas across agent + shell domains, all bridge types, 4 major subsystems, F6 RESOLVED in Bundle B)
