/**
 * Shared primitives for the onboarding flow (intro → systemCheck →
 * dockerBootstrap → composeBootstrap → migrations → wizard).
 *
 * Promoted from `features/docker/bootstrap/` when composeBootstrap
 * became the 4th consumer of the iOS-glass aesthetic (StatusTile,
 * PrimaryButton, DocsLink, FooterButtons). All components read accent
 * from `var(--vex-onboarding-accent, var(--color-accent-primary))` so
 * they fall back gracefully when used outside an onboarding scope.
 */

export { StatusTile, type StatusTone } from "./StatusTile.js";
export { PrimaryButton } from "./PrimaryButton.js";
export { DocsLink } from "./DocsLink.js";
export { ContinueButton, RecheckButton } from "./FooterButtons.js";
