/**
 * PR-12 — MCP hiding freeze for autonomy internals.
 *
 * `loop_defer`, `checkpoint_handoff_prepare`, and `tool_output_read` are
 * Vex Agent runtime primitives. The MCP surface must not mention them in
 * any form — not in `tools/list`, not in any `docs://*` resource, not in
 * `surface://manifest`, not in the initialize `instructions` preamble.
 *
 * The existing design already hides them via `surface: "agent"` +
 * `getProductionMcpTools()`. This test locks the invariant so a future
 * change (e.g. adding a "internal-only" note that names them) still fails
 * CI, and so a missing filter on a new surface is caught structurally.
 */

import { describe, it, expect } from "vitest";

import { getProductionMcpTools } from "../../../vex-agent/tools/registry.js";
import { buildInstructions } from "../../../mcp/docs/instructions.js";
import {
  buildOverview,
  buildProtocolList,
  buildSurfaceManifest,
  buildToolGroups,
} from "../../../mcp/docs/registry-projection.js";

/** Tools that must never appear on any MCP-facing surface. */
const HIDDEN_TOOLS = [
  "loop_defer",
  "checkpoint_handoff_prepare",
  "tool_output_read",
] as const;

function expectNoHiddenMentions(label: string, text: string): void {
  for (const name of HIDDEN_TOOLS) {
    expect(
      text.includes(name),
      `${label} must not mention '${name}' (autonomy internals are hidden from MCP)`,
    ).toBe(false);
  }
}

describe("MCP hiding freeze — autonomy internals", () => {
  it("getProductionMcpTools filters every hidden tool", () => {
    const names = getProductionMcpTools().map((t) => t.name);
    for (const hidden of HIDDEN_TOOLS) {
      expect(names, `'${hidden}' leaked into getProductionMcpTools`).not.toContain(hidden);
    }
  });

  it("buildInstructions preamble never names a hidden tool", () => {
    expectNoHiddenMentions("buildInstructions output", buildInstructions());
  });

  it("buildToolGroups projection never names a hidden tool", () => {
    const groups = buildToolGroups();
    const allNames = groups.flatMap((g) => g.tools.map((t) => t.name));
    for (const hidden of HIDDEN_TOOLS) {
      expect(allNames, `'${hidden}' leaked into buildToolGroups`).not.toContain(hidden);
    }
    // Belt-and-braces: also scan the descriptions in case someone adds a
    // bullet like "knowledge_write (paired with loop_defer)".
    expectNoHiddenMentions("buildToolGroups descriptions", JSON.stringify(groups));
  });

  it("buildOverview snapshot never names a hidden tool", () => {
    expectNoHiddenMentions("buildOverview JSON", JSON.stringify(buildOverview()));
  });

  it("buildSurfaceManifest lists no hidden tool", () => {
    const manifest = buildSurfaceManifest();
    expectNoHiddenMentions("buildSurfaceManifest JSON", JSON.stringify(manifest));
  });

  it("buildProtocolList descriptions never reference a hidden tool", () => {
    expectNoHiddenMentions("buildProtocolList JSON", JSON.stringify(buildProtocolList()));
  });
});
