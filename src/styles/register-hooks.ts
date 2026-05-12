import { registerHooks } from "node:module";

import { load, resolve } from "./hooks.js";

registerHooks({ load, resolve });

export const VERSION = 1;
