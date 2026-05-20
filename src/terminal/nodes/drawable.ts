import Yoga, { Edge, MeasureFunction, Node as YogaNode } from "yoga-layout";

import { Selector } from "../../styles/selector.js";
import { Styles } from "../../styles/styles-runtime.js";
import { RleMatrix } from "../rle-buffer.js";
import { Box, FourSize, Point } from "../utils.js";
import type { TerminalNode } from "./terminal-content.js";

/**
 * The contract for anything the layout/paint pipeline treats as a renderable
 * unit. Implemented by `TerminalContent` (element nodes) and `InlineRun`
 * (a collapsed sequence of adjacent text). Notably *not* implemented by
 * `TerminalText`, which is a pure DOM node and is painted by its owning run.
 */
export interface Drawable {
    layout(options?: { force?: boolean }): void;
    render(): RleMatrix;
    pushStyles(styleData: Styles.LocalStyleData, parentContext: Selector.ParentContext): void;

    probe(position: Point): TerminalNode[];
    dispatchEvent(eventName: string): {
        handled: boolean;
    };
}

export interface ComputedPosition {
    position: Box;
    border: FourSize;
    margin: FourSize;
    padding: FourSize;
    contentArea: Box;
    scrollExtent: Box;
}

/**
 * Owns a single `yoga-layout` node and the cached geometry derived from it.
 * Both element nodes and inline runs extend this so the parent can lay them
 * out and position them uniformly.
 */
export class YogaBase {
    #yogaNode: YogaNode | null = null;
    #computedPosition: ComputedPosition | null = null;
    #measureFunc?: MeasureFunction;

    protected set measureFunc(func: MeasureFunction) {
        this.#measureFunc = func;

        if (this.#yogaNode) {
            this.#yogaNode.setMeasureFunc(func);
        }
    }

    /**
     * The children that participate in this node's Yoga layout. Overridden by
     * `TerminalContent` to return its cached drawable children; leaf nodes
     * (such as `InlineRun`) keep the empty default.
     */
    protected get layoutChildren(): readonly YogaBase[] {
        return [];
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
        for (const child of this.layoutChildren) {
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
