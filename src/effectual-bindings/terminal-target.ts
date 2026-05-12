import { HydrationTarget } from "effectual";

import { Block, Button } from "../terminal/builtin-nodes.js";
import { TerminalNode, TerminalText } from "../terminal/terminal-nodes.js";
import { TextArea } from "../terminal/text-area.js";
import { TextInput } from "../terminal/text-input.js";

export class TerminalTarget implements HydrationTarget<TerminalNode> {
    createElement(tag: string) {
        switch (tag) {
            case "div": {
                return new Block(tag);
            }
            case "button": {
                return new Button();
            }
            case "input": {
                return new TextInput();
            }
            case "textarea": {
                return new TextArea();
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
