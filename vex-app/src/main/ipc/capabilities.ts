/**
 * vex.capabilities.get() — feature flags + phase tracking.
 *
 * Phase 1 surface only. Phase 2 features all `false` until those milestones land.
 */

import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  capabilitiesSchema,
  type Capabilities,
} from "@shared/schemas/capabilities.js";
import { registerHandler } from "./register-handler.js";

const inputSchema = z.object({}).strict();

async function isOnboardingComplete(): Promise<boolean> {
  try {
    const flagPath = path.join(app.getPath("userData"), ".setup-complete");
    await fs.access(flagPath);
    return true;
  } catch {
    return false;
  }
}

export function registerCapabilitiesHandler(): () => void {
  return registerHandler({
    channel: CH.capabilities.get,
    domain: "capabilities",
    inputSchema,
    outputSchema: capabilitiesSchema,
    handle: async (): Promise<Result<Capabilities>> => {
      const onboardingComplete = await isOnboardingComplete();
      const caps: Capabilities = capabilitiesSchema.parse({
        phase: "phase1",
        appVersion: app.getVersion(),
        onboardingComplete,
        features: {
          splash: true,
          systemCheck: true,
          dockerBootstrap: false, // M4
          wizard: false, // M7+
          wallets: false, // M8
          chat: false,
          missions: false,
          portfolio: false,
          memory: false,
          tools: false,
          documents: false,
        },
      });
      return ok(caps);
    },
  });
}
