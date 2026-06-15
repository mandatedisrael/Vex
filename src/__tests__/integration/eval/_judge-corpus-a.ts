/**
 * Judge-decision benchmark — CORPUS CLUSTER A (Wave 1). TEST-ONLY pure data.
 *
 * SEPARATE from the 130-item `_world-corpus.ts` correctness eval. Like the rest of
 * the judge benchmark (`_judge-corpus.ts`), every item here is engineered to
 * survive D1–D11 (`runDeterministicStage`) and reach the LIVE judge, so the
 * metric denominator is the JUDGE ITSELF — a decision-quality benchmark, not a
 * pipeline-routing one.
 *
 * ── WHAT THIS CLUSTER IS ─────────────────────────────────────────────────────
 * 26 GENERALIZATION-kind PROMOTE candidates from one Solana spot/perp/memecoin
 * agent's bull→range arc, spread across three generalization kinds:
 *   - `trade_lesson`   (8): M001–M008
 *   - `risk_rule`      (6): M009–M014
 *   - `strategy_lesson` (12, incl. 2 spare): M015–M026
 * Themes: higher-low entry, add-to-strength, stop discipline, single-token cap,
 * leverage caps, trend-following over mean-reversion in a bull, range-fade in a
 * chop. All are GENUINE process lessons with two distinct execution anchors each
 * (the durable, recurring grounding a judge SHOULD promote).
 *
 * ── GRAY-ZONE BAND (stratum "gray") ──────────────────────────────────────────
 * Six items (M005, M006, M013, M021, M022, M026) are deliberate border
 * promote/retain calls: STILL genuine and STILL escalating (importance ≥3,
 * confidence ≥0.30, two anchors), but thinner — narrower instance base, milder
 * generalization, or a softer process narrative. The thinness lives in the TEXT,
 * never in the gate scalars, so they reach the judge and the judge (not a
 * deterministic terminal) makes the calibration call. They run N=3 (modal vote +
 * `verdict_instability`) because that is where live-LLM jitter bites hardest.
 *
 * ── ESCALATION RECIPE (every item MUST escalate) ─────────────────────────────
 *   entryVia "seedGemmaCandidate" (door bypassed) + clean English text (no
 *   live-state/secret patterns from `exclusion-rules.ts`) + TWO distinct OWN
 *   executionId anchors (`ownAnchorCount: 2` → recurrence ≥ RECURRENCE_PROMOTE_MIN
 *   so the generalization-kind D7 gate clears; ceiling resolves to "moderate" so
 *   D8 is moot) + unique content vs the others + importance ≥3 + confidence ≥0.30
 *   + future eventTime / NULL TTL. No predecessor here (no supersede in cluster A)
 *   → D4/D5/D6 cannot fire (each item is seeded into its own reset DB).
 *
 * The build-time escalation gate (`judge-benchmark.int.test.ts`) runs the REAL
 * `runDeterministicStage` over REAL Gemma embeddings per item and FAILS THE BUILD
 * (naming NEAR_DUP_COSINE / CONFLICT_COSINE / RECURRENCE_PROMOTE_MIN) if any item
 * terminates deterministically.
 *
 * ── NON-CIRCULARITY ──────────────────────────────────────────────────────────
 * Ids are OPAQUE sequential codes (`M001`…). They encode NO verdict/kind/theme
 * semantics, and the companion oracle reasons from the agent-facing text alone.
 * Authored by a DISJOINT mind from the oracle.
 *
 * Pure module: typed const data only. No DB, no embeddings, no I/O, no `as any`,
 * no policy imports.
 */

import type { JudgeCorpusItem } from "./_judge-corpus.js";

/**
 * Cluster A — 26 generalization-kind PROMOTE candidates (with a 6-item gray
 * sub-band). Appended into `JUDGE_CORPUS.items` by the corpus assembler.
 */
export const CLUSTER_A: JudgeCorpusItem[] = [
  // ── trade_lesson (8) — M001–M008 ──────────────────────────────────────────

  // M001 — higher-low entry. A clean, recurring entry-timing lesson: waiting for
  // a higher low before entering a momentum name avoided buying the local top.
  {
    id: "M001",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Entering WIF only after a higher low printed avoided buying the local top",
      summary:
        "Across two separate WIF momentum entries, waiting for price to set a higher low after the initial impulse — rather than chasing the first green candle — produced a materially better average entry and a cleaner stop placement below that swing low.",
      contentMd:
        "Process note: the rule that repeated was 'do not chase the first impulse; wait for the pullback to hold a higher low, then enter against that structure.' Both anchored entries followed this sequence, and the realized exits cleared the average entry comfortably. The lesson is about the entry trigger (higher-low confirmation), not the size or the specific token.",
      importance: 7,
      confidence: 0.72,
    },
  },

  // M002 — add-to-strength. Adding to a winner only after confirmation, twice.
  {
    id: "M002",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Adding to BONK only after the breakout held captured the trend leg",
      summary:
        "On two distinct BONK trend legs, scaling the position up only after the breakout level held on a retest — instead of front-running the breakout — meant the adds were already in profit and never turned a winner into a loser on a failed break.",
      contentMd:
        "Process note: the repeatable rule is 'add to strength on a confirmed, retested breakout, never to a position that is still proving itself.' Both anchored adds were placed after a hold-and-go, and both legs realized gains above the blended cost. The lesson is the add-timing discipline, independent of the specific name.",
      importance: 7,
      confidence: 0.7,
    },
  },

  // M003 — cut-the-loser / stop discipline as a trade lesson (sizing the loss).
  {
    id: "M003",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Honoring the predefined invalidation on POPCAT kept two losers small",
      summary:
        "On two POPCAT entries that failed, exiting at the predefined structural invalidation instead of widening the stop in hope kept each loss to a planned, survivable size and freed capital to re-enter the eventual real move.",
      contentMd:
        "Process note: the recurring discipline is 'the stop is decided before entry and is not moved down to avoid being wrong.' Both anchored exits were taken at the level set at entry; both names later offered a cleaner re-entry that was taken with the preserved capital. The lesson is loss discipline, not a prediction about POPCAT.",
      importance: 8,
      confidence: 0.74,
    },
  },

  // M004 — taking partial profit into strength to de-risk a runner.
  {
    id: "M004",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Trimming a third into vertical strength removed the round-trip risk",
      summary:
        "On two parabolic legs, selling roughly a third of the position into the vertical move and trailing the remainder converted an unrealized spike into booked gains while still leaving a runner, so a sharp reversal could no longer erase the trade.",
      contentMd:
        "Process note: the repeatable rule is 'into a vertical, blow-off move, trim a portion to bank the gain and trail the rest — do not hold the full size hoping for more.' Both anchored trims preceded a meaningful pullback that would otherwise have round-tripped the position. The lesson is the de-risking action, not the specific token.",
      importance: 7,
      confidence: 0.71,
    },
  },

  // M005 — GRAY: re-entry after a stop-out. Genuine but thinner: the instance
  // base is narrow (two entries on the SAME name within one regime) and the rule
  // edges toward a single-context heuristic, so promote-vs-retain is a real call.
  {
    id: "M005",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Re-entering JUP after a stop-out worked when structure was still intact",
      summary:
        "After being stopped on JUP, re-entering once price reclaimed the broken level seemed to recover the move on two occasions, suggesting a stop-out is not always a reason to abandon a thesis when the higher-timeframe structure has not broken.",
      contentMd:
        "Process note: both re-entries were on the same name inside one trending stretch, so the evidence is real but narrow. The candidate rule — 'a stop-out with intact higher-timeframe structure can justify one disciplined re-entry' — may be a context-specific habit rather than a durable, generalizable lesson. Flagged as a borderline promote.",
      importance: 5,
      confidence: 0.55,
    },
  },

  // M006 — GRAY: avoiding low-liquidity hours. Genuine observation-flavored
  // lesson, milder generalization (timing-of-day), thinner process narrative.
  {
    id: "M006",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Skipping entries during the thin overnight session reduced bad fills",
      summary:
        "On two occasions, declining to open a new momentum entry during the thinnest part of the session — when the order book was sparse — appeared to avoid the slippage and whipsaw that had hurt earlier overnight attempts.",
      contentMd:
        "Process note: the candidate rule is 'avoid initiating fresh momentum entries in the thinnest liquidity window.' The grounding is real but soft — the two anchored decisions were 'did not enter,' so the counterfactual benefit is inferred rather than realized. Borderline between a durable timing rule and a one-off observation.",
      importance: 5,
      confidence: 0.5,
    },
  },

  // M007 — letting the plan, not PnL, decide exits (process-over-outcome).
  {
    id: "M007",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Exiting on the signal rather than on green PnL kept winners running",
      summary:
        "On two trend trades, holding until the exit signal fired — instead of selling the moment the position turned green — let the winners run their full leg, and the realized gains were several times what an early take-profit would have captured.",
      contentMd:
        "Process note: the recurring discipline is 'exit on the predefined signal, not on the emotional relief of being in profit.' Both anchored exits were signal-driven and both captured the bulk of the move. The lesson is that the exit rule must be mechanical, decoupled from the unrealized number.",
      importance: 8,
      confidence: 0.73,
    },
  },

  // M008 — not averaging down on a thesis-broken loser.
  {
    id: "M008",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Refusing to average down once the thesis broke avoided compounding losses",
      summary:
        "On two losing positions where the original reason for the trade had clearly failed, refusing to add to the loser to lower the average — and instead taking the planned loss — prevented a manageable mistake from becoming an account-threatening one.",
      contentMd:
        "Process note: the repeatable rule is 'never add to a position whose thesis has been invalidated; averaging down is only ever a sizing decision made in advance, not a reaction to being wrong.' Both anchored exits honored this and capped the damage. The lesson is about invalidation discipline, not the specific tokens.",
      importance: 8,
      confidence: 0.75,
    },
  },

  // ── risk_rule (6) — M009–M014 ─────────────────────────────────────────────

  // M009 — single-token concentration cap.
  {
    id: "M009",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Cap any single memecoin at roughly a tenth of the book",
      summary:
        "Two episodes where a single concentrated memecoin position drove an outsized drawdown taught that no individual memecoin should exceed about a tenth of total capital, so one bad name cannot dominate the equity curve.",
      contentMd:
        "Risk note: the rule is 'size any single high-volatility memecoin so its worst-case loss is bounded to a small fraction of the book — roughly a tenth as a hard ceiling.' Both anchored episodes showed the pain of breaching this; sizing within the cap kept later losers survivable. The rule is about concentration, independent of which token.",
      importance: 8,
      confidence: 0.76,
    },
  },

  // M010 — leverage cap on perps in high volatility.
  {
    id: "M010",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Hold perp leverage at or below three times in high-volatility regimes",
      summary:
        "Two liquidation-near-misses on leveraged perps during volatile stretches established that keeping effective leverage at or under three times in high-volatility conditions leaves enough room for normal noise without forced liquidation.",
      contentMd:
        "Risk note: the rule is 'in a high-volatility regime, cap effective perp leverage at three times so an ordinary adverse swing cannot trigger liquidation.' Both anchored positions came uncomfortably close when leverage ran higher; the capped sizing afterward held through similar swings. The rule scales risk to volatility, independent of the instrument.",
      importance: 8,
      confidence: 0.75,
    },
  },

  // M011 — per-trade risk budget (fixed fractional risk).
  {
    id: "M011",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Risk a fixed small fraction of equity per trade, sized off the stop",
      summary:
        "Two oversized losses that hurt more than the setup warranted established a fixed-fractional rule: risk a small constant fraction of equity per trade, with position size derived from the distance to the stop rather than from conviction.",
      contentMd:
        "Risk note: the rule is 'pick a fixed per-trade risk fraction and let the stop distance determine size — wider stop, smaller size — so every trade risks the same amount of the book regardless of how strong the idea feels.' Both anchored trades violated this by sizing on conviction; normalizing to the budget smoothed the equity curve. The rule is about consistent risk units.",
      importance: 8,
      confidence: 0.77,
    },
  },

  // M012 — daily loss limit / stop-trading circuit breaker.
  {
    id: "M012",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Stop trading for the day after the daily loss limit is hit",
      summary:
        "Two days where losses snowballed into revenge trades taught that hitting a predefined daily loss limit should immediately halt all new entries until the next session, because the worst decisions clustered after the limit was already breached.",
      contentMd:
        "Risk note: the rule is 'define a daily loss limit; once it is reached, take no new positions until the next day.' Both anchored days showed that trading past the limit turned a normal red day into a large one. The rule is a behavioral circuit breaker against tilt, independent of market conditions.",
      importance: 8,
      confidence: 0.74,
    },
  },

  // M013 — GRAY: correlation-aware sizing. Genuine but thinner — the rule rests
  // on a softer, more inferential read of correlated exposure across two names.
  {
    id: "M013",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Treat several memecoins as one correlated bet when sizing",
      summary:
        "On two occasions, holding multiple memecoins at once felt diversified but behaved like a single position when the whole sector moved together, hinting that correlated names should share one risk budget rather than each carrying a full allocation.",
      contentMd:
        "Risk note: the candidate rule is 'when names are highly correlated, size them against a shared budget, not independently, so apparent diversification does not hide concentrated directional risk.' The grounding is real but the correlation read is inferential rather than measured, so this is a borderline promote versus a recallable hypothesis.",
      importance: 5,
      confidence: 0.55,
    },
  },

  // M014 — keep a stable cash/SOL reserve for re-entries and fees.
  {
    id: "M014",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Keep a fixed cash reserve so a drawdown never forces a bad exit",
      summary:
        "Two episodes of being fully deployed when an opportunity or a fee obligation arrived taught that keeping a fixed cash reserve out of the market preserves the optionality to re-enter on weakness and to cover costs without liquidating a good position.",
      contentMd:
        "Risk note: the rule is 'always hold back a defined cash reserve; never be one hundred percent deployed.' Both anchored episodes showed the cost of being fully invested — a forced or missed decision. The reserve is a liquidity buffer, independent of the current names held.",
      importance: 7,
      confidence: 0.72,
    },
  },

  // ── strategy_lesson (10 + 2 spare = 12) — M015–M026 ───────────────────────

  // M015 — trend-following over mean-reversion in a confirmed bull.
  {
    id: "M015",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "In a confirmed bull, follow the trend instead of fading strength",
      summary:
        "Two stretches where fading rallies lost money while buying pullbacks worked established that, once the higher-timeframe trend is confirmed up, trend-following beats mean-reversion — shorting strength in a bull is fighting the dominant force.",
      contentMd:
        "Strategy note: the recurring rule is 'identify the higher-timeframe regime first; in a confirmed bull, take long-biased trend setups and stop fading strength.' Both anchored stretches contrasted a losing fade with a winning pullback-buy. The lesson is regime-conditioned strategy selection, not a single-name call.",
      importance: 8,
      confidence: 0.76,
    },
  },

  // M016 — range-fade in a chop regime (the mirror of M015).
  {
    id: "M016",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "In a clear range, fade the edges instead of chasing breakouts",
      summary:
        "Two choppy stretches where breakout entries kept failing while fading the range boundaries worked established that, in a confirmed range regime, mean-reversion at the edges beats trend-following — most breakouts in a chop are traps.",
      contentMd:
        "Strategy note: the recurring rule is 'when the regime is a range, sell the top of the range and buy the bottom, and treat breakouts as suspect until proven.' Both anchored stretches showed failed breakouts paired with profitable fades. The lesson is the regime-matched strategy, the inverse of the bull-trend rule.",
      importance: 8,
      confidence: 0.75,
    },
  },

  // M017 — wait for regime confirmation before committing a strategy.
  {
    id: "M017",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Confirm the regime before committing to a trend or a range playbook",
      summary:
        "Two periods where applying the wrong playbook to an unconfirmed regime produced repeated small losses taught that the first job is to classify the regime, and only then pick the matching strategy, rather than forcing one style onto every market.",
      contentMd:
        "Strategy note: the recurring meta-rule is 'classify the regime first; let the regime select the strategy.' Both anchored periods showed the cost of applying a trend playbook in a range and vice versa. The lesson sits above any single setup — it governs which setup library to use.",
      importance: 8,
      confidence: 0.74,
    },
  },

  // M018 — favor liquid majors when sizing up; reserve memecoins for small size.
  {
    id: "M018",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Scale size into liquid majors, keep memecoins to small exploratory size",
      summary:
        "Two episodes where memecoin slippage and gaps ate into returns established a sizing strategy: put the larger, scalable size into liquid majors like SOL and reserve memecoins for small, asymmetric, exploratory positions where the bad fills do less damage.",
      contentMd:
        "Strategy note: the recurring rule is 'match position size to liquidity — majors get scalable size, memecoins get small exploratory size.' Both anchored episodes showed that sizing up an illiquid name imported execution risk. The lesson tiers the book by liquidity, not by which specific token is in favor.",
      importance: 7,
      confidence: 0.72,
    },
  },

  // M019 — Raydium vs Jupiter routing as a strategy lesson (execution quality).
  {
    id: "M019",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Route larger Solana swaps through an aggregator to cut execution drag",
      summary:
        "Two larger swaps where a single venue gave a worse fill than the aggregated route established that, above a modest size, routing through a Jupiter-style aggregator rather than a single Raydium pool consistently reduced execution drag.",
      contentMd:
        "Strategy note: the recurring rule is 'for non-trivial size, prefer aggregated routing over a single pool to minimize execution drag.' Both anchored swaps compared a direct-pool fill with an aggregated one and the aggregated route won. The lesson is about execution venue selection by size, independent of the token.",
      importance: 7,
      confidence: 0.71,
    },
  },

  // M020 — funding-aware perp side selection (carry).
  {
    id: "M020",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Let persistently negative funding tilt the perp bias toward longs",
      summary:
        "Two stretches where funding stayed persistently negative — shorts paying longs — established that a durable funding skew is both a carry tailwind and a crowding signal, and tilting the directional bias to align with the paid side improved net outcomes.",
      contentMd:
        "Strategy note: the recurring rule is 'read persistent funding as a carry-plus-positioning signal and lean the directional bias toward the side that gets paid, all else equal.' Both anchored stretches showed the funding-aligned side outperform after costs. The lesson is a funding-aware bias rule, not a single trade.",
      importance: 8,
      confidence: 0.73,
    },
  },

  // M021 — GRAY: narrative/catalyst timing. Genuine but softer — relies on a
  // qualitative narrative read, milder and more inferential generalization.
  {
    id: "M021",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Entering ahead of a known catalyst worked better than chasing it after",
      summary:
        "On two occasions, positioning into a name a little before a widely anticipated catalyst seemed to outperform entering after the news landed, hinting that the anticipation phase, not the event itself, carried most of the move.",
      contentMd:
        "Strategy note: the candidate rule is 'position into anticipation, not into the confirmed news.' The read is qualitative and the two anchors are narrative-driven, so the durability of the edge is uncertain — it could be selection bias on two favorable events. Borderline between a strategy lesson and a single-regime observation.",
      importance: 5,
      confidence: 0.55,
    },
  },

  // M022 — GRAY: time-of-week seasonality. Thin, weakly generalizable, soft.
  {
    id: "M022",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Weekend momentum on Solana memecoins faded more often than it followed through",
      summary:
        "Two weekend stretches where memecoin pumps reversed by the next session suggested weekend strength on thin liquidity is less reliable than weekday momentum, hinting at a mild seasonality worth weighting down rather than trading aggressively.",
      contentMd:
        "Strategy note: the candidate rule is 'discount weekend memecoin momentum; thin weekend liquidity makes follow-through less reliable.' Two observations is a thin base for a seasonality claim and the effect may not persist across regimes, so this is a borderline promote versus a recallable note.",
      importance: 4,
      confidence: 0.5,
    },
  },

  // M023 — scale conviction by confluence (multiple signals agreeing).
  {
    id: "M023",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Reserve full size for setups where multiple signals agree",
      summary:
        "Two trades showed that the best outcomes came when trend, structure, and the broader regime all pointed the same way, establishing a confluence rule: take full size only on multi-signal agreement and keep single-signal trades small.",
      contentMd:
        "Strategy note: the recurring rule is 'grade conviction by confluence — full size when trend, structure, and regime agree; reduced size on a lone signal.' Both anchored trades scored high confluence and worked; lower-confluence attempts were the ones that disappointed. The lesson scales size to signal agreement.",
      importance: 8,
      confidence: 0.74,
    },
  },

  // M024 — pre-commit the full plan (entry, stop, target) before entering.
  {
    id: "M024",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Define entry, stop, and target before entering, not after",
      summary:
        "Two trades that drifted into improvised management taught that writing the entry, stop, and target before committing capital — and then executing that plan mechanically — produced far steadier outcomes than deciding the exits in the heat of the move.",
      contentMd:
        "Strategy note: the recurring rule is 'pre-commit the whole plan — entry, invalidation, and target — before entry, then execute it without renegotiating mid-trade.' Both anchored trades that were planned end-to-end ran cleanly; the improvised ones were where mistakes crept in. The lesson is about planning discipline, not a setup.",
      importance: 8,
      confidence: 0.75,
    },
  },

  // M025 — rotate profits from extended names into fresh setups.
  {
    id: "M025",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Rotate realized gains out of extended names into fresh setups",
      summary:
        "Two cycles where capital sat in already-extended winners and missed the next leg elsewhere established a rotation strategy: bank gains from a name that has run far and redeploy into earlier-stage setups rather than holding a fully-priced position.",
      contentMd:
        "Strategy note: the recurring rule is 'rotate realized profit from extended, late-stage moves into earlier-stage setups instead of marrying a winner.' Both anchored cycles showed idle capital in a topped-out name while a fresh setup ran. The lesson is capital-rotation discipline across the book.",
      importance: 7,
      confidence: 0.72,
    },
  },

  // M026 — GRAY: sentiment-extreme contrarianism. Genuine but thin/soft — rests
  // on a fuzzy sentiment read and a small, possibly cherry-picked instance base.
  {
    id: "M026",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Fading extreme euphoria on memecoins worked on a couple of occasions",
      summary:
        "On two occasions, trimming or standing aside when social sentiment looked euphoric seemed to sidestep the subsequent reversal, hinting that crowd extremes can be a contrarian timing signal — though the sentiment read was subjective.",
      contentMd:
        "Strategy note: the candidate rule is 'treat extreme euphoria as a reason to de-risk rather than add.' The sentiment input is qualitative and only two instances support it, so the edge could be hindsight. Borderline between a durable contrarian rule and an over-read of two lucky exits.",
      importance: 5,
      confidence: 0.52,
    },
  },
];
