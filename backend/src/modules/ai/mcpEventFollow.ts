// Following event subscriptions: the loop both event transports share.
//
// A session client (2025-11-25 and earlier) reads changes on its GET stream;
// a stateless client (2026-07-28) on the response stream of its
// subscriptions/listen request. Either way the same loop runs: every pass
// re-checks the credential, the reader lease and the organization switch,
// re-runs the governed read for each subscription, and hands each change to
// the transport. Subscriptions and their cursors live in the shared event
// stream store, so only one reader follows a stream at a time.

import type {McpEventStreamsPort, McpStreamPrincipal} from '../redis/ports';
import type {McpEventPollResult} from './mcpEventResources';

/** The governed reads a follow needs, as the credential allows them now. */
export interface EventReader {
    validate(uri: string): Promise<void>;
    poll(uri: string, cursor?: string): Promise<McpEventPollResult>;
}

/**
 * Why a follow ended: the transport closed, the credential or the
 * organization stopped admitting it, another reader took the stream, or a
 * read failed (a revoked permission among them).
 */
export type EventFollowEnd =
    | 'closed'
    | 'credential'
    | 'policy'
    | 'lease'
    | 'failed';

export interface EventFollow {
    sessionId: string;
    principal: McpStreamPrincipal;
    readerOwner: string;
    streams: McpEventStreamsPort;
    /** The reader for the credential as it is now; undefined once refused. */
    currentReader(): Promise<EventReader | undefined>;
    policyEnabled(): Promise<boolean>;
    /** False once the client is gone or the server is stopping the stream. */
    open(): boolean;
    leaseCurrent(): boolean;
    /** Sends one change; false when it could not be sent. */
    deliver(change: {uri: string; gap: boolean}): Promise<boolean>;
    reportFailure(error: unknown): void;
    pollIntervalMs: number;
}

function pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}

// Keeps the lease only while this reader still holds it.
async function holdsLease(follow: EventFollow): Promise<boolean> {
    return (
        follow.leaseCurrent() &&
        follow.streams.renewReader(follow.sessionId, follow.readerOwner)
    );
}

async function followSubscription(
    follow: EventFollow,
    reader: EventReader,
    subscription: {uri: string; cursor?: string}
): Promise<EventFollowEnd | undefined> {
    // validate and poll both re-run governed reads, so revoked device or job
    // access stops that resource before anything is delivered.
    await reader.validate(subscription.uri);
    const polled = await reader.poll(subscription.uri, subscription.cursor);
    if (!(await holdsLease(follow))) return 'lease';
    if (
        polled.gap &&
        !(await follow.deliver({uri: subscription.uri, gap: true}))
    )
        return 'closed';
    if (
        polled.changed &&
        !(await follow.deliver({uri: subscription.uri, gap: false}))
    )
        return 'closed';
    const moved = await follow.streams.updateCursor(
        follow.sessionId,
        follow.principal,
        subscription.uri,
        polled.cursor,
        follow.readerOwner
    );
    return moved ? undefined : 'lease';
}

async function followOnce(
    follow: EventFollow
): Promise<EventFollowEnd | undefined> {
    const reader = await follow.currentReader();
    if (!reader) return 'credential';
    if (
        !(await follow.streams.renewReader(
            follow.sessionId,
            follow.readerOwner
        ))
    )
        return 'lease';
    if (!(await follow.policyEnabled())) return 'policy';
    const subscriptions = await follow.streams.listSubscriptions(
        follow.sessionId,
        follow.principal
    );
    for (const subscription of subscriptions) {
        if (!follow.open()) return 'closed';
        const end = await followSubscription(follow, reader, subscription);
        if (end) return end;
    }
    return undefined;
}

/** Follows until the transport closes or something stops admitting it. */
export async function followEventSubscriptions(
    follow: EventFollow
): Promise<EventFollowEnd> {
    while (follow.open()) {
        let end: EventFollowEnd | undefined;
        try {
            end = await followOnce(follow);
        } catch (error) {
            follow.reportFailure(error);
            return 'failed';
        }
        if (end) return end;
        await pause(follow.pollIntervalMs);
    }
    return 'closed';
}
