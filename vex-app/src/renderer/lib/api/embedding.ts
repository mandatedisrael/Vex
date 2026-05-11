/**
 * Embedding configuration API (M9 Step 4).
 *
 * No secrets in payload (URL / model id / dim integer / provider
 * tag) — useMutation is safe and gives us pending state for free.
 * On success, invalidate envState so the skip-card refreshes.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  EmbeddingConfigureInput,
  EmbeddingConfigureResult,
} from "@shared/schemas/embedding.js";
import { onboardingKeys } from "./queryKeys.js";

export function useEmbeddingConfigure(): UseMutationResult<
  Result<EmbeddingConfigureResult>,
  Error,
  EmbeddingConfigureInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmbeddingConfigureInput) =>
      window.vex.onboarding.embeddingConfigure(input),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
      }
    },
  });
}
