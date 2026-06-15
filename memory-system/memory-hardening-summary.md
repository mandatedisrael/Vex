# Vex Memory Hardening — State of Work (for peer review)

> Consolidated summary of the memory hardening + benchmarking effort, for an independent Lead-Dev (Codex) review. Detailed docs: `memory-eval-recon.md` (architecture recon), `judge-benchmark-design.md` (benchmark design + adversarial review), `eval-report-latest.md` (130-eval), `judge-benchmark-report*.md` (judge A/B). All test work is test-only; the ONLY production change that ships is Front-1 (judge prompt). Front-2 (conflict detection) was tried and REVERTED as a net regression — see below.

## Goal
Before building further on the Vex memory subsystem (the part of the autonomous crypto agent that decides what to remember/retire and what to retrieve), prove it works on realistic data through the REAL pipeline, find weaknesses, fix them, and PROVE the fixes — so there are no surprises in production.

## What was built (test-only)

### 1. Correctness eval — 130 memories / 90 simulated days (`e2e-memory-correctness.int.test.ts`)
- 130 realistic Solana-spot/perp/memecoin memories driven ONE AT A TIME through the REAL pipeline (live OpenRouter judge `deepseek-v4-flash` + real Gemma embeddings + Postgres testcontainer) over a wall-projected 90-day sim clock.
- Independent hand-authored oracle (zero policy imports) → detects WRONGNESS not just drift.
- HARD/SOFT firewall: structural invariants `expect()` (red on failure); model-decided dims `recordOracleScore` (never red); known gaps = recorded findings.
- Result: 76/76 HARD gates green (decay 11/11, reconcile 8/8 incl. perp, secret-clean, superseded-inactive, clamp, mustNotAppear). SOFT findings surfaced the real limitations (below). Honest path-split reporting (route buckets vs actual judge reach), F31 root-count, F7 not-retired findings.

### 2. Judge-decision benchmark — 134 memories, ALL reaching the live judge (`judge-benchmark.int.test.ts`)
- A SEPARATE suite isolating JUDGE DECISION QUALITY: every item engineered to survive the deterministic stage D1–D11 and hit `callJudge`, across all kinds × all 5 verdicts × a gray-zone calibration band + a 36-item junk trap set.
- Built via DISJOINT subagents (corpus authors ≠ oracle authors; opaque ids `M001..M134`; oracle reads only `judgeItemFacing()`) for non-circularity. Independently adversarially-reviewed before build (3-lens red-team: trap mass, single-run noise, door-bypass, recurrence-forcing, oracle coupling).
- Real-Gemma escalation HARD build gate (non-escalating item fails the BUILD, no judge spend). Stratified N=3 majority-vote on traps/supersede/gray (noise control) + verdict_instability. Captures the judge's RAW 5-axis rubric + judge-raw sourceTier (separate from the clamped tier) for prompt-debugging.
- Metrics: verdict confusion matrix, false_promote_rate (per-subtype HARD gate), reject precision/recall, grounding calibration (mean grounding per oracle tier), rubric-axis-mismatch localization, F7 three-way, F31 health.

## Findings (what the benchmark exposed about the judge)
The live judge (deepseek-v4-flash), BEFORE fixes:
- **false_promote_rate = 50%** — promotes half of what should be rejected.
- **supersede recall = 5%** — 18/21 contradicting theses promoted as fresh parallel peers (F7 semantic-conflict gap: the deterministic stage only flags numeric/date conflicts; prose contradictions never set `conflictFlag`).
- **reject recall = 29%** — lets 71% of junk through.
- **grounding compressed** (none-tier mean 2.86, should be ~1) — the judge over-scores grounding; confident phrasing inflates it despite the prompt.
- **F31 = 34%** invalid JSON output — model reliability.

## Fixes (production) + proof

### Front 1 — judge prompt (`judge-prompt.ts`, ~20 lines) — PROVEN
Sharpened the grounding 1–5 anchors (ungrounded/single-un-realized-instance/fabricated = grounding 1; confidence IRRELEVANT), added a conflict-PRECEDENCE rule (supersede REQUIRED over promote on contradiction), tightened promote (real anchor + conflictFlag FALSE), added two few-shots (high-conf-low-ground reject; contradiction→supersede).
**A/B (re-benchmark):** false_promote 50%→**34%** (−16pp); supersede recall 5%→**58%** (+53pp); junk→promote leakage 13→7; grounding de-inflated (none 2.86→2.44); HARD-gate fails 19→15; F31 unchanged (no regression). Deltas ≫ noise band.

### Front 2 — semantic conflict detection (`deterministic-stage.ts`, D6) — REVERTED (negative experiment)
Widened `conflictFlag` to fire for a same-kind near-dup in the mid-cosine [CONFLICT_COSINE, NEAR_DUP_COSINE) band (where embeddings cannot separate a prose contradiction from a duplicate — only the judge can), in addition to the existing numeric/date conflicts. The hypothesis was that this would give the judge the conflict signal its (Front-1) conflict-precedence rule keys on, for the remaining semantic-supersede misses.
**Outcome — REVERTED.** The A/B was a NET REGRESSION: widening the conflict band BACKFIRED — false_promote 34%→**40%** (+6pp), reject recall 34%→**18%** (−16pp), and NO supersede gain. The band widening made the judge treat too many true duplicates as conflicts, which inflated promotes and gutted reject recall without buying any supersede recall. This change is REVERTED; it is NOT in production.
**Net: the ONLY production change that ships is Front-1 (`judge-prompt.ts`).** Front-2 (`deterministic-stage.ts`) stays at baseline.

### Clamp-gate scorer fix (TEST-ONLY) + benchmark/redactor findings (2026-06-15)
- **`clamp-applied` HARD gate rank-scale bug (12 false reds, TEST-ONLY).** The gate compared the runtime-CLAMPED source tier against the ORACLE `expectedTierCeiling` on a MISALIGNED scale: it used the oracle MERIT ceiling (not the runtime ceiling the clamp actually keys on) AND a collapsed `SOURCE_RANK` (hypothesis=inferred=1). So a CORRECTLY-clamped promote on an oracle-'none' item failed structurally, and — separately — a broken clamp returning 'inferred' for runtime ceiling 'none' would have WRONGLY passed (the collapse hid it). The real invariant (`_eval-fixtures.ts:879-881`) is "clamped ≤ what the RUNTIME ceiling permits".
- **Fix — HARD runtime-invariant / SOFT oracle-merit split (no goalposts moved).** The HARD `clamp-applied:<id>` gate now checks `clampWithinRuntimeCeiling(clamped, r.evidenceStrengthCeiling)` on an UNCOLLAPSED rank (`hypothesis<inferred<observed`, `user_confirmed` exempt) that exactly mirrors `consolidate.ts:clampSourceTier`/`maxTierForCeiling`, re-typed test-side (anti-circularity, no production import) — it is now a pure regression guard on the production clamp (green unless the clamp is bypassed/broken). A NEW SOFT, never-red `recordOracleScore` row keeps the provenance-vs-merit signal against the ORACLE ceiling. No oracle/corpus edits, no clamp/ceiling LOGIC change. Pure helpers (`clampWithinRuntimeCeiling`, `maxSourceForCeiling`) are exported and unit-tested (incl. the explicit `clampWithinRuntimeCeiling("inferred","none")===false` regression the old collapsed scale could not catch).
- **DEFERRED — verdict↔ceiling prompt line (NOT shipped).** A one-line 'none'-only / promote-only CALIBRATION bullet (tying the VERDICT, not just sourceTier, to the ceiling) was implemented and plan-approved, then DROPPED before ship: it is marginal (the 100%-escalating corpus rarely presents a ceiling-'none' item to the judge, so it moves no HARD gate), unprovable on the current benchmark, and the live A/B that would quantify it was blocked by the finding below. **This slice ships TEST-ONLY — zero production change.** The verdict↔ceiling tie is deferred to a future, properly-measured change.
- **FINDING (benchmark fidelity) — seed bypasses door redaction.** `seedGemmaCandidate` (`_eval-fixtures.ts`) inserts RAW corpus text via `insertCandidate` WITHOUT running the door's `redact()`. In production the door redacts at write time, so the promote-time defense-in-depth re-redaction is a no-op; in the benchmark the raw text reaches promote, and for items whose text trips the redactor the production guard throws `PromoteRedactionAnomalyError`. In the 2026-06-15 live A/B this crashed 4 supersede items (M060/M067/M077/M078) whenever the judge took the promotion path, corrupting that run's supersede / false_promote numbers (survivorship bias: correct supersedes crash, wrong promotes survive). PRE-EXISTING — corpus + seed helper + redactor untouched by this slice. RESOLVED for the benchmark by sanitizing the 10 corpus items that trip the redactor (M001/M012/M042/M044/M053/M060/M067/M077/M078/M080 — minimal meaning-preserving edits, oracle untouched; independent re-scan 0/134); the clean re-run then completed with 0 crashes. The seed-vs-door fidelity gap and the deeper redactor false-positive (next bullet) remain tracked production concerns.
- **FINDING (production redactor over-redaction) — BIP39 heuristic false-positive.** `BIP39_HEURISTIC_RE` (`src/lib/diagnostics/text-redaction.ts:63`) hard-redacts ANY run of 12–24 short (3–8 char) lowercase words as a "mnemonic" (by design it "err[s] on the side of false positives"). Ordinary trading prose hits this — the 4 items above carry NO real secret yet redact `hardRedactCount≥1`. In production this means legitimate memories can get `[REDACTED:mnemonic]` spliced mid-text, degrading recall quality. Security-boundary / approval-gated (F5 territory). NOT changed here. TRACKED.
- **DEFERRED — count-based `evidenceStrengthCeiling` (real-but-narrow poisoning risk).** The ceiling is anchor-COUNT based, so it can over-rate well-anchored-but-low-quality junk; because `observed` feeds hot-context inclusion + retrieval ranking, this is a REAL production poisoning surface, not just a benchmark artifact. It is NARROW (needs ≥2 anchors to even escalate) and a fix is a SCHEMA-level evidence-quality decision — deferred to its own staged change, not folded in here.
- **DEFERRED — Fix A (distinct-session quality proxy).** A distinct-session signal as an evidence-quality proxy is ineffective on this single-session benchmark corpus and would have broad production retrieval impact; deferred rather than shipped speculatively.
- **Clean re-run (2026-06-15, post-sanitize).** First end-to-end run with **0 `PromoteRedactionAnomalyError` crashes**. `clamp-applied` 12 false reds → **0** (the scorer split validated across all 134 items); total HARD fails 18 → 13. Judge-quality this run: supersede recall 0.74→0.63, false_promote 20%→30%, honest F31 7%→8%, high_conf_low_ground 1/6→5/6 — a single noisy draw (see next bullet).
- **FINDING (benchmark non-determinism).** The judge runs at `temperature: default`, `seed: unset` (report header), so judge-DECISION metrics swing run-to-run (high_conf_low_ground 1/6 ↔ 5/6 across two same-config runs; the F7-supersede vs promote split is likewise noisy). The clamp/crash results are deterministic and trustworthy; the judge-quality numbers are NOT a stable A/B signal yet. Before measuring any judge change, pin `temperature=0` + a fixed seed. TRACKED.

## Open items
- Front 3 — F31 (34% invalid): optional prose `reasoning` field (gated/additive) + retry.
- ceiling-quality: `evidenceStrengthCeiling` is anchor-COUNT based, over-rates anchored junk (drives the stubborn high_conf_low_ground reds; partly a benchmark artifact — those items need 2 anchors to escalate).
- Benchmark refinements: high_conf items → single/low-quality anchor; per-run reset (N=3 contamination on promote/retain).
- F5 redactor (P01/P02/P05 secret leak) — security boundary, approval-gated.
- **Benchmark seed fidelity (2026-06-15 finding):** `seedGemmaCandidate` bypasses door redaction → `PromoteRedactionAnomalyError` on supersede of redaction-tripping items (M060/M067/M077/M078); blocks a clean judge-quality A/B. Fix test-only: redact-at-seed or sanitize the corpus text.
- **Redactor BIP39 false-positive (2026-06-15 finding):** `BIP39_HEURISTIC_RE` redacts ordinary prose (12–24 short-lowercase-word runs); degrades real production memories with `[REDACTED:mnemonic]`. Security-boundary / approval-gated.
- Commit the proven checkpoint (130-eval + benchmark + Front-1 ONLY; Front-2 is reverted).

> **NOTE on `judge-benchmark-report.md`:** it currently holds the REVERTED-Front-2 numbers (false_promote 40%, reject recall 18%), NOT the trustworthy baseline. After the benchmark-harness trustworthiness fixes (stratum-leak removal, per-run DB reset, honest reached-but-invalid F31 counting), the report will be RE-GENERATED on the Front-1 baseline so the published numbers reflect the only change that actually ships.

## Review questions (the ask)
1. Is the test suite MEANINGFUL/reliable — does a green 130-eval + the benchmark numbers actually measure memory + judge quality, or are there blind spots that let a good number lie?
2. Are the two production fixes (prompt + the D6 conflict-band widening) sound, or do they risk regressions (e.g. over-flagging true duplicates as conflicts, judge over-supersede)?
3. What would you improve in the implementation and in the tests, prioritized?
