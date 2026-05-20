import { MeasureMode } from "yoga-layout";

import { Styles } from "../../styles/styles-runtime.js";
import { RleMatrix } from "../rle-buffer.js";
import { Point } from "../utils.js";
import { Drawable, YogaBase } from "./drawable.js";
import type { TerminalContent, TerminalNode } from "./terminal-content.js";
import type { TerminalText } from "./terminal-text.js";

/**
 * Break `text` into wrapped lines no wider than `width`. With `width === null`
 * the text is only split on explicit newlines (its natural, unwrapped size).
 */
export const wrapWords = (text: string, width: number | null): string[] => {
    if (text.length === 0) {
        return [];
    }

    if (width === null) {
        return text.split(/\n/g);
    }

    const lines: string[] = [];

    for (const baseLine of text.split(/\n+/g)) {
        let line = "";

        for (const token of baseLine.split(/(\s+)/)) {
            if (token.length === 0) {
                continue;
            }

            if (line.length + token.length <= width) {
                line += token;
                continue;
            }

            if (line.length > 0) {
                lines.push(line);
                line = "";
            }

            if (/^\s+$/.test(token)) {
                continue;
            }

            if (token.length > width) {
                let rest = token;
                while (rest.length > width) {
                    lines.push(rest.slice(0, width));
                    rest = rest.slice(width);
                }

                line = rest;
            } else {
                line = token;
            }
        }

        if (line.length > 0) {
            lines.push(line);
        }
    }

    return lines;
};

/**
 * A run of adjacent inline content collapsed into a single layout box.
 *
 * The DOM keeps every `TerminalText` as a separate node, but text flow does
 * not respect node boundaries — `Hello {name}` must wrap as one stream, not as
 * two independently-wrapped fragments. `InlineRun` is the fix: the parent
 * `TerminalContent` groups maximal sequences of adjacent text nodes into one
 * run, and the run concatenates their content, measures it as a whole, and
 * paints the wrapped result. There is exactly one Yoga node per run rather
 * than one per text node.
 */
export class InlineRun extends YogaBase implements Drawable {
    public kind = "inline-run" as const;

    /** The text nodes this run collapses, in document order. */
    public readonly nodes: readonly TerminalText[];
    public parent: TerminalContent;

    #parentStyles: Styles.LocalStyleData | null = null;
    #renderDirty: boolean = true;
    #layoutDirty: boolean = true;
    #cachedMatrix: RleMatrix | null = null;

    public constructor(parent: TerminalContent, nodes: TerminalText[]) {
        super();

        this.parent = parent;
        this.nodes = nodes;

        for (const node of nodes) {
            node.owner = this;
        }

        this.measureFunc = (width, widthMode) => {
            const text = this.#collapsedText;

            if (text.length === 0) {
                return { width: 0, height: 0 };
            }

            if (widthMode === MeasureMode.Undefined) {
                const lines = wrapWords(text, null);
                const maxWidth = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
                return { width: maxWidth, height: Math.max(1, lines.length) };
            }

            const wrapWidth = Math.max(1, Math.floor(width));
            const lines = wrapWords(text, wrapWidth);
            const maxWidth = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
            return { width: maxWidth, height: Math.max(1, lines.length) };
        };
    }

    /** The concatenated text of every member node — the unit that gets wrapped. */
    get #collapsedText(): string {
        let result = "";
        for (const node of this.nodes) {
            result += node.textContent ?? "";
        }
        return result;
    }

    /**
     * Called by a member `TerminalText` when its content changes. Forces a
     * re-measure and repaint of the whole run.
     */
    public invalidate(): void {
        this.#renderDirty = true;
        this.#layoutDirty = true;
        this.parent.markRenderDirty();
    }

    public pushStyles(styles: Styles.LocalStyleData): void {
        if (this.#parentStyles !== styles) {
            this.#parentStyles = styles;
            this.#renderDirty = true;
            this.#layoutDirty = true;
        }
    }

    public layout(_options?: { force?: boolean }): void {
        if (this.#layoutDirty) {
            this.allocateYoga().markDirty();
            this.#layoutDirty = false;
        }

        this.recomputeLayout();
    }

    public render(): RleMatrix {
        const bounds = this.computedPosition.position;

        const sizeMatches =
            this.#cachedMatrix !== null &&
            this.#cachedMatrix.width === bounds.width &&
            this.#cachedMatrix.height === bounds.height;

        if (sizeMatches && !this.#renderDirty) {
            return this.#cachedMatrix!;
        }

        const color = this.#parentStyles?.style?.color;
        const bgColor = this.#parentStyles?.style?.backgroundColor;
        const matrix = new RleMatrix(bounds.width, bounds.height, undefined, { bgColor });
        const text = this.#collapsedText;

        if (text.length > 0) {
            const computedWidth = Math.max(1, Math.floor(bounds.width));
            const lines = wrapWords(text, computedWidth);

            for (let i = 0; i < lines.length; i++) {
                matrix.setAscii({ x: 0, y: i }, lines[i], { color, bgColor });
            }
        }

        this.#cachedMatrix = matrix;
        this.#renderDirty = false;
        return matrix;
    }

    public probe(_position: Point): TerminalNode[] {
        return [];
    }

    public dispatchEvent(_eventName: string): { handled: boolean } {
        return { handled: false };
    }
}
