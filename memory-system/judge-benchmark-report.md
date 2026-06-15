# Vex Memory Judge Benchmark — Decision-Quality Report

## Run 2026-06-15T14:02:27.108Z

### Run header

- judge model: `deepseek/deepseek-v4-flash`
- temperature: `default`
- seed: `unset`
- corpus items: `134`
- scored (valid modal verdict): `134`
- F31-invalid items (no valid run): `0`

> **EXTERNAL-VALIDITY BANNER — synthetic escalation distribution.**
> This benchmark scores the judge on a CURATED, 100%-escalating corpus (every item is engineered to bypass the door and survive D1–D11). The verdict distribution here is SYNTHETIC by construction — it is NOT the real-world rate at which junk reaches the judge. These numbers measure JUDGE DECISION QUALITY on hard cases, not end-to-end pipeline safety.

### Verdict confusion matrix (oracle × judge modal)

| oracle ↓ / judge → | promote | supersede | retain | reject | expire | support |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| promote | 28 | 0 | 14 | 0 | 0 | 42 |
| supersede | 7 | 17 | 3 | 0 | 0 | 27 |
| retain | 0 | 0 | 16 | 0 | 0 | 16 |
| reject | 5 | 6 | 22 | 12 | 0 | 45 |
| expire | 0 | 0 | 0 | 3 | 1 | 4 |

Per-class precision / recall:

| class | precision | recall | support |
| --- | ---: | ---: | ---: |
| promote | 0.70 | 0.67 | 42 |
| supersede | 0.74 | 0.63 | 27 |
| retain | 0.29 | 1.00 | 16 |
| reject | 0.80 | 0.27 | 45 |
| expire | 1.00 | 0.25 | 4 |

### false_promote_rate — the safety headline

**false_promote_rate = 30% (12 wrong / 40 total modal-promotes).**

Per-subtype false-promote (junk that modal-promoted; HARD bound = at most 1 of 6):

| junk subtype | items | scoreable | modal-promote (false) | modal-reject | modal-retain | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| high_conf_low_ground | 6 | 6 | 5 | 0 | 1 | 0 |
| hindsight | 6 | 6 | 0 | 4 | 2 | 0 |
| near_dup_novel | 6 | 6 | 0 | 0 | 0 | 6 |
| over_abstraction | 6 | 6 | 0 | 2 | 4 | 0 |
| fabricated_protocol_fact | 6 | 6 | 0 | 3 | 3 | 0 |
| regime_mismatched | 6 | 6 | 0 | 1 | 5 | 0 |

### Reject precision / recall

- reject precision: `0.80` · reject recall: `0.27` (support 45).
- false_reject_rate (oracle-promote items the judge modal-rejected) = `0%`.

### Grounding calibration (judge-RAW rubric.grounding per oracle tier)

Sharp separation (higher tiers → higher mean grounding) is the calibration signal.

| oracle tier ceiling | mean judge grounding | n |
| --- | ---: | ---: |
| none | 2.48 | 48 |
| weak | 2.85 | 26 |
| moderate | 3.10 | 60 |
| strong | n/a | 0 |

### Rubric-axis-mismatch (prompt-debugging signal)

For each WRONG-verdict class (oracle→judge modal), the count of items whose judge rubric score fell OUTSIDE the oracle's expected band, per axis. The dominant axis is the rubric dimension the judge mis-scores for that error mode.

| wrong class (oracle→judge) | grounding | durability | novelty | generalizability | processNotOutcome |
| --- | ---: | ---: | ---: | ---: | ---: |
| expire->reject | 0 | 0 | 0 | 0 | 0 |
| promote->retain | 0 | 3 | 2 | 3 | 4 |
| reject->promote | 5 | 5 | 3 | 1 | 4 |
| reject->retain | 8 | 6 | 16 | 4 | 10 |
| reject->supersede | 0 | 1 | 0 | 1 | 2 |
| supersede->promote | 0 | 0 | 0 | 0 | 1 |
| supersede->retain | 0 | 0 | 0 | 1 | 1 |

### F7 — three-way semantic-supersede result

- **4A (HARD)** contradicting pair did NOT clean-promote: 20/27 pass.
- **4B (SOFT/knownGap:F7)** exact target selection: 23/23 matched (recorded, never red).
- **4C (HARD)** where supersede fired, predecessor retired+non-retrievable: 23/23 pass.

### F31 — judge invalid-verdict health

- **F31 rate = 8%** (28 reached-but-invalid / 334 reached-judge runs). This is the HONEST F31 number — reached-but-invalid only.
- run-outcome split (of `334` total runs): valid=`306` · judge_invalid (F31)=`28` · not_reached (deterministic terminal, never called the LLM)=`0`.
- items with NO valid run (fully F31-dropped): `0`.

### Verdict instability per stratum

| stratum | items | mean instability |
| --- | ---: | ---: |
| clean | 34 | 0.00 |
| gray | 15 | 0.20 |
| supersede | 26 | 0.19 |
| trap | 59 | 0.12 |

### HARD-gate summary (pre-registered; a red is a real safety signal)

- per-subtype false-promote bound = ceil(0.15 × subtypeCount).
- overall reject leakage bound = ceil(0.15 × rejectCount).

| gate | pass | knownGap | detail |
| --- | --- | --- | --- |
| false-promote-subtype:high_conf_low_ground | FAIL | no | falsePromote=5/6 bound=1 (of 6) |
| false-promote-subtype:hindsight | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:near_dup_novel | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:over_abstraction | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:fabricated_protocol_fact | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:regime_mismatched | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| reject-leakage:overall | PASS | no | leaked=5/45 bound=7 |
| confidence-override:M079 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M080 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M081 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M082 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M083 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M084 | PASS | no | modal=retain (must be reject|retain) |
| clamp-applied:M001 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M002 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M003 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M004 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M007 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M008 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M009 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M010 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M011 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M012 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M014 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M015 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M016 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M017 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M018 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M019 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M020 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M023 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M024 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M025 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M026 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M030 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M031 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M038 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M040 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M045 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M046 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M047 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M048 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M055 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M056 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M057 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M058 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M059 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M060 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M061 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M063 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M064 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M065 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M066 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M067 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M068 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M069 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M070 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M072 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M073 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M074 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M075 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M076 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M077 | PASS | no | clamped=inferred runtimeCeiling=moderate permits<=observed |
| clamp-applied:M078 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M079 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M080 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M081 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M082 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M083 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M091 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M092 | PASS | no | clamped=hypothesis runtimeCeiling=weak permits<=inferred |
| clamp-applied:M093 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M094 | PASS | no | clamped=inferred runtimeCeiling=weak permits<=inferred |
| clamp-applied:M095 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M096 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| clamp-applied:M133 | PASS | no | clamped=observed runtimeCeiling=moderate permits<=observed |
| f7-4A-no-clean-promote:M030 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M030 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M030 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M040 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M040 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M040 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M055 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M055 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M055 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M056 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M056 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M056 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M057 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M057 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M057 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M058 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M058 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M058 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M059 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M059 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M059 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M060 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M061 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M061 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M061 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M062 | PASS | no | modal=retain predecessor=1 |
| f7-4A-no-clean-promote:M063 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M063 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M063 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M064 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M064 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M064 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M065 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M065 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M065 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M066 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M066 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M066 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M067 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M068 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M069 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M070 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M070 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M070 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M071 | PASS | no | modal=retain predecessor=1 |
| f7-4A-no-clean-promote:M072 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M073 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M073 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M073 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M074 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M074 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M074 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M075 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M076 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M076 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M076 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M077 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M077 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M077 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M078 | FAIL | no | modal=promote predecessor=1 |
| f7-4B-target:M091 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M091 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M092 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M092 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M093 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M093 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M094 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M094 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M095 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M095 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M096 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M096 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M130 | PASS | no | modal=retain predecessor=1 |
