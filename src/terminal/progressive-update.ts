import { Cell, RleMatrix, Segment, SegmentOptions } from "./rle-buffer.js";

const stylesEqual = (a: SegmentOptions, b: SegmentOptions): boolean => {
    const allStyles = new Set([
        ...(Object.keys(a) as (keyof SegmentOptions)[]),
        ...(Object.keys(b) as (keyof SegmentOptions)[]),
    ]);

    return [...allStyles].every((style) => {
        if (a[style] === undefined && b[style] === undefined) {
            return true;
        }

        return a[style] === b[style];
    });
};

const cellsEqual = (a: Cell, b: Cell): boolean => {
    return a.char === b.char && stylesEqual(a.options, b.options);
};

const renderRun = (cells: Cell[]): string => {
    let result = "";
    let i = 0;

    while (i < cells.length) {
        const start = i;
        const style = cells[i].options;

        while (i < cells.length && stylesEqual(cells[i].options, style)) {
            i++;
        }

        const data = cells
            .slice(start, i)
            .map((c) => (c.char.length === 0 ? " " : c.char))
            .join("");

        result += new Segment(1, data, style).toString();
    }

    return result;
};

const moveCursor = (row: number, col: number) => `\x1b[${row + 1};${col + 1}H`;

const generateFullDraw = (matrix: RleMatrix): string => {
    let result = "\x1b[2J" + moveCursor(0, 0);

    for (let y = 0; y < matrix.height; y++) {
        if (y > 0) {
            result += "\r\n";
        }

        result += matrix.getRow(y).toString();
    }

    result += moveCursor(0, 0);
    return result;
};

export const generateProgressiveUpdates = (oldMatrix: RleMatrix | null, newMatrix: RleMatrix): string => {
    if (!oldMatrix || oldMatrix.width !== newMatrix.width || oldMatrix.height !== newMatrix.height) {
        return generateFullDraw(newMatrix);
    }

    let result = "";

    for (let y = 0; y < newMatrix.height; y++) {
        const oldCells = oldMatrix.getRow(y).toCells();
        const newCells = newMatrix.getRow(y).toCells();
        const width = Math.min(oldCells.length, newCells.length);

        let i = 0;
        while (i < width) {
            if (cellsEqual(oldCells[i], newCells[i])) {
                i++;
                continue;
            }

            const runStart = i;
            while (i < width && !cellsEqual(oldCells[i], newCells[i])) {
                i++;
            }

            result += moveCursor(y, runStart);
            result += renderRun(newCells.slice(runStart, i));
        }
    }

    if (result.length > 0) {
        result += moveCursor(0, 0);
    }

    return result;
};
