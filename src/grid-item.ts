import { GridMap } from "./map.js";
import { RenderBuffer } from "./render-buffer.js";
import { Point, pointInDirection, Direction } from "./utils.js";

export type PushContinuation =
    | { kind: "invalid" }
    | { kind: "valid", commit: () => void }

export type ControlAction =
    | undefined // do nothing
    | { kind: "win" }

export abstract class GridItem {
    public abstract power: number;

    public point: Point;
    #id!: string;

    constructor(point: Point) {
        this.point = point;
    }

    public set id(id: string) {
        if (this.#id) {
            console.warn("Cannot overwrite an entity's id");
            return;
        }

        this.#id = id;
    }

    public get id() {
        return this.#id;
    }

    public get x() {
        return this.point.x;
    }

    public get y() {
        return this.point.y;
    }

    public _mapOnlySetPosition(point: Point) {
        this.point = point;
    }

    public push(direction: Direction, map: GridMap): PushContinuation {
        const nextPoint = pointInDirection({ x: this.x, y: this.y }, direction);
        const cell = map.lookup(nextPoint);

        if (!cell) {
            return { kind: "invalid" };
        }

        const continuations: (() => void)[] = [];
        for (const element of cell.stack) {
            const res = element.value.push(direction, map);
            if (res.kind === "invalid") {
                return { kind: "invalid" }
            }

            continuations.push(res.commit);
        }

        return {
            kind: "valid",
            commit: () => {
                for (const cont of continuations) {
                    cont();
                }

                map.move(this.id, nextPoint);
            }
        }
    }

    public abstract render(buffer: RenderBuffer, map: GridMap): void;

    public preUpdate(map: GridMap): ControlAction { return undefined; };
    public postUpdate(map: GridMap): ControlAction { return undefined; };
}