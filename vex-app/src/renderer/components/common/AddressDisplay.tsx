/**
 * Truncated address with copy-to-clipboard button (M8).
 *
 * Truncation: `0x1234…abcd` (6 chars from start, 4 from end). Short
 * enough to scan visually, long enough to disambiguate at a glance.
 * Copy uses `navigator.clipboard.writeText`; visual checkmark feedback
 * for 1.5s. No Toast primitive needed for M8.
 *
 * Accessibility:
 *  - Address is rendered in a `<code>` so screen readers announce it
 *    character-by-character.
 *  - Copy button uses `aria-label` that flips between "Copy address"
 *    and "Address copied" so AT users know the action result.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { cn } from "../../lib/utils.js";

export interface AddressDisplayProps {
  readonly address: string;
  readonly className?: string;
  readonly truncate?: boolean;
}

const COPY_FEEDBACK_MS = 1500;
const PREFIX_LEN = 6;
const SUFFIX_LEN = 4;

function truncateAddress(address: string): string {
  if (address.length <= PREFIX_LEN + SUFFIX_LEN + 1) return address;
  return `${address.slice(0, PREFIX_LEN)}…${address.slice(-SUFFIX_LEN)}`;
}

/**
 * Permissionless copy: an off-screen readonly textarea + the selection copy
 * command. Deprecated API, but the reliable path in a renderer whose
 * permissions API is deny-all — no privileged IPC surface needed for a
 * public address string.
 */
function copyViaSelection(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function AddressDisplay({
  address,
  className,
  truncate = true,
}: AddressDisplayProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (): Promise<void> => {
    // The shell's permission handlers are deny-all (main/permissions.ts), so
    // `navigator.clipboard.writeText` is rejected in the renderer. Try it
    // first (future-proof), then fall back to the selection-based copy path,
    // which needs no permissions API. Feedback fires ONLY on a real success.
    let ok = false;
    try {
      await navigator.clipboard.writeText(address);
      ok = true;
    } catch {
      ok = copyViaSelection(address);
    }
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  const displayed = truncate ? truncateAddress(address) : address;

  return (
    <div
      className={cn(
        // Hairline chip — luminance step + hairline (landing ink grammar).
        "inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1",
        className
      )}
    >
      <code
        className="font-mono text-sm text-foreground"
        title={truncate ? address : undefined}
      >
        {displayed}
      </code>
      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        aria-label={copied ? "Address copied" : "Copy address"}
        className="rounded-sm px-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? "✓ copied" : "copy"}
      </button>
    </div>
  );
}
