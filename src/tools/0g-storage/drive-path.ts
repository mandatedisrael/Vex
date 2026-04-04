/**
 * Drive path normalization and validation.
 */

import { EchoError, ErrorCodes } from "../../errors.js";

const MAX_PATH_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 255;
const VALID_CHARS = /^[a-zA-Z0-9\-_./]+$/;
const DOT_SEGMENT = /(?:^|\/)\.\.(\/|$)|(?:^|\/)\.(\/|$)/;

export function normalizePath(input: string): string {
  let p = input.trim();
  if (!p.startsWith("/")) p = "/" + p;
  // Collapse double slashes
  p = p.replace(/\/\/+/g, "/");
  return p;
}

export function validatePath(input: string): void {
  if (input.length > MAX_PATH_LENGTH) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      `Path too long (${input.length} > ${MAX_PATH_LENGTH}).`,
      "Shorten the path to 512 characters or less."
    );
  }

  if (DOT_SEGMENT.test(input)) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      `Path contains '.' or '..' segments: ${input}`,
      "Use absolute virtual paths without relative segments."
    );
  }

  if (!VALID_CHARS.test(input)) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      `Path contains invalid characters: ${input}`,
      "Allowed: a-z A-Z 0-9 - _ . /"
    );
  }

  const segments = input.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg.length > MAX_SEGMENT_LENGTH) {
      throw new EchoError(
        ErrorCodes.ZG_STORAGE_INVALID_PATH,
        `Segment too long: '${seg.slice(0, 50)}...' (${seg.length} > ${MAX_SEGMENT_LENGTH}).`,
        "Each path segment must be 255 characters or less."
      );
    }
  }
}

export function ensurePath(input: string): string {
  const p = normalizePath(input);
  validatePath(p);
  return p;
}
