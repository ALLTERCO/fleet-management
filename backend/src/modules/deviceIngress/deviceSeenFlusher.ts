// Wires the device-ingress "last seen" write-behind: the same
// drain -> bulk-write -> retry -> flush-on-shutdown loop em_stats uses.
import {createQueueFlusher, type QueueFlusherHandle} from '../queueFlusher';
import {markDeviceSeenBatch} from './deviceIngressRepository';
import {type DeviceSeenBatch, deviceSeenQueue} from './deviceSeenQueue';

const FLUSH_INTERVAL_MS = 120_000;
const FLUSH_RETRY_MAX = 50_000;

let handle: QueueFlusherHandle | null = null;

export function startDeviceSeenFlusher(): void {
    handle ??= createQueueFlusher<DeviceSeenBatch>({
        name: 'device_ingress_seen',
        queue: deviceSeenQueue,
        flush: (batch) => markDeviceSeenBatch(batch),
        batchSize: (batch) => batch.p_external.length,
        intervalMs: FLUSH_INTERVAL_MS,
        retryMax: FLUSH_RETRY_MAX
    });
}

// Stops the timer and flushes the last buffered batch, so a reboot doesn't drop
// the pending "seen" stamps.
export async function stopDeviceSeenFlusher(): Promise<void> {
    await handle?.stop();
    handle = null;
}
