// Taken almost wholesale from https://github.com/zwade/manus-dei/blob/master/client/src/components/ui/styles.tsx
// LICENSE: MIT

export type Selector = {
    className?: string[];
    id?: string;
    tagName?: string;
    pseudoSelector?: string[];
};

export namespace Selector {
    export type State = "hover" | "active" | "focus";

    export interface ParentContext {
        index?: number;
        outOf?: number;
    }

    export interface Context extends ParentContext {
        states?: State[];
        hasChildren?: boolean;
    }

    export const parse = (selector: string): Selector => {
        if (selector === "*") {
            return {};
        }

        const selectorRegex = /([a-zA-Z0-9-_]+)|(\.[a-zA-Z0-9-_]+)|(#[a-zA-Z0-9-_]+)|(:[^:\s]+)/g;
        const result = [...selector.matchAll(selectorRegex)]
            .map(([match]) => match)
            .reduce((sel, match) => {
                if (match[0] === ".") {
                    sel.className = (sel.className ?? []).concat(match.slice(1));
                } else if (match[0] === "#") {
                    sel.id = match.slice(1);
                } else if (match[0] === ":") {
                    sel.pseudoSelector = (sel.pseudoSelector ?? []).concat(match.slice(1));
                } else {
                    sel.tagName = match;
                }
                return sel;
            }, {} as Selector);
        return result;
    };

    export const serialize = (selector: Selector): string => {
        if (selector.id === undefined && selector.className === undefined && selector.tagName === undefined) {
            return "*";
        }

        const tag = selector.tagName ?? "";
        const classNames = (selector.className ?? [])
            .sort((a, b) => a.localeCompare(b))
            .map((a) => "." + a)
            .join("");
        const id = selector.id === undefined ? "" : "#" + selector.id;
        const selectors = (selector.pseudoSelector ?? [])
            .sort((a, b) => a.localeCompare(b))
            .map((a) => ":" + a)
            .join("");
        return `${tag}${classNames}${id}${selectors}`;
    };

    const matchPositionalPseudoSelector = (psuedoSelector: string, a: Selector, aContext: Context): boolean => {
        const index = aContext.index;
        const outOf = aContext.outOf;

        if (index === undefined || outOf === undefined) {
            return false;
        }

        switch (psuedoSelector) {
            case "first-child": {
                return index === 0;
            }
            case "last-child": {
                return index === outOf - 1;
            }
        }

        if (psuedoSelector.startsWith("nth-child")) {
            const match = /^nth-child\((?:(\d+)|(?:(\d+)n(?:\+(\d+))?)?)\)$/.exec(psuedoSelector);
            if (!match) {
                return false;
            }

            const [_, n, nth, offset] = match;
            if (n !== undefined) {
                return parseInt(n) === index + 1;
            }

            const offsetValue = offset === undefined ? 0 : parseInt(offset);
            const nthValue = nth === undefined ? 1 : parseInt(nth);

            return (index + 1 - offsetValue) % nthValue === 0;
        }

        return false;
    };

    export const matches = (a: Selector, b: Selector, aContext: Context): boolean => {
        const baseMatches =
            (b.tagName === undefined || a.tagName === b.tagName) &&
            (b.className === undefined || b.className.every((cls) => a.className?.includes(cls) ?? false)) &&
            (b.id === undefined || a.id === b.id);

        if (!baseMatches || b.pseudoSelector === undefined) {
            return baseMatches;
        }

        for (const selector of b.pseudoSelector) {
            if (a.pseudoSelector?.includes(selector)) {
                continue;
            }

            if (aContext.states?.includes(selector as State)) {
                continue;
            }

            if (matchPositionalPseudoSelector(selector, a, aContext)) {
                continue;
            }

            return false;
        }

        return true;
    };

    export const specificity = (s: Selector) =>
        // TODO(zwade): Make this less hacky
        10000 * (s.id === undefined ? 0 : 1) +
        100 * ((s.className?.length ?? 0) + (s.pseudoSelector?.length ?? 0)) +
        1 * (s.tagName === undefined ? 0 : 1);
}
