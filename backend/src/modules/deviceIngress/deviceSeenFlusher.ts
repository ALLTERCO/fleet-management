// Wires the device-ingress "last seen" write-behind: the same
// drain -> bulk-write -> retry -> flush-on-shutdown loop em_stats uses.
// Besides connects, every flush stamps the devices this process holds a
// connection for, and a disconnect stamps its own moment, so last_seen is the
// last time Fleet knew the device was connected (late by at most one interval).
import CommandSender from '../../model/CommandSender';
import type {ShellyEvent} from '../../types';
import * as DeviceCollector from '../DeviceCollector';
import * as EventDistributor from '../EventDistributor';
import * as Observability from '../Observability';
import {createQueueFlusher, type QueueFlusherHandle} from '../queueFlusher';
import {markDeviceSeenBatch} from './deviceIngressRepository';
import {
    type DeviceSeenBatch,
    deviceSeenQueue,
    seenBatchFor
} from './deviceSeenQueue';

const FLUSH_INTERVAL_MS = 120_000;
const FLUSH_RETRY_MAX = 50_000;
const DISCONNECT_EVENT = 'Shelly.Disconnect';

let handle: QueueFlusherHandle | null = null;
let disconnectListener: number | null = null;

export function startDeviceSeenFlusher(): void {
    handle ??= createQueueFlusher<DeviceSeenBatch>({
        name: 'device_ingress_seen',
        counters: {
            flushes: 'device_ingress_seen_flushes',
            flushesSkipped: 'device_ingress_seen_flushes_skipped',
            flushErrors: 'device_ingress_seen_flush_errors',
            dataDropped: 'device_ingress_seen_data_dropped'
        },
        queue: deviceSeenQueue,
        beforeTick: () =>
            deviceSeenQueue.stampConnected(
                DeviceCollector.getAll(),
                Date.now()
            ),
        flush: flushSeen,
        batchSize: (batch) => batch.p_external.length,
        intervalMs: FLUSH_INTERVAL_MS,
        retryMax: FLUSH_RETRY_MAX
    });
    disconnectListener ??= EventDistributor.addEventListener(
        CommandSender.INTERNAL,
        DISCONNECT_EVENT,
        {},
        (event) => recordDeviceDisconnect(event)
    );
}

// Rows another writer held were skipped, not lost: they go back for the next
// flush, under anything newer that arrived meanwhile.
async function flushSeen(batch: DeviceSeenBatch): Promise<void> {
    const skipped = await markDeviceSeenBatch(batch);
    if (skipped.length === 0) return;
    Observability.incrementCounter(
        'device_ingress_seen_rows_retried',
        skipped.length
    );
    deviceSeenQueue.prepend(seenBatchFor(batch, skipped));
}

export function recordDeviceDisconnect(event: unknown): void {
    const {params} = event as ShellyEvent.Disconnect;
    if (typeof params?.shellyID !== 'string') return;
    if (typeof params.emittedAt !== 'number') return;
    deviceSeenQueue.enqueue({
        reportedExternalId: params.shellyID,
        seenAtMs: params.emittedAt,
        posture: null
    });
}

// Stops the timer and flushes the last buffered batch, so a reboot doesn't drop
// the pending "seen" stamps.
export async function stopDeviceSeenFlusher(): Promise<void> {
    if (disconnectListener !== null) {
        EventDistributor.removeEventListener(
            disconnectListener,
            DISCONNECT_EVENT
        );
        disconnectListener = null;
    }
    await handle?.stop();
    handle = null;
}
