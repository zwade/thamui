import { GridItem, PushContinuation } from "./grid-item.js";
import { GridMap } from "./map.js";
import { RleMatrix } from "./rle-buffer.js";
import { Direction, numberToRune, Point, pointInDirection } from "./utils.js";

export type BlockKind = "door" | "target" | `drain-${Direction}`;

const kindToIcon: { [K in BlockKind]: string } = {
    door: "🚪",
    target: "🎯",
    "drain-bottom": "⬇️",
    "drain-left": "⬅️",
    "drain-right": "➡️",
    "drain-top": "⬆️",
};

export interface BlockOptions {
    power: number;
    target: number | null;
    movable: boolean;
    connectivity: number;
    point: Point;
}

export type AsSerialized = {
    kind: BlockKind;
    power: number;
    target: number | null;
    movable: boolean;
    connectivity: number;
    point: Point;
};

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

    constructor(options: BlockOptions) {
        super(options.point);
        this.power = options.power;
        this.target = options.target;
        this.connectivity = options.connectivity;
        this.movable = options.movable;
    }

    public render(map: GridMap) {
        const baseMatrix = RleMatrix.fromArray(
            [["   ─────────   "], ["  │         │  "], ["  │         │  "], ["  │         │  "], ["   ─────────   "]],
            { color: "red" },
        );

        if (this.connectivity & 0b1000) {
            baseMatrix.setAscii({ x: 6, y: 0 }, " ^ ");
        }

        if (this.connectivity & 0b0100) {
            baseMatrix.setAscii({ x: 12, y: 2 }, ">");
        }

        if (this.connectivity & 0b0010) {
            baseMatrix.setAscii({ x: 6, y: 4 }, " v ");
        }

        if (this.connectivity & 0b0100) {
            baseMatrix.setAscii({ x: 2, y: 2 }, "<");
        }

        if (!this.movable) {
            baseMatrix.setAscii({ x: 2, y: 0 }, "┏");
            baseMatrix.setAscii({ x: 2 + 10, y: 0 }, "┓");
            baseMatrix.setAscii({ x: 2, y: 4 }, "┗");
            baseMatrix.setAscii({ x: 2 + 10, y: 4 }, "┛");
        } else {
            baseMatrix.setAscii({ x: 2, y: 0 }, "╭");
            baseMatrix.setAscii({ x: 2 + 10, y: 0 }, "╮");
            baseMatrix.setAscii({ x: 2, y: 4 }, "╰");
            baseMatrix.setAscii({ x: 2 + 10, y: 4 }, "╯");
        }

        const effectivePower = map.getEffectivePower(this);

        if (this.power) {
            baseMatrix.copyIn(
                { x: 3 + 3, y: 2 },
                RleMatrix.fromAscii(numberToRune(this.power).padStart(2, " "), { color: "yellow" }),
            );
        }

        if (this.target) {
            const color = effectivePower === this.target ? "green" : "red";
            baseMatrix.copyIn(
                { x: 3 + 6, y: 3 },
                RleMatrix.fromAscii(numberToRune(this.target).padStart(2, " "), { color }),
            );
        }

        if (effectivePower) {
            baseMatrix.copyIn(
                { x: 3, y: 3 },
                RleMatrix.fromAscii(numberToRune(effectivePower).padStart(2, " "), { color: "blue" }),
            );
        }

        baseMatrix.copyIn({ x: 3 + 6, y: 1 }, RleMatrix.fromAscii(kindToIcon[this.kind]));

        return baseMatrix;
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
        };
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
            return { kind: "win" as const };
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
