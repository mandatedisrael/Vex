/**
 * TCP / HTTP reachability probes (used for host port availability +
 * Docker Model Runner endpoint reachability). Each probe owns its own
 * `AbortController` + timeout cleanup so a hung socket/fetch can never
 * freeze the main process.
 */

import { createConnection } from "node:net";

const PORT_PROBE_TIMEOUT_MS = 1_000;
const HTTP_PROBE_TIMEOUT_MS = 2_000;

// ── TCP / HTTP probes (used for ports + Model Runner reachability) ───

export async function isPortFree(
  host: string,
  port: number,
  signal?: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const cleanup = (free: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(free);
    };
    const timer = setTimeout(() => cleanup(true), PORT_PROBE_TIMEOUT_MS);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cleanup(false);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cleanup(true);
    });
  });
}

export async function isModelRunnerEndpointReachable(
  baseUrl: string = "http://127.0.0.1:12434/engines/llama.cpp/v1",
  signal?: AbortSignal
): Promise<boolean> {
  const ac = new AbortController();
  const linked = (): void => ac.abort();
  signal?.addEventListener("abort", linked, { once: true });
  const timer = setTimeout(() => ac.abort(), HTTP_PROBE_TIMEOUT_MS);
  try {
    // Append `/models` to baseUrl rather than using `new URL("/v1/models", …)`
    // which would silently drop the engine path (codex turn 5 YELLOW #1).
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", linked);
  }
}
