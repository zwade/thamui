export type Direction = "left" | "right" | "top" | "bottom"
export type Point = {
    x: number;
    y: number;
}

export const pointInDirection = (point: Point, dir: Direction) => {
    const { x, y } = point;
    switch (dir) {
        case "bottom": {
            return { x, y: y + 1 }
        }
        case "top": {
            return { x, y: y - 1 }
        }
        case "left": {
            return { x: x - 1, y }
        }
        case "right": {
            return { x: x + 1, y }
        }
    }
}

export const directionToBin = (direction: Direction) => {
    switch (direction) {
        case "top": {
            return 0b1000;
        }
        case "right": {
            return 0b0100;
        }
        case "bottom": {
            return 0b0010;
        }
        case "left": {
            return 0b0001;
        }
    }
}

export const binToDirections = (bin: number) => {
    const results: Direction[] = [];

    if (bin & 0b1000) {
        results.push("top");
    }

    if (bin & 0b0100) {
        results.push("right");
    }

    if (bin & 0b0010) {
        results.push("bottom");
    }

    if (bin & 0b0001) {
        results.push("left");
    }

    return results;
}

export const invertDirection = (direction: Direction): Direction => {
    switch (direction) {
        case "top": {
            return "bottom";
        }
        case "right": {
            return "left";
        }
        case "bottom": {
            return "top";
        }
        case "left": {
            return "right";
        }
    }
}

export const digitToRune = (digit: number) => {
    switch (digit) {
        case 0: {
            return "ᛃ";
        }
        case 1: {
            return "ᛇ";
        }
        case 2: {
            return "ᛉ";
        }
        case 3: {
            return "ᛟ";
        }
        case 4: {
            return "ᛊ";
        }
        case 5: {
            return "ᛒ";
        }
        case 6: {
            return "ᛤ";
        }
        case 7: {
            return "ᛥ";
        }
        default: {
            throw new Error("Invalid digit");
        }
    }
}

export const numberToRune = (number: number) => {
    let current = number;
    let result: string[] = [];
    while (current > 0) {
        const digit = current & 0b111;
        result.push(digitToRune(digit));

        current = current >> 3;
    }

    return result.reverse().join("");
}