import { CH } from "../../shared/ipc/channels.js";
import { createBugReportInputSchema } from "../../shared/schemas/bug-reports.js";
import type { SupportBridge } from "../../shared/types/bridge/shell/support.js";
import { invokeWithSchema } from "../_dispatch.js";

export const support = {
  createBugReport(input) {
    return invokeWithSchema(
      CH.support.createBugReport,
      input,
      createBugReportInputSchema
    );
  },
  openLogsFolder() {
    return invokeWithSchema(CH.support.openLogsFolder, {});
  },
} satisfies SupportBridge;
