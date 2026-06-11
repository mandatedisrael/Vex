/**
 * SessionContext header tests (slice C — a11y labels + canonical selectors).
 *
 * Pins the `session-header` data selector + the labeled group for the active
 * session strip. `SessionRuntimeBar` is mocked so this test stays free of its
 * model/usage/compaction data hooks.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { SessionContext, type SessionContextProps } from "../SessionContext.js";

vi.mock("../SessionRuntimeBar.js", () => ({
  SessionRuntimeBar: () =>
    createElement("div", { "data-testid": "runtime-bar-stub" }),
}));

const SESSION: SessionListItem = {
  id: "00000000-0000-4000-8000-0000000000e1",
  mode: "agent",
  permission: "restricted",
  title: "Research session",
  initialGoal: null,
  startedAt: "2026-05-26T10:00:00.000Z",
  endedAt: null,
  missionStatus: null,
  pinnedAt: null,
};

function renderCtx(overrides: Partial<SessionContextProps> = {}) {
  return render(
    createElement(SessionContext, {
      activeSession: SESSION,
      activeSessionId: SESSION.id,
      loading: false,
      error: null,
      ...overrides,
    }),
  );
}

describe("SessionContext header (slice C)", () => {
  it("marks the active-session strip with the session-header selector + labeled group", () => {
    const { container } = renderCtx();
    const header = container.querySelector('[data-vex-area="session-header"]');
    expect(header).not.toBeNull();
    expect(header?.getAttribute("role")).toBe("group");
    expect(header?.getAttribute("aria-label")).toBe("Session: Research session");
    expect(screen.getByText("Research session")).not.toBeNull();
    // S3 exception stamps: the default agent mode earns silence; only the
    // deviating `restricted` permission is stamped.
    expect(screen.queryByText("agent")).toBeNull();
    expect(screen.getByText("restricted")).not.toBeNull();
  });

  it("stamps mission mode but stays silent for full permission", () => {
    const { container } = renderCtx({
      activeSession: { ...SESSION, mode: "mission", permission: "full" },
    });
    expect(
      container.querySelector('[data-vex-area="session-header"]'),
    ).not.toBeNull();
    expect(screen.getByText("mission")).not.toBeNull();
    expect(screen.queryByText("restricted")).toBeNull();
  });

  it("does not render the header in the loading or not-found states", () => {
    const loading = renderCtx({ loading: true });
    expect(
      loading.container.querySelector('[data-vex-area="session-header"]'),
    ).toBeNull();
    loading.unmount();

    const notFound = renderCtx({ activeSession: null });
    expect(
      notFound.container.querySelector('[data-vex-area="session-header"]'),
    ).toBeNull();
  });
});
