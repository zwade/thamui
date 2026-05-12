import { border, borderRadius } from "../styles/style-parsers.js";
import { Styles } from "../styles/styles-runtime.js";
import { AnsiStyles, RleMatrix } from "./rle-buffer.js";
import { Box } from "./utils.js";

export const drawBorder = (
    style: Styles.Style,
    parentStyles: Styles.Style,
    boundingRect: Box,
    baseMatrix: RleMatrix,
) => {
    const [borderTop, borderRight, borderBottom, borderLeft] = border(style);
    const [borderTopLeftRadius, borderTopRightRadius, borderBottomRightRadius, borderBottomLeftRadius] =
        borderRadius(style);

    if (borderTop?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderTop[2],
        };

        const vertMatrix = RleMatrix.fromAscii("─".repeat(boundingRect.width), borderStyles);
        baseMatrix.copyIn({ x: 0, y: 0 }, vertMatrix);
    }

    if (borderLeft?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderLeft[2],
        };

        const horizMatrix = RleMatrix.fromAscii("│".repeat(boundingRect.height), { width: 1, ...borderStyles });
        baseMatrix.copyIn({ x: 0, y: 0 }, horizMatrix);
    }

    if (borderBottom?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderBottom[2],
        };

        const vertMatrix = RleMatrix.fromAscii("─".repeat(boundingRect.width), borderStyles);
        baseMatrix.copyIn({ x: 0, y: boundingRect.height - 1 }, vertMatrix);
    }

    if (borderRight?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderRight[2],
        };

        const horizMatrix = RleMatrix.fromAscii("│".repeat(boundingRect.height), { width: 1, ...borderStyles });
        baseMatrix.copyIn({ x: boundingRect.width - 1, y: 0 }, horizMatrix);
    }

    if (borderTop?.[0] && borderLeft?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderLeft[2] ?? borderTop[2],
        };

        const icon = borderTopLeftRadius ? "╭" : "┌";
        baseMatrix.setAscii({ x: 0, y: 0 }, icon, borderStyles);
    }

    if (borderTop?.[0] && borderRight?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderTop[2] ?? borderRight[2],
        };

        const icon = borderTopRightRadius ? "╮" : "┐";
        baseMatrix.setAscii({ x: boundingRect.width - 1, y: 0 }, icon, borderStyles);
    }

    if (borderBottom?.[0] && borderLeft?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderBottom[2] ?? borderLeft[2],
        };

        const icon = borderBottomLeftRadius ? "╰" : "└";
        baseMatrix.setAscii({ x: 0, y: boundingRect.height - 1 }, icon, borderStyles);
    }

    if (borderBottom?.[0] && borderRight?.[0]) {
        const borderStyles: AnsiStyles = {
            bgColor: parentStyles.backgroundColor,
            color: borderBottom[2] ?? borderRight[2],
        };

        const icon = borderBottomRightRadius ? "╯" : "┘";
        baseMatrix.setAscii({ x: boundingRect.width - 1, y: boundingRect.height - 1 }, icon, borderStyles);
    }
};
