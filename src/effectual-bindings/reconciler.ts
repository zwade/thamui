import { EffectualElement, expand, ExpansionEntry, F, reconcile, ReconciliationChild, RootHydrate } from "effectual";
import { Readable, Writable } from "node:stream";
import { Direction } from "yoga-layout";

import { ParsedStyle } from "../styles/styles.js";
import { loadStyles } from "../styles/styles-runtime.js";
import { Block } from "../terminal/builtin-nodes.js";
import { generateProgressiveUpdates } from "../terminal/progressive-update.js";
import { RleMatrix } from "../terminal/rle-buffer.js";
import { TreeContext } from "../terminal/tree-context.js";
import { Point } from "../terminal/utils.js";
import { TerminalTarget } from "./terminal-target.js";

import userAgentString from "../../styles/user-agent-styles.scss";

const userAgent = JSON.parse(userAgentString) as ParsedStyle[];
const userAgentStyles = { style: {}, styleMap: loadStyles(userAgent) };
const rootContext = { index: 0, outOf: 1 };

const refreshRate = 1_000 / 16; // 16 fps

type DebugMode = false | "static" | "loop";
const debugMode = false as DebugMode;

export interface StdoutPtyLike {
    columns: number;
    rows: number;
    write: (data: string) => void;
    on: (event: "resize", listener: () => void) => void;
}

export interface StdinPtyLike {
    setRawMode: (mode: boolean) => void;
    on: (event: "data", listener: (data: Buffer) => void) => void;
}

export interface ReconciliationOptions {
    stdin?: StdinPtyLike;
    stdout?: StdoutPtyLike;
    stderr?: Writable;
}

const buildReconciliationLoop = (App: () => EffectualElement, options: ReconciliationOptions = {}): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        const stdin = options.stdin ?? process.stdin;
        const stdout = options.stdout ?? process.stdout;

        const rootElement = new Block("root");
        const treeContext = new TreeContext(rootElement);
        rootElement.onAttach(treeContext, null);

        const root = {
            kind: "root",
            node: rootElement,
        } satisfies RootHydrate;

        const target = new TerminalTarget();

        let lastPass: ExpansionEntry | undefined = undefined;
        let lastReconciliation: ReconciliationChild[] | undefined = undefined;
        let lastMatrix: RleMatrix | null = null;

        const yOffset = debugMode ? 10 : 0;
        treeContext.offsetY = yOffset;

        let terminalSize: Point = { x: stdout.columns, y: stdout.rows - yOffset };
        let forceReflow = false;
        let stopped = false;
        let intervalHandle: NodeJS.Timeout | null = null;

        !debugMode && stdout.write("\x1b[2J\x1b[1;1H\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25l");
        debugMode === "loop" && stdout.write("\x1b[?1003h\x1b[?1006h\x1b[?2004h");

        stdin.setRawMode(true);

        const cleanup = () => {
            if (stopped) return;
            stopped = true;

            if (intervalHandle) {
                clearInterval(intervalHandle);
                intervalHandle = null;
            }
        };

        stdin.on("data", (sequence) => {
            if (stopped) return;

            const asString = sequence.toString();
            if (asString === "\x1b" || asString === "\x03" || asString === "\x1c") {
                cleanup();
                resolve();
                return;
            }

            const { dirty } = treeContext.dispatchTerminalSequence(sequence);

            if (dirty) {
                forceReflow = true;
            }
        });

        stdout.on("resize", () => {
            if (stopped) return;

            terminalSize = { x: stdout.columns, y: stdout.rows };
            lastMatrix = null;
            forceReflow = true;
        });

        const reReconcile = () => {
            if (stopped) return;

            try {
                if (!forceReflow && lastPass && !globalThis.__effectual__.isDirty) {
                    return;
                }

                const nextPass = expand(F._jsx(App, {}), lastPass);
                const nextReconciliation = reconcile(nextPass, root, target, lastReconciliation);

                lastPass = nextPass;
                lastReconciliation = nextReconciliation;

                debugMode || stdout.write("\x1b[?1003h");

                rootElement.pushStyles(userAgentStyles, rootContext);
                rootElement.layout();
                const yogaRoot = rootElement.allocateYoga();
                yogaRoot.calculateLayout(terminalSize.x, terminalSize.y, Direction.LTR);

                const mat = new RleMatrix(terminalSize.x, terminalSize.y);
                rootElement.render(mat, { x: 0, y: 0 });

                const updates = generateProgressiveUpdates(lastMatrix, mat);
                if (updates.length > 0) {
                    stdout.write(updates);
                }

                lastMatrix = mat;
                forceReflow = false;
            } catch (err) {
                cleanup();
                reject(err);
            }
        };

        if (debugMode === "static") {
            reReconcile();
        } else {
            intervalHandle = setInterval(reReconcile, refreshRate);
        }
    });

export const mount = (App: () => EffectualElement, options: ReconciliationOptions = {}): Promise<void> => {
    const stdin = options.stdin ?? process.stdin;
    const stdout = options.stdout ?? process.stdout;

    const clear = () => {
        stdin.setRawMode(false);
        stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[2J\x1b[1;1H");
    };

    return buildReconciliationLoop(App, options).then(clear, clear);
};
