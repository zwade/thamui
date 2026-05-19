import chalk from "chalk";
import { createHash } from "node:crypto";

import { Point } from "./utils.js";

export interface AnsiStyles {
    color?: string;
    bgColor?: string;
    strikethrough?: boolean;
    underline?: boolean;
    bold?: boolean;
}

export interface SegmentOptions extends AnsiStyles {
    characterWidth?: number;
}

const render = (styles: AnsiStyles, data: string) => {
    let c = chalk;

    if (styles.color) {
        if (styles.color in chalk) {
            c = (c as any)[styles.color];
        } else {
            c = c.hex(styles.color);
        }
    }

    if (styles.bgColor) {
        const asBgName = `bg${styles.bgColor[0].toUpperCase()}${styles.bgColor.slice(1)}`;

        if (asBgName in chalk) {
            c = (c as any)[asBgName];
        } else {
            c = c.bgHex(styles.bgColor);
        }
    }

    if (styles.strikethrough) {
        c = c.strikethrough;
    }

    if (styles.underline) {
        c = c.underline;
    }

    if (styles.bold) {
        c = c.bold;
    }

    return c(data);
};

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

    public dropSuffix(size: number) {
        const toDrop = Math.ceil(size / this.width);
        const extra = size % this.width;

        if (toDrop >= this.size) {
            const dropped = this.size;
            this.data = "";
            return dropped;
        }

        this.data = this.data.slice(0, -toDrop * this.characterWidth);
        return size + extra;
    }

    public clone() {
        return new Segment(this.width, this.data, this.options);
    }

    public toSplit(index: number) {
        const start = Math.floor(index / this.width);

        return [
            new Segment(this.width, this.data.slice(0, start), this.options),
            new Segment(this.width, this.data.slice(start), this.options),
        ];
    }

    public toString() {
        return render(this.options, this.data);
    }

    public toCells(): Cell[] {
        const result: Cell[] = [];
        for (let i = 0; i < this.data.length; i += this.characterWidth) {
            const char = this.data.slice(i, i + this.characterWidth);
            for (let w = 0; w < this.width; w++) {
                result.push({ char: w === 0 ? char : "", options: this.options });
            }
        }
        return result;
    }

    public signature(): string {
        const o = this.options;
        const hash = createHash("sha256");
        hash.update(this.data)
            .update("\x00")
            .update(o.color ?? "")
            .update("\x00")
            .update(o.bgColor ?? "")
            .update("\x00")
            .update(o.bold ? "1" : "0")
            .update("\x00")
            .update(o.underline ? "1" : "0")
            .update("\x00")
            .update(o.strikethrough ? "1" : "0")
            .update("\x00")
            .update(this.characterWidth.toString())
            .update("\x00")
            .update(this.width.toString());

        return hash.digest("hex");
    }
}

export interface Cell {
    char: string;
    options: SegmentOptions;
}

export const isFullwidth = (codepoint: number): boolean => {
    return (
        (codepoint >= 0x1100 && codepoint <= 0x115f) ||
        (codepoint >= 0x2e80 && codepoint <= 0x303e) ||
        (codepoint >= 0x3041 && codepoint <= 0x33ff) ||
        (codepoint >= 0x3400 && codepoint <= 0x4dbf) ||
        (codepoint >= 0x4e00 && codepoint <= 0x9fff) ||
        (codepoint >= 0xa000 && codepoint <= 0xa4cf) ||
        (codepoint >= 0xac00 && codepoint <= 0xd7a3) ||
        (codepoint >= 0xf900 && codepoint <= 0xfaff) ||
        (codepoint >= 0xfe30 && codepoint <= 0xfe4f) ||
        (codepoint >= 0xff00 && codepoint <= 0xff60) ||
        (codepoint >= 0xffe0 && codepoint <= 0xffe6) ||
        (codepoint >= 0x1f300 && codepoint <= 0x1f64f) ||
        (codepoint >= 0x1f680 && codepoint <= 0x1f6ff) ||
        (codepoint >= 0x1f900 && codepoint <= 0x1f9ff) ||
        (codepoint >= 0x20000 && codepoint <= 0x3fffd)
    );
};

export const visualWidth = (text: string): number => {
    let width = 0;
    for (const ch of text) {
        width += isFullwidth(ch.codePointAt(0)!) ? 2 : 1;
    }
    return width;
};

export const segmentsForLine = (text: string, options: SegmentOptions): Segment[] => {
    const segments: Segment[] = [];
    let buf = "";
    let bufCellWidth: 1 | 2 = 1;
    let bufCharWidth: 1 | 2 = 1;

    const flush = () => {
        if (buf.length === 0) {
            return;
        }
        segments.push(new Segment(bufCellWidth, buf, { ...options, characterWidth: bufCharWidth }));
        buf = "";
    };

    for (const ch of text) {
        const code = ch.codePointAt(0)!;
        const w: 1 | 2 = isFullwidth(code) ? 2 : 1;
        const cw: 1 | 2 = ch.length === 2 ? 2 : 1;

        if (buf.length > 0 && (w !== bufCellWidth || cw !== bufCharWidth)) {
            flush();
        }
        if (buf.length === 0) {
            bufCellWidth = w;
            bufCharWidth = cw;
        }
        buf += ch;
    }
    flush();

    return segments;
};

export interface RleBufferOptions extends SegmentOptions {
    empty?: string;
}

export class RleBuffer {
    public length;

    private segments: Segment[];
    private empty?: string;
    private options: RleBufferOptions;

    #prefixDirty = true;
    #prefixSums!: number[];
    #signature: string | null = null;

    public static fromSegments(segments: Segment[], options: RleBufferOptions = {}) {
        const length = segments.reduce((acc, seg) => acc + seg.size, 0);

        return new RleBuffer(length, segments, options);
    }

    public constructor(length: number, segments?: Segment[], options: RleBufferOptions = {}) {
        this.length = length;
        this.empty = options.empty?.[0] ?? " ";
        this.options = options;
        this.segments = segments ?? [this.getEmpty(length)];
    }

    private get prefixSums() {
        if (!this.#prefixDirty) {
            return this.#prefixSums;
        }

        this.#prefixSums = this.segments.reduce<[number[], number]>(
            ([val, acc], segment) => [[...val, acc + segment.size], acc + segment.size],
            [[0], 0],
        )[0];
        this.#prefixDirty = false;

        return this.#prefixSums;
    }

    private getEmpty(length: number) {
        return new Segment(1, Buffer.alloc(length, this.empty).toString("utf-8"), this.options);
    }

    private _write(index: number, data: Segment) {
        let s = data.size;
        let i = index;

        let startDropped = 0;

        while (true) {
            const segmentIndex = this.prefixSums.findIndex((sum) => sum >= i);
            if (i === this.prefixSums[segmentIndex]) {
                const segment = this.segments[segmentIndex];
                if (!segment) {
                    break;
                }

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
                if (!segment) {
                    break;
                }

                const localIndex = i - this.prefixSums[segmentIndex - 1];
                if (localIndex % segment.width !== 0) {
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
        if (data.size === 0) {
            return;
        }

        this._write(index, data);
        this.#signature = null;

        if (this.prefixSums.slice(-1)[0] !== this.length) {
            throw new Error("Something went wrong with rle buffer");
        }
    }

    public copyIn(index: number, other: RleBuffer) {
        this.copyInClipped(index, other, 0, this.length);
    }

    public copyInClipped(index: number, other: RleBuffer, clipStart: number, clipEnd: number) {
        const effectiveStart = Math.max(clipStart, 0);
        const effectiveEnd = Math.min(clipEnd, this.length);
        if (effectiveStart >= effectiveEnd) return;

        let runningIndex = index;

        for (let i = 0; i < other.segments.length; i++) {
            const original = other.segments[i];
            const segStart = runningIndex;
            const segEnd = runningIndex + original.size;
            runningIndex = segEnd;

            if (segEnd <= effectiveStart) continue;
            if (segStart >= effectiveEnd) break;

            const dropFromStart = Math.max(0, effectiveStart - segStart);
            const dropFromEnd = Math.max(0, segEnd - effectiveEnd);

            let segment: Segment;
            if (dropFromStart > 0 || dropFromEnd > 0) {
                segment = original.clone();
                if (dropFromStart > 0) segment.dropPrefix(dropFromStart);
                if (dropFromEnd > 0) segment.dropSuffix(dropFromEnd);
            } else {
                segment = original;
            }

            if (segment.size === 0) continue;

            const writeStart = Math.max(segStart, effectiveStart);
            this.write(writeStart, segment);
        }
    }

    public clear() {
        this.segments = [this.getEmpty(this.length)];
        this.#prefixDirty = true;
        this.#signature = null;
    }

    public signature(): string {
        if (this.#signature === null) {
            const hash = createHash("sha256");
            for (const segment of this.segments) {
                hash.update(segment.signature()).update("\x00");
            }

            this.#signature = hash.digest("hex");
        }

        return this.#signature;
    }

    public toString() {
        return this.segments.map((s) => s.toString()).join("");
    }

    public toCells(): Cell[] {
        const result: Cell[] = [];
        for (const segment of this.segments) {
            for (const cell of segment.toCells()) {
                result.push(cell);
            }
        }
        return result;
    }
}

export interface RleMatrixOptions extends SegmentOptions {
    empty?: string;
}

export interface RleMatrixFromAsciiOptions extends RleMatrixOptions {
    width?: number;
}

export class RleMatrix {
    public height;

    private data: RleBuffer[];
    private options;

    public static fromAscii(data: string, options: RleMatrixFromAsciiOptions = {}) {
        const width = options.width ?? data.length;

        if (data.length === 0 || width === 0) {
            return new RleMatrix(0, 0, [], options);
        }

        const asArray = Array.from(new Array(data.length / width), (_, y) => [data.slice(y * width, (y + 1) * width)]);
        return RleMatrix.fromArray(asArray, options);
    }

    public static fromArray(data: (string | Segment)[][], options: RleMatrixOptions = {}) {
        const asSegments = data.map((row) =>
            row.map((el) => (el instanceof Segment ? el : Segment.fromAscii(el, options))),
        );
        const buffers = asSegments.map((row) => RleBuffer.fromSegments(row, options));

        return new RleMatrix(buffers[0].length, buffers.length, buffers, options);
    }

    public constructor(width: number, height: number, data?: RleBuffer[], options: RleMatrixOptions = {}) {
        this.height = height;
        this.options = options;

        this.data = data ?? Array.from(new Array(height), () => new RleBuffer(width, undefined, options));
    }

    public get width() {
        return this.data[0]?.length ?? 0;
    }

    public clear() {
        for (const buff of this.data) {
            buff.clear();
        }
    }

    public copyIn(start: Point, other: RleMatrix) {
        this.copyInClipped(start, other, { x: 0, y: 0, width: this.width, height: this.height });
    }

    public copyInClipped(
        start: Point,
        other: RleMatrix,
        clip: { x: number; y: number; width: number; height: number },
    ) {
        const clipMaxX = clip.x + clip.width;
        const clipMaxY = clip.y + clip.height;

        const minI = Math.max(0, clip.y - start.y, -start.y);
        const maxI = Math.min(other.height, clipMaxY - start.y, this.data.length - start.y);

        for (let i = minI; i < maxI; i++) {
            this.data[start.y + i].copyInClipped(start.x, other.data[i], clip.x, clipMaxX);
        }
    }

    public setAscii(start: Point, data: string, options: RleMatrixFromAsciiOptions = {}) {
        const mergedOptions: RleMatrixFromAsciiOptions = {
            characterWidth: options.characterWidth,
            color: options.color ?? this.options.color,
            bgColor: options.bgColor ?? this.options.bgColor,
            empty: options.empty ?? this.options.empty,
        };

        const matrix = RleMatrix.fromAscii(data, mergedOptions);
        this.copyIn(start, matrix);
    }

    public setText(start: Point, text: string, options: SegmentOptions = {}) {
        if (start.y < 0 || start.y >= this.data.length) {
            return;
        }

        const mergedOptions: SegmentOptions = {
            color: options.color ?? this.options.color,
            bgColor: options.bgColor ?? this.options.bgColor,
            bold: options.bold,
            underline: options.underline,
            strikethrough: options.strikethrough,
        };

        const row = this.data[start.y];
        let x = start.x;
        for (const segment of segmentsForLine(text, mergedOptions)) {
            if (x + segment.size > row.length) {
                break;
            }
            row.write(x, segment);
            x += segment.size;
        }
    }

    public getRow(i: number) {
        return this.data[i];
    }

    public [Symbol.iterator]() {
        return this.data[Symbol.iterator]();
    }
}
