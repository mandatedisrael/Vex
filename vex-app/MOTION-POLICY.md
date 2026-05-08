# Motion / animation / runtime-styling policy (Phase 1)

CSP for the renderer is strict: `style-src 'self'` — no `'unsafe-inline'`, no
inline `<style>` blocks, no inline HTML `style="..."` attributes parsed from
markup. This is a non-negotiable Phase 1 gate (skill §7, plan §"Phase 1
Acceptance Gates" CSP smoke test).

## CSP precise semantics (corrected per codex audits 2026-05-08)

Per CSP3 spec + MDN docs (`style-src`, `style-src-attr`), the `style-src`
directive controls:

1. external stylesheets (`<link rel="stylesheet" href="...">`)
2. `<style>` element contents
3. inline HTML `style="..."` attributes (governed by `style-src-attr` if set,
   otherwise inherited from `style-src`)
4. **`element.setAttribute("style", "...")`** — treated as creating an inline
   style attribute, hence blocked under `style-src 'self'`
5. **`element.style.cssText = "..."`** — also creates a parsed inline style
   string, also blocked

What `style-src` does NOT govern:

- `element.style.foo = "value"` — single CSSOM property assignment, allowed
- `CSSStyleSheet.insertRule(...)` from JavaScript — allowed by CSP, but
  audit-relevant: it is still a runtime stylesheet mutation, so a library
  that calls it for theming/animations should be reviewed under the same
  rigor as `<style>` injection (codex 2026-05-08 turn 2).
- `element.style.setProperty("--foo", "bar")` — single CSSOM property
  assignment, allowed

The distinction is: parsing a string into multiple style declarations
(`setAttribute`, `cssText`, raw HTML) is blocked; assigning a single
property via CSSOM is allowed.

## What that means for `motion` (formerly `framer-motion`)

React's reconciler applies `style={{...}}` props in the commit phase via
**CSSOM property assignment** (`domStyle[key] = value` in a loop), not via
`setAttribute("style", ...)`. So React-rendered inline styles go through the
allowed path.

Motion's animation loop similarly mutates `element.style.<prop>` in
`requestAnimationFrame`, which is also CSSOM property assignment.

Motion is therefore CSP-safe under our policy when used through React, and
its `style={{...}}` props will not produce CSP violations.

The places we must still avoid:

1. **`<style>{...}</style>` element injection** — some libraries (older
   Emotion configs, theme runtimes) parse a `<style>` element back into the
   DOM. Tailwind v4 emits CSS at build, so this is a non-issue for us; do not
   introduce another style runtime that would need an inline `<style>` tag.
2. **`<motion.div layout>` / `<Reorder>`** — Motion's layout features inject
   a runtime stylesheet to scope `layoutId` keyframes. **Avoid on
   wizard-critical screens** (Splash, System Check, Wallet step, Provider
   step, Review step). For Phase 2 chat/portfolio screens we will re-evaluate
   per feature.
3. **`dangerouslySetInnerHTML`** — never; always banned.
4. **Server-rendered HTML strings with `style="..."`** — banned. Our
   renderer is a SPA, no SSR, and no template literal injects raw `style=`.

## Per-Radix-primitive audit checklist (codex RED 3)

When introducing any `@radix-ui/*` primitive in a future milestone, the PR
must include:

- [ ] Confirm the primitive does not append a `<style>` element to `<head>`
      at runtime (open DevTools → Elements → `<head>`, exercise every state).
- [ ] Confirm any positioning/animation styles arrive via React `style`
      props (JS path, allowed) and not via injected `<style>` blocks.
- [ ] Run a Playwright `_electron` probe that opens every visible state
      (open/closed/hover) and asserts no `Refused to apply inline style`
      console violations.
- [ ] Document the audit result in this file under "Audited primitives"
      with the verifying commit hash.

If a primitive injects runtime `<style>`, two options exist:

- **Reject the primitive.** Prefer a CSS-only alternative or build a
  bespoke component using shadcn-pattern variants over Tailwind classes.
- **Implement nonce CSP plumbing properly.** This requires the main
  process to mint a per-load nonce, inject it into the served HTML, and
  forward it to the primitive's StyleSheet manager. **Do not ship a
  static nonce as a workaround** — that defeats CSP.

### Audited primitives

| Primitive | Status | Verifier | Commit |
|---|---|---|---|
| Card (shadcn-pattern, no Radix) | safe | M1 | TBD |
| Button (shadcn-pattern, no Radix) | safe | M1 | TBD |

## Allowed

- `motion.div`, `motion.span`, etc. with `initial`, `animate`, `exit`,
  `transition` props (React-JSX path).
- `useAnimate`, `useScroll`, `useTransform` hooks.
- `AnimatePresence` for component mount/unmount transitions WITHOUT
  `layout`/`layoutId`.
- CSS keyframe animations defined in `globals.css` or Tailwind utilities
  (build-time emission, not runtime injection).
- Tailwind `transition-*` and `animate-*` utility classes.

## Disallowed in Phase 1

- `<motion.div layout>` and friends.
- `<Reorder.Group>` / `<Reorder.Item>`.
- Any third-party library that injects runtime `<style>` elements
  without an audited nonce or hash exception.
- Any inline-style HTML rendered from a string template (SSR-shaped
  paths, `innerHTML` assignments, `dangerouslySetInnerHTML`).

## Verification

The post-build CI script (`scripts/check-build-artifacts.mjs`) asserts that
the final HTML CSP contains no `'unsafe-inline'` or `'unsafe-eval'`. Per-state
runtime checks on Radix primitives ride in the M15 Playwright suite; new
primitives must include a runtime CSP smoke at the time of adoption (not
deferred). Any future inclusion that breaks this must be flagged in PR
review and either reworked or covered by a signed-off exception (currently
zero exceptions allowed).
