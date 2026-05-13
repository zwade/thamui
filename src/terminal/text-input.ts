import { drawBorder } from "./drawing-utils.js";
import { AnsiStyles, RleMatrix } from "./rle-buffer.js";
import { SplitBuffer } from "./split-buffer.js";
import { TerminalContent } from "./terminal-nodes.js";
import { KeyEvent } from "./tree-context.js";
import { Point } from "./utils.js";

export class TextInput extends TerminalContent {
    public isSelectable = true;

    #buffer = new SplitBuffer();

    public constructor() {
        super("input");
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
            case "Home": {
                changed = this.#buffer.home();
                break;
            }
            case "End": {
                changed = this.#buffer.end();
                break;
            }
            case "Backspace": {
                changed = this.#buffer.backspace();
                break;
            }
            case "Paste": {
                const text = (event.text ?? "").replace(/[\r\n]+/g, " ");
                if (text.length > 0) {
                    changed = this.#buffer.insert(text);
                }
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

        if (innerWidth > 0) {
            const rawValue = this.#buffer.value;
            const display = this.attributes.type === "password" ? "•".repeat(rawValue.length) : rawValue;
            const cursor = this.#buffer.cursor;

            const viewStart = cursor >= innerWidth ? cursor - (innerWidth - 1) : 0;
            const visible = display.slice(viewStart, viewStart + innerWidth);
            const visibleCursor = cursor - viewStart;

            const textStyles: AnsiStyles = {
                color: style.color,
                bgColor: style.backgroundColor,
            };
            const textMatrix = RleMatrix.fromAscii(visible.padEnd(innerWidth, " "), textStyles);
            baseMatrix.copyIn({ x: innerX, y: innerY }, textMatrix);

            if (this.states.has("focus") && visibleCursor >= 0 && visibleCursor < innerWidth) {
                const cursorChar = visible[visibleCursor] ?? " ";
                const cursorStyles: AnsiStyles = {
                    color: style.backgroundColor ?? "black",
                    bgColor: style.color ?? "white",
                };
                const cursorMatrix = RleMatrix.fromAscii(cursorChar, cursorStyles);
                baseMatrix.copyIn({ x: innerX + visibleCursor, y: innerY }, cursorMatrix);
            }
        }

        matrix.copyIn(start, baseMatrix);

        return baseMatrix;
    }
}
