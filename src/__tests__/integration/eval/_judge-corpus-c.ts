/**
 * Judge-decision benchmark — CORPUS CLUSTER C (Wave 1). TEST-ONLY pure data.
 *
 * SUPERSEDE cluster: 24 items, opaque ids `M055`…`M078`, EVERY item engineered to
 * survive D1–D11 and reach the LIVE judge carrying a same-kind, high-cosine ACTIVE
 * predecessor so the judge must decide SUPERSEDE-vs-REJECT (never promote a
 * contradicting v2 as a fresh standalone peer while v1 stays active). All
 * `stratum: "supersede"` → the runner draws each N=3 with modal-verdict
 * aggregation + a `verdict_instability` capture (live-LLM jitter is highest on the
 * safety-critical supersede decisions).
 *
 * ── TWO CONFLICT SHAPES (design §16/§17, §92 F7 split) ───────────────────────
 *   NUMERIC/DATE (19 items): the inline `predecessor` is same-kind at cosine
 *     ≥ CONFLICT_COSINE (0.85) and the candidate carries a DIFFERING number or
 *     date (e.g. v1 "cap 5%" → v2 "cap 2% after the 2nd drawdown"). The Graphiti
 *     guardrail (`differsOnNumberOrDate`) flips the high-cosine match from a D5
 *     near-dup REJECT into a D6 conflict FLAG — NOT a deterministic terminal — so
 *     the candidate escalates with `conflictFlag` + `conflictKnowledgeId` set and
 *     the judge owns supersede-vs-reject.
 *   SEMANTIC (5 items, the F7 probes — M057, M062, M066, M071, M076): SAME thesis,
 *     DIFFERENT mechanism, NO number/date diff. `differsOnNumberOrDate` is false
 *     (both texts are number-free / share identical numbers) so D6 does NOT flag
 *     and there is NO `conflictKnowledgeId` hint — exactly the F7 gap. Their text
 *     is deliberately worded so the predecessor↔candidate cosine stays BELOW
 *     NEAR_DUP_COSINE (0.93): same high-level concern, materially different surface
 *     (instrument / lever / venue), so D5 does NOT reject them either → escalate.
 *     The oracle (disjoint author) holds the judge to the correct predecessor as a
 *     tracked `knownGap:F7`, never a permanent red.
 *
 * ── PREDECESSOR LINKAGE (compiled-contract note; see escalation banner below) ──
 * The Wave-0 stub's `JudgeCorpusItem` carries the predecessor INLINE as raw text
 * (`predecessor: { kind, title, summary }`) and the benchmark runner
 * (`judge-benchmark.int.test.ts → seedItem`) seeds it as a REAL-Gemma ACTIVE
 * knowledge entry BEFORE the candidate. There is NO `supersedesItemId`/separate-
 * predecessor-row field on `JudgeCorpusItem`, and the runner has no branch that
 * treats a `seedPredecessorDirect` row as a non-scored predecessor — so in THIS
 * benchmark a predecessor is NEVER a scored corpus item; it is the inline object.
 * That is how this cluster keeps "predecessors not scored": they are inline, never
 * `JUDGE_CORPUS.items` rows. (The brief's "15 scored + 9 separate
 * `seedPromotedLessonDirect` predecessor rows linked by `supersedesItemId`" is the
 * 130-item `_world-corpus.ts` model; the judge-benchmark stub does not expose it.
 * Reconciling the global SUPERSEDE budget at Wave-3 integration is a human call —
 * see the escalation note returned with this cluster.)
 *
 * ── ESCALATION RECIPE (design §1; every item MUST escalate) ──────────────────
 *   seedGemmaCandidate + clean English (no live secrets/state) + 2 OWN distinct
 *   executionId anchors (all kinds here contain a generalization marker
 *   risk/strategy/lesson/pattern/heuristic → D7 gates them; 2 anchors clear it) +
 *   unique content_hash + cosine managed + importance ≥3 + confidence ≥0.30 +
 *   NULL TTL ⇒ escalate → live judge. The build-time escalation gate runs the REAL
 *   `runDeterministicStage` over REAL Gemma and FAILS THE BUILD (naming the gate +
 *   constant) if any item terminates deterministically.
 *
 * Realism: one Solana spot/perp/memecoin autonomous agent across bull→range→bear
 * (WIF / BONK / POPCAT / SOL / JUP, Raydium / Jupiter / Drift, funding, mint-
 * authority). Every revision is a concrete operating-rule change the agent would
 * actually log, NOT gate-bait.
 *
 * Pure module: typed const data only. No DB, no embeddings, no I/O, no `as any`,
 * no policy imports. The shape asserts in `_judge-corpus.ts` (run at import of the
 * aggregate) cover these once Wave-3 splices the cluster into `JUDGE_CORPUS`.
 */

import type { JudgeCorpusItem } from "./_judge-corpus.js";

// ════════════════════════════════════════════════════════════════════════════
//  CLUSTER C — 24 SUPERSEDE items (M055–M078). All stratum "supersede" (N=3).
//  Each scored candidate is `seedGemmaCandidate` with an inline ACTIVE
//  predecessor it is meant to supersede. ownAnchorCount=2 on every item (all
//  kinds are generalization kinds → D7 needs ≥2 own anchors).
// ════════════════════════════════════════════════════════════════════════════

export const CLUSTER_C: JudgeCorpusItem[] = [
  // ── NUMERIC: per-trade risk cap tightened after a second drawdown. v1 5% → v2
  //    2% (after the 2nd drawdown). Differs on "5"/"2" → D6 conflict, escalate.
  {
    id: "M055",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "risk_rule",
      title: "Cap per-trade risk at 5 percent of the book on memecoin entries",
      summary:
        "Risk no more than 5 percent of the book on any single Solana memecoin entry so one bad fill cannot dent the account.",
    },
    suggest: {
      title: "Cap per-trade risk at 2 percent of the book after a second drawdown",
      summary:
        "Tighten the per-trade memecoin risk cap from 5 percent to 2 percent of the book once a second drawdown lands in a week; the 5 percent cap compounded losses through clustered failed breakouts.",
      contentMd:
        "Revision: the 5 percent per-trade cap let two clustered drawdowns chew through the book in a single week. Cut the cap to 2 percent after the second drawdown so the third failed entry costs far less.",
      importance: 8,
      confidence: 0.74,
    },
  },

  // ── NUMERIC: stop distance widened on SOL momentum. v1 8% → v2 12%.
  {
    id: "M056",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "risk_rule",
      title: "Place an 8 percent stop on SOL momentum entries",
      summary:
        "On SOL momentum entries place the protective stop 8 percent below the entry to cap downside on a failed breakout.",
    },
    suggest: {
      title: "Place a 12 percent stop on SOL momentum entries",
      summary:
        "Widen the SOL momentum stop from 8 percent to 12 percent below entry; the 8 percent stop was getting clipped by ordinary intraday noise before the move resumed.",
      contentMd:
        "Revision: realized SOL volatility routinely swept the 8 percent stop on noise, then the trade worked without us. A 12 percent stop fits the measured swing while still bounding the loss.",
      importance: 7,
      confidence: 0.71,
    },
  },

  // ── SEMANTIC (F7): same thesis (avoid getting wicked out of WIF longs) but a
  //    DIFFERENT mechanism (time-stop vs price-stop). No number/date diff → no D6
  //    hint. Distinct surface keeps cosine < 0.93 → no D5 reject → escalate.
  {
    id: "M057",
    kind: "exit_heuristic",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "exit_heuristic",
      title: "Protect WIF longs with a hard price stop below the breakout base",
      summary:
        "Defend a WIF long by resting a hard price stop just under the broken consolidation base so a failed breakout is cut immediately.",
    },
    suggest: {
      title: "Protect WIF longs with a patience time-stop instead of a tight base stop",
      summary:
        "Rather than a hard price stop under the base, hold a WIF long against a fixed time-stop and exit only if the breakout has not followed through by the session close; the price stop kept knifing us out on the retest before the real move.",
      contentMd:
        "Mechanism change, same goal of not bleeding on WIF breakouts: replace the structural price stop with a session time-stop. The retest into the base was triggering the price stop and then resolving up without us; a time box tolerates the retest while still bounding how long we stay wrong.",
      importance: 7,
      confidence: 0.62,
    },
  },

  // ── NUMERIC: Drift perp leverage cut after a liquidation scare. v1 5x → v2 3x.
  {
    id: "M058",
    kind: "position_sizing_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "position_sizing_rule",
      title: "Run Drift perps at 5x leverage on majors",
      summary:
        "On Drift perp longs in SOL and majors, 5x leverage balances capital efficiency against liquidation risk.",
    },
    suggest: {
      title: "Run Drift perps at 3x leverage on majors after the liquidation scare",
      summary:
        "Cut Drift perp leverage on majors from 5x to 3x; a single fast wick at 5x took the position within a hair of liquidation despite a correct directional call.",
      contentMd:
        "Revision: the thesis was right but 5x left no room for a 20 percent intraday wick on SOL and we nearly got liquidated. At 3x the same wick is survivable and the edge still compounds.",
      importance: 8,
      confidence: 0.76,
    },
  },

  // ── DATE: regime cutover date for the bull "add to strength" playbook. v1
  //    "through 2026-03-15" → v2 "retire after 2026-04-01". Differs on the date.
  {
    id: "M059",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "strategy_lesson",
      title: "Run the add-to-strength playbook through 2026-03-15 while momentum pays",
      summary:
        "Keep adding to winning Solana momentum positions through 2026-03-15; the bull regime is still rewarding strength.",
    },
    suggest: {
      title: "Retire the add-to-strength playbook after 2026-04-01 as the range sets in",
      summary:
        "Stop adding to strength after 2026-04-01; from that date momentum follow-through faded into a range and adding to winners started giving back gains at the highs.",
      contentMd:
        "Revision: the original cutover of 2026-03-15 was too early — strength still paid into late March — but by 2026-04-01 the tape was ranging and add-to-strength entries reversed. Move the retirement date to 2026-04-01.",
      importance: 7,
      confidence: 0.66,
    },
  },

  // ── NUMERIC: minimum 24h volume filter for memecoin entries. v1 250k → v2 1M.
  {
    id: "M060",
    kind: "entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "entry_pattern",
      title: "Only enter memecoins with at least 250k of 24 hour volume",
      summary:
        "Require at least 250000 dollars of trailing 24 hour volume before entering a Solana memecoin so the exit has liquidity.",
    },
    suggest: {
      title: "Only enter memecoins with at least 1 million of 24 hour volume",
      summary:
        "Raise the memecoin entry volume floor from 250000 to 1000000 dollars of trailing 24 hour volume; at 250k the exits slipped badly when the move faded, and the spread widened.",
      contentMd:
        "Revision: 250k of 24h volume looked tradeable on entry but the book vanished on the way out and slippage ate the edge. A 1M floor keeps a real two-sided book at the exit.",
      importance: 7,
      confidence: 0.7,
    },
  },

  // ── NUMERIC: BONK take-profit ladder first rung. v1 +40% → v2 +25%.
  {
    id: "M061",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "trade_lesson",
      title: "Take first BONK profit at 40 percent above entry",
      summary:
        "Sell the first tranche of a BONK position at 40 percent above the average entry to bank a win while letting the rest run.",
    },
    suggest: {
      title: "Take first BONK profit at 25 percent above entry",
      summary:
        "Move the first BONK take-profit rung from 40 percent down to 25 percent above entry; BONK rarely held a 40 percent extension and the unbanked tranche kept round-tripping back to entry.",
      contentMd:
        "Revision: waiting for plus 40 percent meant the first tranche frequently gave the gain back. Banking the first rung at plus 25 percent locks a realized win and the runner still carries the upside.",
      importance: 6,
      confidence: 0.68,
    },
  },

  // ── SEMANTIC (F7): same thesis (size memecoin entries to liquidity) but a
  //    DIFFERENT mechanism (slippage-budget vs fixed-dollar). No number diff.
  {
    id: "M062",
    kind: "position_sizing_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "position_sizing_rule",
      title: "Size memecoin entries by a fixed notional regardless of pool depth",
      summary:
        "Enter every Solana memecoin with the same fixed dollar notional so position management stays simple across names.",
    },
    suggest: {
      title: "Size memecoin entries by a slippage budget against the live pool",
      summary:
        "Replace the one-size fixed notional with a size that keeps expected entry-and-exit slippage inside a budget for the live Raydium pool; a flat notional was fine on deep pools but brutal on thin ones where the same notional moved the price against us both ways.",
      contentMd:
        "Mechanism change, same intent of not overtrading thin liquidity: stop sizing by a flat dollar amount and instead solve for the size whose round-trip slippage fits a budget against the current pool depth. Deep pools get a bigger clip, thin pools a smaller one.",
      importance: 7,
      confidence: 0.64,
    },
  },

  // ── NUMERIC: Drift funding-rate avoidance threshold. v1 0.05%/8h → v2 0.1%/8h.
  {
    id: "M063",
    kind: "funding_strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "funding_strategy_lesson",
      title: "Avoid holding a Drift long when funding exceeds 0.05 percent per 8 hours",
      summary:
        "Close or trim a Drift perp long once funding climbs above 0.05 percent per 8 hour interval so carry does not erode the position.",
    },
    suggest: {
      title: "Avoid holding a Drift long only when funding exceeds 0.1 percent per 8 hours",
      summary:
        "Raise the Drift long funding-exit threshold from 0.05 to 0.1 percent per 8 hours; exiting at 0.05 percent cut us out of strong trends whose carry was easily paid by the move.",
      contentMd:
        "Revision: 0.05 percent per 8h funding was triggering exits in trends that more than covered the carry. Only the sustained 0.1 percent and above regime actually erodes the edge, so move the line there.",
      importance: 7,
      confidence: 0.69,
    },
  },

  // ── NUMERIC: mint-authority safety check window. v1 within 24h → v2 within 72h.
  {
    id: "M064",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "risk_rule",
      title: "Only buy a new memecoin if mint authority was revoked within 24 hours of launch",
      summary:
        "Require that a new Solana memecoin had its mint authority revoked within 24 hours of launch before taking any position.",
    },
    suggest: {
      title: "Only buy a new memecoin if mint authority was revoked within 72 hours of launch",
      summary:
        "Relax the mint-authority revocation window from 24 to 72 hours; several legitimate launches revoked on a slower schedule and the strict 24 hour gate made us miss clean names while never actually catching a rug the 72 hour window would have let through.",
      contentMd:
        "Revision: the 24 hour mint-authority window excluded honest projects that revoked on day two or three. Widening to 72 hours keeps the rug protection (revocation still required) without filtering out slow-but-safe launches.",
      importance: 8,
      confidence: 0.72,
    },
  },

  // ── NUMERIC: max concurrent open positions. v1 6 → v2 4.
  {
    id: "M065",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "risk_rule",
      title: "Hold at most 6 concurrent open Solana positions",
      summary:
        "Cap the book at 6 concurrent open Solana positions so attention and risk stay manageable.",
    },
    suggest: {
      title: "Hold at most 4 concurrent open Solana positions in the bear",
      summary:
        "Cut the concurrent-position cap from 6 to 4 in the bear regime; at 6 positions correlated memecoin drawdowns stacked and the book moved as one losing trade.",
      contentMd:
        "Revision: 6 concurrent names felt diversified but in a risk-off tape they were one correlated bet and all bled together. A cap of 4 forces tighter selection when correlation is high.",
      importance: 7,
      confidence: 0.7,
    },
  },

  // ── SEMANTIC (F7): same thesis (confirm a Raydium breakout before entry) but a
  //    DIFFERENT mechanism (volume confirmation vs retest confirmation). No number.
  {
    id: "M066",
    kind: "entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "entry_pattern",
      title: "Confirm a Raydium breakout with a surge in trade volume before entering",
      summary:
        "Only enter a Raydium-listed name on a breakout once trade volume surges through the level, taking the volume expansion as the confirmation.",
    },
    suggest: {
      title: "Confirm a Raydium breakout with a successful retest before entering",
      summary:
        "Instead of treating a volume surge as the green light, wait for price to break the level and then hold a retest of it before entering; the volume-spike entries kept buying the exact blow-off candle and getting trapped, while a clean retest filtered the fakeouts.",
      contentMd:
        "Mechanism change, same goal of only trading real breakouts: stop using the volume spike as confirmation and require a structural retest that holds. The spike often marked the local top; the retest gives a lower-risk entry on names that actually broke out.",
      importance: 7,
      confidence: 0.63,
    },
  },

  // ── NUMERIC: JUP staking allocation cap. v1 30% → v2 15%.
  {
    id: "M067",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "strategy_lesson",
      title: "Allocate up to 30 percent of the book to JUP staking for yield",
      summary:
        "Park up to 30 percent of the book in JUP staking to earn yield on otherwise idle capital between trades.",
    },
    suggest: {
      title: "Allocate at most 15 percent of the book to JUP staking for yield",
      summary:
        "Cut the JUP staking allocation cap from 30 to 15 percent; the unstake cooldown locked up too much capital when fast memecoin setups appeared, and the missed trades cost more than the staking yield earned.",
      contentMd:
        "Revision: 30 percent in JUP staking looked efficient but the unbonding delay meant we could not redeploy into setups quickly. Capping at 15 percent keeps dry powder liquid for opportunistic entries.",
      importance: 6,
      confidence: 0.65,
    },
  },

  // ── NUMERIC: POPCAT trailing-stop trail distance. v1 15% → v2 8%.
  {
    id: "M068",
    kind: "exit_heuristic",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "exit_heuristic",
      title: "Trail POPCAT winners by 15 percent off the high",
      summary:
        "Once a POPCAT position is in profit, trail the stop 15 percent below the running high to ride the trend while protecting gains.",
    },
    suggest: {
      title: "Trail POPCAT winners by 8 percent off the high",
      summary:
        "Tighten the POPCAT trailing stop from 15 to 8 percent off the high; the 15 percent trail gave back too much on POPCAT's sharp reversals before the trail ever triggered.",
      contentMd:
        "Revision: POPCAT reverses fast and a 15 percent trail surrendered most of an open gain before stopping out. An 8 percent trail banks more of the move at the cost of a few early exits on noise.",
      importance: 6,
      confidence: 0.67,
    },
  },

  // ── NUMERIC: minimum holder-count gate for new memecoins. v1 500 → v2 2000.
  {
    id: "M069",
    kind: "entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "entry_pattern",
      title: "Require at least 500 holders before entering a new memecoin",
      summary:
        "Gate new Solana memecoin entries on at least 500 distinct holders as a floor for organic distribution.",
    },
    suggest: {
      title: "Require at least 2000 holders before entering a new memecoin",
      summary:
        "Raise the new-memecoin holder floor from 500 to 2000; at 500 holders the supply was still concentrated enough that a couple of wallets dumping wrecked the exit.",
      contentMd:
        "Revision: 500 holders was too easy to fake with fresh wallets and the top holders still controlled the float. A 2000 holder floor better screens for real distribution before we provide exit liquidity to insiders.",
      importance: 7,
      confidence: 0.71,
    },
  },

  // ── NUMERIC: daily loss circuit-breaker. v1 stop after -10% day → v2 -6% day.
  {
    id: "M070",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "risk_rule",
      title: "Halt trading for the day after a 10 percent book drawdown",
      summary:
        "Stop opening new positions for the rest of the day once the book is down 10 percent to avoid revenge trading.",
    },
    suggest: {
      title: "Halt trading for the day after a 6 percent book drawdown",
      summary:
        "Tighten the daily circuit-breaker from a 10 percent to a 6 percent book drawdown; by the time we hit minus 10 percent the damage was already large and the bad decisions had compounded.",
      contentMd:
        "Revision: minus 10 percent was too deep a hole before the breaker tripped, and the worst trades clustered in the slide. Cutting the day at minus 6 percent stops the bleed while it is still recoverable.",
      importance: 8,
      confidence: 0.73,
    },
  },

  // ── SEMANTIC (F7): same thesis (manage a depeg event in a stable LP) but a
  //    DIFFERENT mechanism (exit-the-pool vs hedge-with-perp). No number diff.
  {
    id: "M071",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "strategy_lesson",
      title: "On a stable depeg, pull liquidity out of the pool immediately",
      summary:
        "If a stablecoin in a Raydium LP position starts to depeg, withdraw the liquidity at once to stop accumulating the bad side of the pair.",
    },
    suggest: {
      title: "On a stable depeg, hedge the exposure with a perp instead of pulling liquidity",
      summary:
        "Rather than rushing to withdraw LP on a stable depeg, hold the pool and short the depegging asset with a Drift perp to neutralize the directional exposure; pulling liquidity mid-depeg crystallized the impermanent loss at the worst price, whereas a hedge let the peg recover while we were flat.",
      contentMd:
        "Mechanism change, same goal of surviving a depeg without taking a directional hit: stop reflexively withdrawing the LP (which locks in the loss at the panic low) and instead delta-hedge the bad leg with a perp short until the peg resolves, then unwind.",
      importance: 8,
      confidence: 0.66,
    },
  },

  // ── NUMERIC: slippage tolerance on Jupiter swaps. v1 1% → v2 0.5%.
  {
    id: "M072",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "trade_lesson",
      title: "Set Jupiter swap slippage tolerance to 1 percent",
      summary:
        "Route swaps through Jupiter with a 1 percent slippage tolerance to balance fill probability against price impact.",
    },
    suggest: {
      title: "Set Jupiter swap slippage tolerance to 0.5 percent on liquid names",
      summary:
        "Tighten Jupiter slippage tolerance from 1 percent to 0.5 percent on liquid names; at 1 percent we were repeatedly filled at the worst end of the band and MEV sandwiches ate the difference.",
      contentMd:
        "Revision: a 1 percent tolerance on liquid pairs invited sandwich fills at the band edge. On deep books 0.5 percent still fills reliably and halves the price-impact give-up.",
      importance: 6,
      confidence: 0.69,
    },
  },

  // ── NUMERIC: re-entry cooldown after a stop-out. v1 1 hour → v2 4 hours.
  {
    id: "M073",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "trade_lesson",
      title: "Wait 1 hour before re-entering a name after a stop-out",
      summary:
        "After being stopped out of a Solana name, wait at least 1 hour before re-entering it to avoid chasing the same failed setup.",
    },
    suggest: {
      title: "Wait 4 hours before re-entering a name after a stop-out",
      summary:
        "Extend the post-stop-out re-entry cooldown from 1 hour to 4 hours; one hour was not enough to break the chase reflex and the quick re-entries were usually the same broken setup that stopped us out again.",
      contentMd:
        "Revision: a 1 hour cooldown still let us re-enter the same dead setup on tilt. A 4 hour gap forces the chart to actually rebuild structure before we are allowed back in.",
      importance: 6,
      confidence: 0.66,
    },
  },

  // ── NUMERIC: Drift perp position-size cap relative to open interest. v1 2% of
  //    OI → v2 0.5% of OI.
  {
    id: "M074",
    kind: "position_sizing_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "position_sizing_rule",
      title: "Keep a Drift perp position under 2 percent of the market open interest",
      summary:
        "Size a Drift perp so the position stays under 2 percent of the venue open interest to keep exit impact low.",
    },
    suggest: {
      title: "Keep a Drift perp position under 0.5 percent of the market open interest",
      summary:
        "Cut the Drift perp open-interest cap from 2 percent to 0.5 percent; at 2 percent of OI on a thin perp our own unwind moved the mark against us and showed up as outsized exit slippage.",
      contentMd:
        "Revision: 2 percent of open interest was a large enough footprint that closing the position visibly walked the mark. Holding under 0.5 percent of OI keeps our exit from being the price-setting flow.",
      importance: 7,
      confidence: 0.7,
    },
  },

  // ── NUMERIC: minimum reward-to-risk per setup. v1 1.5:1 → v2 2.5:1.
  {
    id: "M075",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "strategy_lesson",
      title: "Only take setups with at least a 1.5 to 1 reward-to-risk",
      summary:
        "Require a minimum 1.5 to 1 reward-to-risk on a planned setup before committing capital.",
    },
    suggest: {
      title: "Only take setups with at least a 2.5 to 1 reward-to-risk in the bear",
      summary:
        "Raise the minimum reward-to-risk from 1.5 to 1 up to 2.5 to 1 in the bear regime; with a lower hit-rate in risk-off tape the 1.5 to 1 setups no longer cleared costs after slippage and fees.",
      contentMd:
        "Revision: 1.5 to 1 worked when the win rate was high in the bull, but in the bear the hit-rate fell and 1.5 to 1 went negative-expectancy net of frictions. Demanding 2.5 to 1 restores the edge at the lower win rate.",
      importance: 7,
      confidence: 0.71,
    },
  },

  // ── SEMANTIC (F7): same thesis (don't chase a vertical memecoin pump) but a
  //    DIFFERENT mechanism (skip-entirely vs wait-for-pullback-entry). No number.
  {
    id: "M076",
    kind: "entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "entry_pattern",
      title: "Skip a memecoin entirely once it has gone vertical",
      summary:
        "If a Solana memecoin has already gone vertical on the chart, pass on it completely rather than chase an extended move.",
    },
    suggest: {
      title: "Wait for the first pullback to enter a memecoin that has gone vertical",
      summary:
        "Instead of skipping a vertical memecoin outright, watch it and enter on the first orderly pullback that holds a higher low; blanket-skipping meant we missed the strongest trending names entirely, while a disciplined pullback entry captured the continuation without buying the blow-off.",
      contentMd:
        "Mechanism change, same goal of not buying the top of a parabola: stop reflexively passing on every vertical name and instead let it have its first pullback, then enter if it sets a higher low. The strongest movers are exactly the ones that go vertical, and the pullback gives a defined-risk entry.",
      importance: 7,
      confidence: 0.62,
    },
  },

  // ── NUMERIC: stale-quote guard for the executor. v1 reject quotes older than
  //    5 seconds → v2 2 seconds.
  {
    id: "M077",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "risk_rule",
      title: "Reject a Jupiter quote older than 5 seconds before signing",
      summary:
        "Treat a Jupiter route quote older than 5 seconds as stale and refetch before signing the swap.",
    },
    suggest: {
      title: "Reject a Jupiter quote older than 2 seconds before signing",
      summary:
        "Tighten the stale-quote guard from 5 seconds to 2 seconds; in fast tape a 5 second old quote was already off the market, and the fill diverged from the displayed price.",
      contentMd:
        "Revision: 5 seconds was an eternity during volatile memecoin moves, and the executed price drifted well off the quoted route. A 2 second freshness window keeps the signed price close to the live market.",
      importance: 7,
      confidence: 0.72,
    },
  },

  // ── NUMERIC: profit-taking scale-out fraction per rung. v1 sell 25% per rung →
  //    v2 sell 33% per rung.
  {
    id: "M078",
    kind: "exit_heuristic",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 2,
    predecessor: {
      kind: "exit_heuristic",
      title: "Scale out of a winner by selling 25 percent at each profit rung",
      summary:
        "On a winning Solana position, sell 25 percent of the remaining size at each successive profit target to bank gains gradually.",
    },
    suggest: {
      title: "Scale out of a winner by selling 33 percent at each profit rung",
      summary:
        "Increase the scale-out fraction from 25 percent to 33 percent per rung; selling only a quarter at a time left too much size exposed when memecoin trends ended abruptly, and the late rungs never filled.",
      contentMd:
        "Revision: at 25 percent per rung the position stayed too heavy into the back of the move, and abrupt memecoin reversals stranded the unsold size. Selling 33 percent per rung de-risks faster while still leaving a runner.",
      importance: 6,
      confidence: 0.68,
    },
  },
];
