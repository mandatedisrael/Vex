/**
 * Telegram message formatter.
 *
 * Converts AgentEvent data to Telegram-ready messages.
 * Uses HTML parse_mode for rich formatting (more robust than MarkdownV2).
 *
 * Telegram limits: 4096 chars per message, 1-64 bytes callback data.
 * HTML entities: <b>, <i>, <code>, <pre>, <a>, <s>, <blockquote>
 */

const TELEGRAM_MSG_LIMIT = 4096;
const CHUNK_LIMIT = 3800; // leave room for HTML tag overhead

// ── Tool emoji mapping (mirrors frontend ICON_MAP with emojis) ──────

const TOOL_EMOJI: Record<string, string> = {
  wallet: "\uD83D\uDC5B",
  solana: "\uD83E\uDE99",
  khalani: "\uD83C\uDF10",
  dexscreener: "\uD83D\uDCCA",
  web_search: "\uD83D\uDD0D",
  web_fetch: "\uD83C\uDF10",
  file: "\uD83D\uDCC4",
  "0g": "\uD83D\uDCBE",
  schedule: "\u23F0",
  trade_log: "\uD83D\uDCC8",
  jaine: "\uD83D\uDD04",
  memory: "\uD83E\uDDE0",
  echobook: "\uD83D\uDCDD",
  chainscan: "\uD83D\uDD0E",
  slop: "\uD83C\uDFB0",
  marketmaker: "\uD83E\uDD16",
  send: "\uD83D\uDCE4",
};

/** Get emoji for a tool command name. */
export function getToolEmoji(command: string): string {
  for (const [prefix, emoji] of Object.entries(TOOL_EMOJI)) {
    if (command.startsWith(prefix)) return emoji;
  }
  return "\uD83D\uDD27"; // 🔧
}

/** Format tool_start as a compact one-liner: emoji + human-readable name. */
export function formatToolStart(command: string): string {
  const emoji = getToolEmoji(command);
  const name = command.replace(/_/g, " ");
  return `${emoji} ${name}`;
}

// ── Markdown to Telegram HTML conversion ────────────────────────────

/** Escape HTML special characters. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert LLM markdown to Telegram-safe HTML.
 *
 * Handles: code blocks, inline code, bold, italic, strikethrough,
 * links, headers (as bold), lists, blockquotes.
 * Falls back gracefully — malformed markdown passes through as escaped text.
 */
export function markdownToTelegramHtml(text: string): string {
  // 1. Extract code blocks before any other processing
  const codeBlocks: string[] = [];
  let processed = text.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_match, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(escapeHtml(code.trim()));
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  // 2. Extract inline code
  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const idx = inlineCodes.length;
    inlineCodes.push(escapeHtml(code));
    return `\x00INLINE_${idx}\x00`;
  });

  // 3. Escape remaining HTML entities
  processed = escapeHtml(processed);

  // 4. Bold: **text** or __text__
  processed = processed.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  processed = processed.replace(/__(.+?)__/g, "<b>$1</b>");

  // 5. Italic: *text* or _text_ (but not inside words with underscores)
  processed = processed.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, "<i>$1</i>");
  processed = processed.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, "<i>$1</i>");

  // 6. Strikethrough: ~~text~~
  processed = processed.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 7. Links: [text](url)
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 8. Headers: # Text → bold line
  processed = processed.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // 9. Unordered lists: - item or * item → • item
  processed = processed.replace(/^[\s]*[-*]\s+(.+)$/gm, "\u2022 $1");

  // 10. Ordered lists: 1. item → keep as-is (already readable)

  // 11. Blockquotes: > text
  processed = processed.replace(/^&gt;\s*(.+)$/gm, "<blockquote>$1</blockquote>");
  // Merge adjacent blockquotes
  processed = processed.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // 12. Restore code blocks
  processed = processed.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_match, idx: string) => {
    return `<pre><code>${codeBlocks[Number(idx)]}</code></pre>`;
  });

  // 13. Restore inline code
  processed = processed.replace(/\x00INLINE_(\d+)\x00/g, (_match, idx: string) => {
    return `<code>${inlineCodes[Number(idx)]}</code>`;
  });

  return processed.trim();
}

/**
 * Format agent text for Telegram with HTML.
 * Returns { html, plain } — caller tries HTML first, falls back to plain.
 */
export function formatTextForTelegram(text: string): { html: string; plain: string } {
  return {
    html: markdownToTelegramHtml(text),
    plain: text.trim(),
  };
}

/** Format approval_required event for Telegram. */
export function formatApprovalMessage(data: Record<string, unknown>): string {
  const command = String(data.command ?? "unknown");
  const args = data.args as Record<string, unknown> | undefined;
  const reasoning = String(data.reasoning ?? "");

  const argsStr = args
    ? Object.entries(args).map(([k, v]) => `  ${k}: ${String(v)}`).join("\n")
    : "";

  return [
    "\u26A0\uFE0F Approval Required",
    "",
    `Command: ${command}`,
    argsStr ? `Args:\n${argsStr}` : "",
    reasoning ? `\nReason: ${reasoning}` : "",
    "",
    "Tap Approve or Reject below.",
  ].filter(Boolean).join("\n");
}

/** Format error message. */
export function formatError(message: string): string {
  return `\u274C Error: ${message}`;
}

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Splits on paragraph boundaries when possible.
 */
export function chunkMessage(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to split on double newline (paragraph)
    let splitIdx = remaining.lastIndexOf("\n\n", limit);
    if (splitIdx < limit * 0.3) {
      // Paragraph boundary too early — try single newline
      splitIdx = remaining.lastIndexOf("\n", limit);
    }
    if (splitIdx < limit * 0.3) {
      // No good newline — try space
      splitIdx = remaining.lastIndexOf(" ", limit);
    }
    if (splitIdx < limit * 0.3) {
      // Hard cut
      splitIdx = limit;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

export { TELEGRAM_MSG_LIMIT, CHUNK_LIMIT };
