import {
    allowAccessControlBatch,
    getBatch,
    getBatchByIds,
    groupAddDevicesBatch
} from '../../modules/PostgresProvider';
import {
    emitWaitingRoomAccepted,
    emitWaitingRoomAcceptedBatch,
    emitWaitingRoomDenied
} from '../../modules/ShellyEvents';
import * as WaitingRoomModule from '../../modules/WaitingRoom';
import type {WaitingRoom} from '../../validations/params';
import type CommandSender from '../CommandSender';
import Component from './Component';

interface Config {
    enable: boolean;
}

export default class WaitingRoomComponent extends Component<Config> {
    constructor() {
        super('waitingroom');
    }

    @Component.Expose('GetPending')
    async getPending() {
        return await WaitingRoomModule.listPendingDevices();
    }

    @Component.Expose('GetDenied')
    async getDenied() {
        return await WaitingRoomModule.getDenied();
    }

    @Component.Expose('AcceptPendingById')
    async acceptPendingById(
        {ids, groupId}: WaitingRoom.AcceptPendingById,
        sender: CommandSender
    ) {
        const username = sender.getUser()?.username;

        // 1. Batch UPDATE: allow all devices in one query
        await allowAccessControlBatch(ids);

        // 2. Batch SELECT: fetch all records in one query
        const records = await getBatchByIds(ids);
        const foundIds = new Set(records.map((r) => r.id));

        // 3. Build success/error arrays
        const success = ids.filter((id) => foundIds.has(id));
        const error = ids.filter((id) => !foundIds.has(id));

        // 4. Fire onApprove callbacks (in-memory)
        WaitingRoomModule.approveDevicesBatch(records, username);

        // 5. Emit single batch event (instead of N individual events)
        emitWaitingRoomAcceptedBatch(success);

        // 6. Batch group assignment (parallel-safe)
        if (typeof groupId === 'number' && records.length > 0) {
            const externalIds = records
                .map((r) => r.external_id)
                .filter(Boolean);
            try {
                await groupAddDevicesBatch(groupId, externalIds);
            } catch (err) {
                this.logger.warn(
                    'Failed to batch-add %d devices to group %d: %s',
                    externalIds.length,
                    groupId,
                    err
                );
            }
        }

        return {success, error};
    }

    @Component.Expose('AcceptPendingByExternalId')
    async acceptPendingByExternal(
        {externalIds, groupId}: WaitingRoom.AcceptPendingByExternalId,
        sender: CommandSender
    ) {
        const username = sender.getUser()?.username;

        // 1. Batch SELECT: fetch all records in one query
        const records = await getBatch(externalIds);
        const foundExternals = new Set(records.map((r) => r.external_id));

        // 2. Build success/error arrays
        const success = externalIds.filter((eid) => foundExternals.has(eid));
        const error = externalIds.filter((eid) => !foundExternals.has(eid));

        // 3. Batch UPDATE: allow all found devices
        const internalIds = records.map((r) => r.id);
        if (internalIds.length > 0) {
            await allowAccessControlBatch(internalIds);
        }

        // 4. Fire onApprove callbacks (in-memory)
        WaitingRoomModule.approveDevicesBatch(records, username);

        // 5. Emit single batch event
        emitWaitingRoomAcceptedBatch(records.map((r) => r.id));

        // 6. Batch group assignment (parallel-safe)
        if (typeof groupId === 'number' && success.length > 0) {
            try {
                await groupAddDevicesBatch(groupId, success);
            } catch (err) {
                this.logger.warn(
                    'Failed to batch-add %d devices to group %d: %s',
                    success.length,
                    groupId,
                    err
                );
            }
        }

        return {success, error};
    }

    @Component.Expose('RejectPending')
    async rejectPending({shellyIDs}: {shellyIDs: string[]}) {
        const success: string[] = [];
        const error: string[] = [];
        for (const shellyID of shellyIDs) {
            try {
                await WaitingRoomModule.denyDevice(Number(shellyID));
                success.push(shellyID);
                emitWaitingRoomDenied(Number(shellyID));
            } catch (err) {
                this.logger.warn('Failed to deny', shellyID, err);
                error.push(shellyID);
            }
        }

        return {
            success,
            error
        };
    }

    protected override getDefaultConfig(): Config {
        return {
            enable: true
        };
    }
}
