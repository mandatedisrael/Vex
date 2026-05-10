/**
 * Component tests for the Migrations screen (M6). Mocks `window.vex`
 * per skill §12 — never reaches a real IPC bridge.
 *
 * Coverage:
 *   - applied result renders Continue button
 *   - noop result auto-advances to placeholder via setCurrentView
 *   - err result renders Retry button + error message
 *   - progress events from the bus drive live "Applying X/total" text
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { MigrateProgress } from "@shared/schemas/database.js";

type ProgressCb = (payload: MigrateProgress) => void;

const mockMigrate = vi.fn();
const mockOnProgress = vi.fn();
const mockSetCurrentView = vi.fn();
let progressCb: ProgressCb | null = null;

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (selector: (s: { setCurrentView: typeof mockSetCurrentView }) => unknown) =>
    selector({ setCurrentView: mockSetCurrentView }),
}));

beforeEach(() => {
  mockMigrate.mockReset();
  mockOnProgress.mockReset();
  mockSetCurrentView.mockReset();
  progressCb = null;

  mockOnProgress.mockImplementation((cb: ProgressCb) => {
    progressCb = cb;
    return () => {
      progressCb = null;
    };
  });

  (globalThis as unknown as { window: Record<string, unknown> }).window =
    (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {};
  (globalThis as unknown as { window: { vex: unknown } }).window.vex = {
    database: {
      migrate: () => mockMigrate(),
      onProgress: (cb: ProgressCb) => mockOnProgress(cb),
    },
  };
});

afterEach(() => {
  cleanup();
});

const { Migrations } = await import("../Migrations.js");

describe("Migrations component", () => {
  it("renders applied phase with Continue button", async () => {
    mockMigrate.mockResolvedValue({
      ok: true,
      data: {
        kind: "applied",
        applied: 2,
        files: ["001.sql", "002.sql"],
        message: "Applied 2 migrations.",
      },
    });
    const { findByText, queryByRole } = render(<Migrations />);
    await findByText(/Applied 2 migrations/);
    expect(queryByRole("button", { name: /Continue/ })).toBeTruthy();
    expect(queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("auto-advances to wizard on noop", async () => {
    mockMigrate.mockResolvedValue({
      ok: true,
      data: {
        kind: "noop",
        message: "All migrations already applied.",
      },
    });
    render(<Migrations />);
    await waitFor(
      () => {
        expect(mockSetCurrentView).toHaveBeenCalledWith("wizard");
      },
      { timeout: 1500 }
    );
  });

  it("renders error phase with Retry when result is err", async () => {
    mockMigrate.mockResolvedValue({
      ok: false,
      error: {
        code: "data.migration_failed",
        domain: "database",
        message: "Migration 007 failed: syntax error",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    const { findByText, queryByRole } = render(<Migrations />);
    await findByText(/Migration 007 failed/);
    expect(queryByRole("button", { name: /Retry/ })).toBeTruthy();
    expect(queryByRole("button", { name: /Continue/ })).toBeNull();
  });

  it("renders live progress from the bus", async () => {
    mockMigrate.mockImplementation(() => new Promise(() => {}));
    const { findByText } = render(<Migrations />);

    await waitFor(() => {
      expect(progressCb).not.toBeNull();
    });

    progressCb?.({
      phase: "planned",
      index: 0,
      total: 5,
      version: 0,
      file: "",
      ts: 1,
    });
    await findByText(/Preparing to apply 5 migrations/);

    progressCb?.({
      phase: "start",
      index: 2,
      total: 5,
      version: 3,
      file: "003_x.sql",
      ts: 2,
    });
    await findByText(/Applying 3\/5: 003_x\.sql/);
  });
});
