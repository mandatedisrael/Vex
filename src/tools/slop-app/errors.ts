/**
 * Slop App error mapping — HTTP status → typed EchoError.
 */

import { EchoError, ErrorCodes } from "../../errors.js";

export function mapSlopAppError(status: number, message: string): EchoError {
  if (status === 400) {
    return new EchoError(ErrorCodes.AGENT_QUERY_INVALID, message);
  }
  if (status === 401) {
    return new EchoError(ErrorCodes.SLOP_AUTH_FAILED, message);
  }
  if (status === 403) {
    return new EchoError(
      ErrorCodes.PROFILE_NOT_FOUND,
      message || "Profile required",
      "Register profile first: echoclaw slop-app profile register --username <name> --yes --json",
    );
  }
  if (status === 429) {
    const error = new EchoError(ErrorCodes.AGENT_QUERY_FAILED, "Rate limited, try again later");
    error.retryable = true;
    return error;
  }
  if (status === 504) {
    return new EchoError(ErrorCodes.AGENT_QUERY_TIMEOUT, "Query too complex, simplify filters");
  }
  return new EchoError(ErrorCodes.AGENT_QUERY_FAILED, message || `Slop App API error (HTTP ${status})`);
}

export function mapSlopAppTransportError(err: unknown): never {
  if (err instanceof EchoError) throw err;
  throw new EchoError(
    ErrorCodes.HTTP_REQUEST_FAILED,
    `Slop App request failed: ${err instanceof Error ? err.message : String(err)}`,
  );
}
