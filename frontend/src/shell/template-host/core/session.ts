// The authoritative identity a snapshot belongs to. Anything cached for one
// identity is invalid for another, so tenant is part of it, not resolved later.

import type {ExternalStore} from './external-store';

export type FleetSessionIdentity = {
    userId: string | null;
    organizationId: string | null;
    isAdmin: boolean;
};

export const ANONYMOUS_SESSION: FleetSessionIdentity = {
    userId: null,
    organizationId: null,
    isAdmin: false
};

export function sameSessionIdentity(
    a: FleetSessionIdentity,
    b: FleetSessionIdentity
): boolean {
    return (
        a.userId === b.userId &&
        a.organizationId === b.organizationId &&
        a.isAdmin === b.isAdmin
    );
}

/** Neither a user nor a tenant: there is nobody left to load data for. */
function isAnonymousSession(identity: FleetSessionIdentity): boolean {
    return identity.userId === null && identity.organizationId === null;
}

/** Null means not yet resolved, so filling one in is arrival, not a switch. */
function knownValueReplaced(
    previous: string | null,
    next: string | null
): boolean {
    return previous !== null && previous !== next;
}

/** True when data loaded for `previous` may not stay on screen for `next`. */
export function sessionInvalidates(
    previous: FleetSessionIdentity,
    next: FleetSessionIdentity
): boolean {
    return (
        knownValueReplaced(previous.userId, next.userId) ||
        knownValueReplaced(previous.organizationId, next.organizationId) ||
        (previous.isAdmin && !next.isAdmin)
    );
}

/** One callback per invalidating move; silent while the identity resolves. */
export function watchSessionInvalidation(
    session: ExternalStore<FleetSessionIdentity> | undefined,
    onInvalidate: () => void
): () => void {
    if (!session) return () => {};
    let previous = session.getSnapshot();
    return session.subscribe(() => {
        const next = session.getSnapshot();
        const invalidated = sessionInvalidates(previous, next);
        previous = next;
        if (invalidated) onInvalidate();
    });
}

/** Answers "may this data still be shown?" without holding a subscription. */
export type FleetSessionGuard = {
    invalidated(): boolean;
    /** True while nobody is signed in. Reads the identity, never the anchor. */
    signedOut(): boolean;
    /** Anchors to the identity present now, for data loaded for it. */
    reset(): void;
    /** Notifies once per invalidating move. Returns the release. */
    watch(onInvalidate: () => void): () => void;
};

/**
 * A guard reads the identity instead of subscribing to it, so an object built
 * during a render that is thrown away leaves nothing behind. `watch` is the
 * separate, commit-time half for callers that also need to be told.
 */
export function createSessionGuard(
    session: ExternalStore<FleetSessionIdentity> | undefined
): FleetSessionGuard {
    const read = () => session?.getSnapshot() ?? ANONYMOUS_SESSION;
    let anchor = read();
    let moved = false;

    return {
        // Sticky, and it follows the identity: the tenant filling in and the
        // tenant being replaced look alike from the identity data loaded under.
        invalidated() {
            const next = read();
            moved ||= sessionInvalidates(anchor, next);
            anchor = next;
            return moved;
        },
        signedOut: () => isAnonymousSession(read()),
        reset() {
            anchor = read();
            moved = false;
        },
        watch: (onInvalidate) => watchSessionInvalidation(session, onInvalidate)
    };
}
