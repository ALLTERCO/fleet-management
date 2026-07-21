import {sendRPC} from '@/tools/websocket';
import type {ShellyDeviceExternal} from '@/types';

const FM = 'FLEET_MANAGER';

// WaitingRoom.GetPending contract — SSOT for a pending entry. profileId is the
// suggested onboarding profile (deviceIngress entries only; null for legacy).
export interface PendingDevice {
    shellyID: string;
    status: ShellyDeviceExternal['status'];
    addedAt: number;
    touchedAt: number;
    profileId?: string | null;
}

// deviceIngress entries are approved through their own RPC (legacy accept can't
// admit them). entryId is the full waiting-room entry id, prefixed
// deviceIngress:<uuid> — the backend parseWaitingRoomEntryId strips the prefix
// to route it. create_new_device is the right action for a fresh waiting device;
// profile is optional — the backend defaults to the device's connected security.
export function approveDeviceIngressEntry(
    entryId: string,
    profileId?: string
): Promise<unknown> {
    return sendRPC(FM, 'waitingroom.Approve', {
        entryId,
        action: 'create_new_device',
        ...(profileId ? {profileId} : {})
    });
}
