import { drawBorder } from "./drawing-utils.js";
import { AnsiStyles, RleMatrix, Segment } from "./rle-buffer.js";
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

        if (!this.needsRerender()) {
            return this.cachedComposite!;
        }

        const style = this.computedStyles;
        const generalStyles = {
            bgColor: style.backgroundColor,
        } satisfies AnsiStyles;

        const composite = new RleMatrix(bounds.width, bounds.height, undefined, generalStyles);
        drawBorder(style, this.parentStyles, bounds, composite);

        const mode = this.overflowMode;
        if (mode === "visible") {
            for (const child of this.drawableChildren) {
                const childPos = child.computedPosition.position;
                composite.copyIn({ x: childPos.x, y: childPos.y }, child.render());
            }
        } else {
            const { border, padding, contentArea } = this.computedPosition;
            const clip = {
                x: border.left + padding.left,
                y: border.top + padding.top,
                width: contentArea.width,
                height: contentArea.height,
            };

            const sx = mode === "scroll" ? this.scrollLeft : 0;
            const sy = mode === "scroll" ? this.scrollTop : 0;

            for (const child of this.drawableChildren) {
                const childPos = child.computedPosition.position;
                composite.copyInClipped({ x: childPos.x - sx, y: childPos.y - sy }, child.render(), clip);
            }

            if (mode === "scroll" && this.scrollActivityUntil > Date.now()) {
                this.#drawScrollbar(composite, clip, generalStyles);
            }
        }

        this.setCachedComposite(composite);
        return composite;
    }

    #drawScrollbar(
        composite: RleMatrix,
        clip: { x: number; y: number; width: number; height: number },
        generalStyles: AnsiStyles,
    ): void {
        const scrollExtent = this.computedPosition.scrollExtent;
        const maxScrollX = scrollExtent.width;
        const maxScrollY = scrollExtent.height;

        if (maxScrollY > 0 && clip.width > 0 && clip.height >= 2) {
            const contentLen = clip.height + maxScrollY;
            const thumbLen = Math.max(1, Math.floor((clip.height * clip.height) / contentLen));
            const usableTrack = clip.height - thumbLen;
            const thumbStart = maxScrollY > 0 ? Math.round((this.scrollTop / maxScrollY) * usableTrack) : 0;
            const thumbX = clip.x + clip.width - 1;

            const trackStyles: AnsiStyles = {
                color: "#666666",
                bgColor: generalStyles.bgColor,
            };
            const thumbStyles: AnsiStyles = {
                color: "#ffffff",
                bgColor: generalStyles.bgColor,
            };

            const thumbEnd = thumbStart + thumbLen - 1;
            for (let i = 0; i < clip.height; i++) {
                const y = clip.y + i;
                const isThumb = i >= thumbStart && i <= thumbEnd;
                let ch: string;
                if (isThumb) {
                    if (thumbLen === 1) ch = "█";
                    else if (i === thumbStart) ch = "▄";
                    else if (i === thumbEnd) ch = "▀";
                    else ch = "█";
                } else {
                    ch = "│";
                }
                const seg = new Segment(1, ch, isThumb ? thumbStyles : trackStyles);
                composite.getRow(y)?.write(thumbX, seg);
            }
        }

        if (maxScrollX > 0 && clip.height > 0 && clip.width >= 2) {
            const contentLen = clip.width + maxScrollX;
            const thumbLen = Math.max(1, Math.floor((clip.width * clip.width) / contentLen));
            const usableTrack = clip.width - thumbLen;
            const thumbStart = maxScrollX > 0 ? Math.round((this.scrollLeft / maxScrollX) * usableTrack) : 0;
            const thumbY = clip.y + clip.height - 1;

            const trackStyles: AnsiStyles = {
                color: "#666666",
                bgColor: generalStyles.bgColor,
            };
            const thumbStyles: AnsiStyles = {
                color: "#ffffff",
                bgColor: generalStyles.bgColor,
            };

            const row = composite.getRow(thumbY);
            if (row) {
                const thumbEnd = thumbStart + thumbLen - 1;
                for (let i = 0; i < clip.width; i++) {
                    const x = clip.x + i;
                    const isThumb = i >= thumbStart && i <= thumbEnd;
                    let ch: string;
                    if (isThumb) {
                        if (thumbLen === 1) ch = "█";
                        else if (i === thumbStart) ch = "▐";
                        else if (i === thumbEnd) ch = "▌";
                        else ch = "█";
                    } else {
                        ch = "─";
                    }
                    const seg = new Segment(1, ch, isThumb ? thumbStyles : trackStyles);
                    row.write(x, seg);
                }
            }
        }
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
