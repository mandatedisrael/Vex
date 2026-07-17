/**
 * Tests for `useControlStateLiveSync` (F5 — control-state push refresh):
 *  - subscribes to `window.vex.engine.onControlState` on mount;
 *  - a matching-session event invalidates BOTH runtimeKeys.state and
 *    approvalsKeys.pending for that session;
 *  - a foreign-session event is ignored (no invalidation);
 *  - the 30s fallback interval re-invalidates runtimeKeys.state only
 *    (pending approvals keep their own faster poll in ApprovalsRegion);
 *  - unmount unsubscribes and clears the fallback interval;
 *  - a null / empty sessionId subscribes to nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import {
  RUNTIME_STATE_FALLBACK_POLL_MS,
  useControlStateLiveSync,
} from "../runtime.js";
import { approvalsKeys, missionKeys, runtimeKeys } from "../queryKeys.js";
import {
  CONTROL_STATE_EVENT_TYPE,
  type ControlStateEvent,
} from "@shared/schemas/runtime.js";

const SESSION_A = "00000000-0000-4000-8000-00000000000a";
const SESSION_B = "00000000-0000-4000-8000-00000000000b";

type ControlCb = (event: ControlStateEvent) => void;

let controlCb: ControlCb | null;
const off = vi.fn();
const onControlState = vi.fn((cb: ControlCb) => {
  controlCb = cb;
  return off;
});

function controlEvent(sessionId: string): ControlStateEvent {
  return {
    type: CONTROL_STATE_EVENT_TYPE,
    sessionId,
    missionRunId: "run-1",
    runStatus: "paused_approval",
    stopReason: null,
    pendingControlKind: null,
    leaseActive: false,
    leaseExpiresAt: null,
    correlationId: null,
  };
}

beforeEach(() => {
  controlCb = null;
  off.mockReset();
  onControlState.mockClear();
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { engine: { onControlState } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function keysOf(spy: ReturnType<typeof vi.spyOn>): readonly unknown[][] {
  return spy.mock.calls.map(
    ([arg]) => (arg as { queryKey?: readonly unknown[] })?.queryKey ?? [],
  );
}

function hasKey(spy: ReturnType<typeof vi.spyOn>, key: readonly unknown[]): boolean {
  const target = JSON.stringify(key);
  return keysOf(spy).some((k) => JSON.stringify(k) === target);
}

describe("useControlStateLiveSync", () => {
  it("subscribes on mount with a session", () => {
    const client = freshClient();
    renderHook(() => useControlStateLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });
    expect(onControlState).toHaveBeenCalledTimes(1);
    expect(controlCb).not.toBeNull();
  });

  it("does not subscribe for a null or empty sessionId", () => {
    const client = freshClient();
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useControlStateLiveSync(id),
      { wrapper: makeWrapper(client), initialProps: { id: null } },
    );
    expect(onControlState).not.toHaveBeenCalled();
    rerender({ id: "" });
    expect(onControlState).not.toHaveBeenCalled();
  });

  it("invalidates runtime state AND pending approvals on a matching event", () => {
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useControlStateLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    controlCb?.(controlEvent(SESSION_A));

    expect(hasKey(spy, runtimeKeys.state(SESSION_A))).toBe(true);
    expect(hasKey(spy, approvalsKeys.pending(SESSION_A))).toBe(true);
  });

  // WP3 (issue #41): a main-side draft→ready promotion fires a
  // `controlState` event without any renderer mutation — the badge only
  // refreshes if this push path also invalidates the mission draft/diff
  // queries.
  it("invalidates the mission draft and diff queries on a matching event", () => {
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useControlStateLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    controlCb?.(controlEvent(SESSION_A));

    expect(hasKey(spy, missionKeys.draft(SESSION_A))).toBe(true);
    expect(hasKey(spy, ["mission", "diff", SESSION_A])).toBe(true);
  });

  it("ignores a foreign-session event", () => {
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useControlStateLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    controlCb?.(controlEvent(SESSION_B));

    expect(spy).not.toHaveBeenCalled();
  });

  it("runs the 30s fallback invalidation for runtime state only", () => {
    vi.useFakeTimers();
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useControlStateLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RUNTIME_STATE_FALLBACK_POLL_MS);

    expect(hasKey(spy, runtimeKeys.state(SESSION_A))).toBe(true);
    // The fallback net does NOT touch approvals — that path keeps its own poll.
    expect(hasKey(spy, approvalsKeys.pending(SESSION_A))).toBe(false);
  });

  it("unsubscribes and clears the interval on unmount", () => {
    vi.useFakeTimers();
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { unmount } = renderHook(() => useControlStateLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    unmount();
    expect(off).toHaveBeenCalledTimes(1);

    // No further fallback invalidation after the interval is cleared.
    vi.advanceTimersByTime(RUNTIME_STATE_FALLBACK_POLL_MS * 2);
    expect(spy).not.toHaveBeenCalled();
  });
});
