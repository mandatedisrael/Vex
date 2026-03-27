#!/usr/bin/env node

import "./suppress-warnings.js";
import { handleError, runCli } from "./cli-runtime.js";

runCli().catch(handleError);
