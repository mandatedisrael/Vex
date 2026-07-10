import { describe, expect, it } from "vitest";
import { isAppTranslocated } from "../translocation.js";

describe("isAppTranslocated", () => {
  it("detects a macOS App Translocation executable path", () => {
    expect(
      isAppTranslocated(
        "/private/var/folders/x/AppTranslocation/ABC/d/Vex.app/Contents/MacOS/Vex",
        "darwin",
      ),
    ).toBe(true);
  });

  it("returns false for a normal macOS application path", () => {
    expect(
      isAppTranslocated("/Applications/Vex.app/Contents/MacOS/Vex", "darwin"),
    ).toBe(false);
  });

  it.each(["linux", "win32"] as const)(
    "returns false on %s even when the path contains the marker",
    (platform) => {
      expect(
        isAppTranslocated("/tmp/AppTranslocation/Vex.app/Vex", platform),
      ).toBe(false);
    },
  );
});
