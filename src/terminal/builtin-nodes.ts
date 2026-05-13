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
    public render(): RleMatrix {
        const bounds = this.computedPosition.position;

        if (!this.renderDirty) {
            return this.cachedComposite!;
        }

        const style = this.computedStyles;
        const generalStyles = {
            bgColor: style.backgroundColor,
        } satisfies AnsiStyles;

        const composite = new RleMatrix(bounds.width, bounds.height, undefined, generalStyles);
        drawBorder(style, this.parentStyles, bounds, composite);

        for (const child of this.children) {
            const childPos = child.computedPosition.position;
            composite.copyIn({ x: childPos.x, y: childPos.y }, child.render());
        }

        this.setCachedComposite(composite);
        return composite;
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
