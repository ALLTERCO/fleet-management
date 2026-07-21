// Lazily attaches a session sink (Redis-backed or in-memory fallback)
// to a ConnectionContext.
import {randomUUID} from 'node:crypto';
import type {Redis, RedisOptions} from 'ioredis';
import log4js from 'log4js';
import type WebSocket from 'ws';
import {tuning} from '../../../config';
import * as Observability from '../../Observability';
import {
    buildBlockingDuplicateOverride,
    getSharedRedis
} from '../../redis/RedisClients';
import type {ConsumerLoopHandle} from '../../redis/streamConsumerLoop';
import {SingleFlight} from '../../singleFlight';
import type {ConnectionContext} from './ConnectionContext';
import {
    attachConnectionId,
    forgetConnectionId,
    setClientSubscription
} from './clientSubscriptionRegistry';
import {InMemorySessionSink, type SessionSink} from './InMemorySessionSink';
import {consumePendingFilter} from './pendingSubscriptionRestore';
import {SessionEventStream} from './SessionEventStream';
import {startSessionSender} from './SessionStreamSender';

const logger = log4js.getLogger('session-stream-registry');

interface SessionBinding {
    sink: SessionSink;
    sender?: ConsumerLoopHandle;
    connectionId: string;
    readerClient?: Redis;
}

export interface SessionStreamRequest {
    connectionId?: string;
    lastSeenStreamId?: string;
}

export interface SessionStreamResult {
    sink: SessionSink;
    connectionId: string;
    resyncRequired?: 'no_offset' | 'stream_expired' | 'stream_trimmed';
    mode: 'redis' | 'inmemory';
}

// Enumerable on purpose — snapshotBindings() walks live bindings on
// shutdown. Entries are cleared in onClose, so no GC risk.
const bindings = new Map<WebSocket, SessionBinding>();
const inflight = new SingleFlight<WebSocket, SessionStreamResult>(
    'ws_session_stream'
);

export interface BindingSnapshotRecord {
    socket: WebSocket;
    connectionId: string;
}

export function snapshotBindings(): BindingSnapshotRecord[] {
    const out: BindingSnapshotRecord[] = [];
    for (const [socket, binding] of bindings) {
        out.push({socket, connectionId: binding.connectionId});
    }
    return out;
}

export async function getSessionStream(
    ctx: ConnectionContext,
    req: SessionStreamRequest = {}
): Promise<SessionStreamResult> {
    const bound = bindings.get(ctx.socket);
    if (bound) {
        return {
            sink: bound.sink,
            connectionId: bound.connectionId,
            mode: bound.sink.mode
        };
    }
    return inflight.run(ctx.socket, async () => {
        const existing = bindings.get(ctx.socket);
        if (existing) {
            return {
                sink: existing.sink,
                connectionId: existing.connectionId,
                mode: existing.sink.mode
            };
        }
        if (tuning.redis.disabled) {
            return attachInMemorySink(ctx, req);
        }
        // Try Redis-backed path; fall back to in-memory on any failure.
        try {
            return await attachRedisStream(ctx, req);
        } catch (err) {
            Observability.incrementCounter('event_redis_unavailable_fallback');
            logger.warn(
                'Redis unavailable for session stream — falling back to in-memory passthrough: %s',
                err
            );
            return attachInMemorySink(ctx, req);
        }
    });
}

async function attachRedisStream(
    ctx: ConnectionContext,
    req: SessionStreamRequest
): Promise<SessionStreamResult> {
    const userId = ctx.sender.getUserId() ?? 'anonymous';
    const {cmd} = getSharedRedis();
    // Writer ops are all fast and non-blocking — they ride the shared cmd
    // client. Only the reader gets a dedicated connection: it runs
    // XREADGROUP BLOCK, which must never queue ahead of request-path
    // commands on a shared connection.
    const readerClient = duplicateBlockingReader(cmd);
    try {
        let connectionId = req.connectionId ?? randomUUID();
        let stream = new SessionEventStream({
            userId,
            connectionId,
            client: cmd,
            readerClient
        });
        let resyncRequired: SessionStreamResult['resyncRequired'];

        if (req.connectionId) {
            const exists = await stream.keyExists();
            if (!exists) {
                resyncRequired = 'stream_expired';
                connectionId = randomUUID();
                stream = new SessionEventStream({
                    userId,
                    connectionId,
                    client: cmd,
                    readerClient
                });
            } else if (req.lastSeenStreamId) {
                const stale = await stream.streamIdIsStale(
                    req.lastSeenStreamId
                );
                if (stale) resyncRequired = 'stream_trimmed';
            }
        } else if (req.lastSeenStreamId) {
            resyncRequired = 'no_offset';
        }

        if (resyncRequired) {
            Observability.incrementLabeledCounter('event_resync_required', {
                reason: resyncRequired
            });
        }

        const lastSeenStreamId = resyncRequired
            ? undefined
            : req.lastSeenStreamId;
        await stream.ensureGroup(lastSeenStreamId ?? '$');
        // XGROUP MKSTREAM creates the key with no TTL and append() no longer
        // refreshes it — arm it now so a session whose socket never opens
        // cannot leak the key.
        await stream.touch();
        const sender = startSessionSender({
            socket: ctx.socket,
            stream,
            lastSeenStreamId
        });
        const sink: SessionSink = {
            mode: 'redis',
            append: (kind, payload) => stream.append(kind, payload),
            drop: () => stream.drop()
        };
        const binding: SessionBinding = {
            sink,
            sender,
            connectionId,
            readerClient: readerClient === cmd ? undefined : readerClient
        };
        bindings.set(ctx.socket, binding);
        bindFilterRestore(ctx.socket, userId, connectionId, req.connectionId);
        ctx.onClose(async () => {
            bindings.delete(ctx.socket);
            forgetConnectionId(ctx.socket);
            binding.sender?.stop();
            await waitForSessionSenderDone(binding);
            // A late XADD can recreate an expired key with no TTL — re-arm
            // before abandoning the stream to TTL cleanup.
            await stream.touch();
            await closeRedisClient(binding.readerClient, 'reader');
            // Stream retained — TTL handles cleanup so reconnect can resume.
        });
        return {sink, connectionId, resyncRequired, mode: 'redis'};
    } catch (error) {
        if (readerClient !== cmd)
            await closeRedisClient(readerClient, 'reader');
        throw error;
    }
}

// Duplicate the shared client into this session's dedicated blocking reader.
// Never attaches listeners to the source client — per-session listeners on
// the shared cmd client would accumulate across sessions.
function duplicateBlockingReader(client: Redis): Redis {
    const duplicate = (
        client as {duplicate?: (override?: Partial<RedisOptions>) => Redis}
    ).duplicate;
    if (typeof duplicate !== 'function') return client;
    const duplicateClient = duplicate.call(
        client,
        buildBlockingDuplicateOverride()
    );
    duplicateClient.on('error', (err) =>
        logger.warn('session reader redis error: %s', err)
    );
    return duplicateClient;
}

// Attach the active connectionId AND consume a pending filter if the
// client supplied a previous one. Filter restore is independent of stream
// persistence, so inmemory mode can still restore even when the stream
// itself is brand-new.
function bindFilterRestore(
    socket: WebSocket,
    userId: string,
    activeConnectionId: string,
    requestedConnectionId?: string
): void {
    attachConnectionId(socket, activeConnectionId);
    const lookupId = requestedConnectionId ?? activeConnectionId;
    const pending = consumePendingFilter(userId, lookupId);
    if (pending) {
        setClientSubscription(socket, pending, activeConnectionId);
    }
}

async function waitForSessionSenderDone(
    binding: SessionBinding
): Promise<void> {
    try {
        await binding.sender?.done;
    } catch (error) {
        logger.debug(
            'session sender stopped with error: %s',
            error instanceof Error ? error.message : String(error)
        );
    }
}

async function closeRedisClient(
    client: Redis | undefined,
    label: 'writer' | 'reader'
): Promise<void> {
    if (!client) return;
    try {
        await client.quit();
    } catch (error) {
        logger.debug(
            'session %s redis close failed: %s',
            label,
            error instanceof Error ? error.message : String(error)
        );
    }
}

function attachInMemorySink(
    ctx: ConnectionContext,
    req: SessionStreamRequest = {}
): SessionStreamResult {
    const userId = ctx.sender.getUserId() ?? 'anonymous';
    const connectionId = randomUUID();
    const sink = new InMemorySessionSink(ctx.socket, connectionId);
    const binding: SessionBinding = {sink, connectionId};
    bindings.set(ctx.socket, binding);
    bindFilterRestore(ctx.socket, userId, connectionId, req.connectionId);
    ctx.onClose(async () => {
        bindings.delete(ctx.socket);
        forgetConnectionId(ctx.socket);
        await sink.drop();
    });
    return {sink, connectionId, mode: 'inmemory'};
}
