import { ArrowBlock, DoorBlock, TargetBlock } from "./blocks.js";
import { CellItem } from "./map.js";
import { Player } from "./player.js";

export const testMap: () => CellItem[] = () => [
    {
        kind: "block",
        value: new DoorBlock({
            connectivity: 0b1101,
            movable: false,
            power: 0,
            target: 2,
            point: {
                x: 1,
                y: 1,
            },
        }),
    },
    {
        kind: "block",
        value: new ArrowBlock("left", {
            connectivity: 0b1111,
            movable: true,
            power: 2,
            target: 2,
            point: {
                x: 2,
                y: 1,
            },
        }),
    },
    {
        kind: "block",
        value: new ArrowBlock("bottom", {
            connectivity: 0b0101,
            movable: false,
            power: 2,
            target: null,
            point: {
                x: 3,
                y: 3,
            },
        }),
    },
    {
        kind: "block",
        value: new TargetBlock({
            connectivity: 0b0001,
            movable: true,
            power: 0,
            target: 4,
            point: {
                x: 3,
                y: 2,
            },
        }),
    },
    {
        kind: "player",
        value: new Player({
            point: {
                x: 0,
                y: 0,
            },
        }),
    },
];
