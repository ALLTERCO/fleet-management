// An async resource as an external store, so stale-request, session and
// cleanup rules are implemented once instead of per framework.

import {toFleetSdkError} from './errors';
import {createExternalStore, type ExternalStore} from './external-store';
import type {FleetConnectionState} from './live-events';
import {createSessionGuard, type FleetSessionIdentity} from './session';
import type {FleetFreshness, FleetResourceState, HostLifecycle} from './types';

export type FleetResource<T> = ExternalStore<FleetResourceState<T>> &
    HostLifecycle & {
        refresh(): Promise<void>;
        /** Replaces loaded data with a live update. Ignored before a load. */
        setData(data: T): void;
        /** Starts the session and connection watches. Idempotent, and ignored
         * once disposed. */
        attach(): void;
        /** Releases both watches. Idempotent, and re-attachable. */
        detach(): void;
        /** Releases the watches and stops accepting results. Idempotent. */
        dispose(): void;
    };

export type FleetResourceOptions<T> = {
    load: () => Promise<T>;
    initial: T;
    /** Freshness to report once loaded. Live subscriptions override it. */
    freshness?: FleetFreshness;
    /** Identity this data belongs to. A change discards it. */
    session?: ExternalStore<FleetSessionIdentity>;
    /**
     * The feed keeping this data current. Supplied only by a resource that
     * really has one: while it is not connected the data is reported `stale`
     * rather than as the freshness a live read would have claimed, and its
     * return refetches. Omitted, nothing about freshness changes.
     */
    connection?: ExternalStore<FleetConnectionState>;
};

/** One load, tied to the attachment that started it. */
type LoadAttempt = {request: number; attachment: number};

function idleState<T>(initial: T): FleetResourceState<T> {
    return {
        status: 'idle',
        data: initial,
        error: null,
        updatedAt: null,
        freshness: 'unknown'
    };
}

export function createResource<T>(
    options: FleetResourceOptions<T>
): FleetResource<T> {
    // One idle snapshot for the whole lifetime: writing it again notifies
    // nobody, and readers get the stable reference React's contract wants.
    const idle = idleState(options.initial);
    const store = createExternalStore<FleetResourceState<T>>(idle);
    const session = createSessionGuard(options.session);
    const loadedFreshness = options.freshness ?? 'live';
    // Only the newest load may write: a slow first request must not overwrite
    // a fast second one, and a session change must cancel both.
    let latestRequest = 0;
    let disposed = false;
    // A load belongs to the attachment that started it, so a reply landing
    // after a detach has no mounted view left to write to.
    let attachment = 0;
    let releaseSession: (() => void) | null = null;
    let releaseConnection: (() => void) | null = null;

    /** No feed declared means nothing can go quiet, so the answer is yes. */
    function feedIsLive(): boolean {
        const connection = options.connection?.getSnapshot();
        return connection === undefined || connection.status === 'connected';
    }

    /** What a load that just succeeded may honestly claim. */
    function freshnessNow(): FleetFreshness {
        return feedIsLive() ? loadedFreshness : 'stale';
    }

    /** Data loaded for another identity is withheld, watched or not. */
    function currentState(): FleetResourceState<T> {
        return !disposed && session.invalidated() ? idle : store.getSnapshot();
    }

    function isStale(attempt: LoadAttempt): boolean {
        return (
            disposed ||
            attempt.attachment !== attachment ||
            attempt.request !== latestRequest
        );
    }

    async function refresh(): Promise<void> {
        if (disposed) return;
        const attempt: LoadAttempt = {request: ++latestRequest, attachment};
        const base = currentState();
        // The request belongs to the identity present now, not the loaded one.
        session.reset();
        store.setSnapshot({...base, status: 'loading', error: null});
        try {
            const data = await options.load();
            if (isStale(attempt)) return;
            store.setSnapshot({
                status: 'ready',
                data,
                error: null,
                updatedAt: Date.now(),
                freshness: freshnessNow()
            });
        } catch (cause) {
            if (isStale(attempt)) return;
            const error = toFleetSdkError(cause);
            store.setSnapshot({
                ...store.getSnapshot(),
                status: 'error',
                error,
                freshness: error.permissionDenied
                    ? 'permission_filtered'
                    : 'stale'
            });
        }
    }

    function setData(data: T): void {
        const current = currentState();
        if (disposed || current.status !== 'ready') return;
        store.setSnapshot({...current, data, updatedAt: Date.now()});
    }

    /** The new identity gets its own data. Signed out there is none to ask
     * for, and a resource that never loaded was not asked to. */
    function adoptNewIdentity(): void {
        if (disposed) return;
        const wasShowingData = store.getSnapshot().status !== 'idle';
        latestRequest += 1;
        store.setSnapshot(idle);
        if (wasShowingData && !session.signedOut()) void refresh();
    }

    /**
     * A feed that stops does not make loaded data wrong, it makes it old — so
     * the data stays and the freshness tells the truth about it. The return
     * refetches, because the fleet moved while nobody was listening.
     */
    function followConnection(): void {
        if (disposed) return;
        const current = currentState();
        if (current.status === 'idle') return;
        if (!feedIsLive()) {
            if (current.freshness === 'stale') return;
            store.setSnapshot({...current, freshness: 'stale'});
            return;
        }
        void refresh();
    }

    // Building a resource listens to nothing, so a framework that builds one
    // and throws it away leaves no listener on the session store.
    function attach(): void {
        if (disposed) return;
        releaseSession ??= session.watch(adoptNewIdentity);
        if (options.connection && !releaseConnection) {
            releaseConnection = options.connection.subscribe(followConnection);
        }
    }

    /** Ends the attachment, so a load still in flight can no longer write. */
    function detach(): void {
        attachment += 1;
        releaseSession?.();
        releaseSession = null;
        releaseConnection?.();
        releaseConnection = null;
    }

    return {
        getSnapshot: currentState,
        subscribe: store.subscribe,
        refresh,
        setData,
        attach,
        detach,
        dispose() {
            disposed = true;
            detach();
        }
    };
}
