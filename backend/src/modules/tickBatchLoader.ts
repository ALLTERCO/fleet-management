// Gathers the keys asked for during one event-loop turn and loads them with
// one call per scope, in bounded batches (the DataLoader pattern). A burst of
// callers then costs one database round trip and one pool checkout per batch
// instead of one each. Nothing is kept after a call settles.

export interface TickBatchLoaderSpec<V> {
    maxBatchSize: number;
    // Answers every key of one scope. A key left out is rejected for its callers.
    loadBatch(
        scope: string,
        keys: readonly string[]
    ): Promise<ReadonlyMap<string, V>>;
}

interface Waiter<V> {
    resolve(value: V): void;
    reject(error: unknown): void;
}

type KeyWaiters<V> = Map<string, Waiter<V>[]>;

export class TickBatchLoader<V> {
    readonly #spec: TickBatchLoaderSpec<V>;
    #pending = new Map<string, KeyWaiters<V>>();
    #scheduled = false;

    constructor(spec: TickBatchLoaderSpec<V>) {
        if (!Number.isSafeInteger(spec.maxBatchSize) || spec.maxBatchSize < 1) {
            throw Object.assign(new Error('Batch limit must be at least 1'), {
                code: 'BATCH_LIMIT_INVALID'
            });
        }
        this.#spec = spec;
    }

    load(scope: string, key: string): Promise<V> {
        return new Promise<V>((resolve, reject) => {
            this.#enqueue(scope, key, {resolve, reject});
        });
    }

    #enqueue(scope: string, key: string, waiter: Waiter<V>): void {
        let keys = this.#pending.get(scope);
        if (!keys) {
            keys = new Map();
            this.#pending.set(scope, keys);
        }
        keys.set(key, [...(keys.get(key) ?? []), waiter]);
        if (this.#scheduled) return;
        this.#scheduled = true;
        setImmediate(() => this.#flush());
    }

    #flush(): void {
        this.#scheduled = false;
        // Detach first so keys asked for from now on go to a new call.
        const pending = this.#pending;
        this.#pending = new Map();
        const limit = this.#spec.maxBatchSize;
        for (const [scope, keys] of pending) {
            const entries = [...keys];
            for (let i = 0; i < entries.length; i += limit) {
                void this.#send(scope, new Map(entries.slice(i, i + limit)));
            }
        }
    }

    async #send(scope: string, batch: KeyWaiters<V>): Promise<void> {
        const values = await this.#loadOrReject(scope, batch);
        if (values) settleBatch(batch, values);
    }

    async #loadOrReject(
        scope: string,
        batch: KeyWaiters<V>
    ): Promise<ReadonlyMap<string, V> | undefined> {
        try {
            return await this.#spec.loadBatch(scope, [...batch.keys()]);
        } catch (error) {
            rejectBatch(batch, error);
            return undefined;
        }
    }
}

function settleBatch<V>(
    batch: KeyWaiters<V>,
    values: ReadonlyMap<string, V>
): void {
    const unanswered = new Map(batch);
    for (const [key, value] of values) {
        for (const waiter of unanswered.get(key) ?? []) waiter.resolve(value);
        unanswered.delete(key);
    }
    if (unanswered.size === 0) return;
    rejectBatch(
        unanswered,
        Object.assign(new Error('Batch load did not answer every key'), {
            code: 'BATCH_KEY_UNANSWERED'
        })
    );
}

function rejectBatch<V>(batch: KeyWaiters<V>, error: unknown): void {
    for (const waiters of batch.values()) {
        for (const waiter of waiters) waiter.reject(error);
    }
}
