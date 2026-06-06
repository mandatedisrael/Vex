/**
 * Tool registry OpenAI projection — `getOpenAITools`.
 *
 * Thin wrapper over `getVisibleToolDefs` + the OpenAI projection — keeps the
 * filter chain in one place. Imports `toOpenAITools` from the canonical
 * `../types.js`; never imports the `registry.js` façade (cycle).
 */

import type { OpenAITool } from "../types.js";
import { toOpenAITools } from "../types.js";

import { getVisibleToolDefs, type ToolVisibilityContext } from "./visibility.js";

/**
 * Get tools as OpenAI format, filtered for the given session context.
 *
 * Thin wrapper over `getVisibleToolDefs` + the OpenAI projection — keeps
 * the filter chain in one place.
 */
export function getOpenAITools(ctx: ToolVisibilityContext): OpenAITool[] {
  return toOpenAITools(getVisibleToolDefs(ctx));
}
