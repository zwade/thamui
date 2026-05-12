import { GridItem } from "./grid-item.js";
import { RenderBuffer } from "./render-buffer.js";
import { RleMatrix, Segment } from "./rle-buffer.js";
import { Point } from "./utils.js";

export interface PlayerOptions {
    point: Point;
}

export type AsSerialized = {
    point: Point;
};

export class Player extends GridItem {
    public power = 0;

    public static fromSerialized(data: AsSerialized): Player {
        return new Player(data);
    }

    constructor(options: PlayerOptions) {
        super(options.point);
    }

    public render() {
        const player = RleMatrix.fromAscii(
            "               " + "     (   )     " + "   === | ===   " + "     /   \\     " + "               ",
            { width: 15 },
        );

        player.copyIn({ x: 6, y: 1 }, RleMatrix.fromArray([[new Segment(2, "👀", { characterWidth: 2 })]]));

        return player;
    }

    public toSerialized(): AsSerialized {
        return {
            point: this.point,
        };
    }
}
