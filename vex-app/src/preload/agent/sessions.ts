import { CH } from "../../shared/ipc/channels.js";
import {
  sessionCreateInputSchema,
  sessionDeleteInputSchema,
  sessionGetInputSchema,
  sessionGetModelInputSchema,
  sessionSetPinnedInputSchema,
} from "../../shared/schemas/sessions.js";
import type {
  SessionCreateInput,
  SessionDeleteInput,
  SessionGetInput,
  SessionGetModelInput,
  SessionSetPinnedInput,
} from "../../shared/schemas/sessions.js";
import type { SessionsBridge } from "../../shared/types/bridge/agent/sessions.js";
import { invokeWithSchema } from "../_dispatch.js";

export const sessions = {
  create(input: SessionCreateInput) {
    return invokeWithSchema(CH.sessions.create, input, sessionCreateInputSchema);
  },
  list() {
    return invokeWithSchema(CH.sessions.list, {});
  },
  get(input: SessionGetInput) {
    return invokeWithSchema(CH.sessions.get, input, sessionGetInputSchema);
  },
  setPinned(input: SessionSetPinnedInput) {
    return invokeWithSchema(
      CH.sessions.setPinned,
      input,
      sessionSetPinnedInputSchema
    );
  },
  delete(input: SessionDeleteInput) {
    return invokeWithSchema(
      CH.sessions.delete,
      input,
      sessionDeleteInputSchema
    );
  },
  getModel(input: SessionGetModelInput) {
    return invokeWithSchema(
      CH.sessions.getModel,
      input,
      sessionGetModelInputSchema
    );
  },
} satisfies SessionsBridge;
