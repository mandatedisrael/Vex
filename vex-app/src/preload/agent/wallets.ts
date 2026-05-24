import { CH } from "../../shared/ipc/channels.js";
import {
  walletsCancelPreparedIntentInputSchema,
  walletsGetPreparedIntentInputSchema,
  walletsListAvailableInputSchema,
  walletsListSessionInputSchema,
  walletsSetScopeInputSchema,
} from "../../shared/schemas/wallets.js";
import type {
  WalletsCancelPreparedIntentInput,
  WalletsGetPreparedIntentInput,
  WalletsListAvailableInput,
  WalletsListSessionInput,
  WalletsSetScopeInput,
} from "../../shared/schemas/wallets.js";
import type { WalletsBridge } from "../../shared/types/bridge/agent/wallets.js";
import { invokeWithSchema } from "../_dispatch.js";

export const wallets = {
  listAvailable(input: WalletsListAvailableInput) {
    return invokeWithSchema(
      CH.wallets.listAvailable,
      input,
      walletsListAvailableInputSchema
    );
  },
  listSessionWallets(input: WalletsListSessionInput) {
    return invokeWithSchema(
      CH.wallets.listSessionWallets,
      input,
      walletsListSessionInputSchema
    );
  },
  setSessionWalletScope(input: WalletsSetScopeInput) {
    return invokeWithSchema(
      CH.wallets.setSessionWalletScope,
      input,
      walletsSetScopeInputSchema
    );
  },
  getPreparedIntent(input: WalletsGetPreparedIntentInput) {
    return invokeWithSchema(
      CH.wallets.getPreparedIntent,
      input,
      walletsGetPreparedIntentInputSchema
    );
  },
  cancelPreparedIntent(input: WalletsCancelPreparedIntentInput) {
    return invokeWithSchema(
      CH.wallets.cancelPreparedIntent,
      input,
      walletsCancelPreparedIntentInputSchema
    );
  },
} satisfies WalletsBridge;
