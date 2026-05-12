type Id = string | number;

export class DisjointSet<T> {
    private parents: Record<Id, Id> = {};
    private rank: Record<Id, number> = {};
    private data: Record<Id, T> = {};

    public add(id: Id, value: T) {
        if (this.parents[id] === undefined) {
            this.parents[id] = id.toString();
            this.rank[id] = 0;
            this.data[id] = value;
        } else {
            this.data[id] = value;
        }
    }

    public find(x: Id): Id {
        let rootId = x;

        while (this.parents[rootId] !== rootId) {
            const newRootId = this.parents[rootId];
            this.parents[rootId] = this.parents[newRootId]; // collapse the set
            rootId = newRootId;
        }

        return rootId;
    }

    public merge(x: Id, y: Id): boolean {
        const rootX = this.find(x);
        const rootY = this.find(y);

        if (rootX === rootY) {
            return false;
        }

        const rankX = this.rank[rootX];
        const rankY = this.rank[rootY];

        if (rankX > rankY) {
            this.parents[rootY] = rootX;
        } else if (rankX < rankY) {
            this.parents[rootX] = rootY;
        } else {
            this.parents[rootY] = rootX;
            this.rank[rootX]++;
        }

        return true;
    }

    public getSet(id: Id): T[] {
        const rootId = this.find(id);
        const set = [];

        for (const [key, value] of Object.entries(this.parents)) {
            if (this.find(key) === rootId) {
                set.push(this.data[key]);
            }
        }

        return set;
    }

    public getSets(): T[][] {
        const sets: Record<string, T[]> = {};

        for (const key of Object.keys(this.parents)) {
            const rootId = this.find(key);
            if (!sets[rootId]) {
                sets[rootId] = [];
            }

            sets[rootId].push(this.data[key]);
        }

        return Object.values(sets);
    }
}
