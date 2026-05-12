import { Map, Set } from "immutable";

import { Selector } from "./selector.js";
import type { ParsedStyle } from "./styles.js";

export namespace Styles {
    export type StyleMap = Map<string, { styles: Styles; subselectors: StyleMap; specificity: number }>;
    export type Style = Record<string, string>;

    export interface LocalStyleData {
        styleMap: StyleMap;
        style: Style;
    }
}

export class Styles {
    public static assign(a: Styles.StyleMap, b: Styles.StyleMap): Styles.StyleMap {
        return b.reduce((map, { styles, subselectors, specificity }, selector) => {
            return map.update(
                selector,
                { styles: {}, subselectors: Map(), specificity: 0 },
                ({ styles: oldStyles, subselectors: oldSubselectors, specificity: oldSpecificity }) => ({
                    styles: Object.assign({}, oldStyles, styles),
                    subselectors: Styles.assign(oldSubselectors, subselectors),
                    specificity: Math.max(oldSpecificity, specificity),
                }),
            );
        }, a);
    }

    public static inheritedStyles = Set(["fontSize", "fontFamily", "color", "textAlign", "backgroundColor"]);
}

export const mergeStyles = (currentStyles: Styles.StyleMap, newDeclarations: ParsedStyle[]) => {
    const insertSelector = (map: Styles.StyleMap, selectorTree: Selector[], newStyles: Styles) => {
        const recInsert = (map: Styles.StyleMap, selectors: Selector[], newStyles: Styles): Styles.StyleMap =>
            selectors.length === 0
                ? map
                : map.update(
                      Selector.serialize(selectors[0]),
                      { subselectors: Map(), styles: {}, specificity: 0 },
                      ({ subselectors, styles }) =>
                          selectors.length === 1
                              ? {
                                    subselectors,
                                    styles: Object.assign({}, styles, newStyles),
                                    specificity: Selector.specificity(selectors[0]),
                                }
                              : {
                                    subselectors: recInsert(subselectors, selectors.slice(1), newStyles),
                                    styles,
                                    specificity: Selector.specificity(selectors[0]),
                                },
                  );

        return recInsert(map, selectorTree, newStyles);
    };

    return newDeclarations.reduce<Styles.StyleMap>((result, node) => {
        return insertSelector(result, node.selectorTree, node.styles);
    }, currentStyles);
};

export const loadStyles = (declarations: ParsedStyle[]): Styles.StyleMap => {
    return mergeStyles(Map(), declarations);
};

export interface PropagateStyleOptions {
    overrides?: Styles.Style;
    defaults?: Styles.Style;
}

export const propagateStyles = (
    parentData: Styles.LocalStyleData,
    selector: Selector,
    context: Selector.Context,
    options: PropagateStyleOptions,
): Styles.LocalStyleData => {
    const inheritedStyles = Object.keys(parentData.style ?? {})
        .filter((key) => Styles.inheritedStyles.contains(key))
        .reduce((styles, key) => {
            styles[key] = parentData.style![key as keyof Styles] as any;
            return styles;
        }, {} as Styles.Style);

    const relevant = parentData.styleMap
        .filter((_, selectorString) => Selector.matches(selector, Selector.parse(selectorString), context))
        .sort(({ specificity: sA }, { specificity: sB }) => sA - sB)
        .reduce(
            ([map, styles], value, _key) =>
                [Styles.assign(map, value.subselectors), Object.assign({}, styles, value.styles)] as [
                    Styles.StyleMap,
                    Styles,
                ],
            [Map(), {}] as [Styles.StyleMap, Styles],
        );

    const resultStyles: Styles.Style = Object.assign(
        {},
        options.defaults ?? {},
        inheritedStyles,
        relevant[1],
        options.overrides ?? {},
    );

    const subStyles = Styles.assign(parentData.styleMap, relevant[0]);

    return { style: resultStyles, styleMap: subStyles };
};
