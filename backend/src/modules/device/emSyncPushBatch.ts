// Live pushes that arrive close together share one Redis call, the way a
// Kafka producer holds records for linger.ms or until batch.size: a batch is
// sent when its window ends or when it is full, whichever comes first. Each
// push stays its own group, admitted whole or refused whole by the byte
// budget script; only the round trip is shared, so the Redis write limit
// counts calls, not pushes.

import type {ByteBudgetGroup} from '../redis/RedisStream';

export type EmSyncPushGroup = ByteBudgetGroup;

export interface EmSyncPushBatcherOptions {
    // Longest a push waits for others (ms); 0 shares only one event-loop turn.
    lingerMs: number;
    // Most entries in one call; a single larger push goes alone, whole.
    maxEntries: number;
    // true per group that was stored; a rejection refuses the whole call.
    append: (groups: EmSyncPushGroup[]) => Promise<boolean[]>;
}

interface Pending {
    group: EmSyncPushGroup;
    answer: (stored: boolean) => void;
}

export class EmSyncPushBatcher {
    readonly #options: EmSyncPushBatcherOptions;
    #pending: Pending[] = [];
    #entries = 0;
    #timer: NodeJS.Timeout | undefined;

    constructor(options: EmSyncPushBatcherOptions) {
        this.#options = options;
    }

    // true once the push is stored; false when it was refused or Redis failed.
    add(group: EmSyncPushGroup): Promise<boolean> {
        const size = group.entries.length;
        if (
            this.#entries > 0 &&
            this.#entries + size > this.#options.maxEntries
        ) {
            this.#flush();
        }
        return new Promise((answer) => {
            this.#pending.push({group, answer});
            this.#entries += size;
            if (this.#entries >= this.#options.maxEntries) {
                this.#flush();
            } else if (!this.#timer) {
                this.#timer = setTimeout(
                    () => this.#flush(),
                    this.#options.lingerMs
                );
            }
        });
    }

    #flush(): void {
        clearTimeout(this.#timer);
        this.#timer = undefined;
        const batch = this.#pending;
        this.#pending = [];
        this.#entries = 0;
        if (batch.length === 0) return;
        this.#options.append(batch.map((p) => p.group)).then(
            (stored) => {
                for (const [i, p] of batch.entries()) {
                    p.answer(stored[i] === true);
                }
            },
            () => {
                for (const p of batch) p.answer(false);
            }
        );
    }
}
