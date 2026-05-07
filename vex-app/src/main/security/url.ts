/**
 * Shared URL security helpers — used by both the app://vex/ protocol handler
 * and the external-link allowlist (shell.openExternal / setWindowOpenHandler).
 *
 * Lives under `src/main/` (not `src/shared/`) per skill §3: shared/ holds
 * DTO/schema/contracts only; security policy is privileged main-process logic.
 *
 * IMPORTANT: every check here must be paired with a unit test.
 */

/**
 * True if the raw request URL string contains any form of parent-directory
 * traversal segment. Catches:
 *   /..    \..    %2e%2e    %2f%2e%2e    %5c%2e%2e
 * Case-insensitive.
 *
 * The URL constructor normalizes `../` away, so a raw URL like
 *   app://vex/../etc/passwd
 * becomes
 *   pathname = "/etc/passwd"
 * which would *technically* resolve inside our root. Adversarial intent —
 * reject pre-parse so we never even try.
 */
export function containsTraversal(rawUrl: string): boolean {
  const lower = rawUrl.toLowerCase();
  return (
    lower.includes("/..") ||
    lower.includes("\\..") ||
    lower.includes("/%2e%2e") ||
    lower.includes("\\%2e%2e") ||
    lower.includes("%2f%2e%2e") ||
    lower.includes("%5c%2e%2e")
  );
}

/**
 * Path-prefix check that respects path boundary: a prefix like `/foo` only
 * matches `/foo` itself or `/foo/...`, never `/foo-bar` or `/foobaz`.
 *
 * Without this boundary, an allowlist entry `/electron/electron/releases`
 * would erroneously accept `/electron/electron/releases-malicious`.
 */
export function pathStartsWithBoundary(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  // A trailing slash on prefix means "this dir or deeper". Otherwise we
  // accept either an exact match or `prefix + '/'` boundary.
  if (prefix.endsWith("/")) {
    return pathname.startsWith(prefix);
  }
  return pathname.startsWith(`${prefix}/`);
}

/**
 * Allowlist entry shape used by the external-link allowlist.
 * `string` = exact-host match; `{host, pathPrefix}` = host + path-boundary match.
 */
export type ExternalAllowEntry =
  | string
  | { readonly host: string; readonly pathPrefix: string };

/**
 * Decide if a raw URL string is safe to pass to `shell.openExternal`.
 *  - Rejects anything containing path traversal markers.
 *  - Rejects anything that isn't `https:`.
 *  - Accepts only entries from the allowlist with proper path boundary.
 */
export function isAllowedExternalUrl(
  raw: string,
  allowlist: ReadonlyArray<ExternalAllowEntry>
): boolean {
  if (containsTraversal(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  for (const entry of allowlist) {
    if (typeof entry === "string") {
      if (url.hostname === entry) return true;
    } else if (
      url.hostname === entry.host &&
      pathStartsWithBoundary(url.pathname, entry.pathPrefix)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve an `app://<expectedHost>/...` URL against a renderer-root directory,
 * returning the absolute file path or a refusal reason.
 *  - "bad_request" → URL didn't parse
 *  - "not_found"   → host segment didn't match expectedHost
 *  - "forbidden"   → traversal detected (raw or post-decode) or resolved
 *                    path escapes the root
 */
export type AppUrlResolution =
  | { readonly kind: "ok"; readonly absolutePath: string }
  | { readonly kind: "bad_request" }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" };

export function resolveAppUrl(args: {
  readonly rawUrl: string;
  readonly expectedHost: string;
  readonly normalizedRoot: string;
  /** node:path resolve+sep injected so this stays platform-aware in callers. */
  readonly resolve: (...segments: string[]) => string;
  readonly sep: string;
}): AppUrlResolution {
  if (containsTraversal(args.rawUrl)) {
    return { kind: "forbidden" };
  }
  let urlPath: string;
  try {
    const url = new URL(args.rawUrl);
    if (url.host !== args.expectedHost) return { kind: "not_found" };
    urlPath = decodeURIComponent(url.pathname);
    if (urlPath.includes("..")) return { kind: "forbidden" };
  } catch {
    return { kind: "bad_request" };
  }
  if (urlPath === "/" || urlPath === "") {
    urlPath = "/index.html";
  }
  const resolved = args.resolve(args.normalizedRoot, "." + urlPath);
  if (
    !resolved.startsWith(args.normalizedRoot + args.sep) &&
    resolved !== args.normalizedRoot
  ) {
    return { kind: "forbidden" };
  }
  return { kind: "ok", absolutePath: resolved };
}
