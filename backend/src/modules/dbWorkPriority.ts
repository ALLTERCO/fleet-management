import {AsyncLocalStorage} from 'node:async_hooks';

// Who is waiting for a database connection. A user request is foreground;
// everything else (device events, alerts, journals, timers) is background.
export type DbWorkPriority = 'foreground' | 'background';

interface DbWorkScope {
    active: boolean;
    // Requests awaiting this detached work; each lends it its priority.
    joinedBy: DbWorkScope[];
}

const workScope = new AsyncLocalStorage<DbWorkScope>();
const detachedScopes = new WeakMap<Promise<unknown>, DbWorkScope>();

function isForeground(scope: DbWorkScope | undefined): boolean {
    if (!scope) return false;
    return scope.active || scope.joinedBy.some(isForeground);
}

// Marks the body as user work. The mark ends with the body, so timers and
// fire-and-forget work it started run as background once it has answered.
export async function runAsForegroundDbWork<T>(
    body: () => Promise<T>
): Promise<T> {
    const scope: DbWorkScope = {active: true, joinedBy: []};
    try {
        return await workScope.run(scope, body);
    } finally {
        scope.active = false;
    }
}

// Work a request starts but does not wait for, so it never holds the
// foreground reserve, even while that request is still running.
export function runAsBackgroundDbWork<T>(body: () => Promise<T>): Promise<T> {
    const scope: DbWorkScope = {active: false, joinedBy: []};
    const work = workScope.run(scope, body);
    detachedScopes.set(work, scope);
    return work;
}

// A request that waits on detached work lends it foreground until the request
// ends; otherwise the request would queue behind its own background work.
export function joinDbWork<T>(work: Promise<T>): Promise<T> {
    const scope = detachedScopes.get(work);
    const joiner = workScope.getStore();
    if (scope && joiner && isForeground(joiner)) {
        scope.joinedBy = scope.joinedBy.filter(isForeground);
        scope.joinedBy.push(joiner);
    }
    return work;
}

export function currentDbWorkPriority(): DbWorkPriority {
    return isForeground(workScope.getStore()) ? 'foreground' : 'background';
}

// Which kind of work this is, for per-kind connection caps (alerts, energy
// saves). Unlabelled work has no cap of its own.
const workloadScope = new AsyncLocalStorage<string>();

export function runAsDbWorkload<T>(
    workload: string,
    body: () => Promise<T>
): Promise<T> {
    return workloadScope.run(workload, body);
}

export function currentDbWorkload(): string | undefined {
    return workloadScope.getStore();
}
