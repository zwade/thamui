import { assert } from "console";
// import { F, HTContentNode, HTTextNode } from "effectual";
// import { HTCSSStyleDeclaration } from "effectual/lib/reconciler/src/hydration-target.mjs";
import Yoga, { Edge, MeasureFunction, MeasureMode, Node as YogaNode } from "yoga-layout";

import { Selector } from "../styles/selector.js";
import { applyStyles } from "../styles/style-parsers.js";
import { ParsedStyle } from "../styles/styles.js";
import { mergeStyles, propagateStyles, Styles } from "../styles/styles-runtime.js";
import { RleMatrix } from "./rle-buffer.js";
import { KeyEvent, TreeContext } from "./tree-context.js";
import { Box, FourSize, Point } from "./utils.js";

export interface Drawable {
    layout(options?: { force?: boolean }): void;
    render(): RleMatrix;
    pushStyles(styleData: Styles.LocalStyleData, parentContext: Selector.ParentContext): void;

    probe(position: Point): TerminalNode[];
    dispatchEvent(eventName: string): {
        handled: boolean;
    };
}

export type StyleMap = {
    setProperty(key: string, value: string): void;
    cssText: string;
} & Record<string, string>;

export const styles = (onDirty: () => void): StyleMap => {
    const wellKnownGet = {
        setProperty(this: Record<string, string>) {
            return (key: string, value: string) => {
                onDirty();
                this[key] = value;
            };
        },
        cssText(this: Record<string, string>) {
            return Object.entries(this)
                .map(([key, value]) => `${key}: ${value};`)
                .join(" ");
        },
    };

    const wellKnownSet = {
        cssText(this: Record<string, string>, target: Record<string, string>, data: string) {
            for (const key in target) {
                delete target[key];
            }

            const styles = data.split(";").map((style) => style.split(":"));
            for (const [key, value] of styles) {
                if (key && value) {
                    onDirty();
                    this[key.trim()] = value.trim();
                }
            }
        },
    };

    return new Proxy<StyleMap>({} as any, {
        get(target, prop: string) {
            if (prop in wellKnownGet) {
                return (wellKnownGet as any)[prop].bind(target);
            }

            return target[prop] ?? "";
        },
        set(target, prop: string, value: string) {
            if (prop in wellKnownSet) {
                (wellKnownSet as any)[prop].bind(target)(target, value);
                return true;
            }

            target[prop] = value;
            onDirty();
            return true;
        },
    });
};

export interface ComputedPosition {
    position: Box;
    border: FourSize;
    margin: FourSize;
    padding: FourSize;
    contentArea: Box;
    scrollExtent: Box;
}

export class YogaBase {
    #yogaNode: YogaNode | null = null;
    #computedPosition: ComputedPosition | null = null;
    #measureFunc?: MeasureFunction;

    protected children: YogaBase[] = [];

    protected set measureFunc(func: MeasureFunction) {
        this.#measureFunc = func;

        if (this.#yogaNode) {
            this.#yogaNode.setMeasureFunc(func);
        }
    }

    public allocateYoga(): YogaNode {
        if (this.#yogaNode) {
            return this.#yogaNode;
        }

        const yogaNode = Yoga.Node.create();
        this.#yogaNode = yogaNode;

        if (this.#measureFunc) {
            yogaNode.setMeasureFunc(this.#measureFunc);
        }

        this.recomputeLayout();

        return yogaNode;
    }

    public deallocateYoga() {
        if (!this.#yogaNode) {
            return;
        }

        this.#yogaNode.freeRecursive();
        this.#yogaNode = null;
    }

    public get computedPosition() {
        if (this.#computedPosition) {
            return this.#computedPosition;
        }

        const node = this.allocateYoga();

        const position: Box = {
            x: node.getComputedLeft(),
            y: node.getComputedTop(),
            width: node.getComputedWidth(),
            height: node.getComputedHeight(),
        };

        const border: FourSize = {
            top: node.getComputedBorder(Edge.Top),
            right: node.getComputedBorder(Edge.Right),
            bottom: node.getComputedBorder(Edge.Bottom),
            left: node.getComputedBorder(Edge.Left),
        };

        const margin: FourSize = {
            top: node.getComputedMargin(Edge.Top),
            right: node.getComputedMargin(Edge.Right),
            bottom: node.getComputedMargin(Edge.Bottom),
            left: node.getComputedMargin(Edge.Left),
        };

        const padding: FourSize = {
            top: node.getComputedPadding(Edge.Top),
            right: node.getComputedPadding(Edge.Right),
            bottom: node.getComputedPadding(Edge.Bottom),
            left: node.getComputedPadding(Edge.Left),
        };

        const contentArea: Box = {
            x: position.x + border.left + padding.left,
            y: position.y + border.top + padding.top,
            width: position.width - (border.left + border.right) - (padding.left + padding.right),
            height: position.height - (border.top + border.bottom) - (padding.top + padding.bottom),
        };

        const originX = border.left + padding.left;
        const originY = border.top + padding.top;

        let maxX = 0;
        let maxY = 0;
        for (const child of this.children) {
            const pos = child.computedPosition.position;
            const relRight = pos.x + pos.width - originX;
            const relBottom = pos.y + pos.height - originY;
            if (relRight > maxX) maxX = relRight;
            if (relBottom > maxY) maxY = relBottom;
        }

        const scrollExtent: Box = {
            x: 0,
            y: 0,
            width: Math.max(0, Math.ceil(maxX - contentArea.width)),
            height: Math.max(0, Math.ceil(maxY - contentArea.height)),
        };

        const computedPosition = {
            position,
            border,
            margin,
            padding,
            contentArea,
            scrollExtent,
        };

        this.#computedPosition = computedPosition;
        return computedPosition;
    }

    public recomputeLayout() {
        this.#computedPosition = null;
    }
}

export type OverflowMode = "visible" | "hidden" | "scroll";

export const SCROLLBAR_ACTIVE_MS = 700;

export class TerminalContent extends YogaBase implements Drawable {
    public kind = "terminal" as const;

    public tagName: string;
    public style: StyleMap;

    public children: TerminalNode[] = [];
    public nextSibling: TerminalNode | null = null;
    public parent: TerminalContent | null = null;
    public treeContext: TreeContext | null = null;
    public isSelectable: boolean = false;

    public scrollActivityUntil: number = 0;
    #scrollFadeTimer: NodeJS.Timeout | null = null;

    protected dirty: boolean = true;
    protected events: Map<string, Set<(data?: any) => void>> = new Map();
    protected attributes: Record<string, string> = {};
    protected rawParentStyles: Styles.LocalStyleData | null = null;
    protected parentContext: Selector.ParentContext | null = null;
    protected localStyles: Styles.LocalStyleData | null = null;
    protected rawStylesheet: ParsedStyle[] | null = null;
    protected states: Set<Selector.State> = new Set();

    #scrollTop: number = 0;
    #scrollLeft: number = 0;
    #layoutDirty: boolean = true;
    #stylesDirty: boolean = true;
    #renderDirty: boolean = true;
    #cachedComposite: RleMatrix | null = null;
    #recomputeTimer: NodeJS.Timeout | null = null;
    #lastParentStyles: Styles.LocalStyleData | null = null;
    #lastParentContextIndex: number | undefined = undefined;
    #lastParentContextOutOf: number | undefined = undefined;
    #lastAppliedStyles: Styles.Style | null = null;

    constructor(tagName: string) {
        super();

        this.tagName = tagName;
        this.style = styles(() => {
            this.markDirty();
        });
    }

    // Getters and setters
    public get selector(): Selector {
        return {
            className: this.attributes["class"]?.split(/\s+/g),
            id: this.attributes["id"],
            tagName: this.tagName,
        };
    }

    public get computedStyles(): Styles.Style {
        if (this.localStyles) {
            return this.localStyles.style;
        }

        return {};
    }

    public get parentStyles(): Styles.Style {
        if (this.rawParentStyles) {
            return this.rawParentStyles.style;
        }

        return {};
    }

    // Protected methods

    protected markDirty() {
        this.#layoutDirty = true;
        this.#stylesDirty = true;
        this.markRenderDirty();

        if (!this.#recomputeTimer) {
            this.#recomputeTimer = setTimeout(() => this.recomputeStyles(), 1);
        }
    }

    public markRenderDirty(): void {
        if (this.#renderDirty) {
            return;
        }

        this.#renderDirty = true;
        this.parent?.markRenderDirty();
    }

    protected get cachedComposite(): RleMatrix | null {
        return this.#cachedComposite;
    }

    protected needsRerender(): boolean {
        if (!this.#cachedComposite) {
            return this.#renderDirty;
        }

        // We need to check if the layout of an adjacent entity has changed in a way that would affect the size of this entity
        // even if the styles haven't changed.
        const bounds = this.computedPosition.position;
        const sizeMatches =
            this.#cachedComposite.width === bounds.width && this.#cachedComposite.height === bounds.height;

        return !sizeMatches || this.#renderDirty;
    }

    protected setCachedComposite(matrix: RleMatrix) {
        this.#cachedComposite = matrix;
        this.#renderDirty = false;
    }

    // Public methods

    public insertBefore(node: TerminalNode, before: TerminalNode | null) {
        const index = this.children.indexOf(before!);
        if (index !== -1) {
            node.nextSibling = before;

            this.allocateYoga().insertChild(node.allocateYoga(), index);
            this.children.splice(index, 0, node);
        } else {
            node.nextSibling = null;

            this.allocateYoga().insertChild(node.allocateYoga(), this.children.length);
            this.children.push(node);
        }

        this.markDirty();

        if (this.treeContext) {
            node.onAttach(this.treeContext, this);
        }
    }

    public appendChild(node: TerminalNode) {
        this.insertBefore(node, null);
    }

    public removeChild(content: TerminalNode): void {
        const index = this.children.indexOf(content);

        if (index !== -1) {
            const [result] = this.children.splice(index, 1);
            if (result) {
                result.nextSibling = null;
                this.allocateYoga().removeChild(result.allocateYoga());
                result.onDetach();
            }
        }

        this.markDirty();
    }

    public onAttach(ctx: TreeContext, parent: TerminalContent | null) {
        this.treeContext = ctx;
        this.parent = parent;

        for (const child of this.children) {
            child.onAttach(ctx, this);
        }
    }

    public onDetach() {
        for (const child of this.children) {
            child.onDetach();
        }

        if (this.treeContext?.focused === this) {
            this.treeContext.blur(this);
        }

        this.treeContext = null;
        this.parent = null;
    }

    public setFocused(value: boolean) {
        if (value) {
            this.states.add("focus");
        } else {
            this.states.delete("focus");
        }

        this.markDirty();
    }

    public setAttribute(key: string, value: string): void {
        // Temporary hack until i have a way of implementing
        // display: contents
        if (key === "data-stylesheet") {
            this.rawStylesheet = JSON.parse(value);
        } else {
            this.attributes[key] = value;
        }

        this.markDirty();
    }

    public removeAttribute(key: string): void {
        delete this.attributes[key];
        this.markDirty();
    }

    public addEventListener(eventName: string, callback: (data?: any) => void): void {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, new Set());
        }

        this.events.get(eventName)!.add(callback);
    }

    public removeEventListener(eventName: string, callback: (data?: any) => void): void {
        if (this.events.has(eventName)) {
            this.events.get(eventName)!.delete(callback);
        }
    }

    public dispatchKeyEvent(_event: KeyEvent): { handled: boolean } {
        return { handled: false };
    }

    public dispatchEvent(eventName: string, data?: unknown): { handled: boolean } {
        if (this.attributes.inert) {
            return { handled: false };
        }

        switch (eventName) {
            case "mouseenter": {
                this.states.add("hover");
                this.markDirty();
                break;
            }
            case "mouseleave": {
                this.states.delete("hover");
                this.states.delete("active");
                this.markDirty();
                break;
            }
            case "mousedown": {
                this.states.add("active");
                if (this.isSelectable && this.treeContext) {
                    this.treeContext.claim(this);
                }
                this.markDirty();
                break;
            }
            case "mouseup": {
                this.states.delete("active");
                this.markDirty();
                break;
            }
        }

        const listeners = this.events.get(eventName);
        if (listeners && listeners.size > 0) {
            for (const listener of listeners) {
                listener(data);
            }

            // TODO(should we still allow bubbling?)
            return { handled: true };
        }

        return { handled: false };
    }

    public get overflowMode(): OverflowMode {
        const value = this.computedStyles["overflow"];
        if (value === "scroll" || value === "hidden") {
            return value;
        }
        return "visible";
    }

    public scrollTo(x: number, y: number) {
        const scrollExtent = this.computedPosition.scrollExtent;

        const newTop = Math.max(0, Math.min(scrollExtent.height, y));
        const newLeft = Math.max(0, Math.min(scrollExtent.width, x));

        const movedY = newTop !== this.#scrollTop;
        const movedX = newLeft !== this.#scrollLeft;

        if (!movedX && !movedY) {
            return { handled: false };
        }

        this.#scrollTop = newTop;
        this.#scrollLeft = newLeft;
        this.scrollActivityUntil = Date.now() + SCROLLBAR_ACTIVE_MS;
        this.markRenderDirty();

        if (this.#scrollFadeTimer) {
            clearTimeout(this.#scrollFadeTimer);
        }

        this.#scrollFadeTimer = setTimeout(() => {
            this.#scrollFadeTimer = null;
            this.markRenderDirty();
            this.treeContext?.requestRedraw();
        }, SCROLLBAR_ACTIVE_MS + 50);

        return { handled: true };
    }

    public dispatchWheel(deltaX: number, deltaY: number): { handled: boolean } {
        if (this.overflowMode !== "scroll") {
            return { handled: false };
        }

        return this.scrollTo(this.#scrollLeft + deltaX, this.#scrollTop + deltaY);
    }

    public probe(position: Point) {
        const results: TerminalNode[] = [];

        let childPos = position;
        if (this.overflowMode !== "visible") {
            const contentArea = this.computedPosition.contentArea;
            const border = this.computedPosition.border;
            const padding = this.computedPosition.padding;
            const localContentX = border.left + padding.left;
            const localContentY = border.top + padding.top;

            if (
                position.x < localContentX ||
                position.x >= localContentX + contentArea.width ||
                position.y < localContentY ||
                position.y >= localContentY + contentArea.height
            ) {
                return results;
            }

            childPos = {
                x: position.x + this.#scrollLeft,
                y: position.y + this.#scrollTop,
            };
        }

        for (const child of this.children) {
            const childPosition = child.computedPosition.position;

            if (
                childPos.x >= childPosition.x &&
                childPos.x < childPosition.x + childPosition.width &&
                childPos.y >= childPosition.y &&
                childPos.y < childPosition.y + childPosition.height
            ) {
                const offsetPosition = {
                    x: childPos.x - childPosition.x,
                    y: childPos.y - childPosition.y,
                };

                results.push(child, ...child.probe(offsetPosition));
            }
        }

        return results;
    }

    public layout(options?: { force?: boolean }) {
        assert(
            this.allocateYoga().getChildCount() === this.children.length,
            `Yoga node child count mismatch (${this.allocateYoga().getChildCount()} != ${this.children.length})`,
        );

        if (this.#layoutDirty || options?.force) {
            const node = this.allocateYoga();
            const computed = this.computedStyles;
            if (computed !== this.#lastAppliedStyles || options?.force) {
                applyStyles(node, computed);
                this.#lastAppliedStyles = computed;
            }

            this.#layoutDirty = false;
        }

        this.recomputeLayout();

        for (const child of this.children) {
            child.layout(options);
        }
    }

    public pushStyles(parentStyles: Styles.LocalStyleData, parentContext: Selector.ParentContext): void {
        this.rawParentStyles = parentStyles;
        this.parentContext = parentContext;
        this.recomputeStyles();
    }

    public recomputeStyles(): void {
        this.#recomputeTimer = null;

        if (!this.rawParentStyles || !this.parentContext) {
            return;
        }

        const inputsUnchanged =
            !this.#stylesDirty &&
            this.rawParentStyles === this.#lastParentStyles &&
            this.parentContext.index === this.#lastParentContextIndex &&
            this.parentContext.outOf === this.#lastParentContextOutOf;

        if (!inputsUnchanged) {
            let parentStyles = this.rawParentStyles;
            if (this.rawStylesheet !== null) {
                parentStyles = {
                    style: parentStyles.style,
                    styleMap: mergeStyles(parentStyles.styleMap, this.rawStylesheet),
                };
            }

            this.localStyles = propagateStyles(
                parentStyles,
                this.selector,
                {
                    ...this.parentContext,
                    hasChildren: this.children.length !== 0,
                    states: [...this.states],
                },
                {
                    overrides: this.style as any as Styles.Style,
                },
            );

            this.#stylesDirty = false;
            this.#lastParentStyles = this.rawParentStyles;
            this.#lastParentContextIndex = this.parentContext.index;
            this.#lastParentContextOutOf = this.parentContext.outOf;
            this.#layoutDirty = true;
            this.#renderDirty = true;
        }

        for (let i = 0; i < this.children.length; i++) {
            this.children[i].pushStyles(this.localStyles!, { index: i, outOf: this.children.length });
        }
    }

    // Emulating HTML properties

    public focus() {
        this.treeContext?.claim(this);
    }

    public blur() {
        this.treeContext?.blur(this);
    }

    public set scrollTop(value: number) {
        this.scrollTo(this.#scrollLeft, value);
    }

    public get scrollTop(): number {
        return this.#scrollTop;
    }

    public set scrollLeft(value: number) {
        this.scrollTo(value, this.#scrollTop);
    }

    public get scrollLeft(): number {
        return this.#scrollLeft;
    }

    public get scrollHeight(): number {
        return this.computedPosition.scrollExtent.height;
    }

    public get scrollWidth(): number {
        return this.computedPosition.scrollExtent.width;
    }

    // Implemented by inheriting classes

    public render(): RleMatrix {
        const bounds = this.computedPosition.position;
        return new RleMatrix(bounds.width, bounds.height);
    }

    public getCursorOffset(): Point | null {
        return null;
    }
}

const wrapWords = (text: string, width: number | null): string[] => {
    if (text.length === 0) {
        return [];
    }

    if (width === null) {
        return text.split(/\n/g);
    }

    const lines: string[] = [];

    for (const baseLine of text.split(/\n+/g)) {
        let line = "";

        for (const token of baseLine.split(/(\s+)/)) {
            if (token.length === 0) {
                continue;
            }

            if (line.length + token.length <= width) {
                line += token;
                continue;
            }

            if (line.length > 0) {
                lines.push(line);
                line = "";
            }

            if (/^\s+$/.test(token)) {
                continue;
            }

            if (token.length > width) {
                let rest = token;
                while (rest.length > width) {
                    lines.push(rest.slice(0, width));
                    rest = rest.slice(width);
                }

                line = rest;
            } else {
                line = token;
            }
        }

        if (line.length > 0) {
            lines.push(line);
        }
    }

    return lines;
};

export class TerminalText extends YogaBase implements Drawable {
    public kind = "text" as const;

    public nextSibling: TerminalNode | null = null;
    public parent: TerminalContent | null = null;
    public treeContext: TreeContext | null = null;

    protected parentStyles: Styles.LocalStyleData | null = null;

    #textContent: string | null;
    #renderDirty: boolean = true;
    #layoutDirty: boolean = true;
    #cachedMatrix: RleMatrix | null = null;

    public get textContent(): string | null {
        return this.#textContent;
    }

    public set textContent(value: string | null) {
        if (value === this.#textContent) {
            return;
        }

        this.#textContent = value;
        this.#markDirty();
    }

    #markDirty() {
        this.#renderDirty = true;
        this.#layoutDirty = true;
        this.parent?.markRenderDirty();
    }

    constructor(textContent: string) {
        super();
        this.#textContent = textContent;

        this.measureFunc = (width, widthMode) => {
            const text = this.#textContent ?? "";
            const natural = text.length;

            if (natural === 0) {
                return { width: 0, height: 0 };
            }

            if (widthMode === MeasureMode.Undefined) {
                const lines = wrapWords(text, null);
                const maxWidth = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
                const maxHeight = Math.max(1, lines.length);
                return { width: maxWidth, height: maxHeight };
            }

            const wrapWidth = Math.max(1, Math.floor(width));
            const lines = wrapWords(text, wrapWidth);
            const maxWidth = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
            const maxHeight = Math.max(1, lines.length);
            return { width: maxWidth, height: maxHeight };
        };
    }

    public onAttach(ctx: TreeContext, parent: TerminalContent | null) {
        this.treeContext = ctx;
        this.parent = parent;
    }

    public onDetach() {
        this.treeContext = null;
        this.parent = null;
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

        const color = this.parentStyles?.style?.color;
        const bgColor = this.parentStyles?.style?.backgroundColor;
        const matrix = new RleMatrix(bounds.width, bounds.height, undefined, { bgColor });
        const text = this.#textContent ?? "";

        if (text.length > 0) {
            const computedWidth = Math.max(1, Math.floor(bounds.width));
            const lines = wrapWords(text, computedWidth);

            for (let i = 0; i < lines.length; i++) {
                matrix.setAscii({ x: 0, y: i }, lines[i], { color, bgColor });
            }
        }

        this.#cachedMatrix = matrix;
        this.#renderDirty = false;
        return matrix;
    }

    public dispatchEvent(_eventName: string) {
        // not implemented
        return { handled: false };
    }

    public probe(_position: Point): TerminalNode[] {
        return [];
    }

    public layout(): void {
        if (this.#layoutDirty) {
            const yogaNode = this.allocateYoga();
            yogaNode.markDirty();

            this.#layoutDirty = false;
        }

        this.recomputeLayout();
    }

    public pushStyles(styles: Styles.LocalStyleData) {
        if (this.parentStyles !== styles) {
            this.parentStyles = styles;
            this.#markDirty();
        }
    }
}

export type TerminalNode = TerminalContent | TerminalText;
