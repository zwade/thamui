declare module "*.scss" {
    export type Selector = {
        className?: string[];
        id?: string;
        tagName?: string;
        pseudoSelector?: string[];
    };

    export type ParsedStyle = {
        selectorTree: Selector[];
        styles: Styles;
    };

    export type Styles = Record<string, string>;

    // const styles: ParsedStyle[];
    const styles: string;
    export default styles;
}
