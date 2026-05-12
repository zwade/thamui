import { Map } from "immutable";

import { AnsiStyles, RleMatrix } from "../rle-buffer.js";
import { ParsedStyle } from "../styles/styles.js";
import { mergeStyles } from "../styles/styles-runtime.js";
import { Point } from "../utils.js";
import { drawBorder } from "./drawing-utils.js";
import { TerminalContent } from "./terminal-nodes.js";

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
    public constructor() {
        super("button");
    }
}
