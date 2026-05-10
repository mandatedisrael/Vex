/**
 * Typed Bus singletons for Docker install + compose log streams.
 * Backed by the generic `Bus<T>` primitive in `../events/event-bus.ts`
 * — the named instances live here so consumers grep by domain
 * (`dockerProgressBus`, `composeLogBus`) instead of an anonymous
 * `new Bus<...>()` call site.
 */

import type { ComposeLog, InstallProgress } from "@shared/schemas/docker.js";
import { Bus } from "../events/event-bus.js";

export const dockerProgressBus = new Bus<InstallProgress>();
export const composeLogBus = new Bus<ComposeLog>();
