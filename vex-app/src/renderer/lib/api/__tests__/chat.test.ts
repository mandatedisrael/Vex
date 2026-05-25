/**
 * Tests for `useSubmitChat` success invalidation (puzzle 06).
 *
 * A completed turn advances usage rows + the session token_count, so the
 * mutation must invalidate the session list/detail AND every usage query
 * for the session (totals, last-turn, context-window). A failed result
 * must NOT invalidate anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import { useSubmitChat } from "../chat.js";
import { sessionKeys } from "../sessions.js";
import { usageKeys } from "../queryKeys.js";

const SESSION = "00000000-0000-4000-8000-0000000000c2";
const submitMock = vi.fn();

beforeEach(() => {
  submitMock.mockReset();
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { chat: { submit: submitMock } },
  });
});

afterEach(() => {
  // @ts-expect-error — test cleanup
  delete window.vex;
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("useSubmitChat onSuccess invalidation", () => {
  it("invalidates session list/detail + usage queries for the session", async () => {
    submitMock.mockResolvedValue({ ok: true, data: { text: null } });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSubmitChat(), {
      wrapper: makeWrapper(client),
    });

    await result.current.mutateAsync({ sessionId: SESSION, message: "hello" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sessionKeys.list() });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: sessionKeys.detail(SESSION),
    });

    const predicateCall = invalidateSpy.mock.calls.find(
      (c) => typeof (c[0] as { predicate?: unknown }).predicate === "function",
    );
    expect(predicateCall).toBeDefined();
    const predicate = (
      predicateCall![0] as {
        predicate: (q: { queryKey: readonly unknown[] }) => boolean;
      }
    ).predicate;
    expect(predicate({ queryKey: usageKeys.contextWindow(SESSION) })).toBe(true);
    expect(predicate({ queryKey: usageKeys.lastTurn(SESSION, "USD") })).toBe(true);
  });

  it("does not invalidate on a failed result", async () => {
    submitMock.mockResolvedValue({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "chat",
        message: "x",
        retryable: true,
        userActionable: false,
        redacted: true,
        correlationId: "c",
      },
    });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSubmitChat(), {
      wrapper: makeWrapper(client),
    });

    await result.current.mutateAsync({ sessionId: SESSION, message: "hello" });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
