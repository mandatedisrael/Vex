/**
 * User profile ("Vex setup") query + mutation — DB-backed personalization
 * (soul singleton), replacing the retired local `persona.md` file.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { UserProfile } from "@shared/schemas/user-profile.js";

const USER_PROFILE_QUERY_KEY = ["userProfile"] as const;

export function useUserProfile(): UseQueryResult<Result<UserProfile>> {
  return useQuery({
    queryKey: USER_PROFILE_QUERY_KEY,
    queryFn: () => window.vex.settings.getUserProfile(),
  });
}

export function useSetUserProfile(): UseMutationResult<
  Result<UserProfile>,
  Error,
  UserProfile
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: UserProfile) => window.vex.settings.setUserProfile(profile),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_PROFILE_QUERY_KEY });
    },
  });
}
