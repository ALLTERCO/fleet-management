// Calls scoped backend reads on tab-resume + WS waiting-room/alert events.

import {MOBILE_RESUME_THRESHOLD_MS, MOBILE_SYNC_DEBOUNCE_MS} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/http';
import {onAlertEvent, onWaitingRoomUpdated} from '@/tools/websocket';
import {isRecoverableReconnectError} from '@/tools/wsReconnectErrors';
import type {ShellyDeviceExternal} from '@/types';

interface SyncDeltaResponse {
    serverTime: string;
    devices: {visible: boolean; changed: ShellyDeviceExternal[]};
    waitingRoom: {
        visible: boolean;
        pendingCount: number;
        pending: Record<string, unknown>;
    };
    alerts: {visible: boolean; openCount: number; criticalCount: number};
}

let hiddenAt: number | null = null;
let lastSyncIso: string | null = null;
let inflight = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let waitingRoomCountTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runSyncDelta();
    }, MOBILE_SYNC_DEBOUNCE_MS);
}

function scheduleWaitingRoomCountSync(): void {
    if (waitingRoomCountTimer) clearTimeout(waitingRoomCountTimer);
    waitingRoomCountTimer = setTimeout(() => {
        waitingRoomCountTimer = null;
        void refreshWaitingRoomCount();
    }, MOBILE_SYNC_DEBOUNCE_MS);
}

async function runSyncDelta(): Promise<void> {
    if (inflight) return;
    const auth = useAuthStore();
    if (!auth.permissionsLoaded) return;
    inflight = true;
    try {
        const since =
            lastSyncIso ??
            auth.launchBootstrap?.serverTime ??
            new Date(0).toISOString();
        const res = (await sendRPC('Mobile.SyncDelta', {
            since
        })) as SyncDeltaResponse;
        lastSyncIso = res.serverTime;
        if (res.devices?.visible && Array.isArray(res.devices.changed)) {
            useDevicesStore().seedFromBootstrap(res.devices.changed);
        }
        if (res.waitingRoom?.visible) {
            auth.updateWaitingRoom(
                res.waitingRoom.pendingCount,
                res.waitingRoom.pending ?? {}
            );
        }
        if (res.alerts?.visible) {
            auth.updateAlertCounts(
                res.alerts.openCount,
                res.alerts.criticalCount
            );
        }
    } catch (err) {
        // Tab-resume / network blip — next tick will pick up cleanly.
        if (!isRecoverableReconnectError(err)) {
            console.warn('[launchSync] Mobile.SyncDelta failed:', err);
        }
    } finally {
        inflight = false;
    }
}

async function refreshWaitingRoomCount(): Promise<void> {
    const auth = useAuthStore();
    if (!auth.permissionsLoaded || !auth.launchBootstrap?.waitingRoom.visible) {
        return;
    }

    try {
        const res = (await sendRPC('WaitingRoom.GetCounts', {})) as {
            pendingCount: number;
        };
        auth.updateWaitingRoomCount(res.pendingCount);
    } catch (err) {
        if (!isRecoverableReconnectError(err)) {
            console.warn('[launchSync] WaitingRoom.GetCounts failed:', err);
        }
    }
}

const ALERT_LIFECYCLE_EVENTS = new Set([
    'Alert.Created',
    'Alert.Updated',
    'Alert.Resolved',
    'Alert.Acked',
    'Alert.Silenced'
]);

export function initLaunchSync(): void {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenAt = Date.now();
            return;
        }
        const idle = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = null;
        if (idle >= MOBILE_RESUME_THRESHOLD_MS) void runSyncDelta();
    });

    onWaitingRoomUpdated(scheduleWaitingRoomCountSync);
    onAlertEvent((e) => {
        if (ALERT_LIFECYCLE_EVENTS.has(e.method)) scheduleSync();
    });
}
