/**
 * Knowledge — canonical agent memory with embeddings + tiered TTL.
 *
 * Free-form `kind`, English-only contents, embedding-on-write via local Docker
 * Model Runner. All tools are visible regardless of EMBEDDING_BASE_URL (no
 * requiresEnv) — write/recall fail loud at runtime if the embeddings service
 * is unavailable, while get/update_status/recall_overflow/lineage/history
 * continue to work without it.
 */

import type { ToolDef } from "../types.js";

export const KNOWLEDGE_TOOLS: readonly ToolDef[] = [
  {
    name: "knowledge_write", kind: "internal", mutating: false, pressureSafety: "mutating", actionKind: "local_write",
    description:
      "Write a NEW entry to curated cross-session knowledge: a distilled rule, observation, lesson from failure, observed user preference, or mastered protocol fact that the next session should be able to recall. "
      + "Use ONLY for net-new content — replacing or updating an existing entry uses knowledge_supersede(previous_id). "
      + ""
      + "Save: persona facts (user goals, risk tolerance, signing constraints), observed strategies that worked, lessons from failures, observed user preferences with evidence, mastered protocols (rate limits, parameter quirks, gas patterns). "
      + "Do not save: balances, prices, gas, open positions, quotes, tx hashes — those are live state, queried via wallet_balances / evm_read / khalani_* / portfolio each turn. Anything already in proj_* / mission_runs / approval_queue is structured DB state, not knowledge. Raw secrets / mnemonics / private keys NEVER. "
      + ""
      + "Provenance via the `source` field: 'observed' (default — directly seen in this session) or 'user_confirmed' (user explicitly stated as fact) reach Active Knowledge hot context; 'inferred' (derived from observation) or 'hypothesis' (thin-evidence guess) remain recallable via knowledge_recall but are NEVER auto-injected. Use 'hypothesis' for guesses you want remembered but NOT surfaced as fact next turn. "
      + ""
      + "title, summary, content_md MUST be in English (embedding retrieval is significantly stronger on English; translate user intent before writing). kind is free-form snake_case — reuse from Active Knowledge → Known kinds before inventing a new one. Pin evergreen rules (no TTL); ttl_hours overrides the default 7-day window for time-bounded observations. "
      + "Fails loud if the local embeddings service is unavailable. Pressure-band rule: blocked at barrier+ (compact first; the catalog filter hides this from the LLM-visible tools then).",
    parameters: { type: "object", properties: {
      kind: { type: "string", description: "Free-form snake_case kind, English. Reuse from Known kinds when possible (e.g. pumpfun_entry_pattern, risk_rule, bridge_observation)." },
      title: { type: "string", description: "Single thesis or rule, in English." },
      summary: { type: "string", description: "1-3 sentences in English. This is the embedding input together with title — write for retrieval." },
      content_md: { type: "string", description: "Optional full markdown body in English (defaults to summary). Returned by recall and knowledge_get." },
      tags: { type: "array", items: { type: "string" }, description: "Optional string tags (e.g. ['solana', 'memecoin'])." },
      confidence: { type: "number", description: "Agent confidence in 0..1." },
      source: {
        type: "string",
        enum: ["observed", "user_confirmed", "inferred", "hypothesis"],
        description:
          "Provenance tier — defaults to 'observed' when omitted. Only 'observed' and 'user_confirmed' enter Active Knowledge hot context. Use 'inferred' for conclusions you derived but didn't see directly; 'hypothesis' for thin-evidence guesses you want remembered but NOT surfaced as fact.",
      },
      source_refs: { type: "object", description: "Provenance: { protocol_executions:[ids], proj_activity:[ids], proj_pnl_lots:[ids] }." },
      ttl_hours: { type: "number", description: "Override default 7-day TTL (1..8760). Ignored if pinned=true." },
      pinned: { type: "boolean", description: "Evergreen rule — bypasses TTL and stays in Active Knowledge (only for source='observed' or 'user_confirmed')." },
    }, required: ["kind", "title", "summary"] },
  },
  {
    name: "knowledge_supersede", kind: "internal", mutating: false, pressureSafety: "mutating", actionKind: "local_write",
    description:
      "Atomically replace an existing active knowledge entry with a new version. Use this whenever you are updating a rule, observation, or fact you previously wrote — a meaningful change in text, thresholds, or assessment means a new version, not an in-place edit. " +
      "The old entry is flipped to status='superseded' (hidden from recall and Active Knowledge) with its explicit successor link; the new entry becomes the active one. " +
      "previous_id is the id of the entry you are replacing (get it from knowledge_recall or Active Knowledge). reason explains why the old version stopped holding. " +
      "Optionally include change_summary (what's new) and what_failed (evidence that invalidated the old version). " +
      "Rejects if the predecessor is not active, already superseded, or if the new content is identical to the predecessor (or any other existing row). " +
      "title, summary, content_md MUST be in English. Fails loud if the local embeddings service is unavailable.",
    parameters: { type: "object", properties: {
      previous_id: { type: "number", description: "Id of the active entry being replaced." },
      kind: { type: "string", description: "Free-form snake_case kind for the NEW entry, English. Usually the same as the predecessor's kind." },
      title: { type: "string", description: "Updated thesis/rule, in English." },
      summary: { type: "string", description: "1-3 sentences, English. Embedding input together with title." },
      content_md: { type: "string", description: "Optional full markdown body, English (defaults to summary)." },
      tags: { type: "array", items: { type: "string" }, description: "Optional string tags." },
      confidence: { type: "number", description: "Agent confidence in 0..1." },
      source: {
        type: "string",
        enum: ["observed", "user_confirmed", "inferred", "hypothesis"],
        description:
          "Provenance tier for the NEW version (defaults to 'observed'). Same rules as knowledge_write — only 'observed' / 'user_confirmed' reach Active Knowledge hot context.",
      },
      source_refs: { type: "object", description: "Provenance for the new version." },
      ttl_hours: { type: "number", description: "Override default 7-day TTL (1..8760). Ignored if pinned=true." },
      pinned: { type: "boolean", description: "Evergreen rule — bypasses TTL." },
      reason: { type: "string", description: "Short reason the old version stopped holding (stored on the old row's status_reason)." },
      change_summary: { type: "string", description: "Optional: what's different about the new version (stored on the new row)." },
      what_failed: { type: "string", description: "Optional: evidence that invalidated the old version (stored on the new row)." },
    }, required: ["previous_id", "kind", "title", "summary", "reason"] },
  },
  {
    name: "knowledge_recall", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description:
      "Semantic recall over curated cross-session knowledge. Returns the top-K entries inline (with content_md); overflow lands in a 15-minute tmp cache readable via knowledge_recall_overflow. "
      + ""
      + "Write SEMANTIC INTENT, not keywords. "
      + "✓ \"user trading risk preferences and position sizing rules\" "
      + "✗ \"risk\" "
      + "✓ \"past lessons from Kyber DEX integration timeouts\" "
      + "✗ \"kyber\" "
      + ""
      + "query MUST be in English (translate intent first — embedding retrieval is significantly stronger on English). ACTIVE-ONLY by design: superseded/invalidated/archived entries are excluded — for those use knowledge_history; for a specific id's version chain use knowledge_lineage. "
      + ""
      + "Skip when the [Knowledge: empty] banner is in the system prompt — nothing to find. "
      + "Fails loud if the local embeddings service is unavailable.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Semantic intent in English. Translate user's intent first; write the way you'd ask an expert who knows the codebase." },
      k: { type: "number", description: "Max results (default 8, hard max 15)." },
      kind: { type: "string", description: "Optional kind filter — reuse from Active Knowledge → Known kinds." },
      include_expired: { type: "boolean", description: "Include entries past their TTL (default true; TTL is hot-context cutoff, not existence)." },
    }, required: ["query"] },
  },
  {
    name: "knowledge_recall_overflow", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: "Read overflow results from a previous knowledge_recall by cacheKey. Cache lives ~15 minutes after the originating recall. Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      cacheKey: { type: "string", description: "Overflow cacheKey returned by a previous knowledge_recall response." },
    }, required: ["cacheKey"] },
  },
  {
    name: "knowledge_get", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: "Fetch a canonical knowledge entry by id. Loads content_md into the engine context. Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      id: { type: "number", description: "Knowledge entry id." },
    }, required: ["id"] },
  },
  {
    name: "knowledge_update_status", kind: "internal", mutating: false, pressureSafety: "mutating", actionKind: "local_write",
    description:
      "Mark a knowledge entry as invalidated or archived. Both remove the entry from recall and Active Knowledge. " +
      "Use this for terminal lifecycle (this fact is just wrong / no longer relevant), NOT for replacing a fact with a new version — for replacement use knowledge_supersede(previous_id). " +
      "Cannot transition back to active — write a new entry instead. Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      id: { type: "number", description: "Knowledge entry id." },
      status: { type: "string", enum: ["invalidated", "archived"], description: "New status. Both remove the entry from semantic recall and Active Knowledge." },
      reason: { type: "string", description: "Optional human-readable reason — persisted to status_reason on the row." },
    }, required: ["id", "status"] },
  },
  {
    name: "knowledge_lineage", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description:
      "Trace the full version chain (root → head) of a knowledge entry from any id in the chain. " +
      "Returns ordered metadata (no content_md) plus headId and headStatus, so you can immediately tell whether the chain is still active or terminated (invalidated/archived). " +
      "Use this whenever you have a historical id (e.g. from knowledge_get supersededBy/supersedesId) and want to find the current version. " +
      "Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      id: { type: "number", description: "Any knowledge entry id in the chain (root, middle, or head)." },
    }, required: ["id"] },
  },
  {
    name: "knowledge_history", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description:
      "Browse historical knowledge entries by explicit filters (kind / status / limit). " +
      "By default returns ONLY non-active entries (superseded, invalidated, archived) — pass status='active' to query active entries instead. " +
      "Returns compact metadata (no content_md). This is NOT semantic search — for active semantic recall use knowledge_recall, for the version chain of a specific id use knowledge_lineage. " +
      "Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      status: { type: "string", enum: ["superseded", "invalidated", "archived", "active"], description: "Optional status filter. Defaults to non-active (superseded ∪ invalidated ∪ archived)." },
      kind: { type: "string", description: "Optional kind filter (free-form snake_case, e.g. risk_rule)." },
      limit: { type: "number", description: "Max entries (default 20, max 100)." },
    } },
  },
];
