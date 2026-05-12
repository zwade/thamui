import { Comment, Declaration, Rule, Stylesheet } from "css";

import { Selector } from "./selector.js";

export type ParsedStyle = {
    selectorTree: Selector[];
    styles: Record<string, string>;
};

export const parseStyle = (stylesheet: Stylesheet): ParsedStyle[] => {
    const parseStyles = (declarations: (Declaration | Comment)[]) => {
        const resultStyle: Record<string, string> = Object.create(null);

        for (const decl of declarations) {
            if (decl.type === "declaration") {
                if (decl.property !== undefined && decl.value !== undefined) {
                    const mappedProperty = decl.property.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

                    resultStyle[mappedProperty as any] = decl.value;
                }
            }
        }

        return resultStyle;
    };

    return (stylesheet.stylesheet?.rules ?? [])
        .filter((node) => node.type === "rule")
        .flatMap((node) =>
            (node.selectors ?? []).map((selector) => {
                return {
                    selectorTree: selector.split(/\s+/g).map(Selector.parse),
                    styles: parseStyles((node as Rule).declarations ?? []),
                };
            }),
        );
};
