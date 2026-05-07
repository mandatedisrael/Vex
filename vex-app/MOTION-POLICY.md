# Motion / animation policy (Phase 1)

CSP for the renderer is strict: `style-src 'self'` — no `'unsafe-inline'`, no
inline `<style>` blocks. This is a non-negotiable Phase 1 gate (skill §7,
plan §"Phase 1 Acceptance Gates" CSP smoke test).

## What that means for `motion` and `framer-motion`

Motion (formerly framer-motion) primarily applies animations through inline
**style attributes** on the target element (`<motion.div style={{ opacity, transform }}>`).
Style **attributes** are NOT covered by `style-src` in CSP — that directive
only restricts `<style>` element content and `<style>` from external URLs.
So normal Motion usage is fine.

The places we must avoid:

1. **`<style>{...}</style>` element injection** (some libraries with theme
   tokens, Emotion's older configs, etc.) — Tailwind v4 emits CSS at build,
   so this is a non-issue for us; do not introduce another style runtime.
2. **`AnimatePresence` layout features** (e.g. `<Reorder>`, `<motion.div layout>`)
   — these may inject a runtime `<style>` for layout-id scope. **Avoid on
   wizard-critical screens** (Splash, System Check, Wallet step, Provider step,
   Review step). For Phase 2 chat/portfolio screens we will re-evaluate per
   feature.
3. **`dangerouslySetInnerHTML`** — never; always banned.

## Allowed

- `motion.div`, `motion.span`, etc. with `initial`, `animate`, `exit`, `transition` props.
- `useAnimate`, `useScroll`, `useTransform` hooks.
- `AnimatePresence` for component mount/unmount transitions WITHOUT `layout`/`layoutId`.
- CSS keyframe animations defined in `globals.css` or Tailwind utilities.
- Tailwind `transition-*` and `animate-*` utilities.

## Disallowed in Phase 1

- `<motion.div layout>` and friends.
- `<Reorder.Group>` / `<Reorder.Item>`.
- Any third-party animation library that ships runtime style injection
  without explicit allowlisting.

## Verification

The post-build CI script (`scripts/check-build-artifacts.mjs`) asserts that the
final HTML CSP contains no `'unsafe-inline'` or `'unsafe-eval'`. Any future
inclusion that breaks this must be flagged in PR review and either reworked or
covered by a signed-off exception (currently zero exceptions allowed).
