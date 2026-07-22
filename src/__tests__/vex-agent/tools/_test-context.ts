import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";

export function makeTestContext(overrides?: Partial<InternalToolContext>): InternalToolContext {
  return {
    sessionId: "test-session",
    loadedDocuments: new Map<string, string>(),
    sessionPermission: "restricted",
    approved: false,
    missionRunId: null,
    missionId: null,
    sessionKind: "agent",
    contextUsageBand: "normal",
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    ...overrides,
  };
}
