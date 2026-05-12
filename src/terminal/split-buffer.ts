export class SplitBuffer {
    public prefix: string = "";
    public suffix: string = "";

    public get value(): string {
        return this.prefix + this.suffix;
    }

    public get cursor(): number {
        return this.prefix.length;
    }

    public reset(value: string, cursor?: number) {
        const clamped = cursor === undefined ? value.length : Math.max(0, Math.min(cursor, value.length));
        this.prefix = value.slice(0, clamped);
        this.suffix = value.slice(clamped);
    }

    public insert(text: string) {
        if (text.length === 0) {
            return false;
        }

        this.prefix += text;
        return true;
    }

    public backspace() {
        if (this.prefix.length === 0) {
            return false;
        }

        this.prefix = this.prefix.slice(0, -1);
        return true;
    }

    public delete() {
        if (this.suffix.length === 0) {
            return false;
        }

        this.suffix = this.suffix.slice(1);
        return true;
    }

    public moveLeft() {
        if (this.prefix.length === 0) {
            return false;
        }

        const ch = this.prefix.slice(-1);
        this.prefix = this.prefix.slice(0, -1);
        this.suffix = ch + this.suffix;
        return true;
    }

    public moveRight() {
        if (this.suffix.length === 0) {
            return false;
        }

        const ch = this.suffix[0];
        this.suffix = this.suffix.slice(1);
        this.prefix = this.prefix + ch;
        return true;
    }

    public home() {
        if (this.prefix.length === 0) {
            return false;
        }

        this.suffix = this.prefix + this.suffix;
        this.prefix = "";
        return true;
    }

    public end() {
        if (this.suffix.length === 0) {
            return false;
        }

        this.prefix = this.prefix + this.suffix;
        this.suffix = "";
        return true;
    }
}
