import { z } from "zod";
import { CH, EV } from "../../shared/ipc/channels.js";
import {
  composeLogSchema,
  installMethodSchema,
  installProgressSchema,
} from "../../shared/schemas/docker.js";
import type { InstallMethod } from "../../shared/schemas/docker.js";
import type { DockerBridge } from "../../shared/types/bridge/shell/docker.js";
import { abortableInvoke, invokeWithSchema, subscribe } from "../_dispatch.js";

const composeUpInputSchema = z
  .object({ pgPort: z.number().int().min(1).max(65535).optional() })
  .strict();
const emptyInputSchema = z.object({}).strict();

export const docker = {
  detect() {
    return invokeWithSchema(CH.docker.detect, {});
  },
  install(input: { method: InstallMethod }) {
    return invokeWithSchema(
      CH.docker.install,
      input,
      z.object({ method: installMethodSchema }).strict()
    );
  },
  start() {
    return invokeWithSchema(CH.docker.start, {});
  },
  composeUp(input: { pgPort?: number } = {}) {
    return invokeWithSchema(CH.docker.composeUp, input, composeUpInputSchema);
  },
  composeUpAbortable(input: { pgPort?: number } = {}) {
    // Same channel + same schema as composeUp; the difference is the
    // renderer gets a `cancel()` handle back. The main-side handler
    // is unchanged — `registerHandler` always creates an
    // AbortController + plumbs ctx.signal regardless of whether the
    // renderer ends up using it.
    return abortableInvoke(CH.docker.composeUp, input, composeUpInputSchema);
  },
  composeDown() {
    return invokeWithSchema(CH.docker.composeDown, {});
  },
  stopPreviousInstallStacks() {
    return invokeWithSchema(
      CH.docker.stopPreviousInstallStacks,
      {},
      emptyInputSchema,
    );
  },
  onInstallProgress(cb) {
    return subscribe(EV.docker.installProgress, installProgressSchema, cb);
  },
  onComposeLog(cb) {
    return subscribe(EV.docker.composeLogs, composeLogSchema, cb);
  },
} satisfies DockerBridge;
