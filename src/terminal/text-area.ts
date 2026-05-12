import { drawBorder } from "./drawing-utils.js";
import { AnsiStyles, RleMatrix } from "./rle-buffer.js";
import { SplitBuffer } from "./split-buffer.js";
import { TerminalContent } from "./terminal-nodes.js";
import { KeyEvent } from "./tree-context.js";
import { Point } from "./utils.js";

const computeVisualLines = (text: string, width: number): string[] => {
    if (width <= 0) {
        return [text];
    }

    const lines: string[] = [];
    let line = "";

    for (const ch of text) {
        if (ch === "\n") {
            lines.push(line);
            line = "";
            continue;
        }

        line += ch;
        if (line.length >= width) {
            lines.push(line);
            line = "";
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

    for (let i = 0; i < cursor && i < text.length; i++) {
        const ch = text[i];
        if (ch === "\n") {
            row++;
            col = 0;
        } else {
            col++;
            if (col >= width) {
                row++;
                col = 0;
            }
        }
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

    for (let i = 0; i <= text.length; i++) {
        if (row === targetRow) {
            if (col <= targetCol && col > bestCol) {
                bestOffset = i;
                bestCol = col;
            }

            if (col === targetCol) {
                return i;
            }
        }

        if (row > targetRow) {
            break;
        }

        if (i === text.length) {
            break;
        }

        const ch = text[i];
        if (ch === "\n") {
            row++;
            col = 0;
        } else {
            col++;
            if (col >= width) {
                row++;
                col = 0;
            }
        }
    }

    return bestOffset >= 0 ? bestOffset : text.length;
};

export class TextArea extends TerminalContent {
    public isSelectable = true;

    #buffer = new SplitBuffer();

    public constructor() {
        super("textarea");
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
                if (event.ctrl) {
                    return { handled: false };
                }

                if (event.key.length === 1) {
                    changed = this.#buffer.insert(event.key);
                } else {
                    return { handled: false };
                }
            }
        }

        if (changed) {
            this.markDirty();
            this.dispatchEvent("change", this.#buffer.value);
        }

        return { handled: true };
    }

    public render(matrix: RleMatrix, start: Point) {
        const style = this.computedStyles;
        const generalStyles: AnsiStyles = { bgColor: style.backgroundColor };
        const boundingRect = this.computedPosition.position;

        const baseMatrix = new RleMatrix(boundingRect.width, boundingRect.height, undefined, generalStyles);

        drawBorder(style, this.parentStyles, boundingRect, baseMatrix);

        const contentArea = this.computedPosition.contentArea;
        const innerX = contentArea.x - boundingRect.x;
        const innerY = contentArea.y - boundingRect.y;
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

                const line = lines[lineIdx].padEnd(innerWidth, " ");
                const lineMatrix = RleMatrix.fromAscii(line, textStyles);
                baseMatrix.copyIn({ x: innerX, y: innerY + i }, lineMatrix);
            }

            if (this.states.has("focus")) {
                const visualRow = cursorPos.row - scrollY;
                if (visualRow >= 0 && visualRow < innerHeight && cursorPos.col < innerWidth) {
                    const cursorLine = lines[scrollY + visualRow] ?? "";
                    const cursorChar = cursorLine[cursorPos.col] ?? " ";
                    const cursorStyles: AnsiStyles = {
                        color: style.backgroundColor ?? "black",
                        bgColor: style.color ?? "white",
                    };
                    const cursorMatrix = RleMatrix.fromAscii(cursorChar, cursorStyles);
                    baseMatrix.copyIn({ x: innerX + cursorPos.col, y: innerY + visualRow }, cursorMatrix);
                }
            }
        }

        matrix.copyIn(start, baseMatrix);
        return baseMatrix;
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
