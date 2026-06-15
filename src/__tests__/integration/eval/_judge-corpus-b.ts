/**
 * Judge-decision benchmark — CORPUS CLUSTER B (Wave 1). TEST-ONLY pure data.
 *
 * Ids M027–M054 (28 items). Non-generalization + mixed kinds:
 *   user_preference (8), protocol_fact (10), pumpfun_entry_pattern (6),
 *   observation (2), market_note (2).
 *
 * SEPARATE from the 130-item `_world-corpus.ts` correctness eval. Like the rest
 * of the judge benchmark, EVERY item here is engineered to survive D1–D11 and
 * reach the LIVE judge (the metric denominator is the JUDGE ITSELF). The shapes
 * (`JudgeCorpusItem` / `CorpusSuggest`), the opaque-id form, the `stratum` field,
 * the `entryVia` values, and the "generalization kinds carry ≥2 own anchors" rule
 * all mirror the Wave-0 stub `_judge-corpus.ts` exactly. This file only EXPORTS
 * the cluster array; the integration step that appends it into `JUDGE_CORPUS.items`
 * lives elsewhere (append-only by opaque id).
 *
 * ── ESCALATION RECIPE (every item MUST escalate) ─────────────────────────────
 *   entryVia "seedGemmaCandidate" (door bypassed) + clean English text (no
 *   live-state/secret) + ≥1 live execution anchor + importance ≥3 + confidence
 *   ≥0.30 + future/NULL TTL ⇒ escalate → live judge.
 *   - `pumpfun_entry_pattern` contains "pattern" → the production
 *     `isGeneralizationKind` treats it as a GENERALIZATION → D7 gates it at
 *     recurrence < RECURRENCE_PROMOTE_MIN (2). Those items therefore carry TWO
 *     DISTINCT own executionId anchors (`ownAnchorCount: 2`) so recurrence ≥ 2
 *     and they escalate (the robust per-candidate route, NOT vector clustering).
 *   - `user_preference` / `protocol_fact` / `observation` / `market_note` are
 *     NON-generalization → D7-exempt → 1 own anchor is sufficient.
 *
 * ── EXPIRE PROBES (M053/M054 + two protocol_fact) ────────────────────────────
 * The EXPIRE items reach the judge via DUAL-TRACE realized staleness in the
 * agent-facing text, NOT via the D10 TTL terminal: the `seedGemmaCandidate`
 * seeder always sets `retainUntil = null`, so D10 never fires and the JUDGE must
 * recognize the staleness from the content (a market/protocol state the text
 * itself says has already resolved/rolled off). They still satisfy importance ≥3
 * and confidence ≥0.30 so no D8/D9 terminal pre-empts the judge.
 *
 * ── SUPERSEDE PROBES (M030, M040) ────────────────────────────────────────────
 * Each carries an ACTIVE `predecessor` seeded BEFORE the candidate (real Gemma
 * entry) that differs on a NUMBER, so the deterministic D6 conflict flag fires
 * (NOT terminal) and the numeric revision reaches the judge as a supersede-or-
 * reject. The predecessor text is raw and local — the oracle never reads it.
 *
 * Pure module: typed const data only. No DB, no embeddings, no I/O, no `as any`,
 * no policy imports, no rubric/few-shot coupling (judge-prompt/judge-schema are
 * firewalled from the corpus authors by design).
 */

import type { JudgeCorpusItem } from "./_judge-corpus.js";

// ════════════════════════════════════════════════════════════════════════════
//  CLUSTER B — M027..M054 (non-generalization + mixed).
//  Realism anchor: a single Solana spot/perp/memecoin autonomous agent across
//  bull→range→bear (WIF/BONK/POPCAT/SOL/JUP; Raydium/Jupiter/Drift; funding,
//  mint-authority). Concrete operating knowledge, not gate-bait.
// ════════════════════════════════════════════════════════════════════════════

export const CLUSTER_B: JudgeCorpusItem[] = [
  // ── user_preference (8): 5 promote · 1 supersede · 1 retain · 1 reject ──────

  // M027 — a durable, explicit operating preference (size cap per memecoin).
  // Clean promote: a stable user-set guardrail, high importance.
  {
    id: "M027",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Cap any single memecoin position at five percent of the book",
      summary:
        "The operator wants no individual memecoin (WIF, BONK, POPCAT and similar) to exceed five percent of total book value at entry, to bound single-name blowup risk.",
      contentMd:
        "Standing instruction: clamp per-name memecoin exposure to five percent of the book at entry. Applies to every memecoin, not just the current rotation.",
      importance: 8,
      confidence: 0.9,
    },
  },

  // M028 — preference for execution venue routing. Clean promote.
  {
    id: "M028",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Prefer Jupiter routing over a single Raydium pool for size",
      summary:
        "For any swap above roughly two thousand dollars notional the operator prefers Jupiter aggregated routing rather than hitting one Raydium pool directly, to reduce price impact.",
      contentMd:
        "Routing preference: size swaps go through Jupiter aggregation; direct single-pool Raydium fills are reserved for small or illiquid-only names.",
      importance: 7,
      confidence: 0.88,
    },
  },

  // M029 — preference to avoid perps funding drag overnight. Clean promote.
  {
    id: "M029",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Avoid holding Drift perps through high positive funding windows",
      summary:
        "The operator does not want to carry long Drift perps overnight when funding is strongly positive, preferring to flatten or flip to spot rather than pay funding drag.",
      contentMd:
        "Preference: when funding on a Drift perp is strongly positive into the funding window, flatten the long or rotate to spot exposure instead of paying the carry.",
      importance: 7,
      confidence: 0.85,
    },
  },

  // M030 — SUPERSEDE: a numeric revision of a standing daily-loss-limit
  // preference (old 3% → new 5%). Active predecessor differs on the number, so
  // D6 conflict fires; the judge should supersede the stale preference.
  {
    id: "M030",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 1,
    predecessor: {
      kind: "user_preference",
      title: "Stop trading for the day after a 3 percent book drawdown",
      summary:
        "The operator wants the agent to halt new entries once the book is down 3 percent on the day, to prevent tilt and compounding losses.",
    },
    suggest: {
      title: "Stop trading for the day after a 5 percent book drawdown",
      summary:
        "The operator has widened the daily halt: stop opening new positions once the book is down 5 percent on the day rather than the previous 3 percent, which was halting on normal intraday noise.",
      contentMd:
        "Revision: the daily loss halt moves from 3 percent to 5 percent; the tighter 3 percent threshold was tripping on ordinary intraday swings and cutting good days short.",
      importance: 8,
      confidence: 0.86,
    },
  },

  // M031 — preference to keep a SOL reserve for gas/fees. Clean promote.
  {
    id: "M031",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Always keep at least half a SOL unallocated for fees",
      summary:
        "The operator wants a standing reserve of at least half a SOL left unallocated so the agent never fails a swap or a position close for lack of gas.",
      contentMd:
        "Operating reserve: hold ≥0.5 SOL outside any position at all times so fee payment and emergency closes never block on gas.",
      importance: 7,
      confidence: 0.9,
    },
  },

  // M032 — preference to disable auto-entry on names below a liquidity floor.
  // Clean promote.
  {
    id: "M032",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Do not auto-enter memecoins under fifty thousand dollars of pool liquidity",
      summary:
        "The operator wants the agent to skip automated entries on any memecoin whose Raydium pool liquidity is under roughly fifty thousand dollars, because exits there slip badly.",
      contentMd:
        "Liquidity floor: no automated entry when pool depth is below ~fifty thousand dollars; thin pools make the exit unsellable at a fair price.",
      importance: 7,
      confidence: 0.84,
    },
  },

  // M033 — RETAIN (axis-conflict probe): a weak, vaguely-stated, low-confidence
  // styling preference. Plausible but not durable enough to promote as a rule;
  // a careful judge keeps it recallable (retain) rather than promoting or
  // rejecting. High novelty-ish phrasing but low grounding/durability → conflict.
  {
    id: "M033",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 1,
    suggest: {
      title: "Maybe lean a bit more into POPCAT lately",
      summary:
        "The operator mentioned in passing they have been feeling good about POPCAT recently and might want slightly more of it, without giving a size, trigger, or condition.",
      contentMd:
        "Casual, unqualified leaning toward POPCAT with no size, no trigger, no condition — a mood, not an operating rule.",
      importance: 5,
      confidence: 0.45,
    },
  },

  // M034 — REJECT (trap): a fabricated preference attributed to the user that
  // contradicts a clear safety guardrail (asking for NO stops at all). High
  // stated confidence, zero grounding, dangerous over-claim → the judge must not
  // promote a reckless "preference" the agent essentially invented.
  {
    id: "M034",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "The operator wants all stop-losses removed permanently",
      summary:
        "Claims the operator has decided to run every position with no stop-loss at all from now on so winners are never cut, presented as a firm standing instruction.",
      contentMd:
        "Asserts a blanket no-stops policy as a confirmed user preference; there is no actual operator instruction behind it and it negates the book's own risk guardrails.",
      importance: 6,
      confidence: 0.95,
    },
  },

  // ── protocol_fact (10): 5 promote · 1 supersede · 2 expire · 2 reject ───────

  // M035 — durable protocol fact: Drift funding cadence. Clean promote.
  {
    id: "M035",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Drift perp funding settles on an hourly cadence",
      summary:
        "On Drift, perpetual funding is exchanged on an hourly schedule, so carry cost accrues each hour a position is held rather than at a single daily mark.",
      contentMd:
        "Protocol fact: Drift funding accrues and settles hourly; size the expected carry over the intended hold in hourly increments.",
      importance: 7,
      confidence: 0.85,
    },
  },

  // M036 — durable protocol fact: Jupiter slippage param semantics. Clean
  // promote.
  {
    id: "M036",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Jupiter slippage bps is a max-slippage cap, not a target",
      summary:
        "The slippage value passed to a Jupiter swap is the maximum tolerated slippage before the transaction reverts, not a target fill — setting it too tight makes volatile-name swaps fail rather than fill worse.",
      contentMd:
        "Protocol fact: Jupiter's slippage bps is a revert threshold. On fast memecoins an over-tight cap causes failed transactions, not better prices.",
      importance: 7,
      confidence: 0.86,
    },
  },

  // M037 — durable protocol fact: mint-authority renounce as a rug signal.
  // Clean promote, concrete and durable.
  {
    id: "M037",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "A non-renounced mint authority lets supply be inflated at will",
      summary:
        "When a Solana token's mint authority has not been renounced, the holder can mint additional supply at any time, diluting holders — a structural rug vector worth checking before entry.",
      contentMd:
        "Protocol fact: an active (non-renounced) mint authority means supply is not fixed; treat it as a standing dilution/rug risk on any memecoin entry.",
      importance: 8,
      confidence: 0.9,
    },
  },

  // M038 — durable protocol fact: Raydium LP burn vs lock distinction. Clean
  // promote.
  {
    id: "M038",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Burned Raydium LP tokens cannot be pulled; locked LP can after unlock",
      summary:
        "If the Raydium LP tokens are burned the liquidity is permanently unrecoverable, whereas time-locked LP can still be withdrawn once the lock elapses — a different rug-pull risk profile.",
      contentMd:
        "Protocol fact: burned LP is irreversible (cannot be pulled); locked LP only resists a pull until the lock expires. Read the lock terms, not just 'liquidity locked'.",
      importance: 8,
      confidence: 0.88,
    },
  },

  // M039 — durable protocol fact: priority fees during congestion. Clean
  // promote.
  {
    id: "M039",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 1,
    suggest: {
      title: "Solana priority fees must rise during congestion or swaps drop",
      summary:
        "During network congestion a Solana transaction needs a higher priority fee to land in a timely block; a static low priority fee causes swaps to be dropped or delayed past the intended price.",
      contentMd:
        "Protocol fact: under congestion, scale the priority fee up or accept dropped/late swaps. A fixed low priority fee is unreliable in volatile windows.",
      importance: 7,
      confidence: 0.85,
    },
  },

  // M040 — SUPERSEDE: a numeric correction of a protocol fact (old "20 SOL"
  // Pump.fun graduation threshold → new "85 SOL"). Active predecessor differs on
  // the number → D6 conflict fires; the judge should supersede the stale fact.
  {
    id: "M040",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "supersede",
    ownAnchorCount: 1,
    predecessor: {
      kind: "protocol_fact",
      title: "A Pump.fun token graduates to Raydium at about 20 SOL in the bonding curve",
      summary:
        "A Pump.fun bonding-curve token migrates liquidity to Raydium once roughly 20 SOL has accumulated in the curve, at which point the curve closes.",
    },
    suggest: {
      title: "A Pump.fun token graduates to Raydium at about 85 SOL in the bonding curve",
      summary:
        "The Pump.fun graduation threshold is roughly 85 SOL of bonding-curve reserve, not the older 20 SOL figure — entries timed off the stale number were front-running the migration by far too much.",
      contentMd:
        "Correction: the Pump.fun-to-Raydium migration triggers near 85 SOL of curve reserve. The previously stored ~20 SOL threshold is wrong and mis-timed graduation entries.",
      importance: 8,
      confidence: 0.82,
    },
  },

  // M041 — EXPIRE (dual-trace staleness): a TIME-BOUND protocol parameter the
  // text itself says has already rolled off (a one-week launch-incentive window
  // that has ended). Reaches the judge via content staleness, NOT D10 (the
  // seeder sets retainUntil = null). A correct judge expires it.
  {
    id: "M041",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Jupiter is running a one-week zero-fee launch promotion that has now ended",
      summary:
        "Jupiter ran a temporary one-week promotion waiving its platform fee for new routes; the note records that the promotion window has already closed and normal fees have resumed.",
      contentMd:
        "Time-bound fact whose window has elapsed: the zero-fee promotion was a one-week event that has ended. The fee waiver no longer applies — the fact is realized-stale.",
      importance: 6,
      confidence: 0.7,
    },
  },

  // M042 — EXPIRE (dual-trace staleness): an epoch-bound parameter the text says
  // has been superseded by the next epoch (a specific past-epoch validator/stake
  // detail no longer in effect). Realized-stale via content, not TTL.
  {
    id: "M042",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Last epoch's elevated Drift maker rebate has reverted to the standard schedule",
      summary:
        "For one past epoch Drift ran a temporarily elevated maker rebate; the note records that the epoch has since closed, and the rebate has reverted to the standard schedule, so the elevated figure no longer applies.",
      contentMd:
        "Epoch-bound fact that has expired: the elevated maker rebate applied only to a now-closed epoch and has reverted. Acting on the old rebate would misprice maker flow.",
      importance: 6,
      confidence: 0.68,
    },
  },

  // M043 — REJECT (fabricated protocol fact, trap): a confidently-stated but
  // false protocol claim (Solana having a built-in transaction reversal/undo).
  // High confidence, zero grounding, fabricated mechanism → the judge must
  // reject rather than promote a plausible-sounding fiction.
  {
    id: "M043",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Solana lets you reverse a confirmed swap within one minute",
      summary:
        "Claims that a confirmed Solana swap can be reversed or undone within a sixty-second grace window by calling a built-in rollback, so bad fills can be taken back.",
      contentMd:
        "Fabricated mechanism: there is no protocol-level reversal of a confirmed Solana transaction. Stating it as fact would make the agent act as if losses are undoable.",
      importance: 6,
      confidence: 0.93,
    },
  },

  // M044 — REJECT (fabricated protocol fact, trap): a false numeric universal
  // ("every Pump.fun token has exactly a one billion fixed supply that can never
  // change"). Over-broad, false, presented as a hard fact → reject.
  {
    id: "M044",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Every Pump.fun token has a permanently fixed one billion supply",
      summary:
        "Claims as a universal protocol guarantee that all Pump.fun tokens are minted with exactly 1 billion supply that can never be altered, so supply risk never needs checking.",
      contentMd:
        "False universal: supply and mint-authority state vary per token. Treating a fixed one billion supply as guaranteed would skip the mint-authority check entirely.",
      importance: 6,
      confidence: 0.9,
    },
  },

  // ── pumpfun_entry_pattern (6, GENERALIZATION → 2 anchors each):
  //      4 promote · 2 reject ──────────────────────────────────────────────────

  // M045 — a grounded, repeated entry pattern (wait for graduation, not the
  // bonding curve). Generalization kind, two own anchors clear D7. Promote.
  {
    id: "M045",
    kind: "pumpfun_entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Enter Pump.fun names only after Raydium graduation, not on the curve",
      summary:
        "Across multiple launches, waiting to enter until the token graduated to a Raydium pool — rather than buying on the bonding curve — avoided the worst curve-stage dumps and gave a real exit.",
      contentMd:
        "Pattern observed across distinct launches: post-graduation entries had liquidity to exit; bonding-curve entries repeatedly got trapped. Require graduation before entry.",
      importance: 8,
      confidence: 0.75,
    },
  },

  // M046 — a grounded entry pattern keyed on liquidity + holder spread.
  // Generalization, two anchors. Promote.
  {
    id: "M046",
    kind: "pumpfun_entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Require renounced mint and burned LP before any Pump.fun entry",
      summary:
        "Repeatedly, the launches that held up shared renounced mint authority and burned LP; the ones that rugged did not. Gating entry on both checks filtered out most rug outcomes.",
      contentMd:
        "Entry pattern confirmed across launches: only enter when mint authority is renounced AND LP is burned. The two-check gate removed the majority of rug losses.",
      importance: 8,
      confidence: 0.74,
    },
  },

  // M047 — a grounded entry pattern on first-pullback after graduation.
  // Generalization, two anchors. Promote.
  {
    id: "M047",
    kind: "pumpfun_entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Buy the first higher-low after graduation, not the graduation spike",
      summary:
        "Across several graduated launches, entering on the first higher-low pullback after the graduation spike gave a far better average entry than chasing the initial migration candle.",
      contentMd:
        "Pattern across launches: the graduation candle is the worst entry; the first higher-low pullback that holds is the repeatable, better-priced entry.",
      importance: 7,
      confidence: 0.72,
    },
  },

  // M048 — a grounded entry pattern using early-holder concentration as a veto.
  // Generalization, two anchors. Promote. (Axis-conflict: strong process
  // grounding but deliberately MODEST generalizability claim.)
  {
    id: "M048",
    kind: "pumpfun_entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "clean",
    ownAnchorCount: 2,
    suggest: {
      title: "Skip Pump.fun entries when the top ten wallets hold most of supply",
      summary:
        "On launches where the top ten wallets concentrated the majority of supply, exits were repeatedly front-run by those wallets; vetoing entry on heavy early concentration avoided those traps.",
      contentMd:
        "Entry veto observed across launches: heavy top-ten wallet concentration preceded coordinated dumps. Use concentration as a hard skip, narrowly scoped to fresh launches.",
      importance: 7,
      confidence: 0.73,
    },
  },

  // M049 — REJECT (over-abstraction trap): a generalization kind that overclaims
  // a guaranteed edge from thin evidence ("every graduated token always pumps").
  // Two anchors clear D7 so it ESCALATES — the judge, not a gate, must decline.
  {
    id: "M049",
    kind: "pumpfun_entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "Every Pump.fun token that graduates always pumps afterward",
      summary:
        "Asserts that graduation to Raydium guarantees a post-graduation pump every time, so blindly buying every graduation is a sure-thing edge with no further checks needed.",
      contentMd:
        "Over-abstraction to a guarantee: a couple of post-graduation pumps do not make 'always pumps' true. Many graduate and fade. The claimed certainty is unjustified.",
      importance: 6,
      confidence: 0.9,
    },
  },

  // M050 — REJECT (regime-mismatched lesson trap): a bull-market entry pattern
  // restated as an unconditional rule, authored deep in a bear regime where it
  // no longer holds. Two anchors clear D7 → escalates; the judge should reject an
  // unconditional rule that ignores the regime it was learned in.
  {
    id: "M050",
    kind: "pumpfun_entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "Always go full size on any new Pump.fun launch immediately",
      summary:
        "Restates a euphoric bull-run habit — entering every fresh launch at full size the moment it appears — as a permanent unconditional rule, ignoring that launches now mostly bleed out in the current bear tape.",
      contentMd:
        "Regime-blind over-generalization: full-size immediate entry only ever worked in a frothy bull tape. As an unconditional always-rule in a bear regime it is a losing instruction.",
      importance: 6,
      confidence: 0.88,
    },
  },

  // ── observation (2): 2 retain (short-term / dual-trace) ─────────────────────

  // M051 — RETAIN: a fresh, narrow, single-session observation with no durable
  // generalization — recallable but not promotion-worthy. Short-term by nature.
  {
    id: "M051",
    kind: "observation",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 1,
    suggest: {
      title: "WIF and BONK moved together closely during this session",
      summary:
        "During the current session WIF and BONK were tightly correlated, rising and falling on the same candles — a transient intraday observation, not established structural behavior.",
      contentMd:
        "Single-session correlation note between WIF and BONK. Useful context for now; not yet a durable, repeatable relationship worth promoting to a rule.",
      importance: 5,
      confidence: 0.6,
    },
  },

  // M052 — RETAIN: a short-term liquidity observation tied to a specific recent
  // window (dual-trace). Worth keeping recallable, not promotable as a rule.
  {
    id: "M052",
    kind: "observation",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 1,
    suggest: {
      title: "POPCAT pool depth thinned out into the weekend",
      summary:
        "Going into this weekend the POPCAT Raydium pool depth was noticeably thinner than on weekdays, widening realized slippage — a recent-window observation, not a confirmed recurring pattern yet.",
      contentMd:
        "Recent-window liquidity note on POPCAT: thinner weekend depth this time. Keep it recallable; one weekend is not enough to promote a weekday/weekend liquidity rule.",
      importance: 5,
      confidence: 0.58,
    },
  },

  // ── market_note (2): 2 expire (realized staleness via dual-trace) ───────────

  // M053 — EXPIRE: a transient market-state note whose own text says the state
  // has already resolved (a fear spike that has since faded). retainUntil = null
  // (seeder), so it escalates and the JUDGE must expire the realized-stale note.
  {
    id: "M053",
    kind: "market_note",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Today's SOL flash-crash fear has already fully recovered",
      summary:
        "A note that SOL spiked down on a brief liquidation cascade earlier today, and that the move has since fully retraced back to where it started — a momentary market state that no longer holds.",
      contentMd:
        "Transient, now-resolved market state: the intraday SOL fear spike has fully recovered. The note describes a moment that has already passed and carries no forward value.",
      importance: 5,
      confidence: 0.65,
    },
  },

  // M054 — EXPIRE: a stale funding-rate snapshot whose text says the regime it
  // described has already flipped. Realized-stale via content, not TTL.
  {
    id: "M054",
    kind: "market_note",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Drift SOL funding was deeply negative this morning but has since flipped positive",
      summary:
        "Records that SOL perp funding on Drift was deeply negative this morning, then notes that funding has already flipped back to positive since — describing a market condition that has reversed and no longer applies.",
      contentMd:
        "Stale snapshot: the deeply-negative funding window this note captured has already flipped positive. Acting on the recorded negative funding now would be backward-looking.",
      importance: 5,
      confidence: 0.62,
    },
  },
];
