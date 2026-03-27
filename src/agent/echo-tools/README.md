# echoTools (Scaffold)

This directory is a template for the new EchoClaw protocol function-calling layer.

## Scope Rules

- `internal tools` stay in `src/agent` and remain directly available in runtime tool set.
- `discover_tools` and `execute_tool` are for protocol capabilities only.
- Protocol scope is controlled by explicit allowlist, not by implicit filesystem discovery.

## Naming Rules

- Use real CLI root names for namespaces (`0g-compute`, `0g-storage`, `solana`).
- Do not use `chains` namespace in catalog.
- `wallet` can be declared while execution stays disabled in phase 1.

## Phase 1 notes

- Active minimum target: `solana`, `khalani`, `kyberswap`.
- `marketmaker` is excluded from this phase.
- Approval/resume/scheduler/trade-capture integration is mandatory when execution is enabled.

## TODO

- Add canonical manifest entries with `toolId` and parameter schemas.
- Validate allowlist and command mappings against `src/cli-runtime.ts`.
- Wire runtime handlers (`discover_tools`, `execute_tool`) and scheduler compatibility.
- Add unit/integration tests for namespace drift and lifecycle policy.

