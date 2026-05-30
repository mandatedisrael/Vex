/**
 * MarkdownContent (stage 8-2a) — render assistant markdown WITHOUT ever
 * producing an HTML string.
 *
 * The build pipeline bans `dangerouslySetInnerHTML`
 * (`scripts/check-build-artifacts.mjs`), so `marked` is used ONLY as a
 * tokenizer (`lexer`) and the token tree is rendered to React elements. Text
 * becomes auto-escaped React nodes — there is no HTML sink, so DOMPurify is
 * unnecessary. Hardening:
 *   - links: absolute `https:` only (`safeHref`); anything else renders as
 *     plain text. Allowed links get `target="_blank" rel="noopener noreferrer"`
 *     and main's `shell.openExternal` allowlist stays the final gate;
 *   - images render as ALT TEXT only — never an `<img>` (no remote fetch);
 *   - GFM tables + task lists render as semantic elements (cells/items go
 *     through the same escaped-React-text path — no HTML sink);
 *   - raw-HTML and any still-unsupported tokens render as escaped text;
 *   - if `lexer` throws, the original text is shown verbatim, never blanked.
 */

import { lexer, type Token } from "marked";
import type { JSX, ReactNode } from "react";

/** ASCII control chars (U+0000–U+001F) and DEL (U+007F) are never valid in a URL. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Allow only absolute https: URLs; everything else → render as plain text. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;
  if (hasControlChars(trimmed)) return null;
  if (trimmed.startsWith("//")) return null; // protocol-relative
  try {
    const url = new URL(trimmed); // throws on relative (no base)
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function tokenText(token: Token): string {
  if ("text" in token && typeof token.text === "string") return token.text;
  return token.raw;
}

function renderInline(tokens: readonly Token[] | undefined): ReactNode[] {
  if (tokens === undefined) return [];
  return tokens.map((token, i) => {
    switch (token.type) {
      case "text":
        return token.tokens !== undefined ? (
          <span key={i}>{renderInline(token.tokens)}</span>
        ) : (
          token.text
        );
      case "escape":
        return token.text;
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {renderInline(token.tokens)}
          </strong>
        );
      case "em":
        return (
          <em key={i} className="italic">
            {renderInline(token.tokens)}
          </em>
        );
      case "del":
        return <del key={i}>{renderInline(token.tokens)}</del>;
      case "codespan":
        return (
          <code
            key={i}
            className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[0.85em]"
          >
            {token.text}
          </code>
        );
      case "br":
        return <br key={i} />;
      case "link": {
        const href = safeHref(token.href);
        const children = renderInline(token.tokens);
        return href !== null ? (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8da5ff] underline-offset-2 hover:underline"
          >
            {children}
          </a>
        ) : (
          <span key={i}>{children}</span>
        );
      }
      case "image":
        // Alt text only — never an <img> (no remote fetch / tracking pixel).
        return <span key={i}>{token.text}</span>;
      default:
        // Raw HTML + anything unsupported → escaped text node.
        return <span key={i}>{tokenText(token)}</span>;
    }
  });
}

function renderBlock(token: Token, key: number): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return <p key={key}>{renderInline(token.tokens)}</p>;
    case "heading":
      return (
        <p key={key} className="font-semibold text-foreground">
          {renderInline(token.tokens)}
        </p>
      );
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-white/[0.06] p-2 font-mono text-[12px] leading-snug"
        >
          <code>{token.text}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-white/20 pl-3 text-[var(--color-text-secondary)]"
        >
          {renderBlocks(token.tokens)}
        </blockquote>
      );
    case "list": {
      const items = token.items.map((item, i) =>
        item.task ? (
          // GFM task list item — a non-interactive (disabled, non-focusable)
          // checkbox reflecting `[x]`/`[ ]`, plus the item content. marked emits
          // a separate `checkbox` token at the head of `item.tokens`; drop it so
          // the literal marker isn't rendered alongside the visual checkbox.
          <li key={i} className="flex list-none items-start gap-2">
            <input
              type="checkbox"
              checked={item.checked === true}
              disabled
              aria-hidden
              className="mt-1.5 accent-[#3275f8]"
            />
            <span className="min-w-0">
              {renderBlocks(item.tokens.filter((t) => t.type !== "checkbox"))}
            </span>
          </li>
        ) : (
          <li key={i}>{renderBlocks(item.tokens)}</li>
        ),
      );
      const hasTask = token.items.some((item) => item.task);
      return token.ordered ? (
        <ol
          key={key}
          start={typeof token.start === "number" ? token.start : undefined}
          className="list-decimal pl-5"
        >
          {items}
        </ol>
      ) : (
        <ul key={key} className={hasTask ? "flex flex-col gap-1" : "list-disc pl-5"}>
          {items}
        </ul>
      );
    }
    case "hr":
      return <hr key={key} className="border-white/10" />;
    case "text":
      return (
        <p key={key}>
          {token.tokens !== undefined
            ? renderInline(token.tokens)
            : tokenText(token)}
        </p>
      );
    case "table": {
      // GFM table → semantic <table>. Cells render through renderInline, so
      // their content stays escaped React text (same no-HTML-sink guarantee).
      const align = token.align ?? [];
      const alignClass = (i: number): string =>
        align[i] === "center"
          ? "text-center"
          : align[i] === "right"
            ? "text-right"
            : "text-left";
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.95em]">
            <thead>
              <tr className="border-b border-white/15">
                {token.header.map((cell, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1 font-semibold ${alignClass(i)}`}
                  >
                    {renderInline(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((cells, r) => (
                <tr key={r} className="border-b border-white/[0.06]">
                  {cells.map((cell, c) => (
                    <td
                      key={c}
                      className={`px-2 py-1 align-top ${alignClass(c)}`}
                    >
                      {renderInline(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      // raw HTML + anything still unsupported → escaped text, never elements.
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {tokenText(token)}
        </p>
      );
  }
}

function renderBlocks(tokens: readonly Token[]): ReactNode[] {
  return tokens.map((token, i) => renderBlock(token, i));
}

export function MarkdownContent({
  text,
}: {
  readonly text: string;
}): JSX.Element {
  let tokens: readonly Token[];
  try {
    tokens = lexer(text);
  } catch {
    return <p className="whitespace-pre-wrap break-words">{text}</p>;
  }
  return (
    <div className="flex flex-col gap-2 break-words">{renderBlocks(tokens)}</div>
  );
}
