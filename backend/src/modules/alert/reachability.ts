// One answer to "can Fleet Manager hear this device right now?". device_offline
// (sweep, preview and the deferred fire) all judge through here, so an alert
// never disagrees with the device list. Each construction type has its own
// clock: a Shelly device is heard on its connection, and a battery device is
// silent on purpose for sys.wakeup_period; a BLU device is heard through its
// gateway and judged like the device list does (bluetoothTransportHealth).

import {bluSilenceThresholdMs} from '../../config/BTHomeData';
import {tuning} from '../../config/tuning';
import type AbstractDevice from '../../model/AbstractDevice';
import type {BluetoothDeviceDto} from '../../types/api/virtualdevice';
import {listBluetoothDevicesByExternalIds} from '../virtualDevice/bluetoothRepository';
import {bluetoothTransportHealth} from '../virtualDevice/deviceListEntry';
import {
    bluetoothPrimaryGatewaySnapshot,
    type DeviceCollectorLike,
    enrichBluetoothDeviceWithGatewayStatus
} from '../virtualDevice/deviceListIntegration';
import {readNumber} from './evaluators/shared';
import {type StoredPresenceRow, timestampMs} from './storedPresence';

export type SilenceReason =
    | 'disconnected'
    | 'sleeping'
    | 'gateway_offline'
    | 'transport_stale'
    | 'transport_disabled';

export type UnknownReason = 'missing_last_seen' | 'bluetooth_device_missing';

export type Reachability =
    | {state: 'online'}
    | {state: 'unknown'; reason: UnknownReason}
    /** Not heard, but not late yet: offline once dueAtMs passes. */
    | {
          state: 'silent';
          reason: SilenceReason;
          lastSeenMs: number;
          dueAtMs: number;
      }
    | {state: 'offline'; reason: SilenceReason; lastSeenMs: number};

export interface ReachabilityInput {
    row: StoredPresenceRow;
    live: AbstractDevice | undefined;
    /** The BLU record for a `bluetooth` row; ignored for other kinds. */
    bluetooth: BluetoothDeviceDto | undefined;
    collector: DeviceCollectorLike;
    /** The rule's quiet time; null fires as soon as the device is not heard. */
    offlineForSec: number | null;
    now: number;
}

export const BLUETOOTH_KIND = 'bluetooth';

export function deviceReachability(input: ReachabilityInput): Reachability {
    const {row, live, now} = input;
    if (live?.presence === 'online' || live?.online === true) {
        return {state: 'online'};
    }
    if (row.kind === BLUETOOTH_KIND) return bluetoothReachability(input);

    const lastSeenMs =
        lastKnownConnectedMs(row, live) ?? timestampMs(live?.lastReportTs);
    if (lastSeenMs === null) {
        return {state: 'unknown', reason: 'missing_last_seen'};
    }
    const quietMs = (input.offlineForSec ?? 0) * 1000;
    const sleepMs = sleepWindowMs(live);
    if (sleepMs !== null && sleepMs > quietMs) {
        return judge('sleeping', lastSeenMs, lastSeenMs + sleepMs, now);
    }
    return judge('disconnected', lastSeenMs, lastSeenMs + quietMs, now);
}

// The later of the stored "last known connected" time and the disconnect this
// process saw. A quiet device's last frame can be its connect, so neither the
// frame time nor a stored stamp alone says when Fleet stopped hearing it.
function lastKnownConnectedMs(
    row: StoredPresenceRow,
    live: AbstractDevice | undefined
): number | null {
    const stored = timestampMs(row.last_seen);
    const disconnected = timestampMs(live?.disconnectedAtMs);
    if (stored === null) return disconnected;
    if (disconnected === null) return stored;
    return Math.max(stored, disconnected);
}

// A battery device reports once per sys.wakeup_period; the sweep grace covers
// the report itself. Anything inside that window is sleep, not silence.
function sleepWindowMs(live: AbstractDevice | undefined): number | null {
    if (!live?.profile?.flags?.isBattery) return null;
    const wakeupSec = readNumber(live.status, 'sys.wakeup_period');
    if (wakeupSec === null || wakeupSec <= 0) return null;
    return (wakeupSec + tuning.alert.sweepEvalDelaySec) * 1000;
}

function bluetoothReachability(input: ReachabilityInput): Reachability {
    const {bluetooth, collector, now} = input;
    if (!bluetooth)
        return {state: 'unknown', reason: 'bluetooth_device_missing'};
    const gateway = bluetoothPrimaryGatewaySnapshot(collector, bluetooth);
    const device = enrichBluetoothDeviceWithGatewayStatus(bluetooth, gateway);
    const transport = device.primaryTransport ?? null;
    if (!transport) return {state: 'unknown', reason: 'missing_last_seen'};
    const health = bluetoothTransportHealth(device, gateway?.presence ?? null);
    if (health.status !== 'offline') return {state: 'online'};

    const quietMs = (input.offlineForSec ?? 0) * 1000;
    if (gateway && gateway.presence !== 'online') {
        // The child rides its gateway: it went quiet when the gateway did.
        const gatewayId = transport.shellyDeviceExternalId;
        const gatewaySeenMs = gatewayId
            ? timestampMs(collector.getDevice(gatewayId)?.lastReportTs)
            : null;
        const lastSeenMs = gatewaySeenMs ?? timestampMs(transport.lastSeenAt);
        if (lastSeenMs === null) {
            return {state: 'unknown', reason: 'missing_last_seen'};
        }
        return judge('gateway_offline', lastSeenMs, lastSeenMs + quietMs, now);
    }
    const lastSeenMs = timestampMs(transport.lastSeenAt);
    if (lastSeenMs === null) {
        return {state: 'unknown', reason: 'missing_last_seen'};
    }
    if (!transport.enabled) {
        return judge(
            'transport_disabled',
            lastSeenMs,
            lastSeenMs + quietMs,
            now
        );
    }
    // Stale by the model's own cadence, and never before the rule's quiet time.
    const staleMs = bluSilenceThresholdMs(device.modelId) ?? 0;
    return judge(
        'transport_stale',
        lastSeenMs,
        lastSeenMs + Math.max(quietMs, staleMs),
        now
    );
}

function judge(
    reason: SilenceReason,
    lastSeenMs: number,
    dueAtMs: number,
    now: number
): Reachability {
    if (now < dueAtMs) return {state: 'silent', reason, lastSeenMs, dueAtMs};
    return {state: 'offline', reason, lastSeenMs};
}

/** The BLU records behind the `bluetooth` presence rows, keyed by external id. */
export async function bluetoothDevicesForPresence(
    organizationId: string,
    rows: readonly StoredPresenceRow[]
): Promise<ReadonlyMap<string, BluetoothDeviceDto>> {
    const ids = rows
        .filter((row) => row.kind === BLUETOOTH_KIND)
        .map((row) => row.external_id);
    if (ids.length === 0) return new Map();
    const devices = await listBluetoothDevicesByExternalIds(
        organizationId,
        ids
    );
    return new Map(devices.map((device) => [device.externalId, device]));
}
