import { EffectualElement, expand, ExpansionEntry, F, reconcile, ReconciliationChild, RootHydrate } from "effectual";
import { Direction } from "yoga-layout";

import { ParsedStyle } from "../styles/styles.js";
import { loadStyles } from "../styles/styles-runtime.js";
import { Block } from "../terminal/builtin-nodes.js";
import { RleMatrix } from "../terminal/rle-buffer.js";
import { TerminalNode } from "../terminal/terminal-nodes.js";
import { TerminalTarget } from "../terminal/terminal-target.js";
import { Point } from "../terminal/utils.js";

import userAgentString from "../../styles/user-agent-styles.scss";

const userAgent = JSON.parse(userAgentString) as ParsedStyle[];

const refreshRate = 1_000 / 16; // 16 fps

type DebugMode = false | "static" | "loop";
const debugMode = false as DebugMode;

const buildReconciliationLoop = async (App: () => EffectualElement) => {
    const rootElement = new Block("root");

    const root = {
        kind: "root",
        node: rootElement,
    } satisfies RootHydrate;

    const target = new TerminalTarget();

    let lastPass: ExpansionEntry | undefined = undefined;
    let lastReconciliation: ReconciliationChild[] | undefined = undefined;
    let hadMouseEntry = new Set<TerminalNode>();

    const yOffset = debugMode ? 10 : 0;
    let terminalSize: Point = { x: process.stdout.columns, y: process.stdout.rows - yOffset };
    let forceReflow = false;

    !debugMode && process.stdout.write("\x1b[2J\x1b[1;1H\x1b[?1003h");
    debugMode === "loop" && process.stdout.write("\x1b[?1003h");

    process.stdin.setRawMode(true);
    process.stdin.on("data", (sequence) => {
        switch (sequence.toString()) {
            case "\x1b":
            case "\x03":
            case "\x1c": {
                process.stdout.write("\x1b[?1000l");
                process.exit(0);
                break;
            }
            default: {
                if (sequence.subarray(0, 3).equals(Buffer.from([0x1b, 0x5b, 0x4d]))) {
                    const event =
                        sequence[3] === 0x43
                            ? "mousemove"
                            : sequence[3] === 0x20
                              ? "mousedown"
                              : sequence[3] === 0x23
                                ? "mouseup"
                                : "unknown";

                    const xPos = sequence[4] - 0x21;
                    const yPos = sequence[5] - 0x21 - yOffset;

                    const targets = rootElement.probe({ x: xPos, y: yPos });

                    for (const target of targets.reverse()) {
                        const { handled } = target.dispatchEvent(event);
                        if (handled) {
                            break;
                        }
                    }

                    if (event === "mousemove") {
                        const newMoveTargets = new Set<TerminalNode>(targets);
                        for (const target of hadMouseEntry) {
                            if (!newMoveTargets.has(target)) {
                                target.dispatchEvent("mouseleave");
                            }
                        }

                        for (const target of newMoveTargets) {
                            if (!hadMouseEntry.has(target)) {
                                target.dispatchEvent("mouseenter");
                            }
                        }

                        hadMouseEntry = newMoveTargets;
                    }

                    forceReflow = true;
                }
            }
        }
    });

    process.stdout.on("resize", () => {
        terminalSize = { x: process.stdout.columns, y: process.stdout.rows };
        forceReflow = true;
    });

    const reReconcile = () => {
        if (!forceReflow && lastPass && !globalThis.__effectual__.isDirty) {
            return;
        }

        const nextPass = expand(<App />, lastPass);
        const nextReconciliation = reconcile(nextPass, root, target, lastReconciliation);

        lastPass = nextPass;
        lastReconciliation = nextReconciliation;

        debugMode || process.stdout.write("\x1b[1;1H\x1b[?1003h");

        rootElement.pushStyles({ style: {}, styleMap: loadStyles(userAgent) }, { index: 0, outOf: 1 });
        rootElement.layout({ force: true });
        const yogaRoot = rootElement.allocateYoga();
        yogaRoot.calculateLayout(terminalSize.x, terminalSize.y, Direction.LTR);

        const mat = new RleMatrix(terminalSize.x, terminalSize.y);
        rootElement.render(mat, { x: 0, y: 0 });

        for (let i = 0; i < mat.height; i++) {
            process.stdout.write(mat.getRow(i).toString());

            if (i < mat.height - 1) {
                process.stdout.write("\r\n");
            }
        }

        forceReflow = false;
    };

    if (debugMode === "static") {
        reReconcile();
    } else {
        setInterval(() => reReconcile(), refreshRate);
    }
};

export const mount = (App: () => EffectualElement) => {
    process.on("uncaughtException", (err) => {
        debugMode || process.stdout.write("\x1b[?1000l");

        console.error(err);
        process.exit(1);
    });

    buildReconciliationLoop(App);
};
