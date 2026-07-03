import {tuning} from '../../config/tuning';
import {getInstanceId} from '../redis/instanceId';
import type {WaitingAuthMethod, WaitingEntry} from '../redis/ports';
import {waitingStore} from '../redis/services';
import {wakeupPeriodFromStatus} from '../redis/waitingTtl';

export type {WaitingAuthMethod, WaitingEntry} from '../redis/ports';

export interface PendingDevice {
    shellyID: string;
    organizationId: string;
    authMethod: WaitingAuthMethod;
    status: string;
    jdoc: Record<string, unknown>;
}

// Returns false when the org is at its size cap and the device is new.
export async function recordPending(device: PendingDevice): Promise<boolean> {
    const existing = await waitingStore.get(
        device.organizationId,
        device.shellyID
    );
    const now = Date.now();
    const entry: WaitingEntry = {
        ...device,
        ownerInstanceId: getInstanceId(),
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        // Sleeper wake interval extends the entry TTL so it survives between
        // wakes; carried over from a prior entry until a fresh status reports it.
        wakeupPeriodSec:
            wakeupPeriodFromStatus(device.jdoc) ?? existing?.wakeupPeriodSec
    };
    return waitingStore.upsert(entry);
}

export async function isPending(
    organizationId: string,
    shellyID: string
): Promise<boolean> {
    return waitingStore.isPending(organizationId, shellyID);
}

export async function mergePendingStatus(
    organizationId: string,
    shellyID: string,
    status: Record<string, unknown>
): Promise<boolean> {
    return waitingStore.mergeStatus(organizationId, shellyID, status);
}

export async function heartbeatPending(
    organizationId: string,
    shellyID: string
): Promise<void> {
    await waitingStore.heartbeat(organizationId, shellyID);
}

export async function listPending(
    organizationId: string
): Promise<WaitingEntry[]> {
    return waitingStore.listByOrg(organizationId);
}

export async function countPending(organizationId: string): Promise<number> {
    return waitingStore.countByOrg(organizationId);
}

// Atomic remove-and-return: only one concurrent caller wins.
export async function claimPending(
    organizationId: string,
    shellyID: string
): Promise<WaitingEntry | null> {
    return waitingStore.claim(organizationId, shellyID);
}

export async function restoreClaimedPending(
    entry: WaitingEntry
): Promise<void> {
    await waitingStore.restoreClaimed(entry);
}

export async function dropPending(
    organizationId: string,
    shellyID: string
): Promise<void> {
    await waitingStore.remove(organizationId, shellyID);
}

export async function markRejected(
    organizationId: string,
    shellyID: string
): Promise<void> {
    await waitingStore.markRejected(
        organizationId,
        shellyID,
        tuning.waitingRoom.rejectCooldownSec
    );
}

export async function isRejected(
    organizationId: string,
    shellyID: string
): Promise<boolean> {
    return waitingStore.isRejected(organizationId, shellyID);
}
