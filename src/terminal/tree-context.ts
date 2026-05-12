import type { TerminalContent, TerminalNode } from "./terminal-nodes.js";

export interface KeyEvent {
    key: string;
    ctrl: boolean;
    alt: boolean;
    raw: Buffer;
}

export type MouseEventName = "mousemove" | "mousedown" | "mouseup";

const isMouseSequence = (s: Buffer) => s.length >= 6 && s[0] === 0x1b && s[1] === 0x5b && s[2] === 0x4d;

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

    public dispatchTerminalSequence(sequence: Buffer): { handled: boolean; dirty: boolean } {
        if (isMouseSequence(sequence)) {
            return this.dispatchMouseSequence(sequence);
        }

        const event = decodeKeyEvent(sequence);
        if (event) {
            return this.dispatchKeyEvent(event);
        }

        return { handled: false, dirty: false };
    }

    private dispatchKeyEvent(event: KeyEvent): { handled: boolean; dirty: boolean } {
        let target: TerminalContent | null = this.focused ?? this.root;

        while (target) {
            const { handled } = target.dispatchKeyEvent(event);
            if (handled) {
                return { handled: true, dirty: true };
            }

            target = target.parent;
        }

        return { handled: false, dirty: false };
    }

    private dispatchMouseSequence(sequence: Buffer): { handled: boolean; dirty: boolean } {
        const eventName = decodeMouseEventName(sequence[3]);
        if (!eventName) {
            return { handled: false, dirty: false };
        }

        const xPos = sequence[4] - 0x21;
        const yPos = sequence[5] - 0x21 - this.offsetY;

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
