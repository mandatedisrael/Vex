import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "@shared/schemas/chat.js";
import { sessionKeys } from "./sessions.js";

export function useSubmitChat(): UseMutationResult<
  Result<ChatSubmitResult>,
  Error,
  ChatSubmitInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChatSubmitInput) => window.vex.chat.submit(input),
    onSuccess: (result, variables) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.detail(variables.sessionId),
      });
    },
  });
}
