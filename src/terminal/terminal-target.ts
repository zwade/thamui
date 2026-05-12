import { HydrationTarget } from "effectual";

import { Block, Button } from "./builtin-nodes.js";
import { TerminalText } from "./terminal-nodes.js";

export class TerminalTarget implements HydrationTarget {
    createElement(tag: string) {
        switch (tag) {
            case "div": {
                return new Block(tag);
            }
            case "button": {
                return new Button();
            }
            default: {
                return new Block(tag);
            }
        }
    }

    createTextNode(value: string) {
        return new TerminalText(value);
    }
}
