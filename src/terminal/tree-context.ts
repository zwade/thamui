import type { TerminalContent, TerminalNode } from "./terminal-nodes.js";

export interface KeyEvent {
    key: string;
    ctrl: boolean;
    alt: boolean;
    raw: Buffer;
    text?: string;
}

export type MouseEventName = "mousemove" | "mousedown" | "mouseup";

const PASTE_START = Buffer.from("\x1b[200~");
const PASTE_END = Buffer.from("\x1b[201~");

const isAnsiMouseSequence = (s: Buffer) => s.length >= 6 && s[0] === 0x1b && s[1] === 0x5b && s[2] === 0x4d;
const isSgrMouseSequence = (s: Buffer) => s.length >= 4 && s[0] === 0x1b && s[1] === 0x5b && s[2] === 0x3c;

const decodeMouseEventName = (byte: number): MouseEventName | null => {
    switch (byte) {
        case 0x43:
            return "mousemove";
        case 0x20:
            return "mousedown";
        case 0x23:
            return "mouseup";
        default:
            return null;
    }
};

export const decodeKeyEvent = (raw: Buffer): KeyEvent | null => {
    if (raw.length === 0) {
        return null;
    }

    if (raw.length > 1 && raw[0] === 0x1b) {
        if (raw[1] === 0x5b && raw.length >= 3) {
            const final = raw[raw.length - 1];
            const named: Record<number, string> = {
                0x41: "ArrowUp",
                0x42: "ArrowDown",
                0x43: "ArrowRight",
                0x44: "ArrowLeft",
                0x48: "Home",
                0x46: "End",
                0x5a: "Shift+Tab",
            };

            const key = named[final];
            if (key) {
                return { key, ctrl: false, alt: false, raw };
            }

            return null;
        }

        const inner = decodeKeyEvent(raw.subarray(1));
        if (inner) {
            return { ...inner, alt: true, raw };
        }

        return null;
    }

    if (raw.length === 1) {
        const b = raw[0];

        if (b === 0x09) return { key: "Tab", ctrl: false, alt: false, raw };
        if (b === 0x0d || b === 0x0a) return { key: "Enter", ctrl: false, alt: false, raw };
        if (b === 0x1b) return { key: "Escape", ctrl: false, alt: false, raw };
        if (b === 0x7f) return { key: "Backspace", ctrl: false, alt: false, raw };

        if (b >= 0x01 && b <= 0x1a) {
            return { key: String.fromCharCode(b + 0x60), ctrl: true, alt: false, raw };
        }

        if (b >= 0x20 && b <= 0x7e) {
            return { key: String.fromCharCode(b), ctrl: false, alt: false, raw };
        }
    }

    return null;
};

export class TreeContext {
    public focused: TerminalContent | null = null;
    public root: TerminalContent;
    public offsetY: number = 0;

    #hadMouseEntry: Set<TerminalNode> = new Set();
    #pasteBuffer: Buffer[] | null = null;

    public constructor(root: TerminalContent) {
        this.root = root;
    }

    public claim(node: TerminalContent) {
        if (this.focused === node) {
            return;
        }

        if (this.focused) {
            this.focused.setFocused(false);
        }

        this.focused = node;
        node.setFocused(true);
    }

    public blur(node: TerminalContent) {
        if (this.focused === node) {
            this.focused = null;
        }
    }

    public focusNext(reverse: boolean = false): boolean {
        const selectable: TerminalContent[] = [];
        this.#collectSelectable(this.root, selectable);

        if (selectable.length === 0) {
            return false;
        }

        const currentIdx = this.focused ? selectable.indexOf(this.focused) : -1;
        const nextIdx = reverse
            ? currentIdx <= 0
                ? selectable.length - 1
                : currentIdx - 1
            : (currentIdx + 1) % selectable.length;

        this.claim(selectable[nextIdx]);
        return true;
    }

    public dispatchTerminalSequence(sequence: Buffer): { handled: boolean; dirty: boolean } {
        if (this.#pasteBuffer !== null) {
            return this.#continuePaste(sequence);
        }

        const pasteStart = sequence.indexOf(PASTE_START);
        if (pasteStart !== -1) {
            return this.#beginPaste(sequence, pasteStart);
        }

        if (isSgrMouseSequence(sequence)) {
            return this.#dispatchSgrMouseSequence(sequence);
        }

        if (isAnsiMouseSequence(sequence)) {
            return this.#dispatchAnsiMouseSequence(sequence);
        }

        const event = decodeKeyEvent(sequence);
        if (event) {
            return this.#dispatchKeyEvent(event);
        }

        return { handled: false, dirty: false };
    }

    #collectSelectable(node: TerminalNode, out: TerminalContent[]) {
        if (!("children" in node)) {
            return;
        }

        if (node.isSelectable) {
            out.push(node);
        }

        for (const child of node.children) {
            this.#collectSelectable(child, out);
        }
    }

    #beginPaste(sequence: Buffer, pasteStart: number): { handled: boolean; dirty: boolean } {
        let dirty = false;
        let handled = false;

        if (pasteStart > 0) {
            const pre = this.dispatchTerminalSequence(sequence.subarray(0, pasteStart));
            handled = handled || pre.handled;
            dirty = dirty || pre.dirty;
        }

        this.#pasteBuffer = [];
        const afterStart = sequence.subarray(pasteStart + PASTE_START.length);
        const tail = this.#continuePaste(afterStart);

        return { handled: handled || tail.handled, dirty: dirty || tail.dirty };
    }

    #continuePaste(sequence: Buffer): { handled: boolean; dirty: boolean } {
        const endIdx = sequence.indexOf(PASTE_END);

        if (endIdx === -1) {
            this.#pasteBuffer!.push(sequence);
            return { handled: true, dirty: false };
        }

        this.#pasteBuffer!.push(sequence.subarray(0, endIdx));
        const text = Buffer.concat(this.#pasteBuffer!).toString("utf8");
        this.#pasteBuffer = null;

        const event: KeyEvent = {
            key: "Paste",
            ctrl: false,
            alt: false,
            raw: Buffer.from(text),
            text,
        };
        const pasted = this.#dispatchKeyEvent(event);

        const remainder = sequence.subarray(endIdx + PASTE_END.length);
        if (remainder.length === 0) {
            return pasted;
        }

        const tail = this.dispatchTerminalSequence(remainder);
        return { handled: pasted.handled || tail.handled, dirty: pasted.dirty || tail.dirty };
    }

    #dispatchKeyEvent(event: KeyEvent): { handled: boolean; dirty: boolean } {
        let target: TerminalContent | null = this.focused ?? this.root;

        while (target) {
            const { handled } = target.dispatchKeyEvent(event);
            if (handled) {
                return { handled: true, dirty: true };
            }

            target = target.parent;
        }

        if (event.key === "Tab" && !event.ctrl && !event.alt) {
            return { handled: this.focusNext(false), dirty: true };
        }

        if (event.key === "Shift+Tab" && !event.ctrl && !event.alt) {
            return { handled: this.focusNext(true), dirty: true };
        }

        return { handled: false, dirty: false };
    }

    #dispatchAnsiMouseSequence(sequence: Buffer): { handled: boolean; dirty: boolean } {
        const eventName = decodeMouseEventName(sequence[3]);
        if (!eventName) {
            return { handled: false, dirty: false };
        }

        const xPos = sequence[4] - 0x21;
        const yPos = sequence[5] - 0x21 - this.offsetY;
        return this.#dispatchMouseAt(eventName, xPos, yPos);
    }

    #dispatchSgrMouseSequence(sequence: Buffer): { handled: boolean; dirty: boolean } {
        let endIdx = -1;
        for (let i = 3; i < sequence.length; i++) {
            if (sequence[i] === 0x4d || sequence[i] === 0x6d) {
                endIdx = i;
                break;
            }
        }

        if (endIdx === -1) {
            return { handled: false, dirty: false };
        }

        const final = sequence[endIdx];
        const parts = sequence.subarray(3, endIdx).toString("ascii").split(";");
        if (parts.length !== 3) {
            return { handled: false, dirty: false };
        }

        const button = parseInt(parts[0], 10);
        const xPos = parseInt(parts[1], 10) - 1;
        const yPos = parseInt(parts[2], 10) - 1 - this.offsetY;

        if (Number.isNaN(button) || Number.isNaN(xPos) || Number.isNaN(yPos)) {
            return { handled: false, dirty: false };
        }

        let eventName: MouseEventName;
        if (final === 0x6d) {
            eventName = "mouseup";
        } else if (button >= 32) {
            eventName = "mousemove";
        } else {
            eventName = "mousedown";
        }

        return this.#dispatchMouseAt(eventName, xPos, yPos);
    }

    #dispatchMouseAt(eventName: MouseEventName, xPos: number, yPos: number): { handled: boolean; dirty: boolean } {
        const targets = this.root.probe({ x: xPos, y: yPos });

        let handled = false;
        for (const target of [...targets].reverse()) {
            const result = target.dispatchEvent(eventName);
            if (result.handled) {
                handled = true;
                break;
            }
        }

        if (eventName === "mousemove") {
            const newMoveTargets = new Set<TerminalNode>(targets);
            for (const target of this.#hadMouseEntry) {
                if (!newMoveTargets.has(target)) {
                    target.dispatchEvent("mouseleave");
                }
            }

            for (const target of newMoveTargets) {
                if (!this.#hadMouseEntry.has(target)) {
                    target.dispatchEvent("mouseenter");
                }
            }

            this.#hadMouseEntry = newMoveTargets;
        }

        return { handled, dirty: true };
    }
}
