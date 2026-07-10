import { CH } from "../../shared/ipc/channels.js";
import {
  secretsLockInputSchema,
  secretsUnlockInputSchema,
  resetToFreshVaultInputSchema,
} from "../../shared/schemas/secrets.js";
import type { SecretsUnlockInput } from "../../shared/schemas/secrets.js";
import type { SecretsBridge } from "../../shared/types/bridge/shell/secrets.js";
import { invokeWithSchema } from "../_dispatch.js";

export const secrets = {
  status() {
    return invokeWithSchema(CH.secrets.status, {});
  },
  unlock(input: SecretsUnlockInput) {
    return invokeWithSchema(CH.secrets.unlock, input, secretsUnlockInputSchema);
  },
  lock() {
    return invokeWithSchema(CH.secrets.lock, {}, secretsLockInputSchema);
  },
  resetToFreshVault(input) {
    return invokeWithSchema(
      CH.secrets.resetToFreshVault,
      input,
      resetToFreshVaultInputSchema,
    );
  },
} satisfies SecretsBridge;
