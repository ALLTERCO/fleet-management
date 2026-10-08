// Lazily attaches a session sink (Redis-backed or in-memory fallback)
// to a ConnectionContext, resuming a parked or half-open session if asked.
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
import {runExclusive} from './keyedSerialQueue';
import {consumePendingFilter} from './pendingSubscriptionRestore';
import {SessionEventStream} from './SessionEventStream';
import {startSessionSender} from './SessionStreamSender';
import {SessionCapture} from './sessionCapture';
import {
    findParkedSession,
    type ParkedSession,
    parkSession,
    resumePolicy,
    type SessionOwner,
    sameOwner,
    sessionKey,
    unparkSession
} from './sessionResumeRegistry';
import {probeSocketAlive} from './socketLivenessProbe';

const logger = log4js.getLogger('session-stream-registry');

interface SessionBinding {
    socket: WebSocket;
    owner: SessionOwner;
    sink: SessionSink;
    capture: SessionCapture;
    connectionId: string;
    /** Ends capture and deletes the stream. */
    discard: () => Promise<void>;
    stream?: SessionEventStream;
    sender?: ConsumerLoopHandle;
    readerClient?: Redis;
    /** A resuming socket took this session over; it must not park. */
    superseded?: boolean;
}

export interface SessionStreamRequest {
    connectionId?: string;
    lastSeenStreamId?: string;
}

export interface SessionStreamResult {
    sink: SessionSink;
    /** Subscription listeners record only while this accepts. */
    capture: SessionCapture;
    connectionId: string;
    resyncRequired?: 'no_offset' | 'stream_expired' | 'stream_trimmed';
    mode: 'redis' | 'inmemory';
}

type ResyncReason = NonNullable<SessionStreamResult['resyncRequired']>;

interface RedisAttachInput {
    ctx: ConnectionContext;
    req: SessionStreamRequest;
    owner: SessionOwner;
    cmd: Redis;
    readerClient: Redis;
}

interface ResumePlan {
    connectionId: string;
    resyncRequired?: ResyncReason;
    predecessor?: SessionCapture;
}

interface PredecessorClaim {
    capture?: SessionCapture;
    refusal?: ResyncReason;
}

const WS_OPEN = 1;

// Enumerable on purpose — snapshotBindings() walks live bindings on
// shutdown. Entries are cleared in onClose, so no GC risk.
const bindings = new Map<WebSocket, SessionBinding>();
// Redis-mode bindings by session key, so a resume can find a live owner.
const liveSessions = new Map<string, SessionBinding>();
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
    if (bound) return resultOf(bound);
    return inflight.run(ctx.socket, async () => {
        const existing = bindings.get(ctx.socket);
        if (existing) return resultOf(existing);
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

function resultOf(
    binding: SessionBinding,
    resyncRequired?: ResyncReason
): SessionStreamResult {
    return {
        sink: binding.sink,
        capture: binding.capture,
        connectionId: binding.connectionId,
        mode: binding.sink.mode,
        ...(resyncRequired ? {resyncRequired} : {})
    };
}

function ownerOf(ctx: ConnectionContext): SessionOwner {
    return {
        userId: ctx.sender.getUserId() ?? 'anonymous',
        organizationId: ctx.sender.getOrganizationId()
    };
}

async function attachRedisStream(
    ctx: ConnectionContext,
    req: SessionStreamRequest
): Promise<SessionStreamResult> {
    const {cmd} = getSharedRedis();
    // Writer ops are all fast and non-blocking — they ride the shared cmd
    // client. Only the reader gets a dedicated connection: it runs
    // XREADGROUP BLOCK, which must never queue ahead of request-path
    // commands on a shared connection.
    const readerClient = duplicateBlockingReader(cmd);
    const input = {ctx, req, owner: ownerOf(ctx), cmd, readerClient};
    try {
        return await withResumeLock(input, () => bindRedisSession(input));
    } catch (error) {
        if (readerClient !== cmd)
            await closeRedisClient(readerClient, 'reader');
        throw error;
    }
}

// One resume, close or expiry at a time per session key.
function withResumeLock<T>(
    input: RedisAttachInput,
    work: () => Promise<T>
): Promise<T> {
    const {req, owner} = input;
    if (!req.connectionId) return work();
    return runExclusive(sessionKey(owner, req.connectionId), work);
}

async function bindRedisSession(
    input: RedisAttachInput
): Promise<SessionStreamResult> {
    const plan = await planResume(input);
    try {
        return await openRedisBinding(input, plan);
    } catch (error) {
        plan.predecessor?.release();
        throw error;
    }
}

async function planResume(input: RedisAttachInput): Promise<ResumePlan> {
    const {connectionId, lastSeenStreamId} = input.req;
    if (!connectionId) {
        return freshPlan(lastSeenStreamId ? 'no_offset' : undefined);
    }
    const claim = await claimPredecessor(input, connectionId);
    if (claim.refusal) return freshPlan(claim.refusal);
    const streamGap = await checkRetainedStream(input, connectionId);
    if (streamGap === 'stream_expired') {
        claim.capture?.release();
        return freshPlan(streamGap);
    }
    return {
        connectionId,
        resyncRequired: streamGap,
        predecessor: claim.capture
    };
}

function freshPlan(resyncRequired?: ResyncReason): ResumePlan {
    return {connectionId: randomUUID(), resyncRequired};
}

async function checkRetainedStream(
    input: RedisAttachInput,
    connectionId: string
): Promise<ResyncReason | undefined> {
    const stream = new SessionEventStream({
        userId: input.owner.userId,
        connectionId,
        client: input.cmd
    });
    if (!(await stream.keyExists())) return 'stream_expired';
    const {lastSeenStreamId} = input.req;
    if (!lastSeenStreamId) return undefined;
    const stale = await stream.streamIdIsStale(lastSeenStreamId);
    return stale ? 'stream_trimmed' : undefined;
}

// The key carries the userId, so only the same user ever reaches a session;
// sameOwner() also pins the organization.
function claimPredecessor(
    input: RedisAttachInput,
    connectionId: string
): Promise<PredecessorClaim> {
    const key = sessionKey(input.owner, connectionId);
    const live = liveSessions.get(key);
    if (live && live.socket !== input.ctx.socket) {
        return claimLiveSession(live, input.owner);
    }
    return claimParkedSession(key, input.owner);
}

// Another socket still holds the session: a live peer (second tab) keeps it,
// a half-open one that misses the ping is taken over.
async function claimLiveSession(
    live: SessionBinding,
    owner: SessionOwner
): Promise<PredecessorClaim> {
    if (!sameOwner(live.owner, owner)) return {refusal: 'stream_expired'};
    const alive = await probeSocketAlive(live.socket, resumePolicy().probeMs);
    if (alive) return {refusal: 'stream_expired'};
    await supersedeBinding(live);
    return adoptOrDiscard(live);
}

async function claimParkedSession(
    key: string,
    owner: SessionOwner
): Promise<PredecessorClaim> {
    const parked = findParkedSession(key);
    if (!parked) return {};
    if (!sameOwner(parked.owner, owner)) return {refusal: 'stream_expired'};
    unparkSession(key);
    return adoptOrDiscard(parked);
}

// A broken gap must never replay partially: drop it and make the client resync.
async function adoptOrDiscard(
    session: ParkedSession
): Promise<PredecessorClaim> {
    if (!session.capture.gapBroken()) return {capture: session.capture};
    Observability.incrementCounter('ws_resume_gap_broken');
    await session.discard();
    return {refusal: 'stream_trimmed'};
}

async function supersedeBinding(binding: SessionBinding): Promise<void> {
    binding.superseded = true;
    liveSessions.delete(sessionKey(binding.owner, binding.connectionId));
    // Old reader must stop before the new one reads the same group.
    binding.sender?.stop();
    await waitForSessionSenderDone(binding);
    terminateSocket(binding.socket);
    Observability.incrementCounter('ws_resume_takeover');
}

async function openRedisBinding(
    input: RedisAttachInput,
    plan: ResumePlan
): Promise<SessionStreamResult> {
    const {ctx, req, owner, cmd, readerClient} = input;
    const stream = new SessionEventStream({
        userId: owner.userId,
        connectionId: plan.connectionId,
        client: cmd,
        readerClient
    });
    recordResync(plan.resyncRequired);
    const lastSeenStreamId = plan.resyncRequired
        ? undefined
        : req.lastSeenStreamId;
    await stream.ensureGroup(lastSeenStreamId ?? '$');
    // XGROUP MKSTREAM creates the key with no TTL and append() no longer
    // refreshes it — arm it now so a session whose socket never opens
    // cannot leak the key.
    await stream.touch();
    const capture = new SessionCapture({
        maxGapEvents: resumePolicy().maxGapEvents,
        ownerMayReceive: () => ctx.isResumable
    });
    if (plan.predecessor) capture.adoptPredecessor(plan.predecessor);
    const binding: SessionBinding = {
        socket: ctx.socket,
        owner,
        capture,
        connectionId: plan.connectionId,
        stream,
        sink: captureSink(capture, stream),
        discard: () => discardStream(capture, stream),
        sender: startSessionSender({
            socket: ctx.socket,
            stream,
            lastSeenStreamId
        }),
        readerClient: readerClient === cmd ? undefined : readerClient
    };
    bindings.set(ctx.socket, binding);
    liveSessions.set(sessionKey(owner, plan.connectionId), binding);
    ctx.holdAfterClose(capture.released);
    bindFilterRestore(
        ctx.socket,
        owner.userId,
        plan.connectionId,
        req.connectionId
    );
    ctx.onClose(() => closeRedisBinding(ctx, binding));
    return resultOf(binding, plan.resyncRequired);
}

function recordResync(reason: ResyncReason | undefined): void {
    if (!reason) return;
    Observability.incrementLabeledCounter('event_resync_required', {reason});
}

function captureSink(
    capture: SessionCapture,
    stream: SessionEventStream
): SessionSink {
    const append = async (kind: string, payload: string): Promise<void> => {
        capture.countAppend();
        if (!capture.accepts()) return;
        const written = await stream.append(kind, payload);
        if (!written) capture.markWriteFailed();
    };
    return {mode: 'redis', append, drop: () => stream.drop()};
}

async function discardStream(
    capture: SessionCapture,
    stream: SessionEventStream
): Promise<void> {
    capture.release();
    await stream.drop();
}

function closeRedisBinding(
    ctx: ConnectionContext,
    binding: SessionBinding
): Promise<void> {
    bindings.delete(ctx.socket);
    forgetConnectionId(ctx.socket);
    const key = sessionKey(binding.owner, binding.connectionId);
    return runExclusive(key, () => retireRedisBinding(ctx, binding));
}

// Socket gone: stop reading, then keep capturing for the grace window so a
// resume replays the gap. Revoked or grace-off sessions are discarded.
async function retireRedisBinding(
    ctx: ConnectionContext,
    binding: SessionBinding
): Promise<void> {
    const key = sessionKey(binding.owner, binding.connectionId);
    if (liveSessions.get(key) === binding) liveSessions.delete(key);
    binding.sender?.stop();
    await waitForSessionSenderDone(binding);
    await closeRedisClient(binding.readerClient, 'reader');
    if (binding.superseded) return;
    binding.capture.releasePredecessor();
    if (!ctx.isResumable || resumePolicy().graceMs === 0) {
        await binding.discard();
        return;
    }
    // A late XADD can recreate an expired key with no TTL — re-arm first.
    await binding.stream?.touch();
    binding.capture.park();
    parkSession(key, binding);
}

function terminateSocket(socket: WebSocket): void {
    try {
        socket.terminate();
    } catch (error) {
        logger.debug(
            'superseded socket terminate failed: %s',
            error instanceof Error ? error.message : String(error)
        );
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
    const owner = ownerOf(ctx);
    const connectionId = randomUUID();
    const sink = new InMemorySessionSink(ctx.socket, connectionId);
    // Nothing outlives the socket here, so the gap is never captured.
    const capture = new SessionCapture({
        maxGapEvents: 0,
        ownerMayReceive: () => ctx.socket.readyState === WS_OPEN
    });
    const binding: SessionBinding = {
        socket: ctx.socket,
        owner,
        sink,
        capture,
        connectionId,
        discard: async () => capture.release()
    };
    bindings.set(ctx.socket, binding);
    ctx.holdAfterClose(capture.released);
    bindFilterRestore(ctx.socket, owner.userId, connectionId, req.connectionId);
    ctx.onClose(async () => {
        bindings.delete(ctx.socket);
        forgetConnectionId(ctx.socket);
        capture.release();
        await sink.drop();
    });
    const resyncRequired = inMemoryResyncReason(req);
    recordResync(resyncRequired);
    return resultOf(binding, resyncRequired);
}

// No stream to replay from: any resume attempt must resync.
function inMemoryResyncReason(
    req: SessionStreamRequest
): ResyncReason | undefined {
    if (req.connectionId) return 'stream_expired';
    if (req.lastSeenStreamId) return 'no_offset';
    return undefined;
}
