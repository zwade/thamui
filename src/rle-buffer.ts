import { Point } from "./utils.js";

const colorToAnsi = {
    "red": "\x1b[31m",
    "green": "\x1b[32m",
    "yellow": "\x1b[33m",
    "blue": "\x1b[34m",
    "clear": "\x1b[0m",
}

export interface SegmentOptions {
    color?: keyof typeof colorToAnsi;
    characterWidth?: number;
}


export class Segment {
    public width;
    public characterWidth: number;

    private data: string;
    private options: SegmentOptions;

    public static fromAscii(data: string, options: SegmentOptions = {}) {
        return new Segment(1, data, options);
    }

    constructor(width: number, data: string, options: SegmentOptions = {}) {
        if (width > 2) {
            console.warn("Width must be 1 or 2");
        }

        this.width = width;
        this.data = data;
        this.characterWidth = options.characterWidth ?? 1;
        this.options = options;
    }

    public get size() {
        return this.length * this.width;
    }

    public get length() {
        return this.data.length / this.characterWidth;
    }

    public dropPrefix(size: number) {
        const toDrop = Math.ceil(size / this.width);
        const extra = size % this.width;

        if (toDrop >= this.size) {
            const dropped = this.size;
            this.data = "";
            return dropped;
        }

        this.data = this.data.slice(toDrop * this.characterWidth);
        return size + extra;
    }

    public toSplit(index: number) {
        const start = Math.floor(index / this.width);

        return [new Segment(this.width, this.data.slice(0, start), this.options), new Segment(this.width, this.data.slice(start), this.options)];
    }

    public toString() {
        if (this.options.color) {
            return colorToAnsi[this.options.color] + this.data + colorToAnsi.clear;
        } else {
            return this.data;
        }
    }
}

export class RleBuffer {
    public length;

    private segments: Segment[];
    private empty?: string;

    #prefixDirty = true;
    #prefixSums!: number[];

    public static fromSegments(segments: Segment[], empty?: string) {
        const length = segments.reduce((acc, seg) => acc + seg.size, 0);

        return new RleBuffer(length, empty, segments);
    }

    public constructor(length: number, empty?: string, segments?: Segment[]) {
        this.length = length;
        this.empty = empty?.[0] ?? " ";
        this.segments = segments ?? [this.getEmpty(length)];
    }

    private get prefixSums() {
        if (!this.#prefixDirty) {
            return this.#prefixSums;
        }

        this.#prefixSums = this.segments.reduce<[number[], number]>(([val, acc], segment) => [[...val, acc + segment.size], acc + segment.size], [[0], 0])[0];
        this.#prefixDirty = false;

        return this.#prefixSums;
    }

    private getEmpty(length: number) {
        return new Segment(1, Buffer.alloc(length, this.empty).toString("utf-8"));
    }


    private _write(index: number, data: Segment) {
        let s = data.size;
        let i = index;

        let startDropped = 0;

        while (true) {
            const segmentIndex = this.prefixSums.findIndex((sum) => sum >= i);

            if (i === this.prefixSums[segmentIndex]) {
                const segment = this.segments[segmentIndex];
                const dropped = segment.dropPrefix(s);
                if (segment.size === 0) {
                    this.segments.splice(segmentIndex, 1);
                }

                s -= dropped;
                if (dropped === 0) {
                    throw new Error("No progress!");
                }

                this.#prefixDirty = true;
            } else {
                const segment = this.segments[segmentIndex - 1];
                const localIndex = i - this.prefixSums[segmentIndex - 1];
                if ((localIndex % segment.width) !== 0) {
                    i -= 1;
                    s += 1;
                    startDropped += 1;

                    continue;
                }

                const [newStart, newEnd] = segment.toSplit(localIndex);
                this.segments.splice(segmentIndex - 1, 1, newStart, newEnd);

                if (newStart.size === 0 || newEnd.size === 0) {
                    throw new Error("No progress!");
                }

                this.#prefixDirty = true;
            }

            if (s <= 0) {
                if (s < 0) {
                    this.segments.splice(segmentIndex, 0, this.getEmpty(-s));
                }

                this.segments.splice(segmentIndex, 0, data);

                if (startDropped) {
                    this.segments.splice(segmentIndex, 0, this.getEmpty(startDropped));
                }

                this.#prefixDirty = true;
                return;
            }
        }
    }

    public write(index: number, data: Segment) {
        this._write(index, data);

        if (this.prefixSums.slice(-1)[0] !== this.length) {
            throw new Error("Something went wrong with rle buffer");
        }
    }

    public copyIn(index: number, other: RleBuffer) {
        let runningIndex = index;
        for (let i = 0; i < other.segments.length; i++) {
            this.write(runningIndex, other.segments[i]);
            runningIndex += other.segments[i].size;
        }
    }

    public clear() {
        this.segments = [this.getEmpty(this.length)];
        this.#prefixDirty = true;
    }

    public toString() {
        return this.segments.map((s) => s.toString()).join("");
    }
}

export class RleMatrix {
    private data: RleBuffer[]
    private width;
    private height;
    private empty;

    public static fromAscii(data: string, width: number | undefined = undefined, segmentOptions: SegmentOptions = {}) {
        width ??= data.length;

        const asArray = Array.from(new Array(data.length / width), (_, y) => [data.slice(y * width, (y + 1) * width)]);
        return RleMatrix.fromArray(asArray, " ", segmentOptions)
    }

    public static fromArray(data: (string | Segment)[][], empty = " ", segmentOptions: SegmentOptions = {}) {
        const asSegments = data.map((row) => row.map((el) => el instanceof Segment ? el : Segment.fromAscii(el, segmentOptions)));
        const buffers = asSegments.map((row) => RleBuffer.fromSegments(row));

        return new RleMatrix(buffers[0].length, buffers.length, empty, buffers);
    }

    public constructor(width: number, height: number, empty: string = " ", data?: RleBuffer[]) {
        this.width = width;
        this.height = height;
        this.empty = empty;

        this.data = data ?? Array.from(new Array(height), () => new RleBuffer(width, empty));
    }

    public clear() {
        for (const buff of this.data) {
            buff.clear();
        }
    }

    public copyIn(start: Point, other: RleMatrix) {
        for (let i = 0; i < other.height; i++) {
            this.data[start.y + i].copyIn(start.x, other.data[i]);
        }
    }

    public getRow(i: number) {
        return this.data[i];
    }
}