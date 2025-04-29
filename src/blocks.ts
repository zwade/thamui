import { GridItem, PushContinuation } from "./grid-item.js";
import { GridMap } from "./map.js";
import { RenderBuffer } from "./render-buffer.js";
import { RleMatrix } from "./rle-buffer.js";
import { Direction, numberToRune, Point, pointInDirection } from "./utils.js";

export type BlockKind =
    | "door"
    | "target"
    | `drain-${Direction}`

const kindToIcon: { [K in BlockKind]: string } = {
    door: "🚪",
    target: "🎯",
    "drain-bottom": "⬇️",
    "drain-left": "⬅️",
    "drain-right": "➡️",
    "drain-top": "⬆️",
}


export interface BlockOptions {
    power: number,
    target: number | null,
    movable: boolean,
    connectivity: number,
    point: Point,
}

export type AsSerialized = {
    kind: BlockKind,
    power: number,
    target: number | null,
    movable: boolean,
    connectivity: number,
    point: Point,
}

export abstract class Block extends GridItem {
    public abstract kind: BlockKind;

    public power: number;
    public target: number | null;
    public movable: boolean;
    public connectivity: number;

    public static fromSerialized(data: AsSerialized): Block {
        switch (data.kind) {
            case "door":
                return new DoorBlock({ ...data });
            case "target":
                return new TargetBlock({ ...data });
            case "drain-bottom":
            case "drain-left":
            case "drain-right":
            case "drain-top": {
                return new ArrowBlock(data.kind.slice(6) as Direction, { ...data });
            }
        }
    }

    constructor(
        options: BlockOptions,
    ) {
        super(options.point);
        this.power = options.power;
        this.target = options.target;
        this.connectivity = options.connectivity;
        this.movable = options.movable;
    }

    public render(target: RenderBuffer, map: GridMap) {
        const top = !!(this.connectivity & 0b1000) ? " ─── ^ ─── " : " ───────── ";
        const right = !!(this.connectivity & 0b0100) ? " │>│ " : " │││ ";
        const bottom = !!(this.connectivity & 0b0010) ? " ─── v ─── " : " ───────── ";
        const left = !!(this.connectivity & 0b0001) ? " │<│ " : " │││ ";

        const startX = this.x * 3 * 5;
        const startY = this.y * 5;

        target.writeScreen({ x: startX + 2, y: startY }, RleMatrix.fromAscii(top));
        target.writeScreen({ x: startX + 2 + 10, y: startY }, RleMatrix.fromAscii(right, 1));
        target.writeScreen({ x: startX + 2, y: startY + 4 },  RleMatrix.fromAscii(bottom));
        target.writeScreen({ x: startX + 2 , y: startY }, RleMatrix.fromAscii(left, 1));

        if (!this.movable) {
            target.writeScreen({ x: startX + 2, y: startY }, RleMatrix.fromAscii("┏"))
            target.writeScreen({ x: startX + 2 + 10, y: startY }, RleMatrix.fromAscii("┓"))
            target.writeScreen({ x: startX + 2, y: startY + 4 }, RleMatrix.fromAscii("┗"))
            target.writeScreen({ x: startX + 2 + 10, y: startY + 4 }, RleMatrix.fromAscii("┛"))
        } else {
            target.writeScreen({ x: startX + 2, y: startY }, RleMatrix.fromAscii("╭"))
            target.writeScreen({ x: startX + 2 + 10, y: startY }, RleMatrix.fromAscii("╮"))
            target.writeScreen({ x: startX + 2, y: startY + 4 }, RleMatrix.fromAscii("╰"))
            target.writeScreen({ x: startX + 2 + 10, y: startY + 4 }, RleMatrix.fromAscii("╯"))
        }

        const effectivePower = map.getEffectivePower(this);

        if (this.power) {
            target.writeScreen({ x: startX + 3 + 3, y: startY + 2 }, RleMatrix.fromAscii(numberToRune(this.power).padStart(2, " "), undefined, { color: "yellow" }));
        }

        if (this.target) {
            const color = effectivePower === this.target ? "green" : "red";
            target.writeScreen({ x: startX + 3 + 6, y: startY + 3 }, RleMatrix.fromAscii(numberToRune(this.target).padStart(2, " "), undefined, { color }));
        }

        if (effectivePower) {
            target.writeScreen({ x: startX + 3, y: startY + 3 }, RleMatrix.fromAscii(numberToRune(effectivePower).padStart(2, " "), undefined, { color: "blue" }));
        }

        target.writeScreen({ x: startX + 3 + 6, y: startY + 1 }, RleMatrix.fromAscii(kindToIcon[this.kind]));
    }

    public push(direction: Direction, map: GridMap): PushContinuation {
        if (!this.movable) {
            return { kind: "invalid" };
        }

        return super.push(direction, map);
    }

    public toSerialized(): AsSerialized {
        return {
            kind: this.kind,
            power: this.power,
            target: this.target,
            movable: this.movable,
            connectivity: this.connectivity,
            point: this.point,
        }
    }
}

export class DoorBlock extends Block {
    public kind: BlockKind = "door";

    constructor(options: BlockOptions) {
        super(options);
    }
}

export class TargetBlock extends Block {
    public kind: BlockKind = "target";

    constructor(options: BlockOptions) {
        super(options);
    }

    public postUpdate(map: GridMap) {
        if (map.getEffectivePower(this) === this.target) {
            return { kind: "win" as "win" }
        }

        return undefined;
    }
}

export class ArrowBlock extends Block {
    public kind: BlockKind;

    constructor(direction: Direction, options: BlockOptions) {
        super(options);
        this.kind = `drain-${direction}`;
    }
}