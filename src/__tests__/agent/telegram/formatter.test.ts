import { describe, it, expect } from "vitest";
import {
  getToolEmoji,
  formatToolStart,
  markdownToTelegramHtml,
  formatTextForTelegram,
  formatApprovalMessage,
  formatError,
  formatSubagentSpawned,
  formatSubagentCompleted,
  formatLoopPhase,
  formatTopupEvent,
  chunkMessage,
} from "../../../agent/telegram/formatter.js";

describe("getToolEmoji", () => {
  it("returns wallet emoji for wallet commands", () => {
    expect(getToolEmoji("wallet_balance")).toContain("👛");
  });

  it("returns search emoji for web_search", () => {
    expect(getToolEmoji("web_search")).toContain("🔍");
  });

  it("returns wrench for unknown command", () => {
    expect(getToolEmoji("unknown_cmd")).toContain("🔧");
  });
});

describe("formatToolStart", () => {
  it("formats command with emoji and spaces", () => {
    const result = formatToolStart("wallet_balance");
    expect(result).toContain("wallet balance");
  });
});

describe("markdownToTelegramHtml", () => {
  it("converts **bold** to <b>", () => {
    expect(markdownToTelegramHtml("**hello**")).toBe("<b>hello</b>");
  });

  it("converts *italic* to <i>", () => {
    expect(markdownToTelegramHtml("*hello*")).toBe("<i>hello</i>");
  });

  it("converts `code` to <code>", () => {
    expect(markdownToTelegramHtml("`code`")).toBe("<code>code</code>");
  });

  it("converts code blocks to <pre><code>", () => {
    expect(markdownToTelegramHtml("```\nfoo\n```")).toBe("<pre><code>foo</code></pre>");
  });

  it("converts ~~strike~~ to <s>", () => {
    expect(markdownToTelegramHtml("~~strike~~")).toBe("<s>strike</s>");
  });

  it("converts [text](url) to <a>", () => {
    const result = markdownToTelegramHtml("[click](https://example.com)");
    expect(result).toBe('<a href="https://example.com">click</a>');
  });

  it("converts headers to bold", () => {
    expect(markdownToTelegramHtml("# Title")).toBe("<b>Title</b>");
    expect(markdownToTelegramHtml("## Subtitle")).toBe("<b>Subtitle</b>");
  });

  it("converts list items to bullets", () => {
    expect(markdownToTelegramHtml("- item")).toBe("• item");
  });

  it("escapes HTML special chars", () => {
    expect(markdownToTelegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("preserves code content (no HTML inside code)", () => {
    const result = markdownToTelegramHtml("`<script>`");
    expect(result).toBe("<code>&lt;script&gt;</code>");
  });
});

describe("formatTextForTelegram", () => {
  it("returns html and plain versions", () => {
    const { html, plain } = formatTextForTelegram("**bold**");
    expect(html).toBe("<b>bold</b>");
    expect(plain).toBe("**bold**");
  });
});

describe("formatApprovalMessage", () => {
  it("includes command and reasoning", () => {
    const result = formatApprovalMessage({
      command: "solana_swap_execute",
      args: { "--amount": "1.0" },
      reasoning: "Rebalance portfolio",
    });
    expect(result).toContain("solana_swap_execute");
    expect(result).toContain("Rebalance portfolio");
    expect(result).toContain("Approval Required");
  });
});

describe("formatError", () => {
  it("includes error message with emoji", () => {
    expect(formatError("something went wrong")).toContain("something went wrong");
    expect(formatError("test")).toContain("❌");
  });
});

describe("formatSubagentSpawned", () => {
  it("includes name and task", () => {
    const result = formatSubagentSpawned("EchoSpark", "Analyze market");
    expect(result).toContain("EchoSpark");
    expect(result).toContain("Analyze market");
  });

  it("truncates long tasks", () => {
    const longTask = "A".repeat(100);
    const result = formatSubagentSpawned("EchoSpark", longTask);
    expect(result).toContain("...");
  });
});

describe("formatSubagentCompleted", () => {
  it("shows done for completed status", () => {
    const result = formatSubagentCompleted("EchoSpark", "completed", 5000);
    expect(result).toContain("done");
    expect(result).toContain("5s");
  });

  it("shows error status directly", () => {
    const result = formatSubagentCompleted("EchoSpark", "error");
    expect(result).toContain("error");
  });
});

describe("formatLoopPhase", () => {
  it("capitalizes phase and shows cycle number", () => {
    const result = formatLoopPhase("sense", 5);
    expect(result).toContain("Sense");
    expect(result).toContain("#5");
  });
});

describe("formatTopupEvent", () => {
  it("formats succeeded event", () => {
    const result = formatTopupEvent({ type: "topup_succeeded", amount: 5.5 });
    expect(result).toContain("5.5000");
  });

  it("formats failed event", () => {
    const result = formatTopupEvent({ type: "topup_failed", error: "timeout" });
    expect(result).toContain("timeout");
  });

  it("formats critical event", () => {
    const result = formatTopupEvent({ type: "critical_alert" });
    expect(result).toContain("CRITICAL");
  });
});

describe("chunkMessage", () => {
  it("returns single chunk for short message", () => {
    expect(chunkMessage("hello")).toEqual(["hello"]);
  });

  it("splits long message into chunks", () => {
    const long = "word ".repeat(1000);
    const chunks = chunkMessage(long, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it("preserves all content after splitting", () => {
    const text = "paragraph1\n\nparagraph2\n\nparagraph3";
    const chunks = chunkMessage(text, 20);
    const rejoined = chunks.join("\n\n");
    expect(rejoined).toContain("paragraph1");
    expect(rejoined).toContain("paragraph3");
  });
});
