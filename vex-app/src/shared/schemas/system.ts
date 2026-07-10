/**
 * Schemas for vex.system.* IPC payloads.
 */

import { z } from "zod";

export const osPlatformSchema = z.enum(["darwin", "win32", "linux"]);
export type OsPlatform = z.infer<typeof osPlatformSchema>;

export const osInfoSchema = z
  .object({
    platform: osPlatformSchema,
    arch: z.enum(["x64", "arm64"]),
    release: z.string(),
    distro: z.string().nullable(),
    homedir: z.string(),
    userDataDir: z.string(),
    appVersion: z.string(),
    electronVersion: z.string(),
    nodeVersion: z.string(),
  })
  .strict();
export type OsInfo = z.infer<typeof osInfoSchema>;

export const networkProbeSchema = z
  .object({
    online: z.boolean(),
    latencyMs: z.number().int().nullable(),
    probedAt: z.string().datetime(),
  })
  .strict();
export type NetworkProbe = z.infer<typeof networkProbeSchema>;

export const healthReportSchema = z
  .object({
    os: osInfoSchema,
    network: networkProbeSchema,
    translocated: z.boolean(),
    setupComplete: z.boolean(),
    /** Computed at probe time, for splash status display. */
    overall: z.enum(["ok", "degraded", "not_ready"]),
  })
  .strict();
export type HealthReport = z.infer<typeof healthReportSchema>;
