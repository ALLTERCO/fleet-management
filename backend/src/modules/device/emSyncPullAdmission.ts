// History pulls fetch a meter page only when the database can store it soon,
// and store it without a checkout timeout. A bulkhead in front of the em-sync
// connection share: at most `connections()` page writes reach the pool at once
// (the guaranteed share, more while the pool lends idle connections);
// the rest wait here in arrival order with no deadline, so a fetched page is
// never thrown away for want of a connection. Pages fetched ahead of the
// writers are bounded too (`pagesPerConnection` per connection) and handed
// out oldest bookmark first, so every channel moves toward the live edge.

import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {getEmSyncWriteConnections} from '../PostgresProvider';

export type EmSyncPageRelease = () => void;

export interface EmSyncPageWait {
    // A reclaimed pass gives its place up.
    signal?: AbortSignal;
    // Epoch ms after which the pass no longer wants a page.
    deadlineMs?: number;
}

export interface EmSyncPullAdmissionOptions {
    // Connections em-sync may use now; read at every hand-over, so page
    // writes follow what the pool grants em-sync.
    connections: () => number;
    // Pages fetched or being stored per connection.
    pagesPerConnection: number;
}

export interface EmSyncPullAdmissionStats {
    pagesOut: number;
    pagesWaiting: number;
    writing: number;
    writesWaiting: number;
}

interface PageWaiter {
    bookmark: number;
    seq: number;
    grant: (release: EmSyncPageRelease | null) => void;
}

export class EmSyncPullAdmission {
    readonly #connections: () => number;
    readonly #pagesPerConnection: number;
    #pagesOut = 0;
    #writing = 0;
    #seq = 0;
    // Sorted by (bookmark, seq): the channel furthest behind goes first.
    readonly #pageWaiters: PageWaiter[] = [];
    readonly #writeWaiters: Array<() => void> = [];

    constructor(options: EmSyncPullAdmissionOptions) {
        this.#connections = options.connections;
        this.#pagesPerConnection = Math.max(1, options.pagesPerConnection);
    }

    stats(): EmSyncPullAdmissionStats {
        return {
            pagesOut: this.#pagesOut,
            pagesWaiting: this.#pageWaiters.length,
            writing: this.#writing,
            writesWaiting: this.#writeWaiters.length
        };
    }

    // A place for one page; null when the pass gave up first.
    reservePage(
        bookmark: number,
        wait: EmSyncPageWait = {}
    ): Promise<EmSyncPageRelease | null> {
        if (wait.signal?.aborted) return Promise.resolve(null);
        return new Promise((resolve) => {
            const waiter: PageWaiter = {
                bookmark,
                seq: ++this.#seq,
                grant: resolve
            };
            const giveUp = () => {
                const at = this.#pageWaiters.indexOf(waiter);
                if (at < 0) return;
                this.#pageWaiters.splice(at, 1);
                this.#publish();
                resolve(null);
            };
            const timer =
                wait.deadlineMs === undefined
                    ? undefined
                    : setTimeout(
                          giveUp,
                          Math.max(0, wait.deadlineMs - Date.now())
                      );
            wait.signal?.addEventListener('abort', giveUp, {once: true});
            waiter.grant = (release) => {
                clearTimeout(timer);
                wait.signal?.removeEventListener('abort', giveUp);
                resolve(release);
            };
            this.#insertPageWaiter(waiter);
            this.#pumpPages();
        });
    }

    // Runs one page write once a connection is free, in arrival order.
    async write<T>(body: () => Promise<T>): Promise<T> {
        await new Promise<void>((admit) => {
            this.#writeWaiters.push(admit);
            this.#pumpWrites();
        });
        try {
            return await body();
        } finally {
            this.#writing--;
            this.#pumpWrites();
        }
    }

    #writeLimit(): number {
        return Math.max(1, Math.floor(this.#connections()));
    }

    #insertPageWaiter(waiter: PageWaiter): void {
        const at = this.#pageWaiters.findIndex(
            (w) => w.bookmark > waiter.bookmark
        );
        if (at < 0) this.#pageWaiters.push(waiter);
        else this.#pageWaiters.splice(at, 0, waiter);
    }

    #pumpPages(): void {
        const limit = this.#writeLimit() * this.#pagesPerConnection;
        while (this.#pageWaiters.length > 0 && this.#pagesOut < limit) {
            const waiter = this.#pageWaiters.shift() as PageWaiter;
            this.#pagesOut++;
            waiter.grant(this.#pageRelease());
        }
        this.#publish();
    }

    #pageRelease(): EmSyncPageRelease {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.#pagesOut--;
            this.#pumpPages();
        };
    }

    #pumpWrites(): void {
        while (
            this.#writeWaiters.length > 0 &&
            this.#writing < this.#writeLimit()
        ) {
            this.#writing++;
            (this.#writeWaiters.shift() as () => void)();
        }
        this.#publish();
    }

    #publish(): void {
        Observability.setGauge(
            'em_sync_pull_pages_waiting',
            this.#pageWaiters.length
        );
        Observability.setGauge(
            'em_sync_pull_writes_waiting',
            this.#writeWaiters.length
        );
    }
}

let shared: EmSyncPullAdmission | undefined;

// One per process: the em-sync share is a per-process pool limit.
export function getEmSyncPullAdmission(): EmSyncPullAdmission {
    if (!shared) {
        shared = new EmSyncPullAdmission({
            connections: getEmSyncWriteConnections,
            pagesPerConnection: tuning.energy.emSyncPullPagesPerConnection
        });
    }
    return shared;
}
