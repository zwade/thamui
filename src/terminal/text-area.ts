import { drawBorder } from "./drawing-utils.js";
import { AnsiStyles, isFullwidth, RleMatrix, visualWidth } from "./rle-buffer.js";
import { SplitBuffer } from "./split-buffer.js";
import { TerminalContent } from "./terminal-nodes.js";
import { KeyEvent } from "./tree-context.js";
import { Point } from "./utils.js";

const cellWidthOf = (ch: string): 1 | 2 => (isFullwidth(ch.codePointAt(0)!) ? 2 : 1);

const computeVisualLines = (text: string, width: number): string[] => {
    if (width <= 0) {
        return [text];
    }

    const lines: string[] = [];
    let line = "";
    let lineCells = 0;

    for (const ch of text) {
        if (ch === "\n") {
            lines.push(line);
            line = "";
            lineCells = 0;
            continue;
        }

        const w = cellWidthOf(ch);
        if (lineCells > 0 && lineCells + w > width) {
            lines.push(line);
            line = "";
            lineCells = 0;
        }

        line += ch;
        lineCells += w;

        if (lineCells >= width) {
            lines.push(line);
            line = "";
            lineCells = 0;
        }
    }

    lines.push(line);
    return lines;
};

const computeVisualPos = (text: string, width: number, cursor: number): { row: number; col: number } => {
    if (width <= 0) {
        return { row: 0, col: 0 };
    }

    let row = 0;
    let col = 0;
    let charIdx = 0;

    for (const ch of text) {
        if (charIdx >= cursor) break;
        if (ch === "\n") {
            row++;
            col = 0;
        } else {
            const w = cellWidthOf(ch);
            if (col > 0 && col + w > width) {
                row++;
                col = 0;
            }
            col += w;
            if (col >= width) {
                row++;
                col = 0;
            }
        }
        charIdx += ch.length;
    }

    return { row, col };
};

const offsetAtVisualPos = (text: string, width: number, targetRow: number, targetCol: number): number => {
    if (width <= 0) {
        return 0;
    }

    let row = 0;
    let col = 0;
    let bestOffset = -1;
    let bestCol = -1;
    let charIdx = 0;

    while (true) {
        if (row === targetRow) {
            if (col <= targetCol && col > bestCol) {
                bestOffset = charIdx;
                bestCol = col;
            }
            if (col === targetCol) {
                return charIdx;
            }
        }

        if (row > targetRow) {
            break;
        }

        if (charIdx >= text.length) {
            break;
        }

        const code = text.codePointAt(charIdx)!;
        const ch = String.fromCodePoint(code);

        if (ch === "\n") {
            row++;
            col = 0;
        } else {
            const w = isFullwidth(code) ? 2 : 1;
            if (col > 0 && col + w > width) {
                row++;
                col = 0;
            }
            col += w;
            if (col >= width) {
                row++;
                col = 0;
            }
        }

        charIdx += ch.length;
    }

    return bestOffset >= 0 ? bestOffset : text.length;
};

const charAtCell = (line: string, targetCol: number): string => {
    let col = 0;
    for (const ch of line) {
        if (col === targetCol) {
            return ch;
        }

        const w = cellWidthOf(ch);
        if (col < targetCol && col + w > targetCol) {
            // Target lands mid-fullwidth; treat as space.
            return " ";
        }

        col += w;
        if (col > targetCol) {
            break;
        }
    }

    return " ";
};

export class TextArea extends TerminalContent {
    public isSelectable = true;

    #buffer = new SplitBuffer();
    #cursorOffset: Point | null = null;

    public constructor() {
        super("textarea");
    }

    public getCursorOffset(): Point | null {
        return this.#cursorOffset;
    }

    public get value(): string {
        return this.#buffer.value;
    }

    public setAttribute(key: string, value: string): void {
        if (key === "value") {
            if (value !== this.#buffer.value) {
                this.#buffer.reset(value);
                this.markDirty();
            }

            this.attributes[key] = value;
            return;
        }

        super.setAttribute(key, value);
    }

    public dispatchKeyEvent(event: KeyEvent): { handled: boolean } {
        this.dispatchEvent("keypress", event);

        if (event.alt) {
            return { handled: false };
        }

        const width = Math.max(1, Math.floor(this.computedPosition.contentArea.width));
        let changed = false;

        switch (event.key) {
            case "ArrowLeft": {
                changed = this.#buffer.moveLeft();
                break;
            }
            case "ArrowRight": {
                changed = this.#buffer.moveRight();
                break;
            }
            case "ArrowUp": {
                changed = this.#moveUp(width);
                break;
            }
            case "ArrowDown": {
                changed = this.#moveDown(width);
                break;
            }
            case "Home": {
                changed = this.#moveLineHome(width);
                break;
            }
            case "End": {
                changed = this.#moveLineEnd(width);
                break;
            }
            case "Backspace": {
                changed = this.#buffer.backspace();
                break;
            }
            case "Enter": {
                changed = this.#buffer.insert("\n");
                break;
            }
            default: {
                if (event.ctrl || event.alt || !event.text) {
                    return { handled: false };
                }

                const text = event.text.replace(/\r\n?/g, "\n");
                if (text.length > 0) {
                    changed = this.#buffer.insert(text);
                }
            }
        }

        if (changed) {
            this.markDirty();
            this.dispatchEvent("change", this.#buffer.value);
        }

        return { handled: true };
    }

    public render(): RleMatrix {
        const bounds = this.computedPosition.position;

        if (!this.needsRerender()) {
            return this.cachedComposite!;
        }

        const style = this.computedStyles;
        const generalStyles: AnsiStyles = { bgColor: style.backgroundColor };
        const composite = new RleMatrix(bounds.width, bounds.height, undefined, generalStyles);

        drawBorder(style, this.parentStyles, bounds, composite);

        const contentArea = this.computedPosition.contentArea;
        const innerX = contentArea.x - bounds.x;
        const innerY = contentArea.y - bounds.y;
        const innerWidth = Math.max(0, contentArea.width);
        const innerHeight = Math.max(0, contentArea.height);

        if (innerWidth > 0 && innerHeight > 0) {
            const text = this.#buffer.value;
            const lines = computeVisualLines(text, innerWidth);
            const cursorPos = computeVisualPos(text, innerWidth, this.#buffer.cursor);

            const scrollY = cursorPos.row >= innerHeight ? cursorPos.row - innerHeight + 1 : 0;

            const textStyles: AnsiStyles = {
                color: style.color,
                bgColor: style.backgroundColor,
            };

            for (let i = 0; i < innerHeight; i++) {
                const lineIdx = scrollY + i;
                if (lineIdx >= lines.length) {
                    break;
                }

                const line = lines[lineIdx];
                composite.setText({ x: innerX, y: innerY + i }, line, textStyles);

                const lineCells = visualWidth(line);
                if (lineCells < innerWidth) {
                    composite.setAscii(
                        { x: innerX + lineCells, y: innerY + i },
                        " ".repeat(innerWidth - lineCells),
                        textStyles,
                    );
                }
            }

            this.#cursorOffset = null;
            if (this.states.has("focus")) {
                const visualRow = cursorPos.row - scrollY;
                if (visualRow >= 0 && visualRow < innerHeight && cursorPos.col < innerWidth) {
                    const cursorLine = lines[scrollY + visualRow] ?? "";
                    const cursorChar = charAtCell(cursorLine, cursorPos.col);
                    const cursorStyles: AnsiStyles = {
                        color: style.backgroundColor ?? "black",
                        bgColor: style.color ?? "white",
                    };
                    composite.setText({ x: innerX + cursorPos.col, y: innerY + visualRow }, cursorChar, cursorStyles);
                    this.#cursorOffset = { x: innerX + cursorPos.col, y: innerY + visualRow };
                }
            }
        } else {
            this.#cursorOffset = null;
        }

        this.setCachedComposite(composite);
        return composite;
    }

    #moveUp(width: number): boolean {
        const text = this.#buffer.value;
        const { row, col } = computeVisualPos(text, width, this.#buffer.cursor);

        if (row === 0) {
            if (this.#buffer.cursor === 0) {
                return false;
            }

            this.#buffer.reset(text, 0);
            return true;
        }

        const newCursor = offsetAtVisualPos(text, width, row - 1, col);
        if (newCursor === this.#buffer.cursor) {
            return false;
        }

        this.#buffer.reset(text, newCursor);
        return true;
    }

    #moveDown(width: number): boolean {
        const text = this.#buffer.value;
        const { row, col } = computeVisualPos(text, width, this.#buffer.cursor);
        const lines = computeVisualLines(text, width);

        if (row >= lines.length - 1) {
            if (this.#buffer.cursor === text.length) {
                return false;
            }

            this.#buffer.reset(text, text.length);
            return true;
        }

        const newCursor = offsetAtVisualPos(text, width, row + 1, col);
        if (newCursor === this.#buffer.cursor) {
            return false;
        }

        this.#buffer.reset(text, newCursor);
        return true;
    }

    #moveLineHome(width: number): boolean {
        const text = this.#buffer.value;
        const { row } = computeVisualPos(text, width, this.#buffer.cursor);
        const newCursor = offsetAtVisualPos(text, width, row, 0);

        if (newCursor === this.#buffer.cursor) {
            return false;
        }

        this.#buffer.reset(text, newCursor);
        return true;
    }

    #moveLineEnd(width: number): boolean {
        const text = this.#buffer.value;
        const { row } = computeVisualPos(text, width, this.#buffer.cursor);
        const newCursor = offsetAtVisualPos(text, width, row, Number.MAX_SAFE_INTEGER);

        if (newCursor === this.#buffer.cursor) {
            return false;
        }

        this.#buffer.reset(text, newCursor);
        return true;
    }
}
