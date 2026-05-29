---
id: index.boundaries
kind: boundary-index
paths: ["VEX-INDEX/boundaries/**/*.md", "VEX-INDEX/Structure.md"]
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change: ["VEX-INDEX/Structure.md", "VEX-INDEX/boundaries/**/*.md"]
related: [index.structure, index.modules]
---

# Boundary Index

Boundary docs are the contract surfaces between Vex components. Use them to answer "what's allowed to cross, in which direction, validated how?". Each doc is a small, durable cross-cutting view; module docs hold the per-file detail.

- `boundary.process-boundaries` — `boundaries/boundary-process.md`. Renderer ↔ preload ↔ main ↔ engine; what each owns; forbidden imports; F5/F6 RESOLVED (Bundle B) — control-state bridge (`onControlState`) wired through preload→bridge→renderer live-sync, 5s approvals poll retained as fast fallback; runtime bridge now uses per-action result unions (legacy `RuntimeRequestResult` removed).
- `boundary.ipc-contracts` — `boundaries/boundary-ipc.md`. CH/EV/error/domains/cancel inventory; validation hops; reserved/unbridged constants.
- `boundary.env-secrets` — `boundaries/boundary-env-secrets.md`. `.env` vs vault (N=65536) vs keystore (N=16384); lock semantics; F1 boot order; renderer secret discipline.
- `boundary.database-contracts` — `boundaries/boundary-database.md`. Engine pool vs main raw `pg`; schema version 027 / 24 SQL files; mirror parity; ADR-0001 column contract.

Open extensions (not yet written; capture under audits/current rather than new boundary docs unless they grow):
- Docker / local services boundary — currently captured in `modules/vex-app/local-services-docker.md` and `modules/vex-app/main-docker-compose-onboarding.md`.
- Release / updater boundary — captured in `modules/vex-app/packaging-build-release-updater.md`; F12 marks the implementation as placeholder-only.
