import log4js from 'log4js';
import * as Observability from '../Observability';
import {
    mergeDeviceInfo,
    sanitizeDeviceInfo,
    sanitizeStatus
} from '../WaitingRoom/sanitize';
import type {SanitizedStatusShape} from '../WaitingRoom/types';
import type {WaitingRoomProbe} from './waitingRoomProbeRegistry';

const logger = log4js.getLogger('waiting-room-enrichment');

export interface WaitingRoomSnapshotEnrichmentInput {
    organizationId: string;
    reportedExternalId: string;
    probe: WaitingRoomProbe;
}

export type StatusMerge = (
    organizationId: string,
    shellyID: string,
    status: Record<string, unknown>
) => Promise<boolean>;

// Lazy import keeps the Redis barrel out of pure tests that mock the merge.
const defaultMerge: StatusMerge = async (organizationId, shellyID, status) => {
    const {mergePendingStatus} = await import(
        '../WaitingRoom/redisWaitingStore.js'
    );
    return mergePendingStatus(organizationId, shellyID, status);
};

// Open entries live in the Redis store, so the probed snapshot merges there.
export async function enrichOpenWaitingRoomSnapshot(
    input: WaitingRoomSnapshotEnrichmentInput,
    merge: StatusMerge = defaultMerge
): Promise<boolean> {
    const status = await readSafeStatus(input.probe);
    if (Object.keys(status).length === 0) return false;
    const merged = await merge(
        input.organizationId,
        input.reportedExternalId,
        status
    );
    if (!merged) {
        // A missed merge loses the device model — the card shows the
        // generic logo and nothing else says why.
        logger.warn(
            'waiting-room enrichment for %s did not land: no live entry under org %s',
            input.reportedExternalId,
            input.organizationId
        );
        Observability.incrementCounter('waiting_room_enrichment_missed');
        return false;
    }
    return true;
}

async function readSafeStatus(
    probe: WaitingRoomProbe
): Promise<SanitizedStatusShape> {
    // allSettled: one probe failing must not discard the other's result.
    const [deviceInfo, liveStatus] = await Promise.allSettled([
        probe.sendRpc('Shelly.GetDeviceInfo'),
        probe.sendRpc('Shelly.GetStatus')
    ]);
    if (deviceInfo.status === 'rejected') {
        logProbeFailure('Shelly.GetDeviceInfo', deviceInfo.reason);
    }
    if (liveStatus.status === 'rejected') {
        logProbeFailure('Shelly.GetStatus', liveStatus.reason);
    }
    return mergeDeviceInfo(
        sanitizeStatus(settledValue(liveStatus)),
        sanitizeDeviceInfo(settledValue(deviceInfo))
    );
}

function settledValue(result: PromiseSettledResult<unknown>): unknown {
    return result.status === 'fulfilled' ? result.value : undefined;
}

function logProbeFailure(method: string, reason: unknown): void {
    Observability.incrementLabeledCounter('waiting_room_probe_failures', {
        method
    });
    logger.warn('enrichment probe %s failed: %s', method, reason);
}
