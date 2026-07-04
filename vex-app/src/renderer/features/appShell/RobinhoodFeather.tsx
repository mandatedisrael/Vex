/**
 * Robinhood feather glyph as an inline SVG (fill `currentColor`), so it tints
 * to any `--vex-*` token at the call site — unlike an <img>, which can't be
 * recolored. Used as the Robinhood-mode typing indicator (StreamingBubble),
 * where it inherits `--vex-accent` (neon lime) and a CSS pulse.
 *
 * Decorative by default (aria-hidden). Path traced from RH_symbol_*.svg
 * (Robinhood brand kit); the source colors are dropped for currentColor.
 */

import type { JSX } from "react";

export interface RobinhoodFeatherProps {
  readonly className?: string;
}

export function RobinhoodFeather({
  className,
}: RobinhoodFeatherProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 115.87 149.53"
      className={className}
      fill="currentColor"
      aria-hidden
      focusable={false}
    >
      <path d="m.86,149.53h3.3c.6,0,1.2-.3,1.4-.8C30.46,85.33,57.56,53.93,74.56,35.13c.7-.8.4-1.4-.6-1.4h-30.4c-1.1,0-2.03.44-2.8,1.4l-21.8,27c-3.2,4-4,7.7-4,13v27.6C7.86,122.63,3.36,136.13.06,148.33c-.2.78.1,1.2.8,1.2ZM110.56,4.03c-4.7-5-25.9-5.2-35.7-1.4-2.04.79-4,2.13-4.9,2.9-9,7.7-15,13.8-20.7,19.8-.7.7-.4,1.4.6,1.4h33.7c3.1,0,4.9,1.8,4.9,4.9v38c0,1,.8,1.3,1.4.4l20.3-26.5c3.3-4.3,4.3-5.6,5.2-11.6,1.2-8.8.5-22.3-4.8-27.9Zm-43.5,100.8l13.9-22.9c.3-.6.4-1.3.4-1.8v-38.2c0-1-.7-1.4-1.4-.6-20.9,23.3-37.2,47.8-52.3,77.3-.38.74.1,1.4,1,1.1l31.2-9.6c3.52-1.08,5.5-2.5,7.2-5.3Z" />
    </svg>
  );
}
