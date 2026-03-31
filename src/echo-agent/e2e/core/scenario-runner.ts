/**
 * Scenario runner — canonical E2E executor.
 *
 * Reuses production dispatchTool() path for faithful end-to-end testing.
 * Each step goes through the same dispatcher → runtime → capture → projection
 * pipeline that the real engine uses.
 */

import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";
import type { ToolResult } from "@echo-agent/tools/types.js";
import { runMigrations } from "@echo-agent/db/migrate.js";
import { closePool } from "@echo-agent/db/client.js";
import logger from "@utils/logger.js";

// ── Types ──────────────────────────────────────────────────────

export interface ScenarioStep {
  /** Protocol tool ID (e.g. "khalani.bridge") */
  toolId: string;
  /** Handler params */
  params: Record<string, unknown>;
  /** Expected outcomes for DB assertions */
  expect: {
    success: boolean;
    captureType?: string;
    positionKey?: string;
    instrumentKey?: string;
    productType?: string;
    tradeSide?: string;
    fanOut?: number;
  };
}

export interface Scenario {
  name: string;
  namespace: string;
  description: string;
  steps: ScenarioStep[];
}

export interface StepResult {
  step: ScenarioStep;
  result: ToolResult;
  durationMs: number;
}

// ── Context factory ────────────────────────────────────────────

export function makeContext(sessionId: string): InternalToolContext {
  return {
    sessionId,
    loadedDocuments: new Map(),
    loopMode: "full",
    approved: true,
    role: "parent",
    missionRunId: null,
  };
}

// ── Lifecycle ──────────────────────────────────────────────────

export async function setup(): Promise<void> {
  logger.info("e2e.setup.migrations");
  await runMigrations();
  logger.info("e2e.setup.ready");
}

export async function teardown(): Promise<void> {
  await closePool();
  logger.info("e2e.teardown.complete");
}

// ── Step execution ─────────────────────────────────────────────

export async function runStep(
  step: ScenarioStep,
  sessionId: string,
): Promise<StepResult> {
  const context = makeContext(sessionId);
  const start = Date.now();

  const result = await dispatchTool(
    {
      name: "execute_tool",
      args: { toolId: step.toolId, params: step.params },
      toolCallId: `e2e-${step.toolId}-${Date.now()}`,
    },
    context,
  );

  const durationMs = Date.now() - start;

  logger.info("e2e.step.completed", {
    toolId: step.toolId,
    success: result.success,
    expected: step.expect.success,
    durationMs,
  });

  return { step, result, durationMs };
}

// ── Scenario execution ─────────────────────────────────────────

export async function runScenario(scenario: Scenario): Promise<StepResult[]> {
  const sessionId = `e2e-${scenario.name}-${Date.now()}`;
  const results: StepResult[] = [];

  logger.info("e2e.scenario.start", { name: scenario.name, steps: scenario.steps.length });

  for (const step of scenario.steps) {
    const stepResult = await runStep(step, sessionId);
    results.push(stepResult);

    if (stepResult.result.success !== step.expect.success) {
      logger.error("e2e.scenario.step_mismatch", {
        toolId: step.toolId,
        expected: step.expect.success,
        actual: stepResult.result.success,
        output: stepResult.result.output.slice(0, 200),
      });
    }
  }

  logger.info("e2e.scenario.complete", { name: scenario.name, steps: results.length });
  return results;
}
