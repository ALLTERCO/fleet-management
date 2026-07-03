import log4js from 'log4js';
import * as EventDistributor from '../EventDistributor';
import * as Observability from '../Observability';
import {groupAddDevicesBatch} from '../PostgresProvider';
import {emitWaitingRoomAcceptedBatch} from '../ShellyEvents';
import {
    type AcceptChunkHook,
    type ClaimApproveResult,
    claimAndApproveByExternalIds
} from './index';

const logger = log4js.getLogger('waiting-room');

export interface AcceptExternalIdsInput {
    organizationId: string;
    externalIds: string[];
    groupId?: number;
    username?: string;
}

// Shared accept path for the inline RPC and the bulk job. fn_admit_batch stamps
// the owning org in the same write as control_access, so org is persisted in one
// place; here we only sync the in-memory routing state and group cache.
export async function acceptExternalIds(
    input: AcceptExternalIdsInput,
    onChunk?: AcceptChunkHook
): Promise<ClaimApproveResult> {
    const {organizationId, externalIds, groupId, username} = input;
    const startMs = performance.now();
    logger.debug(
        'waiting-room accept external start org=%s ids=%d group=%s',
        organizationId,
        externalIds.length,
        groupId ?? '<none>'
    );
    const result = await claimAndApproveByExternalIds(
        organizationId,
        externalIds,
        username,
        undefined,
        onChunk
    );
    if (result.success.length > 0) {
        propagateOwningOrg(result.success, organizationId);
    }
    emitAcceptedSafe(result.records.map((r) => r.id));
    if (typeof groupId === 'number' && result.success.length > 0) {
        await addToGroup(organizationId, groupId, result.success);
    }
    Observability.recordRpcTiming(
        'waitingroom.accept_external.total',
        performance.now() - startMs
    );
    logger.debug(
        'waiting-room accept external finish org=%s ids=%d success=%d error=%d ms=%d',
        organizationId,
        externalIds.length,
        result.success.length,
        result.error.length,
        Math.round(performance.now() - startMs)
    );
    return result;
}

// Admit already committed, so a group-add failure leaves the device admitted
// but absent from its group; surface it loudly (error + metric), not a warn.
function reportGroupAddFailure(
    groupId: number,
    externalIds: string[],
    err: unknown
): void {
    Observability.incrementCounter('waiting_room_group_add_failed');
    logger.error(
        'Admitted %d device(s) but group-add to group %d FAILED — devices are admitted yet absent from the group: %s',
        externalIds.length,
        groupId,
        err
    );
}

// Org is already on the row from admit; sync the in-memory map so the alert
// engine and group cache see the new ownership without a DB re-read.
function propagateOwningOrg(
    externalIds: string[],
    organizationId: string
): void {
    for (const ext of externalIds)
        EventDistributor.setDeviceOrg(ext, organizationId);
    EventDistributor.invalidateGroupCache(organizationId);
}

function emitAcceptedSafe(ids: number[]): void {
    try {
        emitWaitingRoomAcceptedBatch(ids);
    } catch (err) {
        logger.warn('emitWaitingRoomAcceptedBatch failed: %s', err);
    }
}

async function addToGroup(
    organizationId: string,
    groupId: number,
    externalIds: string[]
): Promise<void> {
    const startMs = performance.now();
    try {
        await groupAddDevicesBatch(organizationId, groupId, externalIds);
        EventDistributor.invalidateGroupCache(organizationId);
        Observability.recordDbTiming(
            'waitingroom.accept_external.group_add',
            performance.now() - startMs
        );
        logger.debug(
            'waiting-room accept group-add org=%s group=%d ids=%d ms=%d',
            organizationId,
            groupId,
            externalIds.length,
            Math.round(performance.now() - startMs)
        );
    } catch (err) {
        Observability.recordDbTiming(
            'waitingroom.accept_external.group_add',
            performance.now() - startMs
        );
        reportGroupAddFailure(groupId, externalIds, err);
    }
}
