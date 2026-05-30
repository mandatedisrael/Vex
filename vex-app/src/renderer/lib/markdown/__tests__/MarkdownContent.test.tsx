/**
 * MarkdownContent tests (stage 8-2a). Covers element rendering for the
 * supported subset and the security matrix: href allowlist (https only),
 * raw-HTML-stays-literal, image-as-alt-text, and table/unsupported fallback.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { MarkdownContent, safeHref } from "../MarkdownContent.js";

function renderMd(text: string) {
  return render(createElement(MarkdownContent, { text }));
}

const NUL = String.fromCharCode(0);

describe("safeHref", () => {
  it("allows absolute https URLs", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
  });

  it("rejects every non-https / unsafe form", () => {
    expect(safeHref("http://example.com")).toBeNull();
    expect(safeHref("mailto:a@b.com")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("/relative/path")).toBeNull();
    expect(safeHref("//protocol-relative.example")).toBeNull();
    expect(safeHref("   ")).toBeNull();
    expect(safeHref(`https://e${NUL}.com`)).toBeNull();
  });
});

describe("MarkdownContent", () => {
  it("renders inline emphasis + inline code as elements", () => {
    const { container } = renderMd("**bold** and *em* and `code`");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders headings, lists, blockquotes and fenced code blocks", () => {
    const { container } = renderMd(
      "# Title\n\n- a\n- b\n\n1. x\n\n> quote\n\n```\ncode()\n```",
    );
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("code()");
  });

  it("renders an https link as a safe blank-target anchor", () => {
    const { container } = renderMd("[ok](https://a.example/b)");
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://a.example/b");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never renders a javascript: or http: link as an anchor (text only)", () => {
    const { container } = renderMd("[x](javascript:alert(1)) [y](http://a.b)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("x");
    expect(container.textContent).toContain("y");
  });

  it("renders raw HTML inside markdown as literal text, never as elements", () => {
    const { container } = renderMd('<img src=x onerror="alert(1)"> <b>nope</b>');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('onerror="alert(1)"');
  });

  it("renders image markdown as alt text only (no img element)", () => {
    const { container } = renderMd("![the alt](https://a.b/c.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("the alt");
  });

  it("renders a GFM table as a semantic <table> with header + body cells", () => {
    const { container } = renderMd(
      "| Asset | Amount |\n| --- | ---: |\n| ETH | 1.5 |\n| SOL | 20 |",
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const headers = Array.from(container.querySelectorAll("th")).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(["Asset", "Amount"]);
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(container.querySelectorAll("tbody td")[0]?.textContent).toBe("ETH");
    // Right-aligned column carries the alignment class, not an inline style.
    const amountCell = container.querySelectorAll("tbody td")[1];
    expect(amountCell?.className).toContain("text-right");
    expect(amountCell?.getAttribute("style")).toBeNull();
  });

  it("renders inline markup inside table cells (still escaped, no HTML sink)", () => {
    const { container } = renderMd(
      "| k | v |\n| - | - |\n| **bold** | `<img src=x>` |",
    );
    expect(container.querySelector("td strong")?.textContent).toBe("bold");
    // Raw-HTML-looking cell text stays literal — no <img> element.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x>");
  });

  it("renders a GFM task list with disabled checkboxes reflecting state, no literal marker", () => {
    const { container } = renderMd("- [x] done\n- [ ] todo");
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    // Non-interactive display: disabled (and thus non-focusable), not interactive.
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain("done");
    expect(container.textContent).toContain("todo");
    // The marked `checkbox` token is dropped — no doubled `[x]`/`[ ]` marker.
    expect(container.textContent).not.toContain("[x]");
    expect(container.textContent).not.toContain("[ ]");
  });
});
