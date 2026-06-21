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
 *   - images: a `safeImgSrc`-validated https source renders as a hardened
 *     raw-remote `<img>` (no-referrer, lazy, CSS-bounded, alt-text fallback on
 *     error) — the deliberate Option-A2 token-logo decision; anything else
 *     (non-https, credentialed, localhost/private host, control chars) falls
 *     back to ALT TEXT only;
 *   - GFM tables + task lists render as semantic elements (cells/items go
 *     through the same escaped-React-text path — no HTML sink);
 *   - raw-HTML and any still-unsupported tokens render as escaped text;
 *   - if `lexer` throws, the original text is shown verbatim, never blanked;
 *   - the code-block copy key (S3) writes the token's raw string straight to
 *     the clipboard API — no HTML sink is introduced.
 */

import { lexer, type Token } from "marked";
import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon } from "@hugeicons/core-free-icons";

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

/**
 * True when a hostname targets the local machine or a private/link-local
 * network — an SSRF-style surface even for a bare <img> fetch. Blocks
 * `localhost`, any `*.local`, IPv4 loopback/private/link-local ranges, and the
 * IPv6 loopback / unique-local (fc00::/7) / link-local (fe80::/10) ranges.
 *
 * URL normalizes IPv6 hosts to bracketed lowercase (`[::1]`), so we strip the
 * brackets before range-testing.
 */
function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;

  // IPv4 dotted-quad ranges: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 !== null) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 10) return true; // private 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
    if (a === 192 && b === 168) return true; // private 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
    return false;
  }

  // IPv6 (URL keeps brackets: `[::1]`). Strip them, then range-test.
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1);
    if (v6 === "::1") return true; // loopback ::1
    // IPv4-mapped IPv6 (`::ffff:7f00:1` = 127.0.0.1). URL normalizes mapped
    // forms to this compressed prefix, so a single startsWith closes the
    // mapped-loopback/private bypass without re-parsing the embedded IPv4.
    if (v6.startsWith("::ffff:")) return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(v6)) return true; // unique-local fc00::/7
    if (/^fe[89ab][0-9a-f]?:/.test(v6)) return true; // link-local fe80::/10
    return false;
  }

  return false;
}

/**
 * Allow only an absolute `https:` image URL with NO embedded credentials and a
 * host that is not localhost/loopback/private/link-local. Otherwise null (the
 * caller falls back to alt text). This is the Option-A2 gate: token logos are
 * fetched raw from arbitrary https hosts.
 */
export function safeImgSrc(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (hasControlChars(trimmed)) return null;
  if (trimmed.startsWith("//")) return null; // protocol-relative
  try {
    const url = new URL(trimmed); // throws on relative (no base)
    if (url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null; // no creds
    if (isLocalOrPrivateHost(url.hostname)) return null;
    return url.href;
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
            className="rounded-[3px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[13px]"
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
            className="text-[var(--vex-accent-text)] underline underline-offset-2"
          >
            {children}
          </a>
        ) : (
          <span key={i}>{children}</span>
        );
      }
      case "image": {
        // Option A2: render a hardened raw-remote <img> when the source passes
        // `safeImgSrc` (https-only, no creds, no localhost/private host).
        // Residual risk: an arbitrary https host serving the image learns the
        // client IP and a load timestamp (tracking-pixel surface); mitigated
        // by `referrerPolicy="no-referrer"` (no URL/path leakage) but not
        // eliminated. DNS-rebinding is an accepted residual under Option A.
        // This is the deliberate product decision — see the C2 plan.
        const safe = safeImgSrc(token.href);
        const alt = token.text ?? "";
        return safe !== null ? (
          <MarkdownImage key={i} src={safe} alt={alt} />
        ) : (
          // Source rejected → keep the original alt-text-only behavior.
          <span key={i}>{token.text}</span>
        );
      }
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
      // Semantic decision unchanged (no h-tags in chat prose) — S3 restyles
      // the document scale only: h1/h2-level lead, h3+ subordinate.
      return (
        <p
          key={key}
          className={
            token.depth <= 2
              ? "mt-5 text-[17px] font-semibold text-foreground"
              : "text-[15px] font-semibold text-foreground"
          }
        >
          {renderInline(token.tokens)}
        </p>
      );
    case "code":
      return (
        <CodeBlock key={key} lang={codeLang(token.lang)} code={token.text} />
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-[var(--vex-line-strong)] pl-3 text-[var(--vex-text-2)]"
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
              className="mt-1.5 accent-[var(--vex-accent)]"
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
      return <hr key={key} className="border-[var(--vex-line)]" />;
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
              <tr>
                {token.header.map((cell, i) => (
                  <th
                    key={i}
                    className={`border-b border-[var(--vex-line-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)] ${alignClass(i)}`}
                  >
                    {renderInline(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((cells, r) => (
                <tr key={r}>
                  {cells.map((cell, c) => (
                    <td
                      key={c}
                      className={`border-b border-[var(--vex-line)] px-2 py-1 align-top ${alignClass(c)}`}
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

/** First word of the fence info string ("ts foo" → "ts"); "code" when absent. */
function codeLang(raw: string | undefined): string {
  const first = raw?.trim().split(/\s+/)[0];
  return first !== undefined && first.length > 0 ? first : "code";
}

/**
 * Hardened token-logo image (Option A2). The src is pre-validated by
 * `safeImgSrc`. `referrerPolicy="no-referrer"` keeps the URL/path off the
 * wire; size is CSS-bounded so a hostile dimension can't blow out the layout.
 * On a load error we drop back to the alt text rather than showing a broken
 * image glyph.
 */
function MarkdownImage({
  src,
  alt,
}: {
  readonly src: string;
  readonly alt: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) return <span>{alt}</span>;
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="inline-block max-h-[5rem] max-w-[5rem] rounded-[4px] align-text-bottom"
    />
  );
}

const COPY_RESET_MS = 1_500;

/**
 * Fenced code block — recessed case file (S3): hairline wrapper on the
 * surface-down well with a language strip + copy key. The copy button writes
 * the token's RAW string via the clipboard API — it never re-enters the React
 * tree, so the no-HTML-sink invariant is untouched.
 */
function CodeBlock({
  lang,
  code,
}: {
  readonly lang: string;
  readonly code: string;
}): JSX.Element {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The reset timer must not fire setState after unmount.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      // Clipboard can be denied/unavailable — surface it instead of lying.
      setCopyState("failed");
    }
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), COPY_RESET_MS);
  };

  return (
    <div className="overflow-hidden rounded-[6px] border border-[var(--vex-line)] bg-[var(--vex-surface-down)]">
      <div className="flex h-7 items-center justify-between border-b border-[var(--vex-line)] px-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
          {lang}
        </span>
        <button
          type="button"
          aria-label="Copy code"
          onClick={() => void onCopy()}
          className="flex items-center text-[var(--vex-text-3)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          {copyState === "idle" ? (
            <HugeiconsIcon icon={Copy01Icon} size={12} aria-hidden />
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {copyState === "copied" ? "Copied" : "Copy failed"}
            </span>
          )}
        </button>
      </div>
      <pre className="max-h-[480px] overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-[var(--vex-text-2)]">
        <code>{code}</code>
      </pre>
    </div>
  );
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
