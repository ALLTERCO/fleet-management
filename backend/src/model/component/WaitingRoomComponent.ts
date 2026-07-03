import {logDeviceIngressAudit} from '../../modules/deviceIngress/audit';
import * as deviceIngressRepository from '../../modules/deviceIngress/deviceIngressRepository';
import {setWaitingRoomOpenCount} from '../../modules/deviceIngress/metrics';
import {recordWaitingRoomRejection} from '../../modules/deviceIngress/rejections';
import {
    approveWaitingRoomEntry,
    probeWaitingRoomEntry,
    rejectWaitingRoomEntry,
    requireWaitingRoomEntry
} from '../../modules/deviceIngress/waitingRoom';
import {getWaitingRoomProbe} from '../../modules/deviceIngress/waitingRoomProbeRegistry';
import * as EventDistributor from '../../modules/EventDistributor';
import {
    ACCESS_CONTROL,
    admitBatchByIds,
    groupAddDevicesBatch
} from '../../modules/PostgresProvider';
import {
    emitWaitingRoomAcceptedBatch,
    emitWaitingRoomDenied
} from '../../modules/ShellyEvents';
import * as WaitingRoomModule from '../../modules/WaitingRoom';
import {acceptExternalIds} from '../../modules/WaitingRoom/acceptExternalIds';
import {
    cancelBulkAccept,
    getBulkAccept,
    startBulkAccept
} from '../../modules/WaitingRoom/bulkAcceptJob';
import {
    dropPending,
    markRejected
} from '../../modules/WaitingRoom/redisWaitingStore';
import {
    getUnifiedWaitingRoomEntry,
    listAllOpenExternalIds,
    listAllOpenWaitingRoom,
    listUnifiedWaitingRoom,
    parseWaitingRoomEntryId
} from '../../modules/WaitingRoom/unified';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    WAITINGROOM_ACCEPT_ALL_START_PARAMS_SCHEMA,
    WAITINGROOM_ACCEPT_BULK_START_PARAMS_SCHEMA,
    WAITINGROOM_ACCEPT_BY_EXTERNAL_ID_PARAMS_SCHEMA,
    WAITINGROOM_ACCEPT_BY_ID_PARAMS_SCHEMA,
    WAITINGROOM_APPROVE_PARAMS_SCHEMA,
    WAITINGROOM_DESCRIBE,
    WAITINGROOM_ENTRY_PARAMS_SCHEMA,
    WAITINGROOM_GET_COUNTS_PARAMS_SCHEMA,
    WAITINGROOM_GET_DENIED_PARAMS_SCHEMA,
    WAITINGROOM_GET_PENDING_PARAMS_SCHEMA,
    WAITINGROOM_JOB_REF_PARAMS_SCHEMA,
    WAITINGROOM_LIST_DENIED_PARAMS_SCHEMA,
    WAITINGROOM_LIST_PARAMS_SCHEMA,
    WAITINGROOM_QUARANTINE_PARAMS_SCHEMA,
    WAITINGROOM_REJECT_PARAMS_SCHEMA,
    WAITINGROOM_REJECT_PENDING_PARAMS_SCHEMA,
    type WaitingRoomAcceptAllStartParams,
    type WaitingRoomAcceptBulkStartParams,
    type WaitingRoomAcceptByExternalIdParams,
    type WaitingRoomAcceptByIdParams,
    type WaitingRoomAcceptResponse,
    type WaitingRoomApproveParams,
    type WaitingRoomBulkAcceptStatus,
    type WaitingRoomEntryParams,
    type WaitingRoomJobRefParams,
    type WaitingRoomListParams,
    type WaitingRoomQuarantineParams,
    type WaitingRoomRejectParams,
    type WaitingRoomRejectPendingParams
} from '../../types/api/waitingroom';
import type CommandSender from '../CommandSender';
import Component from './Component';
import {
    canAcceptPending,
    canQuarantinePending,
    canReadWaitingRoom,
    canRejectPending
} from './waitingRoomPermissions';

interface Config {
    enable: boolean;
}

function buildAcceptResponse(input: {
    success: Array<number | string>;
    error: Array<number | string>;
    acceptedIds: number[];
    acceptedExternalIds: string[];
}): WaitingRoomAcceptResponse {
    return {
        ...input,
        pendingCount: WaitingRoomModule.countPendingDevices()
    };
}

export default class WaitingRoomComponent extends Component<Config> {
    constructor() {
        super('waitingroom', {viewer_visible: true});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return WAITINGROOM_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('GetPending')
    @Component.CheckPermissions(canReadWaitingRoom)
    async getPending(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            WAITINGROOM_GET_PENDING_PARAMS_SCHEMA
        );
        // Unpaged — the operator sees every pending device, not 100.
        const items = await listAllOpenWaitingRoom(
            requireOrganizationId(sender)
        );
        return Object.fromEntries(items.map((item) => [item.entryId, item]));
    }

    @Component.NoAudit
    @Component.Expose('GetDenied')
    @Component.CheckPermissions(canReadWaitingRoom)
    async getDenied(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            WAITINGROOM_GET_DENIED_PARAMS_SCHEMA
        );
        return await WaitingRoomModule.getDenied();
    }

    @Component.NoAudit
    @Component.Expose('GetCounts')
    @Component.CheckPermissions(canReadWaitingRoom)
    async getCounts(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomListParams>(
            params ?? {},
            WAITINGROOM_GET_COUNTS_PARAMS_SCHEMA
        );
        const list = await listUnifiedWaitingRoom({
            organizationId: requireOrganizationId(sender),
            ...p,
            state: p.state ?? 'open'
        });
        return {pendingCount: list.total};
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canReadWaitingRoom)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomListParams>(
            params ?? {},
            WAITINGROOM_LIST_PARAMS_SCHEMA
        );
        const list = await listUnifiedWaitingRoom({
            organizationId: requireOrganizationId(sender),
            ...p,
            state: p.state ?? 'open'
        });
        return buildListResponse(
            list.items,
            list.total,
            list.limit,
            list.offset
        );
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canReadWaitingRoom)
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomEntryParams>(
            params,
            WAITINGROOM_ENTRY_PARAMS_SCHEMA
        );
        const item = await getUnifiedWaitingRoomEntry({
            organizationId: requireOrganizationId(sender),
            entryId: p.entryId
        });
        if (!item) throw RpcError.NotFound('waitingRoom.entry', p.entryId);
        return item;
    }

    @Component.NoAudit
    @Component.Expose('Probe')
    @Component.CheckPermissions(canReadWaitingRoom)
    @Component.RateLimit('expensive')
    async probe(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomEntryParams>(
            params,
            WAITINGROOM_ENTRY_PARAMS_SCHEMA
        );
        const parsed = parseWaitingRoomEntryId(p.entryId);
        if (parsed.source === 'legacy') {
            const item = await getUnifiedWaitingRoomEntry({
                organizationId: requireOrganizationId(sender),
                entryId: p.entryId
            });
            if (!item) throw RpcError.NotFound('waitingRoom.entry', p.entryId);
            return {source: 'legacy', live: false, status: item.status};
        }
        return probeWaitingRoomEntry({
            organizationId: requireOrganizationId(sender),
            waitingRoomId: parsed.id,
            repository: deviceIngressRepository,
            getProbe: getWaitingRoomProbe
        });
    }

    @Component.NoAudit
    @Component.Expose('ListDenied')
    @Component.CheckPermissions(canReadWaitingRoom)
    async listDenied(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomListParams>(
            params ?? {},
            WAITINGROOM_LIST_DENIED_PARAMS_SCHEMA
        );
        const list = await listUnifiedWaitingRoom({
            organizationId: requireOrganizationId(sender),
            ...p,
            state: 'rejected'
        });
        return buildListResponse(
            list.items,
            list.total,
            list.limit,
            list.offset
        );
    }

    @Component.Expose('AcceptPendingById')
    @Component.CheckPermissions(canAcceptPending)
    async acceptPendingById(rawParams: unknown, sender: CommandSender) {
        const {ids, groupId} = validateOrThrow<WaitingRoomAcceptByIdParams>(
            rawParams,
            WAITINGROOM_ACCEPT_BY_ID_PARAMS_SCHEMA
        );
        const username = sender.getUser()?.username;
        const orgId = requireOrganizationId(sender);

        // Atomic UPDATE...RETURNING: missing ids drop out of the result
        // set, so success/error reflects the actual post-update DB state
        // with no allow-then-fetch race window.
        const records = await admitBatchByIds(
            ids,
            ACCESS_CONTROL.ALLOWED,
            orgId
        );
        const foundIds = new Set(records.map((r) => r.id));
        const externalIds = records.map((r) => r.external_id).filter(Boolean);
        const success = ids.filter((id) => foundIds.has(id));
        const error = ids.filter((id) => !foundIds.has(id));

        // admitBatchByIds stamped org in the same write; sync the in-memory
        // routing map. Invalidate BEFORE the connect-emitting approve —
        // otherwise the Shelly.Connect race drops on stale orgDeviceIds.
        for (const ext of externalIds)
            EventDistributor.setDeviceOrg(ext, orgId);
        EventDistributor.invalidateGroupCache(orgId);

        WaitingRoomModule.approveDevicesBatch(records, username);
        await this.#dropStoreEntries(orgId, externalIds);
        emitWaitingRoomAcceptedBatch(success);

        if (typeof groupId === 'number' && externalIds.length > 0) {
            try {
                await groupAddDevicesBatch(orgId, groupId, externalIds);
                EventDistributor.invalidateGroupCache(orgId);
            } catch (err) {
                this.logger.warn(
                    'Failed to batch-add %d devices to group %d: %s',
                    externalIds.length,
                    groupId,
                    err
                );
            }
        }

        return buildAcceptResponse({
            success,
            error,
            acceptedIds: success,
            acceptedExternalIds: externalIds
        });
    }

    @Component.Expose('AcceptPendingByExternalId')
    @Component.CheckPermissions(canAcceptPending)
    async acceptPendingByExternal(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<WaitingRoomAcceptByExternalIdParams>(
            rawParams,
            WAITINGROOM_ACCEPT_BY_EXTERNAL_ID_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const {success, error, records} = await acceptExternalIds({
            organizationId: orgId,
            externalIds: params.externalIds,
            groupId: params.groupId,
            username: sender.getUser()?.username
        });

        return buildAcceptResponse({
            success,
            error,
            acceptedIds: records.map((r) => r.id),
            acceptedExternalIds: success
        });
    }

    @Component.Expose('AcceptBulkStart')
    @Component.CheckPermissions(canAcceptPending)
    @Component.RateLimit('expensive')
    async acceptBulkStart(rawParams: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomAcceptBulkStartParams>(
            rawParams,
            WAITINGROOM_ACCEPT_BULK_START_PARAMS_SCHEMA
        );
        const {jobId, total} = await startBulkAccept({
            organizationId: requireOrganizationId(sender),
            externalIds: p.externalIds,
            groupId: p.groupId,
            username: sender.getUser()?.username
        });
        return {jobId, total};
    }

    @Component.Expose('AcceptAllStart')
    @Component.CheckPermissions(canAcceptPending)
    @Component.RateLimit('expensive')
    async acceptAllStart(rawParams: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomAcceptAllStartParams>(
            rawParams,
            WAITINGROOM_ACCEPT_ALL_START_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        // Unpaged: accept-all covers every pending device, not a loaded page.
        const externalIds = await listAllOpenExternalIds(organizationId);
        const {jobId, total} = await startBulkAccept({
            organizationId,
            externalIds,
            groupId: p.groupId,
            username: sender.getUser()?.username
        });
        return {jobId, total};
    }

    @Component.NoAudit
    @Component.Expose('AcceptBulkStatus')
    @Component.CheckPermissions(canReadWaitingRoom)
    async acceptBulkStatus(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<WaitingRoomBulkAcceptStatus> {
        const p = validateOrThrow<WaitingRoomJobRefParams>(
            rawParams,
            WAITINGROOM_JOB_REF_PARAMS_SCHEMA
        );
        const record = await getBulkAccept(
            requireOrganizationId(sender),
            p.jobId
        );
        if (!record) {
            throw RpcError.NotFound('waitingRoom.bulkAcceptJob', p.jobId);
        }
        const {organizationId: _drop, ...status} = record;
        return status;
    }

    @Component.Expose('AcceptBulkCancel')
    @Component.CheckPermissions(canAcceptPending)
    async acceptBulkCancel(rawParams: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomJobRefParams>(
            rawParams,
            WAITINGROOM_JOB_REF_PARAMS_SCHEMA
        );
        return cancelBulkAccept(requireOrganizationId(sender), p.jobId);
    }

    @Component.Expose('Approve')
    @Component.CheckPermissions(canAcceptPending)
    @Component.RateLimit('expensive')
    async approve(rawParams: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomApproveParams>(
            rawParams,
            WAITINGROOM_APPROVE_PARAMS_SCHEMA
        );
        const parsed = parseWaitingRoomEntryId(p.entryId);
        if (parsed.source === 'legacy') {
            return this.acceptPendingByExternal(
                {externalIds: [parsed.id], groupId: p.groupId},
                sender
            );
        }
        return this.approveIngressEntry(parsed.id, p, sender);
    }

    @Component.Expose('RejectPending')
    @Component.CheckPermissions(canRejectPending)
    async rejectPending(rawParams: unknown, sender: CommandSender) {
        const {shellyIDs} = validateOrThrow<WaitingRoomRejectPendingParams>(
            rawParams,
            WAITINGROOM_REJECT_PENDING_PARAMS_SCHEMA
        );
        const username = sender.getUser()?.username;
        const orgId = requireOrganizationId(sender);

        // Numeric = DB id (denied-list); string = external shellyID.
        const numericIds: number[] = [];
        const externalIds: string[] = [];
        for (const id of shellyIDs) {
            const numericId = Number(id);
            if (Number.isInteger(numericId) && numericId > 0) {
                numericIds.push(numericId);
            } else {
                externalIds.push(id);
            }
        }

        const success: string[] = [];
        const error: string[] = [];

        if (numericIds.length > 0) {
            try {
                const records = await admitBatchByIds(
                    numericIds,
                    ACCESS_CONTROL.DENIED,
                    orgId
                );
                const foundIds = new Set(records.map((r) => r.id));
                const externalIds = records
                    .map((r) => r.external_id)
                    .filter((id): id is string => Boolean(id));
                success.push(
                    ...numericIds
                        .filter((id) => foundIds.has(id))
                        .map((id) => String(id))
                );
                error.push(
                    ...numericIds
                        .filter((id) => !foundIds.has(id))
                        .map((id) => String(id))
                );
                for (const record of records) emitWaitingRoomDenied(record.id);
                await Promise.all(
                    externalIds.map((externalId) =>
                        markRejected(orgId, externalId)
                    )
                );
                await this.#dropStoreEntries(orgId, externalIds);
            } catch (err) {
                this.logger.warn('Failed to deny by id batch: %s', err);
                error.push(...numericIds.map((id) => String(id)));
            }
        }

        if (externalIds.length > 0) {
            const result = await WaitingRoomModule.denyDevicesByExternalIds(
                externalIds,
                username,
                orgId
            );
            success.push(...result.success);
            error.push(...result.error);
            for (const id of result.deniedIds) emitWaitingRoomDenied(id);
        }

        return {success, error};
    }

    @Component.Expose('Reject')
    @Component.CheckPermissions(canRejectPending)
    async reject(rawParams: unknown, sender: CommandSender) {
        const p = validateOrThrow<WaitingRoomRejectParams>(
            rawParams,
            WAITINGROOM_REJECT_PARAMS_SCHEMA
        );
        const parsed = parseWaitingRoomEntryId(p.entryId);
        if (parsed.source === 'legacy') {
            return this.rejectPending({shellyIDs: [parsed.id]}, sender);
        }
        return this.rejectIngressEntry(parsed.id, p, sender);
    }

    // Destructive — rewrites device WS config (server='#', enable=false) and
    // reboots. Used only for adversarial / hammering devices; default admin-
    // block is RejectPending (polite close, fully reversible).
    @Component.Expose('Quarantine')
    @Component.CheckPermissions(canQuarantinePending)
    async quarantine(rawParams: unknown, sender: CommandSender) {
        const {shellyIDs} = validateOrThrow<WaitingRoomQuarantineParams>(
            rawParams,
            WAITINGROOM_QUARANTINE_PARAMS_SCHEMA
        );
        const externalIds = shellyIDs.map(String);
        const result = await WaitingRoomModule.quarantineDevicesByExternalIds(
            externalIds,
            sender.getUser()?.username,
            requireOrganizationId(sender)
        );
        for (const id of result.deniedIds) emitWaitingRoomDenied(id);
        return {success: result.success, error: result.error};
    }

    protected override getDefaultConfig(): Config {
        return {
            enable: true
        };
    }

    // Drop open store entries after a DB approve.
    async #dropStoreEntries(
        organizationId: string,
        externalIds: string[]
    ): Promise<void> {
        await Promise.all(
            externalIds.map(async (externalId) => {
                try {
                    await dropPending(organizationId, externalId);
                } catch (err) {
                    this.logger.warn(
                        'Store drop failed for %s: %s',
                        externalId,
                        err
                    );
                }
            })
        );
    }

    private async approveIngressEntry(
        waitingRoomId: string,
        params: WaitingRoomApproveParams,
        sender: CommandSender
    ) {
        const orgId = requireOrganizationId(sender);
        const entry = await requireWaitingRoomEntry({
            organizationId: orgId,
            waitingRoomId,
            repository: deviceIngressRepository
        });
        const profileId = params.profileId ?? entry.profileId;
        if (!profileId) throw RpcError.InvalidParams('profileId is required');
        const result = await approveWaitingRoomEntry({
            organizationId: orgId,
            entry,
            params: {
                waitingRoomId,
                action: params.action ?? 'create_new_device',
                deviceId: params.deviceId,
                profileId
            },
            repository: deviceIngressRepository
        });
        publishFleetDeviceBinding(orgId, entry.reportedExternalId);
        await publishWaitingRoomGauge(orgId);
        await auditIngressWaitingRoom(
            sender,
            'waiting_room_approved',
            entry.id,
            {
                identityId: result.identity.id,
                action: params.action ?? 'create_new_device'
            }
        );
        return result;
    }

    private async rejectIngressEntry(
        waitingRoomId: string,
        params: WaitingRoomRejectParams,
        sender: CommandSender
    ) {
        const reasonCode = params.reasonCode;
        if (!reasonCode) throw RpcError.InvalidParams('reasonCode is required');
        const orgId = requireOrganizationId(sender);
        const entry = await rejectWaitingRoomEntry({
            organizationId: orgId,
            params: {waitingRoomId, reasonCode},
            repository: deviceIngressRepository
        });
        const rejection = await recordWaitingRoomRejection({
            organizationId: orgId,
            waitingRoomId,
            reasonCode,
            detail: params.detail,
            entry,
            repository: deviceIngressRepository
        });
        await applyIngressRejectCooldown(orgId, entry.reportedExternalId);
        await publishWaitingRoomGauge(orgId);
        await auditIngressWaitingRoom(
            sender,
            'waiting_room_rejected',
            entry.id,
            {
                rejectionId: rejection.id,
                reasonCode
            }
        );
        return {success: true, entry, rejection};
    }
}

async function applyIngressRejectCooldown(
    organizationId: string,
    reportedExternalId: string
): Promise<void> {
    await markRejected(organizationId, reportedExternalId);
    await dropPending(organizationId, reportedExternalId);
}

async function publishWaitingRoomGauge(organizationId: string): Promise<void> {
    setWaitingRoomOpenCount(
        await deviceIngressRepository.countOpenWaitingRoom({organizationId})
    );
}

function publishFleetDeviceBinding(
    organizationId: string,
    reportedExternalId: string
): void {
    EventDistributor.setDeviceOrg(reportedExternalId, organizationId);
    EventDistributor.invalidateGroupCache(organizationId);
}

async function auditIngressWaitingRoom(
    sender: CommandSender,
    kind: 'waiting_room_approved' | 'waiting_room_rejected',
    subjectId: string,
    details: Record<string, unknown>
): Promise<void> {
    await logDeviceIngressAudit({
        kind,
        organizationId: requireOrganizationId(sender),
        actor:
            sender.getUser()?.username ?? sender.getUser()?.userId ?? 'unknown',
        subjectId,
        details
    });
}
