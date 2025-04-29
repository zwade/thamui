import { Direction } from "./utils.js";
import { GridMap, CellItem, AsSerialized as MapAsSerialized } from "./map.js";
import * as rl from "node:readline/promises";
import * as rlSync from "node:readline";
import { RenderBuffer } from "./render-buffer.js";

type Writeable = { write: (data: string) => void };
type Readable = {
    on(e: "data", cb: (buffer: Buffer) => void): void
    off(e: "data", cb: (buffer: Buffer) => void): void
};

export interface GameManagerOptions {
    stdout?: Writeable;
    stdin?: Readable;
}

export class GameManager {
    private renderBuffer;
    private map;
    private eventStack: MapAsSerialized[] = [];
    private stdout: Writeable;
    private stdin: Readable;

    constructor(width: number, height: number, items: CellItem[] = [], options: GameManagerOptions = {}) {
        this.stdout = options.stdout ?? process.stdout;
        this.stdin = options.stdin ?? process.stdin;

        this.renderBuffer = new RenderBuffer("Test Puzzle", width * 5 * 3, height * 5, this.stdout);
        this.map = new GridMap(width, height, items, this.renderBuffer);
    }

    private async singleLoop(isFirst?: boolean): Promise<boolean> {
        this.map.renderAll({ resetScreen: !isFirst });

        return await this.singleAction();
    }

    private async performMoveAction(direction: Direction): Promise<boolean> {
        this.eventStack.push(this.map.toSerialized());

        const continuations: (() => void)[] = [];
        for (const player of this.map.getPlayers()) {
            const pushResult = player.push(direction, this.map);
            if (pushResult.kind === "invalid") {
                this.log("Can't push block")
                return true;
            }

            continuations.push(pushResult.commit);
        }

        for (const cont of continuations) {
            cont();
        }

        for (const entity of this.map.mapIter) {
            const action = entity.value.postUpdate(this.map);
            if (action) {
                switch (action.kind) {
                    case "win": {
                        this.log("You won!!!!")
                        this.map.renderAll({ resetScreen: true });
                        return false;
                    }
                }
            }
        }

        return true;
    }

    private async singleAction(): Promise<boolean> {
        while (true) {
            const sequence = await new Promise<string>((resolve) => {
                const callback = (data: Buffer) => {
                    this.stdin.off("data", callback);
                    resolve(data.toString("latin1"));

                }

                this.stdin.on("data", callback);
            })

            switch (sequence) {
                case "\x1b\x5b\x41": {
                    return this.performMoveAction("top");
                }

                case "\x1b\x5b\x42": {
                    return this.performMoveAction("bottom");
                }

                case "\x1b\x5b\x43": {
                    return this.performMoveAction("right");
                }

                case "\x1b\x5b\x44": {
                    return this.performMoveAction("left");
                }

                case "\x7f": {
                    const restoredState = this.eventStack.pop();
                    if (restoredState) {
                        this.map = GridMap.fromSerialized(restoredState, this.renderBuffer);
                        this.map.renderAll({ resetScreen: true });
                    } else {
                        this.log("Nothing to undo!");
                    }

                    continue;
                }

                case "\x1b":
                case "\x03":
                case "\x1c": {
                    return false;
                }

                default: {

                    this.log("Invalid option. Arrow Keys - move, Backspace - undo, Ctrl+C - exit");
                    continue;
                }
            }
        }
    }

    public async runGame() {
        let isFirst = true;
        while (true) {
            const shouldContinue = await this.singleLoop(isFirst);
            isFirst = false;

            if (!shouldContinue) {
                break;
            }
        }
    }

    public async log(message: string) {
        this.renderBuffer.setConsole(message);
        this.map.renderAll({ resetScreen: true });
    }
}