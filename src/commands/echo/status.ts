import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderName } from "../../providers/types.js";
import { CONFIG_DIR } from "../../config/paths.js";
import { colors, infoBox, printTable, successBox, warnBox, stepHeader, markOk, markPending } from "../../utils/ui.js";
import { buildDoctorChecks, buildEchoSnapshot, buildSupportReport, type EchoSnapshot } from "./state.js";
import { autoDetectProvider } from "../../providers/registry.js";
import { buildVerifyPayload } from "./assessment.js";
import { PROVIDER_LABELS } from "./catalog.js";
import { writeEchoWorkflow } from "./protocol.js";
import { writeStderr } from "../../utils/output.js";

export function printHomeSummary(snapshot: EchoSnapshot): void {
  const mark = (ok: boolean | string | null | undefined, label: string): string =>
    ok ? markOk(label) : markPending(label);

  const passwordLabel =
    snapshot.wallet.password.status === "ready"
      ? `ready (${snapshot.wallet.password.source})`
      : snapshot.wallet.password.status === "drift"
        ? colors.warn(`drift (${snapshot.wallet.password.driftSources.join(", ")})`)
        : snapshot.wallet.password.status === "invalid"
          ? colors.error("invalid")
          : colors.muted("missing");

  const runtimeNames = Object.entries(snapshot.runtimes.detected)
    .filter(([, v]) => v.detected)
    .map(([k]) => PROVIDER_LABELS[k as ProviderName]);

  writeStderr("");
  writeStderr(mark(snapshot.wallet.evmAddress, `EVM:       ${snapshot.wallet.evmAddress ?? colors.muted("not configured")}`));
  writeStderr(mark(snapshot.wallet.solanaAddress, `Solana:    ${snapshot.wallet.solanaAddress ?? colors.muted("not configured")}`));
  writeStderr(mark(snapshot.wallet.password.status === "ready", `Password:  ${passwordLabel}`));
  writeStderr(mark(runtimeNames.length > 0, `Runtime:   ${runtimeNames.length > 0 ? runtimeNames.join(", ") : colors.muted("none")} (rec: ${PROVIDER_LABELS[snapshot.runtimes.recommended]})`));
  writeStderr(mark(snapshot.claude.running, `Proxy:     ${snapshot.claude.running ? colors.success(`running on ${snapshot.claude.port}`) : colors.muted("not running")}`));
  writeStderr(mark(snapshot.monitor.running, `Monitor:   ${snapshot.monitor.running ? colors.success(`running (PID ${snapshot.monitor.pid})`) : colors.muted("not running")}`));

  const solCluster = snapshot.solanaCluster;
  const jupKey = snapshot.jupiterApiKeySet;
  if (solCluster || jupKey) {
    writeStderr(markOk(`Solana:    ${solCluster ? colors.primary(solCluster) : "default"}${jupKey ? " + Jupiter key" : ""}`));
  }

  writeStderr("");
}

export async function printStatus(json: boolean, fresh = false): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  if (json) {
    writeEchoWorkflow({
      phase: "status",
      status: "ready",
      summary: "Current Echo launcher status snapshot.",
      snapshot,
    });
    return;
  }

  infoBox("Status", JSON.stringify(snapshot, null, 2));
}

export async function printDoctor(json: boolean, fresh = false): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  const checks = await buildDoctorChecks(snapshot);
  if (json) {
    writeEchoWorkflow({
      phase: "doctor",
      status: "ready",
      summary: "Diagnostics completed.",
      checks,
      snapshot,
    });
    return;
  }

  stepHeader(1, 1, "Doctor");
  writeStderr("");

  const rows = checks.map((check) => [
    check.ok ? colors.success("OK") : colors.warn("WARN"),
    check.title,
    check.detail,
  ]);

  printTable([
    { header: "Status", width: 10 },
    { header: "Check", width: 24 },
    { header: "Detail", width: 70 },
  ], rows);
}

export async function writeSupportReportToFile(json = false): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true });
  const report = buildSupportReport(snapshot);

  if (json) {
    writeEchoWorkflow({
      phase: "support-report",
      status: "ready",
      summary: "Generated a redacted support report.",
      report,
    });
    return;
  }

  const reportDir = join(CONFIG_DIR, "reports");
  mkdirSync(reportDir, { recursive: true });
  const path = join(reportDir, `support-report-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
  successBox("Support Report Saved", `Saved to ${path}`);
}

export async function printVerify(json: boolean, runtime = autoDetectProvider().name, fresh = true): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  const payload = buildVerifyPayload(snapshot, runtime);

  if (json) {
    writeEchoWorkflow(payload);
    return;
  }

  const body = [
    payload.summary,
    payload.nextAction ? `Next action: ${payload.nextAction}` : "",
    ...(payload.manualSteps ?? []),
    ...(payload.warnings ?? []),
  ].filter(Boolean).join("\n");

  if (payload.status === "ready") {
    successBox("Verify", body);
  } else if (payload.status === "manual_required") {
    warnBox("Verify", body);
  } else {
    infoBox("Verify", body);
  }
}
