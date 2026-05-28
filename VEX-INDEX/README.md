# VEX-INDEX — durable codebase index for LLM navigation

> This folder is the working knowledge base for **future-Claude sessions** on this repo.
> Files are LLM-readable: granular, stable headings, symbol+line anchors, cross-linked IDs.
> Designed with Codex consultation (session `vex-index-design`, 2026-05-28).

## How to navigate (future-me)

1. **Quick repo map** → `Structure.md` (Stage-1 zone index Z1–Z8 + integration wiring map).
2. **A specific module** → `modules/<area>/<name>.md`. Terse listing in `modules/_INDEX.md`.
3. **End-to-end flow** (chat-turn, mission-start, approval, wake, compact, onboarding) → `flows/<name>.md`.
4. **Trust boundaries / IPC / env / DB contracts** → `boundaries/<topic>.md`.
5. **Why we chose X (design)** → `decisions/ADR-NNNN-<topic>.md`.
6. **Gaps / smells / vex-app coverage** → `audits/current/{coverage-gaps,quality-findings,security-review}.md`.
7. **What's in flight (bug fixes, audits)** → `00-PROGRESS.md` + `fix-plans/`.
8. **Project vocabulary** → `glossary.md`.
9. **Machine-readable doc catalog** → `MANIFEST.yml` (use for retrieval / refresh).

## File conventions

### Front matter (YAML, required on every module/flow/boundary/decision/audit doc)

```yaml
---
id: <stable.dotted.id>
kind: module | flow | boundary | decision | audit | tracker | …
paths: ["glob/**", …]            # source paths the doc describes
source_commit: <abbrev sha>      # repo snapshot the facts describe
indexed_at: YYYY-MM-DD
stale_when_paths_change: [globs] # paths that, when modified, invalidate this doc
related: [<id>, <id>, …]         # cross-links by id
---
```

### Stable IDs (grep-safe, rename-tolerant)

- **Module**: `module.<area>.<name>` — e.g. `module.vex-agent.engine-core`, `module.vex-app.renderer-appshell`.
- **Capability**: `CAP-<area>-<verb>-<target>` — e.g. `CAP-engine-resume-paused_wake`, `CAP-renderer-render-approval-card`.
- **Flow**: `FLOW-<name>` — e.g. `FLOW-chat-turn`, `FLOW-approval-restricted-resume`.
- **Finding**: `FINDING-<area>-<NNN>` — e.g. `FINDING-security-001`, `FINDING-engine-007`.
- **Decision**: `ADR-NNNN-<slug>` — e.g. `ADR-0001-global-model-session-wallet`.

### Anchors

Prefer **`path:line symbol`** over bare `path:line`. Lines drift; symbols survive most refactors.
- ✅ `src/vex-agent/engine/ingress.ts:43 routeUserMessage`
- ⚠ `src/vex-agent/engine/ingress.ts:43` (still useful but less stable)

### Canonical ownership

- **Coverage matrix lives ONLY in `audits/current/coverage-gaps.md`**. Module docs reference by `#CAP-…`, not duplicate matrices.
- **Quality findings live ONLY in `audits/current/quality-findings.md`** with status (`open|fixed|superseded|wontfix`). Module docs reference by `#FINDING-…`.

## Tree

```
VEX-INDEX/
├── README.md                           (this file)
├── MANIFEST.yml                        machine-readable canonical index
├── 00-PROGRESS.md                      live tracker
├── Structure.md                        Stage-1 zone index Z1–Z8 + integration wiring
├── glossary.md                         project terms / aliases for retrieval
├── fix-plans/F{1,2,3}-*.md             per-bug plans (shipped on main, commits 97c2c9c..0430072)
├── audit-vex-agent-plan.md             10-agent vex-agent deep-audit plan (Round 1)
├── modules/
│   ├── _INDEX.md                       terse listing of all modules (auto/manual updated)
│   ├── vex-agent/                      ~10 docs — Round 1
│   ├── src-root/                       — Round 2
│   └── vex-app/                        — Round 3
├── flows/                              end-to-end traces (Round 2)
├── boundaries/                         trust/IPC/env/DB contracts (post-Round 1)
├── decisions/                          ADRs (start with ADR-0001 global-model)
└── audits/
    ├── current/                        latest truth (coverage-gaps, quality-findings, security)
    └── archive/                        dated snapshots if needed
```

## When this index is stale

A doc is **stale** when any path in its `stale_when_paths_change` has changed since its `source_commit`. To refresh:

1. `git log --since=<source_commit> --name-only -- <stale_when_paths_change>` to detect drift.
2. Re-run the corresponding agent prompt OR edit by hand and bump `source_commit` + `indexed_at`.

`MANIFEST.yml` is the source of truth for which docs cover which paths.

## Conventions for round-N audit agents

Round 1 = `modules/vex-agent/*`. Round 2 = `modules/src-root/*` + `flows/*`. Round 3 = `modules/vex-app/*` + populated `audits/current/coverage-gaps.md`.

Agents:
- Use `general-purpose` subagent type (have `Write` to land directly here).
- Write one .md to a fixed path; return a short status (don't dump report into my context).
- Apply the template (next section) and stable IDs.
- Append their doc entry to `MANIFEST.yml` (or I batch-update at consolidation).

## Module template

See `MANIFEST.yml` `templates.module` for the canonical version; mirrored here for human reading:

```markdown
---
id: module.<area>.<name>
kind: module
paths: ["<glob>", …]
source_commit: <abbrev>
indexed_at: YYYY-MM-DD
stale_when_paths_change: [<globs>]
related: [<ids>]
---

# <Title>

## Purpose
1 short paragraph.

## Retrieval keywords
- alias 1
- alias 2

## State owned
- DB tables / env vars / Zustand stores / event buses / files

## Boundary crossings
- IPC, DB, env, filesystem, network, wallet/signing

## File map
- `path:line symbol` — purpose — key exports

## Key types & invariants
- `TypeName` (`path:line`) — invariant.

## Capabilities (stable IDs)
- **CAP-…**: 1 line — `path:line symbol`

## Public API (consumed by)
- caller location → entry function

## Internal flow
End-to-end with anchors (cross-link to `flows/<id>.md` if multi-module).

## Dependencies
- Imports FROM: <ids>
- Consumed BY: <ids> (paths in vex-app/src/… for cross-process consumers)

## Cross-references
- vex-app coverage: `audits/current/coverage-gaps.md#CAP-…`
- quality findings: `audits/current/quality-findings.md#FINDING-…`
- related flows: `flows/<id>.md`
- related decisions: `decisions/ADR-NNNN-…`

## Refresh triggers
Paths/commits that invalidate this doc.

## Open questions
- ...
```

## Flow template

```markdown
---
id: FLOW-<name>
kind: flow
…
---

# FLOW-<name>: <title>

## Trigger
What kicks off this flow (user action, event, scheduler).

## Steps

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|--------------|

## Invariants

## Related modules / capabilities
- `module.…` (CAP-…)

## Known failure modes
- (link to FINDING-… in quality-findings.md)
```
