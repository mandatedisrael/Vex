/**
 * Memory Routing Rule — a four-line decision hierarchy that tells the
 * model which substrate to consult for which kind of question. Sits
 * between the memory/knowledge state banners and the Tool Map so the
 * model has the routing rule fresh before it scans the catalog.
 *
 * Codex design recommendation (PR2/PR3 thread `019e3688-...`): a
 * compact ordered rule is more valuable than another prose paragraph,
 * and resolves the substrate-confusion failure mode (model reaching for
 * `knowledge_recall` when it should be reading live state, or vice versa).
 *
 * Static content — no context input. Both agent and mission modes see
 * the same four lines; the substrates themselves don't change shape
 * based on session kind.
 */

export function buildMemoryRoutingRule(): string {
  return [
    "# Memory Routing",
    "",
    "- Current state (balances, prices, gas, positions, quotes) → live tools (`wallet_balances`, `khalani_tokens_balances`, `portfolio`).",
    "- Something earlier in THIS conversation/mission → `memory_recall` (per-session narrative).",
    "- Durable cross-session lessons / strategies / observed preferences → `knowledge_recall` (curated, cross-session).",
  ].join("\n");
}
