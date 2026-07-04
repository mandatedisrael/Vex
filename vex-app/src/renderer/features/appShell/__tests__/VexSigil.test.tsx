/**
 * VexSigil — jsdom contract tests.
 *
 * jsdom has no canvas 2D, so the default environment exercises the graceful
 * fallback branch (the canvas unmounts, the plain monogram <img> renders in
 * the same fixed box). The particle paths are exercised through a minimal
 * mocked 2D context + a stubbed Image that fires onload on a microtask —
 * pinning the reduced-motion single-static-frame contract (no rAF loop, no
 * shimmer interval), the particle-count band, the paint palette, and the
 * rAF assembly kick-off/cleanup. Mirrors SignalSky.test.tsx's approach.
 */

import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROBINHOOD_SIGIL_PALETTE,
  ROBINHOOD_SIGIL_SRC,
  VexSigil,
} from "../VexSigil.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Minimal 2D-context double: every method VexSigil touches, as a vi.fn().
 * fillStyle assignments are recorded so the paint palette is assertable;
 * getImageData answers a fully-opaque block (every grid cell is a target →
 * the stride-thinning branch runs). */
function makeFake2d() {
  const fillStyles: string[] = [];
  return {
    fillStyles,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(255),
      width: w,
      height: h,
    })),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    set fillStyle(value: string) {
      fillStyles.push(value);
    },
  };
}

/** Patch HTMLCanvasElement.getContext (visible AND offscreen canvases) to
 * hand VexSigil the fake 2D context. */
function installFake2d(): ReturnType<typeof makeFake2d> {
  const ctx = makeFake2d();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (contextId: string) =>
      // The double implements exactly the surface VexSigil uses; anything
      // more would silently pass where a real context would throw.
      contextId === "2d" ? (ctx as unknown as CanvasRenderingContext2D) : null,
  );
  return ctx;
}

/** Image stub whose src assignment fires onload (or onerror) on a
 * microtask — jsdom never loads images on its own. */
function installFakeImage(outcome: "load" | "error"): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 500;
    naturalHeight = 500;
    set src(_value: string) {
      queueMicrotask(() => {
        if (outcome === "load") this.onload?.();
        else this.onerror?.();
      });
    }
  }
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
}

/** Force the prefers-reduced-motion media query (this jsdom build ships NO
 * window.matchMedia at all — VexSigil feature-detects it). */
function mockReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query.includes("prefers-reduced-motion") ? matches : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/** Flush the fake image's queued onload/onerror microtask inside act. */
async function flushImageLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("VexSigil", () => {
  it("falls back to the plain monogram <img> when canvas 2D is unavailable (jsdom)", () => {
    const view = render(<VexSigil className="h-28" />);

    // getContext("2d") returns null in jsdom → the canvas unmounts and the
    // <img> renders inside the SAME fixed box (no layout shift).
    expect(view.container.querySelector("canvas")).toBeNull();
    const img = view.container.querySelector("[data-vex-sigil-fallback]");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/logo_clean.png");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is decorative: aria-hidden root, pointer-events-none, caller-sized fixed box", () => {
    const view = render(<VexSigil className="h-28 md:h-32 mx-auto" />);

    const root = view.container.querySelector("[data-vex-sigil]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-hidden")).toBe("true");
    expect(root?.className).toContain("pointer-events-none");
    // Height-driven sizing from the prop + the mark's own square aspect.
    expect(root?.className).toContain("h-28");
    expect(root?.className).toContain("aspect-square");
  });

  it("falls back to the <img> when the monogram image fails to load", async () => {
    installFake2d();
    installFakeImage("error");

    const view = render(<VexSigil />);
    expect(view.container.querySelector("canvas")).not.toBeNull();

    await flushImageLoad();

    expect(view.container.querySelector("canvas")).toBeNull();
    expect(
      view.container.querySelector("[data-vex-sigil-fallback]"),
    ).not.toBeNull();
  });

  it("reduced motion: paints the fully-assembled mark once — no rAF loop, no shimmer interval", async () => {
    mockReducedMotion(true);
    const ctx = installFake2d();
    installFakeImage("load");
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const interval = vi.spyOn(window, "setInterval");

    const view = render(<VexSigil />);
    await flushImageLoad();

    // The canvas stays (no fallback) and the static frame was painted.
    expect(view.container.querySelector("canvas")).not.toBeNull();
    expect(
      view.container.querySelector("[data-vex-sigil-fallback]"),
    ).toBeNull();
    expect(ctx.fill).toHaveBeenCalled();

    // Particle budget: the fully-opaque 220px sample overshoots the band and
    // is stride-thinned back into 1500–3000 (one rect per particle).
    const particleCount = ctx.rect.mock.calls.length;
    expect(particleCount).toBeGreaterThanOrEqual(1500);
    expect(particleCount).toBeLessThanOrEqual(3000);

    // Paint palette: paper #f3f4f7 body + periwinkle sparks.
    expect(ctx.fillStyles.some((s) => s.includes("243,244,247"))).toBe(true);
    expect(ctx.fillStyles.some((s) => s.includes("139,162,255"))).toBe(true);
    expect(ctx.fillStyles.some((s) => s.includes("125,146,255"))).toBe(true);

    // FULL STOP: no assembly loop, no idle ticker.
    expect(raf).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });

  it("motion allowed: kicks off the rAF assembly after sampling and cancels it on unmount", async () => {
    installFake2d();
    installFakeImage("load");
    const raf = vi.fn(() => 42);
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);

    const view = render(<VexSigil />);
    await flushImageLoad();

    expect(raf).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(caf).toHaveBeenCalledWith(42);
  });

  it("mounts and unmounts cleanly, including StrictMode effect replay", async () => {
    installFake2d();
    installFakeImage("load");
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 7),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const view = render(
      <StrictMode>
        <VexSigil className="h-28" />
      </StrictMode>,
    );
    await flushImageLoad();

    expect(() => {
      view.unmount();
    }).not.toThrow();
  });

  it("robinhood: the fallback <img> uses the feather source (not the monogram)", () => {
    // jsdom has no canvas 2D → the <img> fallback renders the passed src.
    const view = render(
      <VexSigil src={ROBINHOOD_SIGIL_SRC} palette={ROBINHOOD_SIGIL_PALETTE} />,
    );
    const img = view.container.querySelector("[data-vex-sigil-fallback]");
    expect(img?.getAttribute("src")).toBe(ROBINHOOD_SIGIL_SRC);
    expect(ROBINHOOD_SIGIL_SRC).toBe("/logo/robinhood-feather.png");
  });

  it("robinhood: samples the feather src and paints the neon-lime spark palette", async () => {
    mockReducedMotion(true);
    const ctx = installFake2d();
    installFakeImage("load");
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );

    const view = render(
      <VexSigil src={ROBINHOOD_SIGIL_SRC} palette={ROBINHOOD_SIGIL_PALETTE} />,
    );
    await flushImageLoad();

    // Canvas path (no fallback) and a painted static frame.
    expect(view.container.querySelector("canvas")).not.toBeNull();
    expect(ctx.fill).toHaveBeenCalled();

    // Palette = paper body + the two lime sparks (#ccff00 / #b6e600).
    expect(ctx.fillStyles.some((s) => s.includes("243,244,247"))).toBe(true);
    expect(ctx.fillStyles.some((s) => s.includes("204,255,0"))).toBe(true);
    expect(ctx.fillStyles.some((s) => s.includes("182,230,0"))).toBe(true);
    // The cobalt sparks of the default palette are absent.
    expect(ctx.fillStyles.some((s) => s.includes("139,162,255"))).toBe(false);
  });
});
