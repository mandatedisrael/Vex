# Bug Reporting

Local-first bug reporting subsystem for Vex. Phase 1 (this document) covers the persistence skeleton; Phase 2 and Phase 3 are sketched at the bottom.

This document is the canonical architecture reference for the `support` domain. It is intentionally exhaustive — anyone touching `bug_reports`, the redactors, or the IPC handler should read it first.

---

## 1. Why this exists

Before the `vex-agent` engine is integrated into the `vex-app` Electron shell, we want a production-grade path for capturing bugs from three sources:

1. **The user**, via a "Report an issue" button in the app shell.
2. **The renderer**, automatically, when React or async code throws.
3. **The agent runtime**, programmatically (Phase 2), at known failure boundaries (`paused_error`, `compact_unable_at_critical`, inference exhaustion, protocol capture rejection, ...).

All three sources must land in **one canonical local sink** (the `bug_reports` table), redacted at the trust boundary, with a shape that can later be uploaded to an external backend.

Critically, this is **not** a replacement for existing telemetry:

- `electron-log` keeps writing rotated log files and catching `uncaughtException` / `unhandledRejection` in the main process.
- Sentry stays opt-in, lazy-loaded, and continues to receive renderer errors.
- The agent's structured Winston events (`compact.now.called`, `knowledge.write.with_source`, etc.) keep flowing to stderr.
- Domain `error TEXT` columns on `compact_jobs.last_error`, `subagents.error`, `runtime_cycles.error_message` stay as state-machine + retry evidence — they are **referenced** by `bug_reports` via soft refs, never normalized away.

The goal is to **unify the SINK, not the SOURCES**. The new table is a support-records store, not a normalization of every operational error column.

---

## 2. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Renderer (untrusted)                                                          │
│                                                                               │
│   ReportIssueButton ──► ReportIssueDialog ──► window.vex.support.create…     │
│                                                                               │
│   onCaughtError / onUncaughtError / unhandledrejection ──► safeSupportReport │
│                                                            (.catch noop)      │
│                                                                               │
│   report-dedupe.ts (30s window, LRU 256) gates AUTOMATIC emissions only.     │
└──────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  IPC: vex:support:createBugReport
                                  │  payload: CreateBugReportInput (Zod, strict)
┌──────────────────────────────────────────────────────────────────────────────┐
│ Preload (typed bridge)                                                        │
│   support.createBugReport(input) ──► invokeWithSchema(...)                   │
│                                       Zod validates BEFORE crossing IPC.      │
└──────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Main (privileged)                                                             │
│                                                                               │
│   registerHandler(...)                                                        │
│     ├─ sender frame check (app://vex/ in prod, http://127.0.0.1:5173 in dev) │
│     ├─ envelope Zod parse (requestId + payload)                              │
│     ├─ outputSchema parse (defense-in-depth on the reply)                    │
│     └─ ctx with correlationId                                                │
│                          │                                                    │
│                          ▼                                                    │
│   bug-report-service.ts                                                       │
│     1. Stamp env: id (uuid), app.getVersion(), process.platform, install_id │
│     2. ──► redactBugPayload({title, description, context, refs})            │
│         ├─ key-name redact ([REDACTED] for password/api_key/seed/...)       │
│         ├─ two-tier text redact (Tier 1 hard, Tier 2 mask)                  │
│         ├─ Error unwrap (name/message/stack before plain-object branch)     │
│         ├─ bigint → decimal string (JSON.stringify safety)                  │
│         ├─ depth cap 8 / circular guard / 4000-char string cap              │
│         └─ counts: hardRedactCount + maskCount                              │
│     3. Compute retention_until (manual=null, automatic=+90d)                │
│     4. ──► bug-reports-db.insertBugReport(...)                              │
│     5. Fire-and-forget transport.enqueue(reportId) (currently no-op)        │
│                          │                                                    │
│                          ▼                                                    │
│   bug-reports-db.ts                                                           │
│     withClient(): own pg.Client, connect, do work, end in finally.           │
│     INSERT into bug_reports (30 columns), JSONB stringify, RETURNING * map. │
│     BugReportsDbUnavailableError when buildPoolConfig returns null.         │
└──────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  pg
┌──────────────────────────────────────────────────────────────────────────────┐
│ Local PostgreSQL                                                              │
│   bug_reports (migration 019, mirrored from src/vex-agent/db/migrations/)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The trust boundary and the redaction contract

**Rule:** Every string the renderer can fill must pass through `redactBugPayload(...)` **before** any DB column is written.

This includes:

- `title`, `description`, `context.*` (obvious),
- `refs.sessionId`, `refs.toolCallId`, `refs.toolName`, `refs.protocolNamespace`, `refs.correlationId`, `refs.missionId`, `refs.missionRunId`, `refs.subagentId` (every up-to-128-char string the renderer can fill — without redaction here, a secret-shaped value passed as `refs.sessionId` would land RAW in the `session_id` column while `title`/`description` get scrubbed).

`refs.compactJobId` is numeric and passes through unchanged.

The redactor returns:

```ts
{ value: T;            // redacted clone (input not mutated)
  hardRedactCount: number;
  maskCount: number;
}
```

The two counts are written to `redaction_hard_count` and `redaction_mask_count` on the row as proof that redaction ran. If `hardRedactCount > 0` and the raw input had no secret-shaped substring, that's a future telemetry signal for "renderer is sending unexpected secret-shaped values" — a Phase 2 anomaly category.

### 3.1 Tier 1 (hard redact)

Replaced with `[REDACTED:<class>]`. Lives in `src/lib/diagnostics/text-redaction.ts`.

| Class                | Pattern (summary)                                                  |
|----------------------|---------------------------------------------------------------------|
| `private_key`        | labelled `private_key:0x...`, `seed_key:...`, raw 64-hex after label |
| `api_key`            | known prefixes: `sk-`, `sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`, `sk-or-`, `sk-ant-` |
| `jwt`                | three base64url segments separated by dots, header starts with `eyJ` |
| `mnemonic`           | 12/15/18/21/24 lowercase 3-8 char words separated by single spaces, no sentence punctuation |

### 3.2 Tier 2 (mask)

Identifier shape preserved (e.g. `0xabcd…1234`) so downstream context still carries the semantic role.

| Class            | Pattern                       | Example output  |
|------------------|-------------------------------|------------------|
| EVM address      | `\b0x[a-f0-9]{40}\b`          | `0xabcd…1234`   |
| Transaction hash | `\b0x[a-f0-9]{64}\b`          | `0xabcd…1234`   |
| Solana base58    | 32-44 chars, base58 alphabet  | `Abc…1234`      |

### 3.3 Key-name redaction (composite layer)

Lives in `src/lib/diagnostics/redactor.ts`. Field names matching the case-insensitive regex below are replaced with the literal `[REDACTED]`:

```
password | passphrase | mnemonic | seed | phrase
private_key | secret | token | api_key | auth(orization)?
signature | sig | wallet | address | keystore
cipher | tag | salt | nonce | iv | jwt
```

This mirrors `vex-app/src/main/logger/redact.ts` so the file logger and the support sink honour the same key-name allowlist.

### 3.4 Type guards in the composite redactor

- `Error` instances are checked **before** the plain-object branch. `Object.entries(err)` iterates only own enumerable props and would miss `name`/`message`/`stack` — where the secrets live. So the redactor unwraps Error to `{ name, message, stack }` with `message` and `stack` recursively redacted.
- `bigint` is normalized to its decimal-string form because `JSON.stringify(1n)` throws — the DB layer JSON-stringifies `sanitized_context` and `attachments` before INSERT, so a stray bigint would surface as `support.persist_failed`.
- Circular references return `[circular]` (`WeakSet` tracking).
- Depth cap is 8, beyond which `[depth-limit]` is returned.
- Strings beyond 4000 chars are truncated with a `…[truncated N chars]` suffix so a renderer can never bloat the local DB with megabyte-sized payloads.

---

## 4. The `bug_reports` table

Migration: `src/vex-agent/db/migrations/019_bug_reports.sql`, mirrored to `vex-app/resources/migrations/` by `vex-app/scripts/copy-migrations.mjs` at `prebuild`/`predev` time.

The mirror directory is `.gitignore`d. Source of truth = the file in `src/vex-agent/db/migrations/`.

### 4.1 Columns by role

**Classification (5):**
`report_kind` (`manual` | `automatic`), `source` (`user` | `renderer` | `main` | `agent` | `worker`), `category` (TEXT with regex CHECK — see §4.2), `severity` (`info` | `warning` | `error` | `critical`), `status` (`open` | `triaged` | `dismissed`).

**Body (2):**
`title` (1-160 chars), `description` (≤ 8000 chars). Both already redacted at insert time.

**Upload state machine — Phase 3 prep, no worker today (6):**
`upload_state` (`not_configured` | `queued` | `uploading` | `uploaded` | `failed`), `upload_attempt_count INTEGER CHECK >= 0`, `next_upload_at`, `last_upload_error`, `remote_report_id`, `uploaded_at`.

**Environment stamp (3):**
`app_version` (from `app.getVersion()`), `os_platform` (`process.platform`: `linux` | `darwin` | `win32`), `install_id` (read from `CONFIG_DIR/.install-id`, cached).

**Soft references to agent state (9, no FK):**
`correlation_id`, `session_id`, `mission_id`, `mission_run_id`, `subagent_id`, `tool_name`, `tool_call_id`, `protocol_namespace`, `compact_job_id`.

These are deliberately not foreign keys. `vex-app` records bug reports even when the referenced row was reaped or never existed in the app pool's perspective. Filtering integrity is enforced by the service layer at insert time, not the database.

**Agent-domain context — populated by Phase 2 emitters (6):**
`stop_reason`, `runtime_status`, `context_pressure_band` (CHECK in `normal|warning|barrier|critical` or NULL), `context_pressure_fraction NUMERIC(5,4) CHECK 0..1`, `checkpoint_generation`, `post_compact_bridge_active`.

**Redaction proof (2):**
`redaction_hard_count INTEGER CHECK >= 0`, `redaction_mask_count INTEGER CHECK >= 0`.

**Bounded JSON (2):**
`sanitized_context JSONB CHECK jsonb_typeof = 'object'`, `attachments JSONB CHECK jsonb_typeof = 'array'`.

**Retention (1):**
`retention_until TIMESTAMPTZ`. Manual reports → NULL (user-driven delete only). Automatic reports → `created_at + 90 days`.

**Timestamps (2):**
`created_at`, `updated_at` (both `NOT NULL DEFAULT NOW()`).

### 4.2 The `category` regex (`SUPPORT_CATEGORY_REGEX`)

```
^[a-z][a-z0-9_]{2,80}$
```

snake_case identifiers, 3-81 chars. The SQL CHECK and the Zod schema enforce the same pattern.

Why TEXT + regex and not an enum: Phase 2 / Phase 3 introduce new categories (programmatic emit points, new failure surfaces) without forcing a schema migration + coordinated bump of preload, main, and renderer. Two const arrays document the current set:

- `MANUAL_CATEGORIES` (used by the dialog select): `user_reported_bug`, `user_reported_confusion`.
- `KNOWN_AUTOMATIC_CATEGORIES` (Phase 2+ emitters): `renderer_caught_error`, `renderer_uncaught_error`, `renderer_unhandled_rejection`, `main_uncaught_exception`, `main_unhandled_rejection`, `ipc_validation_failure`, `database_unavailable`, `database_migration_failure`, `docker_detection_failure`, `docker_compose_failure`, `inference_provider_failure`, `embedding_failure`, `mission_paused_error`, `mission_system_error`, `compact_unable_at_critical`, `tool_dispatch_failure`, `protocol_execution_failure`, `protocol_capture_rejection`, `sync_worker_failure`, `wake_resume_failure`, `subagent_lifecycle_failure`, `redaction_anomaly`.

### 4.3 Indexes

Six partial / composite indexes match the expected query shapes:

| Index                              | Predicate                                                  | Use case |
|------------------------------------|------------------------------------------------------------|----------|
| `idx_bug_reports_created`          | `created_at DESC`                                          | Recent-first list |
| `idx_bug_reports_category_created` | `(category, created_at DESC)`                              | Per-category browse |
| `idx_bug_reports_correlation`      | `correlation_id` WHERE NOT NULL                            | Cross-reference IPC requests |
| `idx_bug_reports_session`          | `(session_id, created_at DESC)` WHERE NOT NULL             | Per-session diagnostics |
| `idx_bug_reports_upload_due`       | `(upload_state, next_upload_at)` WHERE `queued`/`failed`   | Phase 3 upload worker |
| `idx_bug_reports_retention`        | `retention_until` WHERE NOT NULL                           | Retention sweep |

---

## 5. Layering rules (enforced by Codex review)

These constraints were the two blockers Codex caught during plan review. Both are now enforced by repository structure and verified by typecheck + grep:

### 5.1 `vex-app` never imports from `src/vex-agent/db/*`

`vex-app/src/main/database/bug-reports-db.ts` uses its own `pg.Client` per call (single-shot lifecycle, closed in `finally`) through `buildPoolConfig()` from `vex-app/src/main/database/db-config.ts`. This mirrors the existing pattern in `sessions-db.ts` and `dim-lock.ts`.

The shared SQL schema (`019_bug_reports.sql`) lives in the agent's migration directory and is mirrored to `vex-app/resources/migrations/` at build/dev time. The mirror directory is `.gitignore`d — canonical source is the agent directory.

Phase 2 (when `vex-agent` is integrated into `vex-app`) may add an agent-side repo at `src/vex-agent/db/repos/bug-reports/`, or extract a pure SQL mapper to `src/lib/db/bug-reports-rows.ts` that both `vex-app` and `vex-agent` import. That decision is deferred — Phase 1 is unaffected.

### 5.2 `src/lib/diagnostics/*` never imports from `src/vex-agent/*`

`@vex-lib` is aliased into the renderer (`vite.renderer.config.ts`, `tsconfig.renderer.json`). If `src/lib/diagnostics/redactor.ts` imported from `src/vex-agent/memory/redaction.ts`, the renderer bundle would drag in agent code.

Solution: the canonical two-tier text redactor lives at `src/lib/diagnostics/text-redaction.ts`. The pre-existing `src/vex-agent/memory/redaction.ts` is now a 13-line re-export:

```ts
export {
  redact,
  redactObject,
  type RedactionResult,
} from "../../lib/diagnostics/text-redaction.js";
```

Zero behavioral change for the agent. The existing 15 tests in `src/__tests__/vex-agent/memory/redaction.test.ts` continue to pass through the re-export — proof that the refactor is backwards-compatible.

Verification: `grep -rn "from.*vex-agent" src/lib/` returns zero hits.

---

## 6. Renderer surface

### 6.1 Manual report — `ReportIssueButton` + `ReportIssueDialog`

Placed in the app-shell topbar at `vex-app/src/renderer/features/appShell/AppShell.tsx`, alongside `EditInfrastructureButton`. The button owns its dialog open state via local `useState` (no Zustand store, no cross-feature reason to lift).

The dialog form (minimal by design):

- Category select: `user_reported_bug` | `user_reported_confusion`.
- Severity: `info` | `warning` | `error` | `critical` (default `error`).
- Title: 1-160 chars, trimmed, empty disables submit.
- Description: ≤ 8000 chars.

On submit, the dialog calls `window.vex.support.createBugReport({reportKind: "manual", source: "user", category, severity, title, description, context: {}, refs: {}})`. Manual submissions bypass the dedupe — they are never dropped.

The form is intentionally narrow. Every additional field is one more chance for the user to accidentally paste a secret-shaped value into a free-text input before the main-side redactor catches it. Phase 2 may add diagnostics attachments and a "My reports" list with export/delete, gated on UX review.

### 6.2 Automatic renderer error capture — three sources

`vex-app/src/renderer/main.tsx`:

1. **React caught errors** — `createRoot(...).onCaughtError` calls `safeSupportReport({category: "renderer_caught_error", severity: "warning"})`.
2. **React uncaught errors** — `createRoot(...).onUncaughtError` calls `safeSupportReport({category: "renderer_uncaught_error", severity: "error"})`.
3. **Promise rejections** — `window.addEventListener("unhandledrejection")` calls `safeSupportReport({category: "renderer_unhandled_rejection", severity: "error"})`.

Each call is wrapped:

```ts
function safeSupportReport(input: CreateBugReportInput): void {
  void window.vex?.support?.createBugReport(input).catch(() => undefined);
}
```

The `.catch(() => undefined)` guarantees a failed report (preload validation reject, IPC unavailable, main throws) can never itself trigger another `unhandledrejection` and cause an infinite loop. The same wrapping is applied to `safeSentryReport` so the legacy `window.vex.telemetry.reportRendererError` path is also loop-proof.

The Sentry path runs **in parallel** with the local sink. Sentry is opt-in (default OFF). The local sink is local-first (always on). They do not compete:

```ts
onCaughtError(error, info) {
  if (!dedupe.shouldDrop(...)) safeSupportReport({...});   // always
  safeSentryReport({...});                                 // no-op if consent off
}
```

### 6.3 Dedupe — `vex-app/src/renderer/lib/report-dedupe.ts`

`createReportDedupe({ windowMs: 30_000, maxEntries: 256 })` keyed by `category + ":" + key`. Drops a duplicate if the previous emit was within `windowMs`. LRU eviction at `maxEntries`. The dedupe state is in-memory only; a renderer reload resets it.

The dedupe is **not** a security gate — it exists to reduce noise from render loops that fire the same error 1000× before the user notices. Adversarial input is bounded by the preload Zod schema and the main-side handler. Manual submissions (dialog) do not pass through dedupe.

---

## 7. IPC contract

### 7.1 Channel

`vex:support:createBugReport` (constant: `CH.support.createBugReport` in `vex-app/src/shared/ipc/channels.ts`).

### 7.2 Input schema (`createBugReportInputSchema`)

Strict Zod 4 object. Lives in `src/lib/diagnostics/bug-report-schema.ts` and is re-exported through `vex-app/src/shared/schemas/bug-reports.ts` so renderer + preload + main all reference one source of truth.

```ts
{
  reportKind: "manual" | "automatic",
  source:     "user" | "renderer" | "main" | "agent" | "worker",
  category:   string,                                 // matches SUPPORT_CATEGORY_REGEX
  severity:   "info"|"warning"|"error"|"critical",    // default "error"
  title:      string,                                 // trim, 1..160 chars
  description: string,                                // max 8000 chars, default ""
  context:    Record<string, unknown>,                // default {}
  refs: {                                             // strict, default {}
    correlationId?, sessionId?, missionId?,
    missionRunId?,  subagentId?,
    toolName?,      toolCallId?,
    protocolNamespace?,
    compactJobId?:  number,
  },
}
```

### 7.3 Output schema (`createBugReportResultSchema`)

```ts
{
  reportId:    string (uuid),
  recorded:    boolean,
  uploadState: "not_configured" | "queued" | "uploading" | "uploaded" | "failed",
}
```

Validated at the boundary by `registerHandler`'s `outputSchema` (defense in depth).

### 7.4 Error model

The `support` domain has exactly one bespoke `VexErrorCode`:

- `support.persist_failed` — `retryable: true`, `userActionable: true`. Mapped from any thrown exception in `createBugReport(...)` (DB unavailable, constraint conflict, transport drift). The renderer never sees driver details.

`validation.invalid_input` with `domain: "support"` is emitted automatically by the harness when the input Zod parse fails.

`validation.invalid_sender` is emitted when the frame URL is neither `app://vex/` nor `http://127.0.0.1:5173/` (dev only).

Note: `registerHandler` stamps a **fresh** `correlationId` when the whole envelope (including payload) fails to parse — the renderer's `requestId` is not recovered from a partially-valid envelope. This is the existing harness semantic, not a Phase 1 regression.

---

## 8. The Phase 3 upload stub

`vex-app/src/main/support/transport.ts` defines a tiny interface:

```ts
export interface BugReportTransport {
  enqueue(reportId: string): Promise<{ readonly uploadState: BugReportUploadState }>;
}

export const noopBugReportTransport: BugReportTransport = {
  async enqueue() { return { uploadState: "not_configured" }; },
};
```

Today: every report parks in `upload_state = "not_configured"`. No timer, no worker, no HTTP client.

Phase 3 will swap in an HTTPS uploader with its own consent flag (`preferences.support.uploadEnabled`, default OFF — **separate** from Sentry consent) and a Track 2-style outbox worker using the `upload_state` / `next_upload_at` / `upload_attempt_count` machinery already on the table. `bumpUploadAttempt(...)` in `bug-reports-db.ts` is the prep — it updates `updated_at = NOW()` and writes one attempt's worth of state.

Implementations MUST NOT throw — failures must resolve to a sensible `uploadState` (`failed` or `not_configured`) so the service layer doesn't surface persistence errors for transport faults.

---

## 9. Domain factors — why the schema looks the way it does

The `bug_reports` row carries first-class agent-domain columns because reports captured during agent execution have unique diagnostic value that would be lost in a generic `key TEXT, value TEXT` bag.

- **Context pressure bands** (`memory/policy.ts`): `normal` < 66% → `warning` 66-88% → `barrier` 88-95% → `critical` ≥ 95%. Stamped on `context_pressure_band` + `context_pressure_fraction` so reports captured under high pressure can be filtered separately. Phase 2: an LLM-callable `report_bug` tool is **hidden** at barrier/critical pressure so a report path cannot itself bloat the prompt when context is already stressed.
- **Compaction snapshots** (Track 1 sync + Track 2 async): when a report is captured during the post-compact bridge window (`POST_COMPACT_BRIDGE_CYCLES`, default 2 turns), `post_compact_bridge_active` and `checkpoint_generation` distinguish it from "normal" reports. A failing turn in this window has unique resume-packet context worth flagging.
- **Stop conditions** as pre-classified bug signals: `paused_error`, `system_error`, `compact_unable_at_critical`. Phase 2 emitters stamp these into `stop_reason` and `runtime_status`. Mission contract stops (`goal_reached`, `deadline_reached`, etc.) are **not** bugs — they are business outcomes.
- **Approvals + wake scheduler + operator interrupts**: a strict state machine. Bug-report writes are non-disruptive — they do not transition the state machine. Phase 2 emit points fire after the state machine has already transitioned (e.g. into `paused_error`), so we never race a transition.

Many agent failures **do not throw uncaught**. Tool failures become tool results (visible to the LLM, not to the OS). Protocol capture/projection rejections are warning-only — the tool may look like it succeeded while state is stale. Sync and wake workers log and continue. Phase 2 will add explicit programmatic emit points at these boundaries; relying on `uncaughtException` alone would miss them.

Wallet "action denied" is **not** a bug category by default. Expected policy denials are product behavior. A separate category like `wallet_policy_unexpected` exists only for genuine anomalies where policy state contradicts the expected rule.

---

## 10. Files (Phase 1)

```
src/vex-agent/db/migrations/
└── 019_bug_reports.sql                                       NEW (mirrored at build)

src/vex-agent/memory/
└── redaction.ts                                              EDIT (200 lines → 13-line re-export)

src/lib/diagnostics/                                          NEW dir
├── text-redaction.ts                                         (two-tier, canonical)
├── redactor.ts                                               (composite + Error + bigint guards)
└── bug-report-schema.ts                                      (Zod input/output)

src/__tests__/lib/diagnostics/                                NEW dir
├── text-redaction.test.ts
├── redactor.test.ts
└── bug-report-schema.test.ts

vex-app/src/shared/
├── ipc/channels.ts                                           EDIT (+CH.support.createBugReport)
├── ipc/result.ts                                             EDIT (+domain "support", +code support.persist_failed)
├── schemas/bug-reports.ts                                    NEW (re-export from @vex-lib)
└── types/bridge.ts                                           EDIT (+support namespace in VexBridge)

vex-app/src/preload/
└── index.ts                                                  EDIT (+support.createBugReport)

vex-app/src/main/
├── database/bug-reports-db.ts                                NEW (own pg.Client, finally-closed)
├── database/__tests__/bug-reports-db.test.ts                 NEW (unavailable contract)
├── support/bug-report-service.ts                             NEW (orchestrator)
├── support/transport.ts                                      NEW (NoopBugReportTransport)
├── support/__tests__/bug-report-service.test.ts              NEW
├── ipc/support.ts                                            NEW (handler)
├── ipc/__tests__/support.test.ts                             NEW
└── ipc/register-all.ts                                       EDIT (+registerSupportHandler)

vex-app/src/renderer/
├── features/appShell/AppShell.tsx                            EDIT (+ReportIssueButton)
├── features/appShell/ReportIssueButton.tsx                   NEW
├── features/appShell/ReportIssueDialog.tsx                   NEW
├── features/appShell/__tests__/ReportIssueDialog.test.tsx    NEW
├── lib/report-dedupe.ts                                      NEW
├── lib/__tests__/report-dedupe.test.ts                       NEW
└── main.tsx                                                  EDIT (rewritten — unhandledrejection + dual path + .catch on all)
```

---

## 11. Verification performed

| Check                                                            | Result                                                   |
|------------------------------------------------------------------|----------------------------------------------------------|
| `node vex-app/scripts/copy-migrations.mjs`                       | 16 mig copied, 1 orphan removed, `019` lands as expected |
| `pnpm exec tsc --noEmit -p tsconfig.json` (vex-app)              | exit 0, no output                                        |
| `pnpm exec tsc --noEmit` (root)                                  | exit 0, no output                                        |
| `node vex-app/scripts/check-process-boundaries.mjs`              | `Process boundary check passed.`                         |
| `pnpm exec vitest run` (vex-app full suite)                      | 940 / 940 passed across 90 files, 0 failed              |
| `pnpm exec vitest run` (root full suite)                         | 3462 / 3462 passed across 243 files, 7 skipped, 0 failed |
| `src/__tests__/vex-agent/memory/redaction.test.ts` (backwards)   | 15 / 15 — proves the re-export is behavior-preserving    |
| `grep -rn "from.*vex-agent" src/lib/`                            | 0 hits — layering invariant holds                        |

What was **not** run (out of Phase 1 scope):

- `pnpm build` in vex-app (production rolldown, needs Docker compose state).
- Manual click-through QA in dev (requires Postgres compose up).
- E2E Playwright (Electron, requires packaged build).

---

## 12. Design decisions and trade-offs

### 12.1 Local-first persistence has no consent gate

A bug report is the user's data on the user's disk. Persistence to the local `bug_reports` table is always on. Upload to a remote backend (Phase 3) requires a **separate** consent — `preferences.support.uploadEnabled` — that does not piggyback on the existing Sentry telemetry consent.

Rationale: telemetry consent governs **what leaves the machine**. Local persistence does not leave the machine. Forcing a consent gate before writing locally would mean an opted-out user gets neither Sentry traces nor a local diagnostic record, which is worse for support outcomes.

### 12.2 Sentry coexists, doesn't compete

The existing `vex:telemetry:reportRendererError` Sentry path is unchanged. The renderer wires **both** paths in parallel for caught/uncaught React errors. Reasons:

- Sentry is opt-in (default OFF). For users who opt out, only the local sink captures the event.
- Sentry's offline queue, breadcrumb allowlist, and `beforeSend` redactor are mature. We don't want to re-implement them.
- The two sinks have different consumers: Sentry → Vex maintainers, local sink → the user (and Phase 3 → a different backend).

### 12.3 `support` domain, not `telemetry`

Codex specifically flagged this during plan review. The new IPC namespace is `vex:support:*`, not `vex:telemetry:*`. Three reasons:

1. Don't conflate consent paths. Sentry consent governs telemetry transmission. The local sink should not be hidden under the same name.
2. Support records are different from telemetry events. Telemetry is aggregate / sampled. Support is per-incident.
3. Phase 2 will add "support bundle" export and Phase 3 will add upload — both are first-class `support` operations, not telemetry.

### 12.4 Category as TEXT regex, not enum

Phase 2 and Phase 3 introduce new categories at runtime (Phase 2 programmatic emit points, Phase 3 new failure surfaces from the backend). A SQL enum would require a coordinated migration + preload + main + renderer bump for every new category. The regex CHECK is the simpler boundary.

### 12.5 Soft refs, not foreign keys

`session_id`, `mission_run_id`, `compact_job_id`, etc. are NOT foreign keys. Rationale:

- `vex-app` records bug reports even when the referenced row was reaped (e.g. session ended cleanly and `ON DELETE CASCADE` cleared it) or never existed in the app pool's perspective.
- Phase 2 may decide it wants stage-aware cleanup (e.g. `ON DELETE SET NULL`) — adding that later is reversible. Removing an FK because it caused a missing-parent insert failure is more disruptive.

### 12.6 No LLM-visible `report_bug` tool in Phase 1

Codex's recommendation: programmatic reporting first, LLM tool later. Two reasons:

- Phase 1 has no programmatic emit points yet (deferred to Phase 2 integration). An LLM tool with no real call sites is dead weight.
- An LLM-visible tool at barrier/critical pressure is harmful — it adds prompt weight when context is already stressed. Phase 2 will gate the tool by pressure band.

### 12.7 Renderer-side dedupe only

Phase 1 has dedupe in the renderer (a `Map` keyed by category + first 200 chars of the message, 30s TTL). Main-side rate limiting is deferred to Phase 2 — it only matters when programmatic agent emit points exist that could fire 1000× per second.

---

## 13. What is intentionally deferred

### 13.1 Phase 2 — agent integration

These items unblock once `vex-agent` is imported into `vex-app`:

- Programmatic emit points wired through a `BugReportSink` interface injected at the integration boundary:
  - `engine/turn-loop.ts`: `paused_error`, `system_error`, `compact_unable_at_critical`.
  - `engine/compact-jobs/executor.ts`: `permanently_failed` row → emit.
  - `engine/wake/executor.ts`: resume failures.
  - `sync/`: worker failures.
  - `tools/protocols/`: capture/projection rejections (with `stop_reason` and `protocol_namespace` stamped).
  - `engine/subagents/runner.ts`: lifecycle failures (when subagents come back online).
- Stamp Phase 2 fields on each emit: `stop_reason`, `runtime_status`, `context_pressure_band`, `context_pressure_fraction`, `checkpoint_generation`, `post_compact_bridge_active`.
- Main-side rate limit / dedupe (key = `category + correlation_id + stable_hash(context_summary)`, sliding window, max N per window).
- Prefilled "Report this" actions on user-visible error states (mission run failures, tool failure cards, embedding setup errors).
- A `report_bug` LLM-callable tool, hidden at barrier/critical pressure.

### 13.2 Phase 3 — backend transport

- Backend API contract (HTTPS).
- `preferences.support.uploadEnabled` (default OFF, separate from Sentry).
- Upload worker using `upload_state` / `next_upload_at` / `upload_attempt_count` with exponential backoff (Track 2 pattern, see `compact_jobs` executor).
- Support bundle export: zip of bounded redacted logs + a preview UI so the user sees exactly what would be sent before submission.
- User-visible delete / export controls for local reports.
- Privacy / legal copy (GDPR / CCPA language) — requires product + legal input.

### 13.3 Out of scope, sketched for posterity

- **Settings page** showing a list of local reports (filter by category, severity, date) with export-to-zip and delete-all. Easy follow-up patch — the repo `listRecentBugReports({limit, sinceCreatedAt?})` already exists.
- **Sentry consent copy fix**: `vex-app/src/renderer/features/wizard/steps/review/SentryConsentCard.tsx` claims an anonymous install ID is collected, but the current Sentry init in `sentry-lifecycle.ts` does not attach it. Either fix the copy or attach the tag. Codex deliberately kept this out of the Phase 1 PR — separate small patch.
- **Pre-DB failure file spool fallback**: if Postgres is down or migrations fail before the sink is ready, a bug report cannot persist to `bug_reports`. Today the bootstrap fallback is `electron-log`'s `errorHandler.startCatching` (already redacting). Phase 2 may add a bounded redacted file spool that drains into `bug_reports` once the DB comes up.
- **Better UX for `support.persist_failed` when compose is missing**: today the error maps to `retryable: true`, which is technically true but suggests a retry might succeed without operator action. A dedicated `support.services_unavailable` code with a link to System Check would be a UX improvement.
- **Global JSDOM `HTMLDialogElement` polyfill**: the renderer test for `ReportIssueDialog` includes a local polyfill in `beforeAll` because JSDOM does not implement `showModal`/`close`/`show`. If more dialog-using components grow tests, the polyfill should move to `vex-app/src/renderer/test/setup.ts`.

---

## 14. Pointers — files to read first when extending this subsystem

- `src/lib/diagnostics/redactor.ts` — the trust-boundary contract. Touch this with care; the composite layering (key-name → text → Error → bigint → recursive) was tuned to match the existing `vex-app/src/main/logger/redact.ts` and the agent's `memory/redaction.ts` semantics.
- `src/vex-agent/db/migrations/019_bug_reports.sql` — the canonical schema. Add columns here, not in `vex-app/resources/migrations/` (that directory is `.gitignore`d).
- `vex-app/src/main/support/bug-report-service.ts` — orchestrator. Phase 2 emit points will inject through this module (most likely via a `BugReportSink` interface that wraps `createBugReport`).
- `vex-app/src/main/database/bug-reports-db.ts` — DB layer. Mirror the `sessions-db.ts` pattern for any new query.
- `src/lib/diagnostics/bug-report-schema.ts` — Zod contract. New categories go into `KNOWN_AUTOMATIC_CATEGORIES` for documentation, but the regex is the gate.

---

## 15. Test coverage

| Module                                         | Cases | Notes                                                           |
|------------------------------------------------|-------|------------------------------------------------------------------|
| `text-redaction.test.ts`                       | 12    | Tier 1 hard + Tier 2 mask + `redactObject` shallow              |
| `redactor.test.ts`                             | 10    | key-name + Error unwrap + bigint + depth / circular / truncate  |
| `bug-report-schema.test.ts`                    | 12    | regex / Zod strict / defaults / oversize / uuid                 |
| `bug-reports-db.test.ts`                       | 1     | `BugReportsDbUnavailableError` contract (integration deferred to e2e) |
| `support.test.ts` (IPC)                        | 4     | valid / schema-fail / untrusted sender / service throw          |
| `bug-report-service.test.ts`                   | 6     | redact-before-insert / env stamp / correlationId fallback / retention / refs redaction / transport-throw recovery |
| `ReportIssueDialog.test.tsx`                   | 3     | submit success / persistence error / disabled state             |
| `report-dedupe.test.ts`                        | 4     | drop in window / admit after / LRU eviction / category scope    |

Plus the existing 15 tests in `src/__tests__/vex-agent/memory/redaction.test.ts` continue to pass through the re-export — backwards-compat proof.
