import { TwitterAccountParamsSchema } from "@tools/twitter-account/schema.js";
import {
  executeTwitterAccountRequest,
  sanitizeTwitterAccountError,
} from "@tools/twitter-account/client.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { enumField, fail, ok } from "./types.js";
import { projectTwitterResult } from "./twitter-projection.js";

const RESPONSE_FORMATS = ["concise", "detailed"] as const;
type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

export async function handleTwitterAccount(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  // Read response_format off RAW params: the Zod discriminated-union strips
  // unknown keys, so it would not survive into parsed.data. concise is default.
  const responseFormat: ResponseFormat =
    enumField<ResponseFormat>(params, "response_format", RESPONSE_FORMATS) ?? "concise";

  const parsed = TwitterAccountParamsSchema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`twitter_account: ${formatValidationIssue(issue)}`);
  }

  try {
    const result = await executeTwitterAccountRequest(parsed.data);
    return ok(
      responseFormat === "detailed"
        ? result
        : projectTwitterResult(result, responseFormat),
    );
  } catch (error) {
    return fail(`twitter_account: ${sanitizeTwitterAccountError(error)}`);
  }
}

function formatValidationIssue(
  issue: { path: PropertyKey[]; message: string } | undefined,
): string {
  if (!issue) return "invalid arguments";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
