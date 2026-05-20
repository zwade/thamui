import { assert } from "console";

import { Selector } from "../../styles/selector.js";
import { applyStyles } from "../../styles/style-parsers.js";
import { ParsedStyle } from "../../styles/styles.js";
import { mergeStyles, propagateStyles, Styles } from "../../styles/styles-runtime.js";
import { RleMatrix } from "../rle-buffer.js";
import { KeyEvent, TreeContext } from "../tree-context.js";
import { Point } from "../utils.js";
import { Drawable, YogaBase } from "./drawable.js";
import { InlineRun } from "./inline-run.js";
import type { TerminalText } from "./terminal-text.js";

/** The two kinds of DOM node: element nodes and text nodes. */
export type TerminalNode = TerminalContent | TerminalText;

/** A drawable child of a `TerminalContent`: either an element or a collapsed text run. */
export type DrawableChild = TerminalContent | InlineRun;

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

export type OverflowMode = "visible" | "hidden" | "scroll";

export const SCROLLBAR_ACTIVE_MS = 700;

export class TerminalContent extends YogaBase implements Drawable {
    public kind = "terminal" as const;

    public tagName: string;
    public style: StyleMap;

    /** The DOM children, exactly as the reconciler arranged them. */
    public children: TerminalNode[] = [];
    public nextSibling: TerminalNode | null = null;
    public parent: TerminalContent | null = null;
    public treeContext: TreeContext | null = null;
    public isSelectable: boolean = false;

    /**
     * Set when this element is `display: inline`: it is then laid out and
     * painted by an ancestor's `InlineRun` rather than by a box of its own.
     * The pointer lets style/state changes invalidate that run.
     */
    public inlineOwner: InlineRun | null = null;

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

    // The layout view of `children`: adjacent text nodes are collapsed into
    // `InlineRun`s, element nodes pass through. Rebuilt lazily whenever the DOM
    // children change.
    #drawableChildren: DrawableChild[] = [];
    #drawableChildrenDirty: boolean = true;
    #lastDisplayMode: "block" | "inline" | undefined = undefined;

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

    /**
     * `block` (the default) or `inline`. An inline element joins an ancestor's
     * inline run instead of producing its own layout box.
     */
    public get displayMode(): "block" | "inline" {
        return this.computedStyles["display"] === "inline" ? "inline" : "block";
    }

    /**
     * The drawable children, rebuilt on demand if the DOM children changed
     * since the last access.
     */
    public get drawableChildren(): readonly DrawableChild[] {
        if (this.#drawableChildrenDirty) {
            this.rebuildDrawableChildren();
        }

        return this.#drawableChildren;
    }

    protected get layoutChildren(): readonly YogaBase[] {
        return this.drawableChildren;
    }

    // Protected methods

    protected markDirty() {
        this.#layoutDirty = true;
        this.#stylesDirty = true;
        this.markRenderDirty();

        // If we are an inline element, any mutation (children, attributes,
        // pseudo-state) changes what the owning run paints, so re-flatten it.
        this.inlineOwner?.invalidate();

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

    /**
     * Force `drawableChildren` to be regrouped on next access. Used when a
     * child's `display` changes, which can move it into or out of a run.
     */
    public markDrawableChildrenDirty(): void {
        this.#drawableChildrenDirty = true;
        this.markRenderDirty();
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

    /**
     * Recompute `#drawableChildren` from the current DOM children: maximal runs
     * of adjacent text nodes collapse into one `InlineRun`, element nodes pass
     * through unchanged. The owning Yoga node's children are re-synced to match.
     */
    private rebuildDrawableChildren(): void {
        this.#drawableChildrenDirty = false;

        const yoga = this.allocateYoga();

        // Detach the previous layout children. Element children keep their Yoga
        // nodes and are re-attached below; the old runs are discarded.
        while (yoga.getChildCount() > 0) {
            yoga.removeChild(yoga.getChild(0));
        }

        for (const previous of this.#drawableChildren) {
            if (previous.kind === "inline-run") {
                previous.detachOwners();
                previous.deallocateYoga();
            }
        }

        const next: DrawableChild[] = [];
        let pendingInline: TerminalNode[] = [];

        const flushRun = () => {
            if (pendingInline.length > 0) {
                next.push(new InlineRun(this, pendingInline));
                pendingInline = [];
            }
        };

        // Text nodes and `display: inline` elements are inline-level: maximal
        // adjacent runs of them collapse into one `InlineRun`. Block elements
        // break the run and stand on their own.
        for (const child of this.children) {
            const isInlineLevel = child.kind === "text" || child.displayMode === "inline";
            if (isInlineLevel) {
                pendingInline.push(child);
            } else {
                flushRun();
                next.push(child);
            }
        }
        flushRun();

        for (let i = 0; i < next.length; i++) {
            const childYoga = next[i].allocateYoga();

            // A moved element may still be parented to its old node; detach it
            // before adopting.
            const existingParent = childYoga.getParent();
            if (existingParent) {
                existingParent.removeChild(childYoga);
            }

            yoga.insertChild(childYoga, i);
        }

        this.#drawableChildren = next;
    }

    // Public methods

    public insertBefore(node: TerminalNode, before: TerminalNode | null) {
        const index = this.children.indexOf(before!);
        if (index !== -1) {
            node.nextSibling = before;
            this.children.splice(index, 0, node);
        } else {
            node.nextSibling = null;
            this.children.push(node);
        }

        this.#drawableChildrenDirty = true;
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
                result.onDetach();
            }
        }

        this.#drawableChildrenDirty = true;
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
        this.inlineOwner = null;
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

    public probe(position: Point): TerminalContent[] {
        // Yields only element nodes — block children directly, and the inline
        // elements an `InlineRun` reports under the point. Never a `TerminalText`.
        const results: TerminalContent[] = [];

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

        for (const child of this.drawableChildren) {
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

                if (child.kind === "inline-run") {
                    // The run maps the cell to the inline element chain (if any)
                    // covering it; the run itself is not an event target.
                    results.push(...child.probe(offsetPosition));
                } else {
                    results.push(child, ...child.probe(offsetPosition));
                }
            }
        }

        return results;
    }

    public layout(options?: { force?: boolean }) {
        const drawables = this.drawableChildren;

        assert(
            this.allocateYoga().getChildCount() === drawables.length,
            `Yoga node child count mismatch (${this.allocateYoga().getChildCount()} != ${drawables.length})`,
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

        for (const child of drawables) {
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

            // A change to our `display` can move us into or out of a sibling
            // run, so the parent must regroup its drawable children.
            const display = this.displayMode;
            if (display !== this.#lastDisplayMode) {
                this.#lastDisplayMode = display;
                this.parent?.markDrawableChildrenDirty();
            }

            // If we are an inline element, the run painting us must repaint
            // with the recomputed style.
            this.inlineOwner?.invalidate();
        }

        // Styles cascade down the DOM tree: every element child — block or
        // inline — recomputes against our scope. `:nth-child` indices are taken
        // over the DOM children so collapsing text into runs cannot perturb
        // selector matching.
        const outOf = this.children.length;
        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            child.pushStyles(this.localStyles!, { index: i, outOf });
        }

        // Hand our inherited style to our own inline runs. Inline elements are
        // skipped here — they flatten into an ancestor's run, not one of ours.
        if (this.displayMode === "block") {
            for (const drawable of this.drawableChildren) {
                if (drawable.kind === "inline-run") {
                    drawable.pushStyles(this.localStyles!);
                }
            }
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
