/**
 * External documentation link primitive. Renders the link with an
 * arrow-up-right glyph and routes through the renderer's default
 * `<a target="_blank">` flow, which the main process picks up via the
 * `shell.openExternal` allowlist (no in-renderer navigation).
 *
 * `rel="noopener noreferrer"` mandatory — even on Electron, leaving
 * `opener` open against a freshly-launched browser tab is bad hygiene.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

interface DocsLinkProps {
  readonly href: string;
  readonly label: string;
}

export function DocsLink({ href, label }: DocsLinkProps): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 self-start text-xs text-[var(--vex-onboarding-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
    >
      {label}
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} aria-hidden />
    </a>
  );
}
