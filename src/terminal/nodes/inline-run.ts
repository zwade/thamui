import { MeasureMode } from "yoga-layout";

import { getAnsiStyles } from "../../styles/style-parsers.js";
import { Styles } from "../../styles/styles-runtime.js";
import { AnsiStyles, RleMatrix } from "../rle-buffer.js";
import { Point } from "../utils.js";
import { Drawable, YogaBase } from "./drawable.js";
import type { TerminalContent, TerminalNode } from "./terminal-content.js";
import type { TerminalText } from "./terminal-text.js";

/**
 * One contiguous chunk of inline content: the characters of a single text node
 * together with the chain of inline elements that wrap it (outermost first).
 * The element chain drives both styling and hit-testing.
 */
interface InlinePiece {
    source: TerminalText;
    elements: readonly TerminalContent[];
}

/** A single rendered character cell, tagged with the piece it came from. */
interface Cell {
    ch: string;
    piece: InlinePiece;
}

const isSpace = (ch: string): boolean => /\s/.test(ch);

/**
 * Break a flat cell stream into wrapped lines no wider than `width` columns.
 * With `width === null` the stream is only broken on explicit newlines (its
 * natural, unwrapped size). Word boundaries are honoured; words longer than
 * `width` are hard-broken.
 */
const wrapCells = (cells: Cell[], width: number | null): Cell[][] => {
    if (cells.length === 0) {
        return [];
    }

    // Break on runs of newlines first; empty hard lines are dropped.
    const hardLines: Cell[][] = [];
    let segment: Cell[] = [];
    for (const cell of cells) {
        if (cell.ch === "\n") {
            if (segment.length > 0) {
                hardLines.push(segment);
                segment = [];
            }
        } else {
            segment.push(cell);
        }
    }
    if (segment.length > 0) {
        hardLines.push(segment);
    }

    if (width === null) {
        return hardLines;
    }

    const wrapped: Cell[][] = [];

    for (const hardLine of hardLines) {
        // Tokenize into alternating word / whitespace runs.
        const tokens: Cell[][] = [];
        let token: Cell[] = [];
        let tokenIsSpace: boolean | null = null;
        for (const cell of hardLine) {
            const space = isSpace(cell.ch);
            if (tokenIsSpace !== null && space !== tokenIsSpace) {
                tokens.push(token);
                token = [];
            }
            token.push(cell);
            tokenIsSpace = space;
        }
        if (token.length > 0) {
            tokens.push(token);
        }

        let line: Cell[] = [];
        for (const tok of tokens) {
            if (line.length + tok.length <= width) {
                line = line.concat(tok);
                continue;
            }

            if (line.length > 0) {
                wrapped.push(line);
                line = [];
            }

            if (isSpace(tok[0].ch)) {
                // Whitespace never starts a wrapped line.
                continue;
            }

            if (tok.length > width) {
                let rest = tok;
                while (rest.length > width) {
                    wrapped.push(rest.slice(0, width));
                    rest = rest.slice(width);
                }
                line = rest;
            } else {
                line = tok;
            }
        }

        if (line.length > 0) {
            wrapped.push(line);
        }
    }

    return wrapped;
};

/**
 * A run of adjacent inline content collapsed into a single layout box.
 *
 * The DOM keeps every text node and inline element as a separate node, but
 * text flow does not respect node boundaries — `Hello <b>{name}</b>` must wrap
 * as one stream, not as three independently-wrapped fragments. `InlineRun` is
 * the fix: the parent `TerminalContent` groups maximal sequences of adjacent
 * inline-level children (text + `display: inline` elements) into one run, and
 * the run flattens that subtree into a cell stream, measures it as a whole, and
 * paints the wrapped result. There is exactly one Yoga node per run.
 *
 * Because inline elements have no box of their own, the run also owns their
 * hit-testing: every painted cell remembers the inline element chain it came
 * from, so `probe` can map a coordinate back to the element(s) under it.
 *
 * Limitation: block-level elements nested inside an inline element are treated
 * as inline (flattened in place); mixing block content into an inline subtree
 * is not supported.
 */
export class InlineRun extends YogaBase implements Drawable {
    public kind = "inline-run" as const;

    /** The inline-level DOM children this run lays out, in document order. */
    public readonly members: readonly TerminalNode[];
    public parent: TerminalContent;

    #parentStyles: Styles.LocalStyleData | null = null;
    #renderDirty: boolean = true;
    #layoutDirty: boolean = true;
    #cells: Cell[] | null = null;
    #lines: Cell[][] = [];
    #cachedMatrix: RleMatrix | null = null;

    public constructor(parent: TerminalContent, members: TerminalNode[]) {
        super();

        this.parent = parent;
        this.members = members;

        // Flatten once up front so the owner back-pointers are in place.
        this.#buildCells();

        this.measureFunc = (width, widthMode) => {
            const cells = this.#cellList;
            if (cells.length === 0) {
                return { width: 0, height: 0 };
            }

            const wrapWidth = widthMode === MeasureMode.Undefined ? null : Math.max(1, Math.floor(width));
            const lines = wrapCells(cells, wrapWidth);
            const maxWidth = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
            return { width: maxWidth, height: Math.max(1, lines.length) };
        };
    }

    get #cellList(): Cell[] {
        if (this.#cells === null) {
            this.#buildCells();
        }
        return this.#cells!;
    }

    /**
     * Flatten the inline subtree into a cell stream and (re)establish the owner
     * back-pointers on every descendant node, so a later content or style
     * change can find its way back to this run.
     */
    #buildCells(): void {
        const cells: Cell[] = [];

        const visit = (node: TerminalNode, elements: TerminalContent[]) => {
            if (node.kind === "text") {
                node.owner = this;
                const piece: InlinePiece = { source: node, elements: elements.slice() };
                const text = node.textContent ?? "";
                for (let i = 0; i < text.length; i++) {
                    cells.push({ ch: text[i], piece });
                }
            } else {
                // An inline element contributes no box of its own, only its
                // (recursively flattened) content.
                node.inlineOwner = this;
                elements.push(node);
                for (const child of node.children) {
                    visit(child, elements);
                }
                elements.pop();
            }
        };

        for (const member of this.members) {
            visit(member, []);
        }

        this.#cells = cells;
    }

    /** Clear the owner back-pointers — used when this run is discarded. */
    public detachOwners(): void {
        const visit = (node: TerminalNode) => {
            if (node.kind === "text") {
                if (node.owner === this) {
                    node.owner = null;
                }
            } else {
                if (node.inlineOwner === this) {
                    node.inlineOwner = null;
                }
                for (const child of node.children) {
                    visit(child);
                }
            }
        };

        for (const member of this.members) {
            visit(member);
        }
    }

    /**
     * Re-measure and repaint this run. Called when a member text node's content
     * changes or a member inline element's style changes.
     */
    public invalidate(): void {
        this.#cells = null;
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

    #pieceStyle(piece: InlinePiece): AnsiStyles {
        const style: Styles.Style = piece.source.rawParentStyles?.style ?? {};
        return getAnsiStyles(style);
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

        const runBg = this.#parentStyles?.style?.["backgroundColor"];
        const matrix = new RleMatrix(bounds.width, bounds.height, undefined, { bgColor: runBg });

        const computedWidth = Math.max(1, Math.floor(bounds.width));
        this.#lines = wrapCells(this.#cellList, computedWidth);

        for (let y = 0; y < this.#lines.length; y++) {
            const line = this.#lines[y];

            // Coalesce adjacent cells from the same piece so each same-styled
            // span is written in a single call.
            let x = 0;
            while (x < line.length) {
                const piece = line[x].piece;
                let end = x;
                let text = "";
                while (end < line.length && line[end].piece === piece) {
                    text += line[end].ch;
                    end++;
                }

                const options = this.#pieceStyle(piece);
                matrix.setAscii({ x, y }, text, options);
                x = end;
            }
        }

        this.#cachedMatrix = matrix;
        this.#renderDirty = false;
        return matrix;
    }

    /**
     * Hit-test a point within this run. Returns the chain of inline elements
     * covering that cell, outermost first — empty if the cell is bare text or
     * past the end of a line.
     */
    public probe(position: Point): TerminalContent[] {
        const line = this.#lines[position.y];
        if (!line) {
            return [];
        }

        const cell = line[position.x];
        if (!cell) {
            return [];
        }

        return [...cell.piece.elements];
    }
}
