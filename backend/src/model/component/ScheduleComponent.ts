// Schedule.* — device-side cron-style scheduler. Mirrors Shelly Schedule.* 1:1.

import * as DeviceCollector from '../../modules/DeviceCollector';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SCHEDULE_CREATE_PARAMS_SCHEMA,
    SCHEDULE_DELETE_ALL_PARAMS_SCHEMA,
    SCHEDULE_DELETE_PARAMS_SCHEMA,
    SCHEDULE_DESCRIBE,
    SCHEDULE_LIST_PARAMS_SCHEMA,
    SCHEDULE_UPDATE_PARAMS_SCHEMA,
    type ScheduleCreateParams,
    type ScheduleCreateResponse,
    type ScheduleDeleteAllParams,
    type ScheduleDeleteAllResponse,
    type ScheduleDeleteParams,
    type ScheduleDeleteResponse,
    type ScheduleJob,
    type ScheduleListParams,
    type ScheduleListResponse,
    type ScheduleUpdateParams,
    type ScheduleUpdateResponse
} from '../../types/api/schedule';
import type CommandSender from '../CommandSender';
import Component from './Component';

export default class ScheduleComponent extends Component {
    constructor() {
        super('schedule', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SCHEDULE_DESCRIBE;
    }

    private async callDevice<T>(
        shellyID: string,
        method: string,
        params: Record<string, unknown>
    ): Promise<T> {
        const device = DeviceCollector.getDevice(shellyID);
        if (!device) throw RpcError.DeviceNotFound();
        try {
            return (await device.sendRPC(method, params)) as T;
        } catch (err: unknown) {
            throw RpcError.DeviceFailed(method, err, shellyID);
        }
    }

    @Component.Expose('List')
    @Component.CrudPermission(
        'devices',
        'read',
        (p: ScheduleListParams) => p?.shellyID
    )
    async list(
        params: ScheduleListParams,
        _sender: CommandSender
    ): Promise<ScheduleListResponse> {
        const {shellyID} = validateOrThrow<ScheduleListParams>(
            params,
            SCHEDULE_LIST_PARAMS_SCHEMA
        );
        const res = await this.callDevice<{jobs?: ScheduleJob[]}>(
            shellyID,
            'Schedule.List',
            {}
        );
        const items = Array.isArray(res?.jobs) ? res.jobs : [];
        return buildListResponse(items, items.length, 0, 0);
    }

    @Component.Expose('Create')
    @Component.CrudPermission(
        'devices',
        'update',
        (p: ScheduleCreateParams) => p?.shellyID
    )
    async create(
        params: ScheduleCreateParams,
        _sender: CommandSender
    ): Promise<ScheduleCreateResponse> {
        const {shellyID, enable, timespec, calls} =
            validateOrThrow<ScheduleCreateParams>(
                params,
                SCHEDULE_CREATE_PARAMS_SCHEMA
            );
        const res = await this.callDevice<{id?: number}>(
            shellyID,
            'Schedule.Create',
            {
                enable: enable ?? true,
                timespec,
                calls
            }
        );
        if (typeof res?.id !== 'number') {
            throw RpcError.DeviceFailed(
                'Schedule.Create',
                'device returned no schedule id',
                shellyID
            );
        }
        return {id: res.id};
    }

    @Component.Expose('Update')
    @Component.CrudPermission(
        'devices',
        'update',
        (p: ScheduleUpdateParams) => p?.shellyID
    )
    async update(
        params: ScheduleUpdateParams,
        _sender: CommandSender
    ): Promise<ScheduleUpdateResponse> {
        const {shellyID, id, enable, timespec, calls} =
            validateOrThrow<ScheduleUpdateParams>(
                params,
                SCHEDULE_UPDATE_PARAMS_SCHEMA
            );
        const devicePayload: Record<string, unknown> = {id};
        if (enable !== undefined) devicePayload.enable = enable;
        if (timespec !== undefined) devicePayload.timespec = timespec;
        if (calls !== undefined) devicePayload.calls = calls;
        await this.callDevice(shellyID, 'Schedule.Update', devicePayload);
        return {success: true};
    }

    @Component.Expose('Delete')
    @Component.CrudPermission(
        'devices',
        'update',
        (p: ScheduleDeleteParams) => p?.shellyID
    )
    async rpcDelete(
        params: ScheduleDeleteParams,
        _sender: CommandSender
    ): Promise<ScheduleDeleteResponse> {
        const {shellyID, id} = validateOrThrow<ScheduleDeleteParams>(
            params,
            SCHEDULE_DELETE_PARAMS_SCHEMA
        );
        await this.callDevice(shellyID, 'Schedule.Delete', {id});
        return {success: true};
    }

    @Component.Expose('DeleteAll')
    @Component.CrudPermission(
        'devices',
        'update',
        (p: ScheduleDeleteAllParams) => p?.shellyID
    )
    async deleteAll(
        params: ScheduleDeleteAllParams,
        _sender: CommandSender
    ): Promise<ScheduleDeleteAllResponse> {
        const {shellyID} = validateOrThrow<ScheduleDeleteAllParams>(
            params,
            SCHEDULE_DELETE_ALL_PARAMS_SCHEMA
        );
        await this.callDevice(shellyID, 'Schedule.DeleteAll', {});
        return {success: true};
    }
}
