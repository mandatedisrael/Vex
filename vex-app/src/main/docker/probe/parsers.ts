/**
 * Pure Docker probe parsers (fixture-testable). Operate on string output
 * from `docker --version` / `docker compose version` / `docker model
 * status` / `docker info --format "{{json .}}"` so the test suite never
 * needs Docker installed.
 */

// ── Pure parsers (fixture-testable) ──────────────────────────────────

export function parseDockerVersion(stdout: string): string | null {
  // "Docker version 27.5.1, build 9f9e405"
  const match = stdout.match(/Docker version\s+([^\s,]+)/);
  return match?.[1] ?? null;
}

export function parseComposeVersion(stdout: string): string | null {
  // "Docker Compose version v2.32.4" or "Docker Compose version 2.32.4"
  const match = stdout.match(/Docker Compose version\s+(v?[\d][\w.+-]*)/);
  return match?.[1] ?? null;
}

export type ModelStatusKind = "active" | "inactive" | "unsupported";

export function parseModelStatus(
  stdout: string,
  errorMessage: string | null
): ModelStatusKind {
  if (errorMessage && /unknown command|no such command|is not a docker command/i.test(errorMessage)) {
    return "unsupported";
  }
  if (errorMessage && /unknown command|no such command/i.test(stdout)) {
    return "unsupported";
  }
  // Order matters: "Docker Model Runner is not running" contains the literal
  // word "running", so the negative pattern MUST be tested first.
  if (/not.*running|disabled|inactive|stopped/i.test(stdout)) return "inactive";
  if (/running|enabled|active/i.test(stdout)) return "active";
  if (errorMessage) return "inactive";
  return "inactive";
}

export function parseDaemonRunning(
  infoStdout: string,
  errorMessage: string | null
): boolean {
  if (errorMessage) {
    // Common stderrs when daemon is unreachable.
    return false;
  }
  // We invoke `docker info --format "{{json .}}"` (codex turn 5 RED #4 —
  // the previous text-format check would always say "stopped"). When the
  // daemon is reachable, the JSON object includes a non-empty
  // `ServerVersion` field. The client-only fast path prints `{}` plus a
  // separate stderr message — the function above already short-circuits
  // on errorMessage.
  const trimmed = infoStdout.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { ServerVersion?: unknown }).ServerVersion === "string" &&
      ((parsed as { ServerVersion: string }).ServerVersion).length > 0
    ) {
      return true;
    }
    return false;
  } catch {
    // Fallback: legacy text format ("Server Version: x.y.z") in case
    // someone wires probeDocker without --format=json.
    return /Server Version:/i.test(infoStdout);
  }
}
