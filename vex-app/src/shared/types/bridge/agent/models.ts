import type { Result } from "../../../ipc/result.js";
import type {
  ModelsListAvailableInput,
  ModelsListAvailableResult,
} from "../../../schemas/models.js";

/**
 * Global model catalogue. Returns the configured global default from env
 * (single option or empty). A future OpenRouter `/models` fetch could
 * enrich the option metadata (pricing, context length).
 */
export interface ModelsBridge {
  readonly listAvailable: (
    input: ModelsListAvailableInput
  ) => Promise<Result<ModelsListAvailableResult>>;
}
