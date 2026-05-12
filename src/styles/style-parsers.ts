// Large swaths taken from https://github.com/zwade/manus-dei/blob/master/client/src/components/ui/styles.tsx
// License MIT

import {
    Align,
    BoxSizing,
    Edge,
    FlexDirection,
    Gutter,
    Justify,
    Node as YogaNode,
    PositionType,
    Wrap,
} from "yoga-layout";

export type StyleRecord = Record<string, string>;
export type Style = string;

export type MeasureWithAuto = number | `${number}%` | "auto";
export type MeasureWithPercent = number | `${number}%`;
export type Measure = number;

export type Size = [width: MeasureWithAuto, height: MeasureWithAuto];
export type FourOf<Elt = MeasureWithAuto> = [top: Elt, right: Elt, bottom: Elt, left: Elt];

export type Border = [size: number, shape: string | undefined, color: string | undefined];

const num = (val: string | undefined): number | undefined => {
    if (val === undefined) {
        return undefined;
    }

    return Number(val);
};

const pixels = (val: string | undefined) => {
    if (val === undefined) {
        return undefined;
    }

    return val.endsWith("px") ? parseFloat(val.slice(0, -2)) : parseFloat(val);
};

const measureWithAuto = (val: string | undefined): MeasureWithAuto | undefined => {
    if (val === undefined) {
        return undefined;
    }

    if (val === "auto" || val.endsWith("%")) {
        return val as MeasureWithAuto;
    }

    if (val.endsWith("px")) {
        return parseFloat(val.slice(0, -2));
    }

    const result = parseFloat(val);
    if (isNaN(result)) {
        return undefined;
    }

    return result;
};

const measureWithPercent = (val: string | undefined): MeasureWithPercent | undefined => {
    if (val === undefined) {
        return undefined;
    }

    if (val.endsWith("%")) {
        return val as MeasureWithPercent;
    }

    if (val.endsWith("px")) {
        return parseFloat(val.slice(0, -2));
    }

    const result = parseFloat(val);
    if (isNaN(result)) {
        return undefined;
    }

    return result;
};

const measure = (val: string | undefined): Measure | undefined => {
    if (val === undefined) {
        return undefined;
    }

    if (val.endsWith("px")) {
        return parseFloat(val.slice(0, -2));
    }

    const result = parseFloat(val);
    if (isNaN(result)) {
        return undefined;
    }

    return result;
};

const color = (val: string | undefined) => {
    const simpleColors: { [key: string]: number } = {
        black: 0x000000,
        white: 0xffffff,
        red: 0xcc0000,
        green: 0x00cc00,
        blue: 0x0000cc,
    };

    if (val === undefined) {
        return undefined;
    }

    if (val.toLowerCase() in simpleColors) {
        return simpleColors[val.toLowerCase()];
    }

    return parseInt(val.slice(1, 7), 16);
};

const colorOpacity = (val: string | undefined) => {
    if (val?.startsWith("#") && val.length === 9) {
        return parseInt(val.slice(7, 9), 16) / 255;
    }
};

function fourSize(val: string | undefined): FourOf<number> | undefined;
function fourSize<T>(val: string | undefined, parser: (s?: string) => T): FourOf<T> | undefined;
function fourSize(
    val: string | undefined,
    parser: (s?: string) => unknown = measureWithAuto,
): FourOf<unknown> | undefined {
    if (val === undefined) {
        return undefined;
    }

    const components = val.split(/\s+/).map((x) => parser(x)!);
    if (components.length === 1) {
        const singleVal = components[0];
        return [singleVal, singleVal, singleVal, singleVal];
    }

    if (components.length === 2) {
        const valV = components[0];
        const valH = components[1];
        return [valV, valH, valV, valH];
    }

    if (components.length === 4) {
        return components as [unknown, unknown, unknown, unknown];
    }

    console.warn("Invalid four spec spec:", components);
    return undefined;
}

export const flexDirection = (val: string | undefined): FlexDirection => {
    return (
        {
            row: FlexDirection.Row,
            "row-reverse": FlexDirection.RowReverse,
            column: FlexDirection.Column,
            "column-reverse": FlexDirection.ColumnReverse,
        }[val || ""] ?? FlexDirection.Row
    );
};

export const justifyContent = (val: string | undefined): Justify => {
    return (
        {
            start: Justify.FlexStart,
            "flex-start": Justify.FlexStart,
            end: Justify.FlexEnd,
            "flex-end": Justify.FlexEnd,
            center: Justify.Center,
            "space-between": Justify.SpaceBetween,
            "space-around": Justify.SpaceAround,
            "space-evenly": Justify.SpaceEvenly,
        }[val || ""] ?? Justify.FlexStart
    );
};

export const alignItems = (val: string | undefined): Align => {
    return (
        {
            start: Align.FlexStart,
            flexStart: Align.FlexStart,
            end: Align.FlexEnd,
            flexEnd: Align.FlexEnd,
            center: Align.Center,
            stretch: Align.Stretch,
            baseline: Align.Baseline,
            spaceBetween: Align.SpaceBetween,
            spaceAround: Align.SpaceAround,
            spaceEvenly: Align.SpaceEvenly,
            auto: Align.Auto,
        }[val || ""] ?? Align.FlexStart
    );
};

export const flexWrap = (val: string | undefined): Wrap => {
    return (
        {
            nowrap: Wrap.NoWrap,
            wrap: Wrap.Wrap,
            "wrap-reverse": Wrap.WrapReverse,
        }[val || ""] ?? Wrap.NoWrap
    );
};

export const positionType = (val: string | undefined) => {
    return (
        {
            absolute: PositionType.Absolute,
            relative: PositionType.Relative,
            static: PositionType.Static,
        }[val || ""] ?? PositionType.Static
    );
};

const multiPart =
    <T>(
        baseName: string,
        parser: (s?: string) => T,
        notFourSize?: boolean,
        overridePartNames?: [Style, Style, Style, Style],
    ) =>
    (styles: StyleRecord) => {
        const partNames =
            overridePartNames ?? ["Top", "Right", "Bottom", "Left"].map((suffix) => `${baseName}${suffix}`);

        const genericStyles = styles as unknown as Record<string, string | undefined>;
        const initialValue = notFourSize
            ? ((x) => (x === undefined ? undefined : [x, x, x, x]))(parser(genericStyles[baseName]))
            : fourSize(genericStyles[baseName], parser);

        return (initialValue ?? [undefined, undefined, undefined, undefined]).map(
            (val, i) => parser(genericStyles[partNames[i]]) ?? val,
        ) as [T, T, T, T];
    };

export const margin = multiPart("margin", measureWithPercent);
export const padding = multiPart("padding", measureWithPercent);

export const border = multiPart(
    "border",
    (val) => {
        if (!val) {
            return undefined;
        }

        const [rawSize, rawShape, rawColor] = val.split(/\s+/g);
        return [measureWithPercent(rawSize), rawShape, rawColor] as Border;
    },
    true,
);

export const borderRadius = multiPart("borderRadius", measureWithPercent, true, [
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
]);

export const position = (styles: StyleRecord) => {
    const baseResult = multiPart("", measureWithAuto, true, ["top", "right", "bottom", "left"])(styles);
    if (!baseResult) return baseResult;

    baseResult[3] ??= styles["x"] as MeasureWithAuto | undefined;
    baseResult[1] ??= styles["y"] as MeasureWithAuto | undefined;

    return baseResult;
};

export const applyFourSize = <T>(fn: (edge: Edge, value: T) => void, fourSize: FourOf<T>) => {
    const [top, right, bottom, left] = fourSize;

    fn(Edge.Top, top);
    fn(Edge.Right, right);
    fn(Edge.Bottom, bottom);
    fn(Edge.Left, left);
};

export const applyStyles = (node: YogaNode, styles: StyleRecord) => {
    node.setWidth(measureWithAuto(styles["width"]));
    node.setHeight(measureWithAuto(styles["height"]));
    node.setBoxSizing(BoxSizing.ContentBox);

    node.setMinWidth(measureWithPercent(styles["minWidth"]));
    node.setMinHeight(measureWithPercent(styles["minHeight"]));
    node.setMaxWidth(measureWithPercent(styles["maxWidth"]));
    node.setMaxHeight(measureWithPercent(styles["maxHeight"]));

    applyFourSize(node.setMargin.bind(node), margin(styles));
    applyFourSize(node.setPadding.bind(node), padding(styles));

    const borderVal = border(styles);
    applyFourSize(node.setBorder.bind(node), borderVal.map((border) => border?.[0]) as FourOf<number>);

    node.setFlexGrow(num(styles["flexGrow"]));
    node.setFlexShrink(num(styles["flexShrink"]));
    node.setFlexBasis(measureWithAuto(styles["flexBasis"]));

    node.setFlexDirection(flexDirection(styles["flexDirection"]));
    node.setFlexWrap(flexWrap(styles["flexWrap"]));
    node.setJustifyContent(justifyContent(styles["justifyContent"]));
    node.setAlignItems(alignItems(styles["alignItems"]));

    node.setPositionType(positionType(styles["position"]));

    const alignSelf = styles["alignSelf"];
    if (alignSelf) {
        node.setAlignSelf(alignItems(alignSelf));
    }

    node.setGap(Gutter.All, measureWithPercent(styles["gap"]));

    return styles;
};
