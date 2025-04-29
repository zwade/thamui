import { Block, AsSerialized as BlockAsSerialized } from "./blocks.js";
import { DisjointSet } from "./disjoint-set.js";
import { GridItem } from "./grid-item.js";
import { Player, AsSerialized as PlayerAsSerialized } from "./player.js";
import { RenderBuffer } from "./render-buffer.js";
import { binToDirections, Direction, directionToBin, invertDirection, Point, pointInDirection } from "./utils.js";

export type CellValue =
    | { kind: "block", id: string }
    | { kind: "player", id: string }

export interface Cell {
    stack: CellValue[];
}

export type CellItem =
    | { kind: "block", value: Block }
    | { kind: "player", value: Player }

export interface MappedCell {
    stack: CellItem[];
}

export type CellItemAsSerialized =
    | { kind: "block", value: BlockAsSerialized }
    | { kind: "player", value: PlayerAsSerialized }

export type AsSerialized = {
    width: number;
    height: number;
    items: CellItemAsSerialized[];
}

export class GridMap {
    public width;
    public height;

    private map: Cell[][];
    private renderBuffer;
    private entityMap: Map<string, CellItem> = new Map();
    private id = 0;

    #eqDirty = true;
    #eqCache: DisjointSet<CellItem> | null = null;

    public static fromSerialized(data: AsSerialized, renderBuffer: RenderBuffer): GridMap {
        const items: CellItem[] = data.items.map((item) => {
            switch (item.kind) {
                case "block": {
                    return { kind: "block", value: Block.fromSerialized(item.value) };
                }
                case "player": {
                    return { kind: "player", value: Player.fromSerialized(item.value) };
                }
            }
        });

        return new GridMap(data.width, data.height, items, renderBuffer);
    }

    constructor(width: number, height: number, items: CellItem[] = [], renderBuffer: RenderBuffer) {
        this.width = width;
        this.height = height;
        this.renderBuffer = renderBuffer;
        this.map = Array.from(new Array(height), (_) => Array.from(new Array(width), (_) => ({ stack: [] })))

        for (const item of items) {
            this.addItem(item);
        }
    }

    public get mapIter() {
        const map = this.map;
        const entityMap = this.entityMap;

        return (function*() {
            for (const row of map) {
                for (const col of row) {
                    for (const item of col.stack) {
                        const resolved = entityMap.get(item.id);
                        if (!resolved) {
                            console.warn("Missing element with id", item.id);
                            continue;
                        }

                        yield resolved;
                    }
                }
            }
        })();
    }

    public lookup(point: { x: number, y: number }): MappedCell | undefined {
        if (point.y < 0 || point.x < 0 || point.y >= this.height || point.x >= this.width) {
            return undefined;
        }

        const cell = this.map[point.y]?.[point.x];

        return {
            stack: cell.stack.map(({ kind, id }) => this.entityMap.get(id)!)
        }
    }

    public move(id: string, location: Point) {
        const entity = this.entityMap.get(id);
        if (!entity) {
            console.warn("Could not find entity");
            return;
        }

        const cell = this.map[entity.value.y][entity.value.x];
        cell.stack = cell.stack.filter(({ id: extantId }) => extantId !== id);

        this.map[location.y][location.x].stack.push({ kind: entity.kind, id });
        entity.value._mapOnlySetPosition(location);

        this.#eqDirty = true;
    }

    public addItem(item: CellItem) {
        const id = `${item.kind}-${++this.id}`;
        item.value.id = id;
        this.entityMap.set(id, item);

        this.map[item.value.y][item.value.x].stack.push({ kind: item.kind, id });

        this.#eqDirty = true;
    }

    public renderAll(options: { resetScreen?: boolean } = {}) {
        this.renderBuffer.clear();

        if (options.resetScreen) {
            this.renderBuffer.resetScreen();
        }

        for (const element of this.mapIter) {
            element.value.render(this.renderBuffer, this);
        }

        return this.renderBuffer.render();
    }

    public toSerialized(): AsSerialized {
        const items = this.mapIter.map((item): CellItemAsSerialized => {
            switch (item.kind) {
                case "block": {
                    return { kind: "block", value: item.value.toSerialized() };
                }
                case "player": {
                    return { kind: "player", value: item.value.toSerialized() };
                }
            }
        }).toArray();

        return {
            width: this.width,
            height: this.height,
            items
        }
    }

    public* getPlayers() {
        for (const element of this.mapIter) {
            if (element.kind === "player") {
                yield element.value;
            }
        }
    }

    private get equivalenceSets() {
        if (!this.#eqDirty) {
            return this.#eqCache!;
        }

        const ds = new DisjointSet<CellItem>();
        for (const element of this.mapIter) {
            ds.add(element.value.id, element);
        }

        for (const element of this.mapIter) {
            if (element.kind !== "block") {
                continue;
            }

            const cell = this.lookup(element.value);
            if (!cell) {
                continue;
            }

            for (const item of cell.stack) {
                if (item.kind === "block" && !!(item.value.connectivity & element.value.connectivity)) {
                    ds.merge(element.value.id, item.value.id);
                }
            }

            for (const direction of binToDirections(element.value.connectivity)) {
                const point = pointInDirection(element.value, direction);
                const cell = this.lookup(point);
                if (!cell) {
                    continue;
                }

                for (const item of cell.stack) {
                    const reflectiveBin = directionToBin(invertDirection(direction));
                    if (item.kind === "block" && !!(item.value.connectivity & reflectiveBin)) {
                        ds.merge(element.value.id, item.value.id);
                    }
                }
            }
        }

        this.#eqCache = ds;
        this.#eqDirty = false;

        return ds;
    }

    public getEntitiesInEquivalenceClass(item: GridItem) {
        return this.equivalenceSets.getSet(item.id);
    }

    public getEffectivePower(item: GridItem) {
        let result = 0;
        for (const entity of this.getEntitiesInEquivalenceClass(item)) {
            result += entity.value.power;
        }

        return result;
    }
}