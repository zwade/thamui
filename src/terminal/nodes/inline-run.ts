import { MeasureMode } from "yoga-layout";

import { getAnsiStyles } from "../../styles/style-parsers.js";
import { Styles } from "../../styles/styles-runtime.js";
import { AnsiStyles, isFullwidth, RleMatrix } from "../rle-buffer.js";
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

/**
 * A single rendered character cell. `ch` is one whole code point (one or two
 * UTF-16 units); `width` is how many terminal columns it occupies — 2 for
 * fullwidth CJK / emoji, 1 otherwise. Tracking the visual width here is what
 * keeps wrapping, measurement and paint in agreement for wide characters.
 */
interface Cell {
    ch: string;
    width: 1 | 2;
    piece: InlinePiece;
}

const isSpace = (ch: string): boolean => /\s/.test(ch);

/** Total terminal columns occupied by a cell list. */
const columnsOf = (cells: readonly Cell[]): number => {
    let total = 0;
    for (const cell of cells) {
        total += cell.width;
    }
    return total;
};

/**
 * Split a cell list at the first point that would exceed `maxColumns`. The head
 * always contains at least one cell, so callers that loop on the remainder are
 * guaranteed to make progress even when a single wide cell overflows the width.
 */
const splitAtColumns = (cells: Cell[], maxColumns: number): [head: Cell[], rest: Cell[]] => {
    let columns = 0;
    let i = 0;
    while (i < cells.length) {
        const width = cells[i].width;
        if (i > 0 && columns + width > maxColumns) {
            break;
        }
        columns += width;
        i++;
        if (columns >= maxColumns) {
            break;
        }
    }
    return [cells.slice(0, i), cells.slice(i)];
};

/**
 * Break a flat cell stream into wrapped lines no wider than `width` columns.
 * With `width === null` the stream is only broken on explicit newlines (its
 * natural, unwrapped size). Word boundaries are honoured; words wider than
 * `width` are hard-broken. All widths are measured in terminal columns, so
 * fullwidth characters count as two.
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
        let lineColumns = 0;
        for (const tok of tokens) {
            const tokColumns = columnsOf(tok);

            if (lineColumns + tokColumns <= width) {
                line = line.concat(tok);
                lineColumns += tokColumns;
                continue;
            }

            if (line.length > 0) {
                wrapped.push(line);
                line = [];
                lineColumns = 0;
            }

            if (isSpace(tok[0].ch)) {
                // Whitespace never starts a wrapped line.
                continue;
            }

            if (tokColumns > width) {
                let rest = tok;
                while (columnsOf(rest) > width) {
                    const [head, tail] = splitAtColumns(rest, width);
                    wrapped.push(head);
                    rest = tail;
                }
                line = rest;
                lineColumns = columnsOf(rest);
            } else {
                line = tok;
                lineColumns = tokColumns;
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
            const maxWidth = lines.reduce((acc, line) => Math.max(acc, columnsOf(line)), 0);
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
                // Iterate by code point so surrogate pairs (emoji) stay intact.
                for (const ch of text) {
                    const width = isFullwidth(ch.codePointAt(0)!) ? 2 : 1;
                    cells.push({ ch, width, piece });
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
            // span is painted in a single call. `x` advances in terminal
            // columns, so wide characters keep the cursor aligned.
            let x = 0;
            let i = 0;
            while (i < line.length) {
                const piece = line[i].piece;
                let text = "";
                let runColumns = 0;
                while (i < line.length && line[i].piece === piece) {
                    text += line[i].ch;
                    runColumns += line[i].width;
                    i++;
                }

                // `setText` (unlike `setAscii`) builds fullwidth-aware segments.
                matrix.setText({ x, y }, text, this.#pieceStyle(piece));
                x += runColumns;
            }
        }

        this.#cachedMatrix = matrix;
        this.#renderDirty = false;
        return matrix;
    }

    /**
     * Hit-test a point within this run. Returns the chain of inline elements
     * covering that column, outermost first — empty if the column is bare text
     * or past the end of a line.
     */
    public probe(position: Point): TerminalContent[] {
        const line = this.#lines[position.y];
        if (!line) {
            return [];
        }

        // Walk the line in columns so a click anywhere on a wide cell hits it.
        let column = 0;
        for (const cell of line) {
            if (position.x >= column && position.x < column + cell.width) {
                return [...cell.piece.elements];
            }
            column += cell.width;
        }

        return [];
    }
}
