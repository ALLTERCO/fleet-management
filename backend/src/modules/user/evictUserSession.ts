// Order: local cache → live sessions → peer signal. Reverse order lets
// a peer's echo reload the stale row before we've cleared it locally.

import {ConnectionContext} from '../web/ws/ConnectionContext';
import {evictCachedUserByUserId} from './cache';
import {publishUserSessionSignal} from './sessionNotifications';

export interface EvictionCounts {
    usersEvicted: number;
    sessionsRefreshed: number;
}

export interface EvictOptions {
    // Delete/disable: drop the live sockets, don't just mark them stale.
    // An idle socket never re-introspects, so refresh alone leaves a deleted
    // user connected indefinitely.
    disconnect?: boolean;
    reason?: string;
}

export function evictUserSessionEverywhere(
    userId: string,
    context: string,
    opts: EvictOptions = {}
): EvictionCounts {
    if (!userId || userId.trim() === '') {
        throw new Error('userId required');
    }
    const usersEvicted = evictCachedUserByUserId(userId);
    if (opts.disconnect) {
        const reason = opts.reason ?? context;
        const sessionsRefreshed = ConnectionContext.forceSenderDisconnect(
            userId,
            reason
        );
        publishUserSessionSignal(context, {
            kind: 'force-disconnect',
            userId,
            reason
        });
        return {usersEvicted, sessionsRefreshed};
    }
    const sessionsRefreshed = ConnectionContext.forceSenderRefresh(userId);
    publishUserSessionSignal(context, {kind: 'auth-changed', userId});
    return {usersEvicted, sessionsRefreshed};
}
