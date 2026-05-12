import { register } from "node:module";
import nodePath from "node:path";

const rootDir = `file:${nodePath.join(new URL(import.meta.url).pathname, "..")}`;

register("./styles/hooks.js", rootDir);

export const VERSION = 1;
