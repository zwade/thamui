import { RleBuffer, RleMatrix } from "./rle-buffer.js";
import { Point } from "./utils.js";

export class RenderBuffer {
    public width;
    public height;
    private buffer: RleMatrix;
    private writeable;

    private titleBuffer;
    private console: string = "";

    constructor(
        title: string,
        width: number,
        height: number,
        writeable: { write: (data: string) => void } = process.stdout
    ) {
        this.titleBuffer = title;
        this.width = width;
        this.height = height;
        this.buffer = new RleMatrix(width, height);
        this.writeable = writeable;
    }

    public clear() {
        this.buffer.clear();
    }

    public resetScreen() {
        const offset = 6; // 2 (top/bottom borders) + 2 (title) + 2 (footer)
        this.writeable.write(`\x1b[G\x1b[${this.height + offset}A`);
    }

    public render() {
        this.writeable.write("┌" + "─".repeat(this.titleBuffer.length + 2) + "┐\r\n");
        this.writeable.write("│ " + this.titleBuffer + " │\r\n");

        this.writeable.write("├" + "─".repeat(this.titleBuffer.length + 2) + "┴" + "─".repeat(this.width - this.titleBuffer.length - 3) + "┐\r\n");

        for (let i = 0; i < this.height; i++) {
            const row = this.buffer.getRow(i).toString();
            this.writeable.write("│" + row + "│\r\n");
        }

        this.writeable.write("├" + "─".repeat(this.width) + "┤\r\n");

        if (this.console.length > this.width - 2) {
            this.writeable.write("│ " + this.console.slice(0, this.width - 5) + "... │\r\n");
        } else {
            this.writeable.write("│ " + this.console + " ".repeat(this.width - 2 - this.console.length) + " │\r\n");
        }

        this.writeable.write("└" + "─".repeat(this.width) + "┘\r\n");
    }

    public writeScreen(start: Point, data: RleMatrix) {
        this.buffer.copyIn(start, data);
    }

    public setConsole(data: string) {
        this.console = data;
    }
}