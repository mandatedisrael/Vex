import { TwitterAccountParamsSchema } from "@tools/twitter-account/schema.js";
import {
  executeTwitterAccountRequest,
  sanitizeTwitterAccountError,
} from "@tools/twitter-account/client.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { fail, ok } from "./types.js";

export async function handleTwitterAccount(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = TwitterAccountParamsSchema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`twitter_account: ${issue?.message ?? "invalid arguments"}`);
  }

  try {
    return ok(await executeTwitterAccountRequest(parsed.data));
  } catch (error) {
    return fail(`twitter_account: ${sanitizeTwitterAccountError(error)}`);
  }
}
