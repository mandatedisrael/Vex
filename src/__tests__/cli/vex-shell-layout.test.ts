import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import { Cockpit } from "../../../local/vex-shell/app/components/Cockpit.js";
import {
  Messages,
  buildMessageRows,
} from "../../../local/vex-shell/app/components/Messages.js";
import {
  clampTerminalSize,
  deriveShellLayout,
} from "../../../local/vex-shell/app/lib/shellLayout.js";
import {
  formatStatus,
  formatTurnResult,
} from "../../../local/vex-shell/app/lib/shellMessages.js";
import {
  createInitialState,
  createStore,
  type ChatMessageLine,
} from "../../../local/vex-shell/app/state/store.js";
import type { TurnResult } from "../../../src/vex-agent/engine/types.js";

function lineCount(output: string): number {
  return output.replace(/\n+$/u, "").split("\n").length;
}

function makeStore(messages: ChatMessageLine[] = []) {
  const initial = createInitialState({
    provider: {
      name: "openrouter",
      detail: "model=openai/gpt-5.4-mini ".repeat(20),
    },
    mode: "chat",
    wakeEnabled: false,
  });

  return createStore(
    {
      ...initial,
      messages,
    },
  );
}

function makeMessage(index: number, content = "hello"): ChatMessageLine {
  return {
    id: `msg-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    timestamp: "2026-04-29T12:00:00.000Z",
  };
}

describe("vex-shell layout", () => {
  it("derives stable viewport budgets from terminal size", () => {
    expect(clampTerminalSize({ columns: 12, rows: 8 })).toEqual({
      columns: 48,
      rows: 16,
    });

    expect(deriveShellLayout({ columns: 83.8, rows: 25.9 }, true)).toEqual({
      columns: 83,
      rows: 25,
      bodyRows: 16,
      mainColumns: 52,
      sidebarColumns: 30,
    });
  });

  it("keeps cockpit height fixed with long provider and session labels", () => {
    const store = makeStore();
    store.setState({
      session: {
        id: "session-" + "x".repeat(80),
        kind: "chat",
        missionStatus: "paused_approval",
        pendingApprovals: 12,
      },
    });

    const output = renderToString(React.createElement(Cockpit, { store }), {
      columns: 80,
    });

    expect(lineCount(output)).toBe(4);
  });

  it("caps message rows to the viewport budget", () => {
    const messages = Array.from({ length: 100 }, (_, index) =>
      makeMessage(index, `message ${index} ${"x".repeat(160)}`),
    );

    const rows = buildMessageRows(messages, 12, 80);

    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows[0]?.kind).toBe("marker");
    expect(rows.some((row) => row.text.includes("[assistant]"))).toBe(true);
  });

  it("renders messages without exceeding the assigned viewport height", () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      makeMessage(index, `message ${index} ${"y".repeat(240)}`),
    );
    const store = makeStore(messages);
    store.setState({ messages });

    const output = renderToString(
      React.createElement(Messages, {
        store,
        viewportRows: 10,
        viewportColumns: 72,
      }),
      { columns: 72 },
    );

    expect(lineCount(output)).toBeLessThanOrEqual(10);
  });

  it("formats status and turn results outside the root component", () => {
    const store = makeStore();
    store.setState({
      pendingTurn: { startedAt: Date.now() - 2100 },
      approvals: [{ id: "approval-1", tool: "swap", createdAt: "now" }],
    });

    const status = formatStatus(store.getState());

    expect(status).toContain("Provider: openrouter");
    expect(status).toContain("Approvals: 1");
    expect(status).toContain("Pending turn: yes");

    const textResult: TurnResult = {
      text: "done",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: null,
    };
    const fallbackResult: TurnResult = {
      text: null,
      toolCallsMade: 1,
      pendingApprovals: ["approval-1"],
      stopReason: "paused_approval",
      missionStatus: null,
    };

    expect(formatTurnResult(textResult, "No model text").role).toBe(
      "assistant",
    );
    expect(formatTurnResult(fallbackResult, "No model text").content).toContain(
      "pendingApprovals=approval-1",
    );
  });
});
