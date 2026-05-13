# VEX Shell — runbook

Private local harness over the Vex Agent engine. Gitignored; not published;
not an MCP transport. Rebuilt during Etap 2 + Etap 3 of the shell redesign;
the pre-rewrite readline-based shell is gone.

## Run

```bash
pnpm exec tsx --tsconfig local/vex-shell/tsconfig.json local/vex-shell/index.ts
```

## Flow

1. **Wizard** (@clack/prompts, linear) — 8 steps:
   1. **System check** — `collectSystemChecks()` + bootstrap. If Postgres /
      embeddings are down, offers `docker compose up -d` + retries.
   2. **Keystore password** — create `VEX_KEYSTORE_PASSWORD` when missing.
   3. **Wallets** — EVM + Solana create/import (delegates to `ensureWallets`).
   4. **API keys** — `JUPITER_API_KEY` (required) + `TAVILY_API_KEY`,
      `RETTIWT_API_KEY` for `twitter_account` read-only X/Twitter research,
      Polymarket CLOB trio (`POLYMARKET_API_KEY` / `_API_SECRET` /
      `_PASSPHRASE`).
   5. **Embedding** — optional override of `EMBEDDING_{BASE_URL,MODEL,DIM,
      PROVIDER}`. `DIM` is locked when `knowledge_entries` is non-empty.
   6. **Agent core** — optional `AGENT_CONTEXT_LIMIT` /
      `AGENT_MAX_OUTPUT_TOKENS` / `AGENT_TEMPERATURE` + all six `SUBAGENT_*`.
   7. **Provider** — OpenRouter (API key prompt + manual model id text input
      — find IDs at https://openrouter.ai/models). The `/v1/models` fetch was
      removed — operator picks the id.
   8. **Mode** — `agent` / `mission`, permission (`restricted` / `full`),
      and a mission goal when mission mode is selected. Wake is always-on and
      not user-configurable.

2. **Ink TUI** — Cockpit (provider / wake / session / mission / approvals) +
   Messages (tool-call stream via `useTurnState` polling every 500 ms) +
   Thinking indicator + ApprovalBanner + Input. Sidebar on Ctrl+D (latency,
   errors). Settings panel on Ctrl+S.

3. **Session auto-wire** — if the wizard picked `mission` with an initial
   goal, App.tsx dispatches it once after the session lands via
   `engine-actions.startMissionFromSetup`.

## Hotkeys

- `Ctrl+D` — toggle Sidebar (latency, last error).
- `Ctrl+S` — toggle Settings panel.
- `Tab` / `Shift+Tab` — cycle Settings tabs when open.
- `Ctrl+L` — clear the visible messages buffer (does not touch DB).
- `Ctrl+C` — exit (Ink's default, wired to `runtime.ts::runShutdown`).

## Settings tabs (Ctrl+S)

13 interactive tabs. Each tab has its own hotkeys (shown in the panel
footer); inline edit forms appear in a yellow box with `Enter` to save and
`Esc` to cancel.

1. **Provider** — `k` edit OPENROUTER_API_KEY, `m` edit AGENT_MODEL +
   re-switch, `o` activate OpenRouter.
2. **Session** — `n` new, `e` end current, `↑↓`
   navigate recent, `Enter` resume.
3. **Mission** — `s` start ready mission (restricted), `a` abort active run.
4. **Approvals** — `↑↓` select, `a` approve, `r` reject (`rejectApproval`),
   `A` approve all.
5. **Tools** — `↑↓` select, `Enter` provide JSON args + run via `runTool`.
6. **Knowledge** — `q` query (calls `knowledge_recall` via `runTool`), `x`
   clear results.
7. **Subagents** — `↑↓` select, `k` stop (calls `subagent_stop`), `r`
   refresh.
8. **Wake** — `t` toggle on/off, `i` edit intervalMs + restart, `b` edit
   batchSize + restart.
9. **Diagnostics** — read-only (latency ring buffer + last error).
10. **Services** — `s` `docker compose up -d`, `p` stop, `r` rebootstrap
    (DB migrations + probes).
11. **Env** — `↑↓` select, `Enter` edit (writes to `.env` + sync). Secrets
    are masked, including `RETTIWT_API_KEY`.
12. **Config** — `↑↓` select, `Enter` edit (calls `saveConfigPatch`). Chain
    rpcUrl change requires `/provider` re-switch to drop cached broker.
13. **Advanced** — `↑↓` select, `Enter` edit `SUBAGENT_*` tunings.

## Architecture

```
local/vex-shell/
├── index.ts          prelude → dynamic import main
├── main.tsx          orchestrator (wizard → session → render Ink)
├── engine-actions.ts pure wrappers for engine exports
├── tsconfig.json     jsx: react-jsx
├── RUN.md            this file
├── platform/         reused modules (bootstrap, log, runtime, services,
│                     session-host, diagnostics, provider, render)
├── wizard/           8 @clack steps + run-wizard orchestrator
└── app/              Ink TUI
    ├── App.tsx
    ├── components/   Cockpit, Messages, Thinking, Approvals, Input,
    │                 Sidebar, SettingsPanel
    ├── hooks/        useSession, useHotkeys, useTurnState
    └── state/        store (useSyncExternalStore)
```

## Unexposed env vars (edit `~/.vex/.env` + restart)

These exist in the code but the wizard and settings panel do not touch them:

- `MCP_TRANSPORT`, `MCP_HTTP_PORT` — for `vex-mcp` binary only.
- `OPENROUTER_BASE_URL` — default is fine for everyone.
- `CHECKPOINT_MODEL` — advanced per-model compaction override.
- `BENCHMARK_OUTPUT_PATH` — only for `benchmark-cross-lingual` script.
- System env (`APPDATA`, `XDG_CONFIG_HOME`, `USER`, `SUDO_USER`) — resolved
  by the OS; not editable at shell level.

## Debug artefacts

The shell writes two debug-only artefacts under `<repo>/local/` (gitignored):

- `local/session-reports/<sessionId>.jsonl` + `.meta.json` — full per-session
  transcript (user input, assistant output, tool I/O, approvals, errors).
  Consumed by an offline evaluator; not production telemetry.
- `local/vex-shell.log` — runtime log while Ink owns the terminal frame.

Knobs (env vars; not surfaced in the wizard):

- `VEX_SHELL_REPORT_DIR` — override the session-reports directory.
- `VEX_SHELL_REPORT_DISABLE=1` — turn the session reporter off (no-op shape,
  no files written).
- `VEX_SHELL_REPORT_NO_REDACT=1` — disable the secret redaction pass on
  recorded tool args / output (use with care).

## Caveats

- Wizard spinners and winston logs both write to stderr. During the wizard
  you may see winston lines interleave with @clack renders; that is cosmetic.
  Once Ink mounts, it owns the frame.
- `processMissionSetupTurn` (triggered automatically when mode=mission)
  currently runs with `maxIterations=15`. If setup keeps calling tools
  without a final text response, it will hit the iteration limit silently;
  watch for `stopReason=iteration_limit` in the Sidebar error line.
- Settings tabs that mutate engine state (`runTool`, `rejectApproval`,
  `saveConfigPatch`, provider hot-switch, services start/stop) all run
  synchronously through `engine-actions.ts` + the engine exports added in
  Etap 3G. Errors land as red toasts under the panel; success as green.
