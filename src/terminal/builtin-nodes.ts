import { drawBorder } from "./drawing-utils.js";
import { AnsiStyles, RleMatrix } from "./rle-buffer.js";
import { TerminalContent } from "./terminal-nodes.js";
import { KeyEvent } from "./tree-context.js";
import { Point } from "./utils.js";

export interface RenderResult {
    start: Point;
    end: Point;
}

export class Block extends TerminalContent {
    public render(matrix: RleMatrix, start: Point) {
        const style = this.computedStyles;

        const generalStyles = {
            bgColor: style.backgroundColor,
        } satisfies AnsiStyles;

        const boundingRect = this.computedPosition.position;

        const baseMatrix = new RleMatrix(boundingRect.width, boundingRect.height, undefined, generalStyles);

        drawBorder(style, this.parentStyles, boundingRect, baseMatrix);

        matrix.copyIn(start, baseMatrix);

        for (const child of this.children) {
            const offsetPoint = {
                x: start.x + child.computedPosition.position.x,
                y: start.y + child.computedPosition.position.y,
            };

            child.render(matrix, offsetPoint);
        }

        return baseMatrix;
    }
}

export class Button extends Block {
    public isSelectable = true;

    public constructor() {
        super("button");
    }

    public dispatchKeyEvent(event: KeyEvent): { handled: boolean } {
        if ((event.key === "Enter" || event.key === " ") && !event.ctrl && !event.alt) {
            this.dispatchEvent("mousedown");
            this.dispatchEvent("mouseup");
            return { handled: true };
        }

        return super.dispatchKeyEvent(event);
    }
}
