/**
 * Pure-template tests for the macOS application menu builder.
 * No Electron runtime is required because `menu-template.ts` only uses
 * a type-level import from "electron".
 */

import { describe, expect, it } from "vitest";
import { buildMacMenuTemplate } from "../menu-template.js";

describe("buildMacMenuTemplate", () => {
  it("returns null on non-mac platforms (dev or prod)", () => {
    expect(buildMacMenuTemplate({ isMac: false, isDev: true })).toBeNull();
    expect(buildMacMenuTemplate({ isMac: false, isDev: false })).toBeNull();
  });

  it("returns appMenu + editMenu + viewMenu in mac dev", () => {
    const template = buildMacMenuTemplate({ isMac: true, isDev: true });
    expect(template?.map((t) => t.role)).toEqual([
      "appMenu",
      "editMenu",
      "viewMenu",
    ]);
  });

  it("returns appMenu + editMenu only in mac prod (no viewMenu)", () => {
    const template = buildMacMenuTemplate({ isMac: true, isDev: false });
    expect(template?.map((t) => t.role)).toEqual(["appMenu", "editMenu"]);
  });
});
