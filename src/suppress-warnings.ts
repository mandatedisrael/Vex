/**
 * Suppress noisy warnings from transitive dependencies.
 * Must be imported BEFORE any other module to take effect.
 *
 * - bigint-buffer: "Failed to load bindings" console.warn from @solana/buffer-layout-utils
 * - punycode DEP0040: deprecated module used by transitive deps (whatwg-url, tr46)
 */

const _origWarn = console.warn.bind(console);
console.warn = ((...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("bigint")) return;
  _origWarn(...args);
}) as typeof console.warn;

const _origEmit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && msg.includes("punycode")) return;
  return (_origEmit as (w: string | Error, ...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;
