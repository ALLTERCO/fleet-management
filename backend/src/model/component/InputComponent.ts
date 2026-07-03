import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    INPUT_CHECK_EXPRESSION_PARAMS_SCHEMA,
    INPUT_DESCRIBE,
    INPUT_GET_CONFIG_PARAMS_SCHEMA,
    INPUT_GET_STATUS_PARAMS_SCHEMA,
    INPUT_RESET_COUNTERS_PARAMS_SCHEMA,
    INPUT_SET_CONFIG_PARAMS_SCHEMA,
    INPUT_TRIGGER_PARAMS_SCHEMA,
    type InputCheckExpressionParams,
    type InputGetConfigParams,
    type InputGetStatusParams,
    type InputResetCountersParams,
    type InputSetConfigParams,
    type InputTriggerParams
} from '../../types/api/input';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class InputComponent extends Component<any> {
    constructor() {
        super('input', {
            set_config_methods: false,
            auto_apply_config: false,
            // Input.mdx → Notifications. Push events have their own
            // ShellyMessageHandler cases; btn_down/btn_up are
            // notification-only with no state mirror.
            events: [
                {event: 'btn_down'},
                {event: 'btn_up'},
                {event: 'single_push'},
                {event: 'double_push'},
                {event: 'triple_push'},
                {event: 'long_push'}
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return INPUT_DESCRIBE;
    }

    @Component.Expose('Trigger')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async trigger(params: unknown) {
        const v = validateOrThrow<InputTriggerParams>(
            params,
            INPUT_TRIGGER_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.event !== undefined) payload.event = v.event;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Input.Trigger', () =>
            device.sendRPC('Input.Trigger', payload)
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<InputSetConfigParams>(
            params,
            INPUT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Input.SetConfig', () =>
            device.sendRPC('Input.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetCounters(params: unknown) {
        const v = validateOrThrow<InputResetCountersParams>(
            params,
            INPUT_RESET_COUNTERS_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.types !== undefined) payload.types = v.types;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Input.ResetCounters', () =>
            device.sendRPC('Input.ResetCounters', payload)
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<InputGetConfigParams>(
            params,
            INPUT_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Input.GetConfig', () =>
            device.sendRPC('Input.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<InputGetStatusParams>(
            params,
            INPUT_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Input.GetStatus', () =>
            device.sendRPC('Input.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('CheckExpression')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async checkExpression(params: unknown) {
        const v = validateOrThrow<InputCheckExpressionParams>(
            params,
            INPUT_CHECK_EXPRESSION_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Input.CheckExpression', () =>
            device.sendRPC('Input.CheckExpression', {
                expr: v.expr,
                inputs: v.inputs
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
