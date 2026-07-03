import {debugWarn} from '@/tools/debug';
import type {WaitingRoomMode} from './useWaitingRoomList';

export type WaitingRoomDeviceMap<Device> = Record<string, Device>;

export interface WaitingRoomRemoval<Device> {
    devices: WaitingRoomDeviceMap<Device>;
    count: number;
}

export interface WaitingRoomDeviceReconciler {
    reconcileDevicesFromBackend(source: string): Promise<void>;
}

export function removeWaitingRoomEntries<Device>(
    devices: WaitingRoomDeviceMap<Device>,
    ids: string[]
): WaitingRoomRemoval<Device> {
    const updated = {...devices};

    for (const id of ids) {
        delete updated[id];
    }

    return {
        devices: updated,
        count: Object.keys(updated).length
    };
}

export function shouldPublishPendingCount(mode: WaitingRoomMode): boolean {
    return mode === 'pending';
}

// Backstop for a missed Device.Created event. Several passes across a window so
// a slow-to-register device is caught too, not only fast ones.
const SETTLE_SCHEDULE_MS = [2_000, 6_000, 15_000];

function safeReconcile(
    reconciler: WaitingRoomDeviceReconciler,
    source: string
): Promise<void> {
    return reconciler
        .reconcileDevicesFromBackend(source)
        .catch((error) =>
            debugWarn('waiting-room device reconciliation failed', error)
        );
}

export async function reconcileAcceptedDevices(
    reconciler: WaitingRoomDeviceReconciler
): Promise<void> {
    await safeReconcile(reconciler, 'waiting-room');
    for (const delay of SETTLE_SCHEDULE_MS) {
        setTimeout(
            () => void safeReconcile(reconciler, 'waiting-room-settle'),
            delay
        );
    }
}
