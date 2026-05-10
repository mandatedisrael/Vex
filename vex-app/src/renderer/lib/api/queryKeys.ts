/**
 * TanStack Query key factories per skill §5. Centralised so M2-M5 view
 * code never assembles raw key arrays inline (and so invalidation
 * targets — `queryClient.invalidateQueries({ queryKey: dockerKeys.all })`
 * — touch every consumer atomically).
 */

export const systemKeys = {
  all: ["system"] as const,
  health: () => ["system", "health"] as const,
  osInfo: () => ["system", "osInfo"] as const,
  network: () => ["system", "network"] as const,
};

export const dockerKeys = {
  all: ["docker"] as const,
  status: () => ["docker", "status"] as const,
};

export const onboardingKeys = {
  all: ["onboarding"] as const,
  envState: () => ["onboarding", "envState"] as const,
  wizardState: () => ["onboarding", "wizardState"] as const,
};
