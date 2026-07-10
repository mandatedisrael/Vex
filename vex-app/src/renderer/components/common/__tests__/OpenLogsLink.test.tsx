import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenLogsLink } from "../OpenLogsLink.js";

const openLogsFolder = vi.fn();

beforeEach(() => {
  openLogsFolder.mockReset().mockResolvedValue({
    ok: true,
    data: { opened: true },
  });
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: { support: { openLogsFolder } },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("OpenLogsLink", () => {
  it("opens the contained logs folder through the support bridge", async () => {
    const view = render(<OpenLogsLink />);
    fireEvent.click(view.getByRole("button", { name: "Open logs folder" }));
    await waitFor(() => expect(openLogsFolder).toHaveBeenCalledTimes(1));
  });

  it("contains a rejected bridge call", async () => {
    openLogsFolder.mockRejectedValue(new Error("bridge unavailable"));
    const view = render(<OpenLogsLink />);
    fireEvent.click(view.getByRole("button", { name: "Open logs folder" }));
    await waitFor(() => expect(openLogsFolder).toHaveBeenCalledTimes(1));
  });
});
