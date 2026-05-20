import type { TreeContext } from "../tree-context.js";
import type { InlineRun } from "./inline-run.js";
import type { TerminalContent, TerminalNode } from "./terminal-content.js";

/**
 * A text DOM node. Unlike `TerminalContent`, this is *not* a renderable entity:
 * it owns no Yoga node and never paints itself. It is purely a carrier of
 * character data within the DOM tree. Layout and paint are handled by the
 * `InlineRun` that the parent groups it into — see `InlineRun` and
 * `TerminalContent.rebuildDrawableChildren`.
 */
export class TerminalText {
    public kind = "text" as const;

    public nextSibling: TerminalNode | null = null;
    public parent: TerminalContent | null = null;
    public treeContext: TreeContext | null = null;

    /**
     * The inline run that currently lays out and paints this node. Assigned by
     * the parent `TerminalContent` every time it rebuilds its drawable
     * children, and cleared on detach.
     */
    public owner: InlineRun | null = null;

    #textContent: string | null;

    public constructor(textContent: string) {
        this.#textContent = textContent;
    }

    public get textContent(): string | null {
        return this.#textContent;
    }

    public set textContent(value: string | null) {
        if (value === this.#textContent) {
            return;
        }

        this.#textContent = value;

        // The run owns measurement and paint; tell it the collapsed text
        // changed so it re-measures and repaints.
        this.owner?.invalidate();
    }

    public onAttach(ctx: TreeContext, parent: TerminalContent | null) {
        this.treeContext = ctx;
        this.parent = parent;
    }

    public onDetach() {
        this.treeContext = null;
        this.parent = null;
        this.owner = null;
    }
}
