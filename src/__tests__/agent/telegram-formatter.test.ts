import { describe, expect, it } from "vitest";
import {
  markdownToTelegramHtml,
  getToolEmoji,
  formatToolStart,
  formatTextForTelegram,
  formatError,
  formatApprovalMessage,
  chunkMessage,
} from "../../agent/telegram/formatter.js";

// ── markdownToTelegramHtml ──────────────────────────────────────────

describe("markdownToTelegramHtml", () => {
  it("converts bold **text**", () => {
    expect(markdownToTelegramHtml("hello **world**")).toContain("<b>world</b>");
  });

  it("converts bold __text__", () => {
    expect(markdownToTelegramHtml("hello __world__")).toContain("<b>world</b>");
  });

  it("converts italic *text*", () => {
    expect(markdownToTelegramHtml("hello *world*")).toContain("<i>world</i>");
  });

  it("converts strikethrough ~~text~~", () => {
    expect(markdownToTelegramHtml("hello ~~world~~")).toContain("<s>world</s>");
  });

  it("converts inline code", () => {
    expect(markdownToTelegramHtml("run `npm install`")).toContain("<code>npm install</code>");
  });

  it("converts code blocks", () => {
    const md = "```js\nconst x = 1;\n```";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<pre><code>");
    expect(html).toContain("const x = 1;");
    expect(html).toContain("</code></pre>");
  });

  it("converts code blocks without language tag", () => {
    const md = "```\nhello world\n```";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<pre><code>hello world</code></pre>");
  });

  it("converts links", () => {
    const md = "Visit [Google](https://google.com)";
    expect(markdownToTelegramHtml(md)).toContain('<a href="https://google.com">Google</a>');
  });

  it("converts headers to bold", () => {
    expect(markdownToTelegramHtml("# Title")).toContain("<b>Title</b>");
    expect(markdownToTelegramHtml("## Subtitle")).toContain("<b>Subtitle</b>");
    expect(markdownToTelegramHtml("### Section")).toContain("<b>Section</b>");
  });

  it("converts unordered lists", () => {
    const md = "- item one\n- item two";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("\u2022 item one");
    expect(html).toContain("\u2022 item two");
  });

  it("converts * list items", () => {
    const html = markdownToTelegramHtml("* first\n* second");
    expect(html).toContain("\u2022 first");
  });

  it("converts blockquotes", () => {
    const html = markdownToTelegramHtml("> important note");
    expect(html).toContain("<blockquote>important note</blockquote>");
  });

  it("escapes HTML entities", () => {
    const html = markdownToTelegramHtml("x < y & a > b");
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&gt;");
  });

  it("does not escape inside code blocks", () => {
    const md = "```\nif (x < 5) {}\n```";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("&lt;");
    expect(html).toContain("<pre><code>");
  });

  it("handles plain text without modification", () => {
    const plain = "Just a normal sentence without any markdown.";
    const html = markdownToTelegramHtml(plain);
    expect(html).toBe(plain);
  });

  it("handles empty input", () => {
    expect(markdownToTelegramHtml("")).toBe("");
    expect(markdownToTelegramHtml("   ")).toBe("");
  });

  it("handles nested bold + italic", () => {
    const html = markdownToTelegramHtml("**bold and *italic* inside**");
    expect(html).toContain("<b>");
    expect(html).toContain("<i>");
  });

  it("preserves code block content from markdown processing", () => {
    const md = "```\n**not bold** *not italic*\n```";
    const html = markdownToTelegramHtml(md);
    // Inside code block, bold/italic markers should be escaped text, not HTML tags
    expect(html).not.toContain("<b>not bold</b>");
  });
});

// ── getToolEmoji ────────────────────────────────────────────────────

describe("getToolEmoji", () => {
  it("returns wallet emoji for wallet_ commands", () => {
    const emoji = getToolEmoji("wallet_balance");
    expect(emoji).toBe("\uD83D\uDC5B");
  });

  it("returns coin emoji for solana_ commands", () => {
    const emoji = getToolEmoji("solana_swap_quote");
    expect(emoji).toBe("\uD83E\uDE99");
  });

  it("returns chart emoji for dexscreener_ commands", () => {
    const emoji = getToolEmoji("dexscreener_search");
    expect(emoji).toBe("\uD83D\uDCCA");
  });

  it("returns search emoji for web_search", () => {
    expect(getToolEmoji("web_search")).toBe("\uD83D\uDD0D");
  });

  it("returns default wrench for unknown commands", () => {
    expect(getToolEmoji("unknown_command")).toBe("\uD83D\uDD27");
  });
});

// ── formatToolStart ─────────────────────────────────────────────────

describe("formatToolStart", () => {
  it("converts underscores to spaces", () => {
    const result = formatToolStart("solana_swap_quote");
    expect(result).toContain("solana swap quote");
  });

  it("includes emoji prefix", () => {
    const result = formatToolStart("wallet_balance");
    expect(result).toContain("\uD83D\uDC5B");
  });
});

// ── formatTextForTelegram ───────────────────────────────────────────

describe("formatTextForTelegram", () => {
  it("returns both html and plain versions", () => {
    const result = formatTextForTelegram("**bold** text");
    expect(result.html).toContain("<b>bold</b>");
    expect(result.plain).toBe("**bold** text");
  });

  it("trims whitespace in plain", () => {
    const result = formatTextForTelegram("  hello  ");
    expect(result.plain).toBe("hello");
  });
});

// ── formatError ─────────────────────────────────────────────────────

describe("formatError", () => {
  it("prepends error icon", () => {
    const result = formatError("Something went wrong");
    expect(result).toContain("\u274C");
    expect(result).toContain("Something went wrong");
  });
});

// ── formatApprovalMessage ───────────────────────────────────────────

describe("formatApprovalMessage", () => {
  it("includes command name", () => {
    const result = formatApprovalMessage({ command: "solana_swap_execute", id: "123" });
    expect(result).toContain("solana_swap_execute");
    expect(result).toContain("Approval Required");
  });

  it("includes args when provided", () => {
    const result = formatApprovalMessage({
      command: "send_confirm",
      args: { amount: "1.0", to: "0xabc" },
      reasoning: "User requested transfer",
      id: "456",
    });
    expect(result).toContain("amount: 1.0");
    expect(result).toContain("to: 0xabc");
    expect(result).toContain("User requested transfer");
  });
});

// ── chunkMessage ────────────────────────────────────────────────────

describe("chunkMessage", () => {
  it("returns single chunk for short messages", () => {
    const chunks = chunkMessage("Hello world");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Hello world");
  });

  it("splits on paragraph boundary", () => {
    const text = "A".repeat(2000) + "\n\n" + "B".repeat(2000);
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).not.toContain("B");
  });

  it("splits on newline when no paragraph boundary", () => {
    const text = "A".repeat(2000) + "\n" + "B".repeat(2000);
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles text with no good split points", () => {
    const text = "A".repeat(5000);
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join("")).toBe(text);
  });
});
