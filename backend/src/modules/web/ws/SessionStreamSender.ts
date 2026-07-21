// Consumer loop that drains SessionEventStream to the WS socket.
// On start: replays this consumer's PEL (entries delivered before the
// last disconnect that we didn't ack), then enters the live `>` loop.
import log4js from 'log4js';
import type {WebSocket} from 'ws';
import {tuning} from '../../../config';
import * as Observability from '../../Observability';
import {recoverMissingGroup, type StreamEntry} from '../../redis/RedisStream';
import type {ConsumerLoopHandle} from '../../redis/streamConsumerLoop';
import {sleep} from '../../util/sleep';
import {getClientSubscription} from './clientSubscriptionRegistry';
import type {SessionEventStream} from './SessionEventStream';
import {
    isSocketNotOpenError,
    strictSocketSend,
    waitForSocketOpen
} from './safeSocketSend';
import {shouldDeliver} from './subscriberFilter';

const logger = log4js.getLogger('session-stream-sender');

// Push a resync signal to a live client after its stream vanished mid-session.
// Reuses the reconnect resume contract (reason 'stream_expired') so the client
// refetches full state instead of silently missing the gap.
function pushResyncRequired(socket: WebSocket): void {
    Observability.incrementLabeledCounter('event_resync_required', {
        reason: 'stream_expired'
    });
    try {
        strictSocketSend(
            socket,
            JSON.stringify({
                jsonrpc: '2.0',
                method: 'Session.ResyncRequired',
                params: {reason: 'stream_expired'}
            })
        );
    } catch (err) {
        // Socket closing mid-heal — the reconnect path will resync anyway.
        if (!isSocketNotOpenError(err)) throw err;
    }
}

export interface SessionStreamSenderOptions {
    socket: WebSocket;
    stream: SessionEventStream;
    lastSeenStreamId?: string;
}

async function sendBatchAndAck(
    socket: WebSocket,
    inner: SessionEventStream['stream'],
    group: string,
    entries: StreamEntry[],
    opts: {minExclusiveStreamId?: string} = {}
): Promise<string | undefined> {
    let lastSentId: string | undefined;
    const filter = getClientSubscription(socket);
    for (const entry of entries) {
        if (
            opts.minExclusiveStreamId &&
            !streamIdGreaterThan(entry.id, opts.minExclusiveStreamId)
        ) {
            await inner.ack(group, [entry.id]);
            continue;
        }
        const kind = entry.fields.kind ?? 'unknown';
        const payload = entry.fields.payload ?? '';
        const parsed = parsePayloadObject(payload);
        if (
            filter &&
            !shouldDeliver(filter, {
                eventType: kind,
                deviceId: extractDeviceId(parsed)
            })
        ) {
            await inner.ack(group, [entry.id]);
            Observability.incrementLabeledCounter('event_filtered_total', {
                kind
            });
            continue;
        }
        strictSocketSend(socket, withStreamId(payload, parsed, entry.id));
        await inner.ack(group, [entry.id]);
        lastSentId = maxStreamId(lastSentId, entry.id);
        Observability.incrementLabeledCounter('event_xack_total', {kind});
        // Bytes actually delivered to the client, per event kind — the "how
        // much data" measure for the widget data contract's effect on payload.
        Observability.incrementLabeledCounter(
            'event_delivered_bytes',
            {kind},
            payload.length
        );
    }
    return lastSentId;
}

async function replayRangeAfter(
    socket: WebSocket,
    inner: SessionEventStream['stream'],
    group: string,
    startId: string
): Promise<string> {
    let cursor = startId;
    while (socket.readyState === 1 /* OPEN */) {
        const entries = await inner.rangeAfter(
            cursor,
            tuning.ws.streamBatchSize
        );
        if (entries.length === 0) break;
        const lastSentId = await sendBatchAndAck(socket, inner, group, entries);
        cursor = lastSentId ?? cursor;
        if (entries.length < tuning.ws.streamBatchSize) break;
    }
    await inner.setGroupId(group, cursor);
    return cursor;
}

export function startSessionSender(
    opts: SessionStreamSenderOptions
): ConsumerLoopHandle {
    const {socket, stream, lastSeenStreamId} = opts;
    const inner = stream.stream;
    const group = stream.group;
    const consumer = stream.consumer;
    let stopped = false;

    const done = (async () => {
        const opened = await waitForSocketOpen(
            socket,
            tuning.ws.socketOpenTimeoutMs,
            tuning.ws.socketOpenPollMs
        );
        if (!opened) {
            logger.debug('session sender exiting — socket never reached OPEN');
            return;
        }

        let resumeFrom = lastSeenStreamId;

        // PEL replay: redeliver our own un-acked entries from a prior session.
        try {
            const pending = await inner.readPending(
                group,
                consumer,
                tuning.ws.streamBatchSize
            );
            if (pending.length > 0) {
                Observability.incrementCounter('event_pel_replayed');
                const lastPendingId = await sendBatchAndAck(
                    socket,
                    inner,
                    group,
                    pending,
                    {
                        minExclusiveStreamId: lastSeenStreamId
                    }
                );
                resumeFrom = maxStreamId(resumeFrom, lastPendingId);
            }
        } catch (err) {
            logReplayFailure('PEL replay', err);
        }

        if (resumeFrom) {
            try {
                resumeFrom = await replayRangeAfter(
                    socket,
                    inner,
                    group,
                    resumeFrom
                );
            } catch (err) {
                logReplayFailure('range replay', err);
            }
        }

        // Live loop — new entries only. Skip reads when socket isn't OPEN so
        // we don't strand entries in PEL during a transient close.
        // Edge-tracked so a client stuck in backpressure is counted once, not
        // every 50ms tick.
        let wasBackpressured = false;
        // Sliding TTL: refresh while connected so an idle-but-open session
        // never expires under us. Derived from the TTL — no extra config key.
        const ttlRefreshMs = Math.max(
            1000,
            Math.floor(tuning.ws.streamTtlMs / 3)
        );
        let lastTtlTouchMs = 0;
        while (!stopped) {
            if (socket.readyState !== 1 /* OPEN */) {
                await sleep(50);
                continue;
            }
            if (Date.now() - lastTtlTouchMs >= ttlRefreshMs) {
                lastTtlTouchMs = Date.now();
                await stream.touch();
            }
            const buffered = socket.bufferedAmount ?? 0;
            if (buffered > tuning.ws.senderPauseBytes) {
                if (!wasBackpressured) {
                    wasBackpressured = true;
                    Observability.recordBackpressure({
                        clientId: consumer,
                        bufferedBytes: buffered,
                        action: 'paused'
                    });
                }
                await sleep(50);
                continue;
            }
            wasBackpressured = false;
            let entries: StreamEntry[];
            try {
                entries = await inner.readGroup({
                    group,
                    consumer,
                    count: tuning.ws.streamBatchSize,
                    blockMs: tuning.ws.streamBlockMs
                });
            } catch (err) {
                // Stream expired/evicted while connected — recreate the group so
                // live events keep flowing, AND tell the client to resync the
                // state it may have missed (the recreated group reads from the
                // live tail, so gap entries are gone). Same resume contract as a
                // reconnect that detects stream_expired.
                const healed = await recoverMissingGroup(err, {
                    source: 'ws-session',
                    recreate: async () => {
                        await stream.ensureGroup();
                        await stream.touch();
                    }
                });
                if (healed) {
                    pushResyncRequired(socket);
                    continue;
                }
                logger.warn('readGroup failed: %s', err);
                await sleep(1000);
                continue;
            }
            if (entries.length === 0) {
                // Yield — real Redis blocks per BLOCK ms; in-process fakes
                // return immediately so we'd hot-spin without this.
                await sleep(10);
                continue;
            }
            try {
                await sendBatchAndAck(socket, inner, group, entries);
            } catch (err) {
                if (isSocketNotOpenError(err)) {
                    // socket closing — leave the rest in PEL for next session.
                    logger.debug('live loop stopped: socket closed');
                    await sleep(100);
                    continue;
                }
                // Non-socket fault: surface it; entries stay in PEL for retry.
                logger.warn('live loop send failed: %s', err);
                Observability.incrementCounter('ws_live_loop_send_errors');
                await sleep(1000);
            }
        }
    })();

    return {
        stop() {
            stopped = true;
        },
        done
    };
}

function logReplayFailure(label: string, err: unknown): void {
    if (isSocketNotOpenError(err)) {
        logger.debug('%s stopped: socket closed', label);
        return;
    }
    logger.warn('%s failed: %s', label, err);
}

function parsePayloadObject(payload: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function withStreamId(
    payload: string,
    parsed: Record<string, unknown> | null,
    streamId: string
): string {
    if (parsed === null) return payload;
    return JSON.stringify({...parsed, streamId});
}

// Canonical source: payload.params.deviceId (Shelly RPC envelope).
function extractDeviceId(
    parsed: Record<string, unknown> | null
): string | undefined {
    if (parsed === null) return undefined;
    const params = parsed.params;
    if (params && typeof params === 'object' && !Array.isArray(params)) {
        const deviceId = (params as Record<string, unknown>).deviceId;
        if (typeof deviceId === 'string') return deviceId;
    }
    return undefined;
}

function streamIdGreaterThan(left: string, right: string): boolean {
    const [leftMs, leftSeq] = splitStreamId(left);
    const [rightMs, rightSeq] = splitStreamId(right);
    if (leftMs !== rightMs) return leftMs > rightMs;
    return leftSeq > rightSeq;
}

function maxStreamId(
    left: string | undefined,
    right: string | undefined
): string | undefined {
    if (!left) return right;
    if (!right) return left;
    return streamIdGreaterThan(left, right) ? left : right;
}

function splitStreamId(streamId: string): [number, number] {
    const [ms, seq] = streamId.split('-').map(Number);
    return [Number.isFinite(ms) ? ms : 0, Number.isFinite(seq) ? seq : 0];
}
