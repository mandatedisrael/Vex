/**
 * electron-log configuration with file rotation per skill §11 +
 * redaction wrapper that scrubs secrets before any transport sees them.
 *
 * Log files: ${userData}/logs/{main,renderer}-{YYYY-MM-DD}.log
 * Rotation: 5 MB max → archive on rollover.
 *
 * Use the exported `log` for ALL main-process logging — never raw
 * `console.*` and never the unredacted `electron-log` instance directly.
 */

import { app } from "electron";
import path from "node:path";
import logElectron from "electron-log/main.js";
import { redact, redactArgs } from "./redact.js";

let configured = false;

const MAX_BYTES = 5 * 1024 * 1024;

export function configureLogger(): typeof logElectron {
  if (configured) return logElectron;

  logElectron.transports.console.level = app.isPackaged ? false : "info";
  logElectron.transports.console.format =
    "{h}:{i}:{s}.{ms} [{level}] {scope} {text}";

  logElectron.transports.file.level = app.isPackaged ? "warn" : "info";
  logElectron.transports.file.maxSize = MAX_BYTES;
  logElectron.transports.file.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}";
  logElectron.transports.file.resolvePathFn = (variables) => {
    const fileName = variables.fileName ?? "main.log";
    return path.join(app.getPath("userData"), "logs", fileName);
  };
  logElectron.transports.file.archiveLogFn = (oldLogFile) => oldLogFile;

  // Capture uncaught errors & promise rejections in main, but route them
  // through the redactor so unhandled paths can NEVER bypass scrubbing.
  logElectron.errorHandler.startCatching({
    showDialog: false,
    onError({ error, processType, versions }) {
      const safeError = redact(error);
      const safeVersions = redact(versions);
      logElectron.error(
        `[unhandled:${processType ?? "unknown"}]`,
        safeError,
        safeVersions
      );
      // We've already logged — instruct electron-log not to do its raw default.
      return false;
    },
  });

  logElectron.eventLogger.startLogging({
    events: {
      app: { "before-quit": true },
      webContents: { "render-process-gone": true },
    },
  });

  configured = true;
  return logElectron;
}

/**
 * Redacted logger wrapper. All call sites in main should use this
 * instead of importing `electron-log` directly. The variadic args
 * are recursively scrubbed for sensitive field names + secret patterns
 * (private keys, JWTs, base58 secrets, EVM addresses).
 */
export const log = {
  error(...args: unknown[]): void {
    logElectron.error(...redactArgs(args));
  },
  warn(...args: unknown[]): void {
    logElectron.warn(...redactArgs(args));
  },
  info(...args: unknown[]): void {
    logElectron.info(...redactArgs(args));
  },
  debug(...args: unknown[]): void {
    logElectron.debug(...redactArgs(args));
  },
  verbose(...args: unknown[]): void {
    logElectron.verbose(...redactArgs(args));
  },
  silly(...args: unknown[]): void {
    logElectron.silly(...redactArgs(args));
  },
} as const;

export { redact, redactArgs } from "./redact.js";
