/**
 * Agent core configuration API (M9 Step 5).
 *
 * No secrets in payload — useMutation is safe. Tri-state per field
 * (number / null / absent) handled by the schema; the renderer just
 * shapes the input before submitting.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  AgentCoreConfigureInput,
  AgentCoreConfigureResult,
} from "@shared/schemas/agent-core.js";
import { onboardingKeys } from "./queryKeys.js";

export function useAgentCoreConfigure(): UseMutationResult<
  Result<AgentCoreConfigureResult>,
  Error,
  AgentCoreConfigureInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentCoreConfigureInput) =>
      window.vex.onboarding.agentCoreConfigure(input),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
      }
    },
  });
}
