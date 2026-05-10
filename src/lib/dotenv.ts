/**
 * Cross-boundary re-export so vex-app (Electron main) can pull the
 * canonical dotenv helpers via `@vex-lib/dotenv.js` without reaching
 * outside the alias scope.
 *
 * The implementation lives in `/mnt/x/Vex/src/utils/dotenv.ts` and
 * stays the single source of truth for the `${CONFIG_DIR}/.env`
 * format that both vex-shell and vex-app read/write.
 */

export {
  appendToDotenvFile,
  loadDotenvFileIntoProcess,
  readDotenvFileValue,
} from "../utils/dotenv.js";
