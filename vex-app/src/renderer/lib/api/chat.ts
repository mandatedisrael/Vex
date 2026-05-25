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
import { isUsageQueryForSession } from "./queryKeys.js";
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
      // A completed turn advances usage rows + the session token_count, so
      // refresh the runtime bar immediately (usage totals, last-turn, and
      // context window). The transcript-append live-sync is the backstop
      // for non-interactive turns (mission/wake).
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isUsageQueryForSession(query.queryKey, variables.sessionId),
      });
    },
  });
}
