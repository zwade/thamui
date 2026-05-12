import css from "css";
import type { LoadHook, ResolveHook } from "node:module";
import * as sass from "sass";

import { parseStyle } from "./styles.js";

const parseStyles = (cssData: string) => {
    const parsed = css.parse(cssData);
    if (!parsed.stylesheet) {
        throw new Error("Invalid CSS data");
    }

    const digestedStyles = parseStyle(parsed);

    const result = `export const styles = JSON.stringify(${JSON.stringify(digestedStyles, null, 2)});\nexport default styles;`;

    return result;
};

export const load: LoadHook = (url, context, nextLoad) => {
    const path = new URL(url).pathname;
    if (!path.endsWith(".scss") && !path.endsWith(".sass") && !path.endsWith(".css")) {
        return nextLoad(url, context);
    }

    const compiled = sass.compile(path, {});
    const cssData = parseStyles(compiled.css);

    return {
        format: "module",
        shortCircuit: true,
        source: cssData,
    };
};

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
    if (specifier.endsWith(".scss") || specifier.endsWith(".sass") || specifier.endsWith(".css")) {
        const resolved = new URL(specifier, context.parentURL).href;
        return { url: resolved, shortCircuit: true, format: "module" };
    }

    return nextResolve(specifier, context);
};
