// FIFO with hard cap. Bounds memory when consumers stall.
export type OverflowPolicy = 'drop-oldest' | 'drop-newest' | 'reject';

export interface BoundedQueueOptions<T = unknown> {
    maxSize: number;
    overflow: OverflowPolicy;
    onDrop?: (reason: 'oldest' | 'newest', item: T) => void;
}

export class BoundedQueueFullError extends Error {
    constructor(maxSize: number) {
        super(`BoundedQueue at capacity (${maxSize})`);
        this.name = 'BoundedQueueFullError';
    }
}

export class BoundedQueue<T> {
    readonly #items: T[] = [];
    readonly #maxSize: number;
    readonly #overflow: OverflowPolicy;
    readonly #onDrop?: (reason: 'oldest' | 'newest', item: T) => void;

    constructor(options: BoundedQueueOptions<T>) {
        this.#maxSize = Math.max(1, options.maxSize);
        this.#overflow = options.overflow;
        this.#onDrop = options.onDrop;
    }

    push(item: T): void {
        if (this.#items.length < this.#maxSize) {
            this.#items.push(item);
            return;
        }
        if (this.#overflow === 'drop-oldest') {
            const dropped = this.#items.shift() as T;
            this.#items.push(item);
            this.#onDrop?.('oldest', dropped);
            return;
        }
        if (this.#overflow === 'drop-newest') {
            this.#onDrop?.('newest', item);
            return;
        }
        throw new BoundedQueueFullError(this.#maxSize);
    }

    drain(n = this.#items.length): T[] {
        if (n <= 0) return [];
        return this.#items.splice(0, n);
    }

    peek(): T | undefined {
        return this.#items[0];
    }

    clear(): void {
        this.#items.length = 0;
    }

    get size(): number {
        return this.#items.length;
    }

    get maxSize(): number {
        return this.#maxSize;
    }

    get isFull(): boolean {
        return this.#items.length >= this.#maxSize;
    }
}
