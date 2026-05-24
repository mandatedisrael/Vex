/**
 * Action taxonomy — registry coverage + pinned classifications.
 *
 * Puzzle 5 phase 1A (2026-05-23): every internal `ToolDef.actionKind` must
 * be REQUIRED + declared at registration time. The compiler enforces the
 * field's presence on `ToolDef`; this suite enforces:
 *
 *  1. Every registered tool's `actionKind` is a member of `ACTION_KINDS`
 *     (no string drift between the type union and the runtime list).
 *  2. The list (`ACTION_KINDS`) and the union (`ActionKind`) cover the same
 *     8 values — `assertExhaustiveActionKind` would surface a missing branch
 *     at compile time; this test pins both directions.
 *  3. Critical mappings agreed in the puzzle 5/1A Codex review stay stable
 *     (regression guard for "someone reclassified wallet_send_confirm").
 *
 * The full per-tool mapping is in `src/vex-agent/tools/registry/*.ts`; this
 * test does NOT enumerate every tool because the type system already enforces
 * each new tool to declare `actionKind`. It pins ONLY the security/policy-
 * relevant decisions where a silent reclassification would change phase 2+
 * approval behavior.
 *
 * Phase 1B will add `actionKind` to `ProtocolToolManifest` and replace the
 * `deriveProtocolActionKind` heuristic in `protocols/runtime.ts` with a
 * direct field read — at that point a separate test file will pin per-protocol
 * mappings (e.g. polymarket.bridge → user_wallet_broadcast).
 */

import { describe, it, expect } from "vitest";
import { getAllTools, getActionKind } from "@vex-agent/tools/registry.js";
import { ACTION_KINDS, type ActionKind } from "@vex-agent/tools/taxonomy.js";

describe("ActionKind taxonomy — registry coverage", () => {
  it("every registered internal tool's actionKind is a member of ACTION_KINDS", () => {
    const validKinds = new Set<ActionKind>(ACTION_KINDS);
    const violations: string[] = [];

    for (const tool of getAllTools()) {
      if (!validKinds.has(tool.actionKind)) {
        violations.push(`${tool.name}: declares actionKind=${String(tool.actionKind)} not in ACTION_KINDS`);
      }
    }

    expect(violations, "tools with actionKind outside ACTION_KINDS").toEqual([]);
  });

  it("ACTION_KINDS array contains exactly the 8 documented variants", () => {
    // If the union is widened (e.g. phase 6 adds `provider_action_response`),
    // bump both the union AND this list — and update every consumer that
    // switches on ActionKind (the `assertExhaustiveActionKind` guard will
    // make the missing branches compile-fail before this test runs).
    expect([...ACTION_KINDS].sort()).toEqual([
      "approval_prepare",
      "destructive",
      "external_post",
      "local_write",
      "read",
      "schedule",
      "user_wallet_broadcast",
    ]);
  });
});

describe("ActionKind — pinned critical classifications (Codex puzzle 5/1A)", () => {
  // Codex GREEN LIGHT 2026-05-23 — these mappings drive puzzle 5 phase 2+
  // approval / wallet / audit policy. A regression here would silently change
  // approval semantics, so each one is pinned explicitly.

  const CRITICAL_MAPPINGS: ReadonlyArray<readonly [string, ActionKind]> = [
    // Wallet — user signs locally
    ["wallet_send_confirm", "user_wallet_broadcast"],
    ["wallet_send_prepare", "approval_prepare"],
    ["wallet_read", "read"],

    // Read-only DB / RPC / external API surfaces
    ["evm_read", "read"],
    ["portfolio_inspect", "read"],
    ["memory_recall", "read"],
    ["tool_output_read", "read"],
    ["knowledge_recall", "read"],
    ["knowledge_get", "read"],
    ["document_read", "read"],
    ["document_list", "read"],

    // External API calls — read-only per Codex bindings:
    // network egress / privacy is a separate dimension, not `external_post`.
    ["web_research", "read"],
    ["twitter_account", "read"],

    // Local writes — knowledge, documents, mission draft, compaction
    ["knowledge_write", "local_write"],
    ["knowledge_supersede", "local_write"],
    ["knowledge_update_status", "local_write"],
    ["document_write", "local_write"],
    ["mission_draft_update", "local_write"],
    ["mark_outstanding_resolved", "local_write"],
    ["compact_now", "local_write"],
    ["polymarket_setup", "local_write"],

    // mission_stop is a state transition via engineSignal, not deferred work —
    // classify as local_write (Codex Q2 ruling, puzzle 5/1A).
    ["mission_stop", "local_write"],

    // Schedule — reserved for delayed / deferred execution (Codex Q2 ruling).
    ["loop_defer", "schedule"],

    // Destructive — no expand-and-contract recovery. document_delete is a
    // soft-delete in repo today but the taxonomy ranks reversibility risk;
    // a delete operation gets `destructive` so the approval / audit layer
    // can treat it as the high-risk class.
    ["document_delete", "destructive"],

    // Protocol meta-tools — wrapper is read; protocol target classification
    // is derived dynamically in `executeProtocolTool` (see execute-tool-taxonomy test).
    ["discover_tools", "read"],
    ["execute_tool", "read"],

    // Self-documentation (MCP-surface only)
    ["vex_introduction", "read"],
    ["vex_namespace_tools", "read"],

    // Khalani read-only aliases
    ["khalani_chains_list", "read"],
    ["khalani_tokens_top", "read"],
    ["khalani_tokens_search", "read"],
    ["khalani_tokens_balances", "read"],
  ];

  it.each(CRITICAL_MAPPINGS)("%s → %s", (toolName, expectedKind) => {
    const actual = getActionKind(toolName);
    expect(actual, `${toolName} should classify as ${expectedKind}`).toBe(expectedKind);
  });

  it("getActionKind returns undefined for unregistered tool names", () => {
    expect(getActionKind("definitely-not-a-real-tool")).toBeUndefined();
  });
});
