import {Pool, type PoolClient, type PoolConfig} from 'pg';
import {
    claimDbCallTiming,
    type DbCallTiming,
    markCheckoutFailed,
    markDbCall
} from './dbCallTiming';
import {
    currentDbWorkload,
    currentDbWorkPriority,
    type DbWorkPriority
} from './dbWorkPriority';

// A bulkhead inside one pg pool: background work may use every connection
// except the foreground reserve, and a waiting user request is served before
// waiting background work, except that background gets at least one grant in
// every `capacity` while both wait, so user load cannot starve it. The gate is
// taken once per checkout, so the statements of a held transaction never
// queue on it. A kind's cap is its guaranteed share; a borrowing kind may go
// past it only onto connections nothing else waits for (work-conserving, like
// a cgroup weight beside a hard cpu.max), and gets none above its share while
// other work waits, so it shrinks back as its calls finish.

export interface DbCheckoutGateOptions {
    capacity: number;
    foregroundReserve: number;
    // 0 waits forever, like pg-pool's connectionTimeoutMillis.
    waitTimeoutMs: number;
    // Milliseconds; tests pass their own clock.
    now?: () => number;
    // Permits one kind of work is entitled to (its share, not a reservation).
    workloadCaps?: Readonly<Record<string, number>>;
    // Kinds that may pass their cap on idle connections, up to every
    // background connection but one, which stays free for other work.
    borrowingWorkloads?: readonly string[];
}

export interface DbWorkloadShareSums {
    // Within the kind's cap.
    guaranteed: number;
    // Above it, on borrowed idle connections.
    borrowed: number;
}

export interface DbWorkloadOccupancy {
    // Permit-milliseconds; the rate is the average connections held.
    msHeld: DbWorkloadShareSums;
    grants: DbWorkloadShareSums;
}

// Sums kept by the gate itself, so short spikes between scrapes still count.
export interface DbCheckoutGateOccupancy {
    // Index is the number of permits in use.
    msAtInUse: number[];
    // A waiter of that priority while a connection was free.
    msWaitingWithRoom: Record<DbWorkPriority, number>;
    // Labelled kinds only; unlabelled work is the rest of msAtInUse.
    workloads: Record<string, DbWorkloadOccupancy>;
}

export interface DbCheckoutGateStats {
    inUse: number;
    foregroundWaiting: number;
    backgroundWaiting: number;
}

// One kind of work against everything else, so a kind that borrows idle
// connections can tell its own load from other work's.
export interface DbWorkloadGateStats {
    // Permits the kind holds, and its checkouts waiting at the gate.
    inUse: number;
    waiting: number;
    // Other checkouts waiting that the gate would serve first.
    othersWaiting: number;
    // Its guaranteed share and the most it may hold by borrowing.
    share: number;
    ceiling: number;
    // More permits it could be given now without passing other work.
    room: number;
}

export type DbCheckoutRelease = () => void;

// Runs in the tick the gate gives the permit or gives up, before the waiting
// call can resume.
export type DbCheckoutDecided = () => void;

interface Waiter {
    admit: (release: DbCheckoutRelease) => void;
    timer: NodeJS.Timeout | undefined;
    workload: string | undefined;
}

function noop(): void {}

function emptyWorkloadOccupancy(): DbWorkloadOccupancy {
    return {
        msHeld: {guaranteed: 0, borrowed: 0},
        grants: {guaranteed: 0, borrowed: 0}
    };
}

function copyWorkloadOccupancy(sums: DbWorkloadOccupancy): DbWorkloadOccupancy {
    return {msHeld: {...sums.msHeld}, grants: {...sums.grants}};
}

export class DbCheckoutTimeoutError extends Error {
    readonly code = 'DB_POOL_CHECKOUT_TIMEOUT';

    constructor() {
        // pg-pool's text, so isTransientDatabaseError keeps the data queued.
        super('timeout exceeded when trying to connect');
        this.name = 'DbCheckoutTimeoutError';
    }
}

export class DbCheckoutGate {
    readonly #capacity: number;
    readonly #backgroundLimit: number;
    readonly #waitTimeoutMs: number;
    readonly #waiting: Record<DbWorkPriority, Waiter[]> = {
        foreground: [],
        background: []
    };
    #inUse = 0;
    // One background grant in every this many while both queues wait.
    readonly #backgroundEvery: number;
    // Foreground grants made in a row while background waited.
    #foregroundStreak = 0;
    readonly #now: () => number;
    readonly #workloadCaps: Readonly<Record<string, number>>;
    // Above the cap only for borrowing kinds.
    readonly #workloadCeilings: Readonly<Record<string, number>>;
    readonly #inUseByWorkload = new Map<string, number>();
    readonly #workloadSums = new Map<string, DbWorkloadOccupancy>();
    #accountedAt: number;
    readonly #msAtInUse: number[];
    readonly #msWaitingWithRoom: Record<DbWorkPriority, number> = {
        foreground: 0,
        background: 0
    };

    constructor(options: DbCheckoutGateOptions) {
        const {capacity, foregroundReserve} = options;
        if (foregroundReserve < 0 || foregroundReserve >= capacity) {
            throw new RangeError(
                `foreground reserve ${foregroundReserve} must leave background at least one of ${capacity} connections`
            );
        }
        this.#capacity = capacity;
        this.#backgroundLimit = capacity - foregroundReserve;
        // Scales with the pool: 1 in 10 of a 10-connection pool, and a small
        // pool with little turnover still moves background along.
        this.#backgroundEvery = Math.max(2, capacity);
        this.#waitTimeoutMs = options.waitTimeoutMs;
        this.#now = options.now ?? (() => performance.now());
        this.#workloadCaps = options.workloadCaps ?? {};
        this.#workloadCeilings = this.#borrowCeilings(
            options.borrowingWorkloads ?? []
        );
        this.#accountedAt = this.#now();
        this.#msAtInUse = new Array(capacity + 1).fill(0);
    }

    // Every background connection but one, never less than the cap.
    #borrowCeilings(
        borrowing: readonly string[]
    ): Readonly<Record<string, number>> {
        const ceilings: Record<string, number> = {...this.#workloadCaps};
        for (const workload of borrowing) {
            const cap = this.#workloadCaps[workload];
            if (cap === undefined) continue;
            ceilings[workload] = Math.max(cap, this.#backgroundLimit - 1);
        }
        return ceilings;
    }

    occupancy(): DbCheckoutGateOccupancy {
        this.#account();
        return {
            msAtInUse: [...this.#msAtInUse],
            msWaitingWithRoom: {...this.#msWaitingWithRoom},
            workloads: Object.fromEntries(
                [...this.#workloadSums].map(([workload, sums]) => [
                    workload,
                    copyWorkloadOccupancy(sums)
                ])
            )
        };
    }

    // Charges the time since the last change to the state that held during it.
    // Called before every change of permits in use or of the queues.
    #account(): void {
        const now = this.#now();
        const elapsed = now - this.#accountedAt;
        this.#accountedAt = now;
        if (elapsed <= 0) return;
        this.#msAtInUse[this.#inUse] += elapsed;
        if (this.#hasEntitled('foreground') && this.#inUse < this.#capacity) {
            this.#msWaitingWithRoom.foreground += elapsed;
        }
        if (
            this.#hasEntitled('background') &&
            this.#inUse < this.#backgroundLimit
        ) {
            this.#msWaitingWithRoom.background += elapsed;
        }
        this.#accountWorkloads(elapsed);
    }

    #accountWorkloads(elapsed: number): void {
        for (const [workload, inUse] of this.#inUseByWorkload) {
            if (inUse === 0) continue;
            const guaranteed = Math.min(inUse, this.#cap(workload));
            const held = this.#sumsOf(workload).msHeld;
            held.guaranteed += guaranteed * elapsed;
            held.borrowed += (inUse - guaranteed) * elapsed;
        }
    }

    #sumsOf(workload: string): DbWorkloadOccupancy {
        let sums = this.#workloadSums.get(workload);
        if (!sums) {
            sums = emptyWorkloadOccupancy();
            this.#workloadSums.set(workload, sums);
        }
        return sums;
    }

    acquire(
        priority: DbWorkPriority,
        onDecided: DbCheckoutDecided = noop,
        workload?: string
    ): Promise<DbCheckoutRelease> {
        if (this.#canAdmitNow(priority, workload)) {
            const release = this.#grant(priority, workload);
            onDecided();
            return Promise.resolve(release);
        }
        return this.#enqueue(priority, onDecided, workload);
    }

    // A new caller never passes a waiter of its own standing.
    #canAdmitNow(
        priority: DbWorkPriority,
        workload: string | undefined
    ): boolean {
        if (this.#entitled(workload)) {
            return !this.#hasEntitled(priority) && this.#canAdmit(priority);
        }
        return (
            this.#mayBorrow(workload) &&
            this.#firstBorrower(priority) < 0 &&
            this.#canBorrow()
        );
    }

    workloadInUse(): Record<string, number> {
        return Object.fromEntries(
            [...this.#inUseByWorkload].filter(([, count]) => count > 0)
        );
    }

    workloadStats(workload: string): DbWorkloadGateStats {
        const all = [...this.#waiting.foreground, ...this.#waiting.background];
        const waiting = all.filter((w) => w.workload === workload).length;
        const othersWaiting = all.filter(
            (w) => w.workload !== workload && this.#entitled(w.workload)
        ).length;
        const inUse = this.#held(workload);
        const share = Math.min(this.#cap(workload), this.#backgroundLimit);
        const ceiling = this.#workloadCeilings[workload] ?? share;
        const free =
            othersWaiting > 0
                ? share - inUse
                : Math.min(
                      ceiling - inUse,
                      this.#backgroundLimit - this.#inUse
                  );
        return {
            inUse,
            waiting,
            othersWaiting,
            share,
            ceiling,
            room: Math.max(0, free - waiting)
        };
    }

    // Most permits the kind may hold; undefined when it has no cap.
    workloadCeiling(workload: string): number | undefined {
        return this.#workloadCeilings[workload];
    }

    #held(workload: string): number {
        return this.#inUseByWorkload.get(workload) ?? 0;
    }

    #cap(workload: string): number {
        return this.#workloadCaps[workload] ?? Number.POSITIVE_INFINITY;
    }

    // Within the kind's guaranteed share; unlabelled work always is.
    #entitled(workload: string | undefined): boolean {
        return (
            workload === undefined || this.#held(workload) < this.#cap(workload)
        );
    }

    #mayBorrow(workload: string | undefined): boolean {
        if (workload === undefined) return false;
        const ceiling = this.#workloadCeilings[workload];
        return ceiling !== undefined && this.#held(workload) < ceiling;
    }

    // Only a connection no entitled waiter of either priority can use, and
    // never one of the foreground reserve.
    #canBorrow(): boolean {
        return (
            !this.#hasEntitled('foreground') &&
            !this.#hasEntitled('background') &&
            this.#inUse < this.#backgroundLimit
        );
    }

    // Waiters held only by their own kind's cap do not hold back the queue.
    #firstEntitled(priority: DbWorkPriority): number {
        return this.#waiting[priority].findIndex((waiter) =>
            this.#entitled(waiter.workload)
        );
    }

    #firstBorrower(priority: DbWorkPriority): number {
        return this.#waiting[priority].findIndex(
            (waiter) =>
                !this.#entitled(waiter.workload) &&
                this.#mayBorrow(waiter.workload)
        );
    }

    #hasEntitled(priority: DbWorkPriority): boolean {
        return this.#firstEntitled(priority) >= 0;
    }

    stats(): DbCheckoutGateStats {
        return {
            inUse: this.#inUse,
            foregroundWaiting: this.#waiting.foreground.length,
            backgroundWaiting: this.#waiting.background.length
        };
    }

    // While background is due, users wait for the release that lets it in
    // without touching the reserve.
    #backgroundDue(): boolean {
        return (
            this.#hasEntitled('background') &&
            this.#foregroundStreak >= this.#backgroundEvery - 1
        );
    }

    #canAdmit(priority: DbWorkPriority): boolean {
        if (priority === 'foreground') {
            return this.#inUse < this.#capacity && !this.#backgroundDue();
        }
        return (
            (!this.#hasEntitled('foreground') || this.#backgroundDue()) &&
            this.#inUse < this.#backgroundLimit
        );
    }

    #grant(
        priority: DbWorkPriority,
        workload: string | undefined
    ): DbCheckoutRelease {
        if (priority === 'foreground' && this.#hasEntitled('background')) {
            this.#foregroundStreak++;
        } else {
            this.#foregroundStreak = 0;
        }
        return this.#take(workload);
    }

    #take(workload: string | undefined): DbCheckoutRelease {
        this.#account();
        this.#inUse++;
        this.#countWorkload(workload, 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.#account();
            this.#inUse--;
            this.#countWorkload(workload, -1);
            this.#admitWaiters();
        };
    }

    #countWorkload(workload: string | undefined, change: number): void {
        if (workload === undefined) return;
        if (change > 0) this.#countGrant(workload);
        this.#inUseByWorkload.set(workload, this.#held(workload) + change);
    }

    #countGrant(workload: string): void {
        const grants = this.#sumsOf(workload).grants;
        if (this.#entitled(workload)) grants.guaranteed++;
        else grants.borrowed++;
    }

    #admitWaiters(): void {
        for (;;) {
            const next = this.#nextToAdmit();
            if (!next) return;
            this.#account();
            const [waiter] = this.#waiting[next.priority].splice(next.index, 1);
            clearTimeout(waiter.timer);
            waiter.admit(this.#grant(next.priority, waiter.workload));
        }
    }

    #nextToAdmit(): {priority: DbWorkPriority; index: number} | null {
        const order: DbWorkPriority[] = this.#backgroundDue()
            ? ['background', 'foreground']
            : ['foreground', 'background'];
        for (const priority of order) {
            const index = this.#firstEntitled(priority);
            if (index >= 0 && this.#canAdmit(priority)) {
                return {priority, index};
            }
        }
        return this.#nextBorrower();
    }

    #nextBorrower(): {priority: DbWorkPriority; index: number} | null {
        if (!this.#canBorrow()) return null;
        for (const priority of ['foreground', 'background'] as const) {
            const index = this.#firstBorrower(priority);
            if (index >= 0) return {priority, index};
        }
        return null;
    }

    #enqueue(
        priority: DbWorkPriority,
        onDecided: DbCheckoutDecided,
        workload: string | undefined
    ): Promise<DbCheckoutRelease> {
        const queue = this.#waiting[priority];
        return new Promise((resolve, reject) => {
            const admit = (release: DbCheckoutRelease) => {
                onDecided();
                resolve(release);
            };
            const waiter: Waiter = {admit, timer: undefined, workload};
            if (this.#waitTimeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    this.#account();
                    queue.splice(queue.indexOf(waiter), 1);
                    onDecided();
                    reject(new DbCheckoutTimeoutError());
                    // A due background waiter that gave up held users back.
                    this.#admitWaiters();
                }, this.#waitTimeoutMs);
                waiter.timer.unref();
            }
            this.#account();
            queue.push(waiter);
        });
    }
}

type PoolConnectCallback = (
    err: Error | undefined,
    client: PoolClient | undefined,
    done: (release?: Error | boolean) => void
) => void;

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export interface DbCheckedOutStats {
    foregroundCheckedOut: number;
    backgroundCheckedOut: number;
}

interface CheckoutReturn {
    releaseGate: DbCheckoutRelease;
    timing: DbCallTiming | undefined;
    // Runs once, when the connection goes back.
    onReturn: () => void;
}

// The permit follows the connection back to the pool, after pg-pool has
// made it idle, so the next admitted waiter finds it there.
function releaseGateWithClient(
    client: PoolClient,
    {releaseGate, timing, onReturn}: CheckoutReturn
): void {
    const releaseClient = client.release;
    let returned = false;
    client.release = (err?: Error | boolean) => {
        markDbCall(timing, 'releasedAt');
        if (!returned) {
            returned = true;
            onReturn();
        }
        try {
            releaseClient(err);
        } finally {
            releaseGate();
        }
    };
}

export interface DbWorkloadShares {
    caps?: DbCheckoutGateOptions['workloadCaps'];
    borrowing?: DbCheckoutGateOptions['borrowingWorkloads'];
}

// pg-pool's own query() checks out through connect(), so one override covers
// single statements and transactions alike.
export class PriorityPool extends Pool {
    readonly #gate: DbCheckoutGate;
    readonly #checkedOut: Record<DbWorkPriority, number> = {
        foreground: 0,
        background: 0
    };

    constructor(
        config: PoolConfig,
        foregroundReserve: number,
        workloads: DbWorkloadShares = {}
    ) {
        super(config);
        // A pool smaller than the budget (tools, tests) still serves background.
        const spare = Math.max(0, this.options.max - 1);
        this.#gate = new DbCheckoutGate({
            capacity: this.options.max,
            foregroundReserve: Math.min(foregroundReserve, spare),
            waitTimeoutMs: this.options.connectionTimeoutMillis ?? 0,
            workloadCaps: workloads.caps,
            borrowingWorkloads: workloads.borrowing
        });
    }

    override connect(): Promise<PoolClient>;
    override connect(callback: PoolConnectCallback): void;
    override connect(
        callback?: PoolConnectCallback
    ): Promise<PoolClient> | undefined {
        const timing = claimDbCallTiming();
        const checkout = this.#checkout(timing);
        if (!callback) return checkout;
        // pg-pool's own query() sends its statement from this callback.
        checkout.then(
            (client) => {
                markDbCall(timing, 'checkoutResumedAt');
                callback(undefined, client, client.release);
            },
            (error: unknown) => callback(asError(error), undefined, noop)
        );
        return undefined;
    }

    gateStats(): DbCheckoutGateStats {
        return this.#gate.stats();
    }

    gateOccupancy(): DbCheckoutGateOccupancy {
        return this.#gate.occupancy();
    }

    workloadGateStats(workload: string): DbWorkloadGateStats {
        return this.#gate.workloadStats(workload);
    }

    checkedOutStats(): DbCheckedOutStats {
        return {
            foregroundCheckedOut: this.#checkedOut.foreground,
            backgroundCheckedOut: this.#checkedOut.background
        };
    }

    async #checkout(timing: DbCallTiming | undefined): Promise<PoolClient> {
        const priority = currentDbWorkPriority();
        let releaseGate: DbCheckoutRelease;
        try {
            releaseGate = await this.#gate.acquire(
                priority,
                () => markDbCall(timing, 'gateDoneAt'),
                currentDbWorkload()
            );
        } catch (error) {
            markCheckoutFailed(timing);
            throw error;
        }
        markDbCall(timing, 'gateResumedAt');
        try {
            const client = await this.#handOver(priority, timing);
            releaseGateWithClient(client, {
                releaseGate,
                timing,
                onReturn: () => this.#checkedOut[priority]--
            });
            return client;
        } catch (error) {
            markCheckoutFailed(timing);
            releaseGate();
            throw error;
        }
    }

    // pg-pool calls a connect callback in the tick it hands the connection
    // over; its promise would resolve later, behind other queued work.
    #handOver(
        priority: DbWorkPriority,
        timing: DbCallTiming | undefined
    ): Promise<PoolClient> {
        return new Promise((resolve, reject) => {
            super.connect((error, client) => {
                markDbCall(timing, 'checkoutDoneAt');
                if (!client) {
                    reject(error);
                    return;
                }
                this.#checkedOut[priority]++;
                resolve(client);
            });
        });
    }
}

export interface PoolStatsLike {
    totalCount?: number;
    idleCount?: number;
    waitingCount?: number;
}

export interface PriorityPoolStats
    extends DbCheckoutGateStats,
        DbCheckedOutStats {
    totalCount: number;
    idleCount: number;
    // Every checkout still waiting, in the gate or in pg-pool's own queue.
    waitingCount: number;
}

const NO_GATE: DbCheckoutGateStats = {
    inUse: 0,
    foregroundWaiting: 0,
    backgroundWaiting: 0
};

const NONE_CHECKED_OUT: DbCheckedOutStats = {
    foregroundCheckedOut: 0,
    backgroundCheckedOut: 0
};

export function priorityPoolStats(pool: PoolStatsLike): PriorityPoolStats {
    const priority = pool instanceof PriorityPool;
    const gate = priority ? pool.gateStats() : NO_GATE;
    return {
        ...gate,
        ...(priority ? pool.checkedOutStats() : NONE_CHECKED_OUT),
        totalCount: pool.totalCount ?? 0,
        idleCount: pool.idleCount ?? 0,
        waitingCount:
            (pool.waitingCount ?? 0) +
            gate.foregroundWaiting +
            gate.backgroundWaiting
    };
}
