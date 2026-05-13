import { drawBorder } from "./drawing-utils.js";
import { AnsiStyles, isFullwidth, RleMatrix, visualWidth } from "./rle-buffer.js";
import { SplitBuffer } from "./split-buffer.js";
import { TerminalContent } from "./terminal-nodes.js";
import { KeyEvent } from "./tree-context.js";
import { Point } from "./utils.js";

export class TextInput extends TerminalContent {
    public isSelectable = true;

    #buffer = new SplitBuffer();
    #cursorOffset: Point | null = null;

    public getCursorOffset(): Point | null {
        return this.#cursorOffset;
    }

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
            default: {
                if (event.ctrl || event.alt || !event.text) {
                    return { handled: false };
                }

                const text = event.text.replace(/[\r\n]+/g, " ");
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

        if (!this.renderDirty) {
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

        if (innerWidth > 0) {
            const rawValue = this.#buffer.value;
            const display = this.attributes.type === "password" ? "•".repeat(rawValue.length) : rawValue;
            const cursor = this.#buffer.cursor;

            const cursorCell = visualWidth(display.slice(0, cursor));
            const viewStartTarget = cursorCell >= innerWidth ? cursorCell - (innerWidth - 1) : 0;

            // Drop chars from the start until we've passed viewStartTarget cells.
            let charIdx = 0;
            let viewStartCell = 0;
            for (const ch of display) {
                if (viewStartCell >= viewStartTarget) break;
                viewStartCell += isFullwidth(ch.codePointAt(0)!) ? 2 : 1;
                charIdx += ch.length;
            }

            // Take chars until we fill innerWidth cells.
            let visible = "";
            let visibleCells = 0;
            let i = charIdx;
            while (i < display.length) {
                const code = display.codePointAt(i)!;
                const w = isFullwidth(code) ? 2 : 1;
                if (visibleCells + w > innerWidth) break;
                const ch = String.fromCodePoint(code);
                visible += ch;
                visibleCells += w;
                i += ch.length;
            }

            const textStyles: AnsiStyles = {
                color: style.color,
                bgColor: style.backgroundColor,
            };

            composite.setText({ x: innerX, y: innerY }, visible, textStyles);

            if (visibleCells < innerWidth) {
                composite.setAscii(
                    { x: innerX + visibleCells, y: innerY },
                    " ".repeat(innerWidth - visibleCells),
                    textStyles,
                );
            }

            this.#cursorOffset = null;
            if (this.states.has("focus")) {
                const cursorCellRel = cursorCell - viewStartCell;
                if (cursorCellRel >= 0 && cursorCellRel < innerWidth) {
                    const cursorCode = cursor < display.length ? display.codePointAt(cursor) : 0x20;
                    const cursorChar = cursorCode === undefined ? " " : String.fromCodePoint(cursorCode);
                    const cursorStyles: AnsiStyles = {
                        color: style.backgroundColor ?? "black",
                        bgColor: style.color ?? "white",
                    };
                    composite.setText({ x: innerX + cursorCellRel, y: innerY }, cursorChar, cursorStyles);
                    this.#cursorOffset = { x: innerX + cursorCellRel, y: innerY };
                }
            }
        } else {
            this.#cursorOffset = null;
        }

        this.setCachedComposite(composite);
        return composite;
    }
}
