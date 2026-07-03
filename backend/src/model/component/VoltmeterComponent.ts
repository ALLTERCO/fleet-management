// Voltmeter.* — voltmeter sensor with optional expression evaluation.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    VOLTMETER_CHECK_EXPRESSION_PARAMS_SCHEMA,
    VOLTMETER_DESCRIBE,
    VOLTMETER_GET_CONFIG_PARAMS_SCHEMA,
    VOLTMETER_GET_STATUS_PARAMS_SCHEMA,
    VOLTMETER_SET_CONFIG_PARAMS_SCHEMA,
    type VoltmeterCheckExpressionParams,
    type VoltmeterGetConfigParams,
    type VoltmeterGetStatusParams,
    type VoltmeterSetConfigParams
} from '../../types/api/voltmeter';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class VoltmeterComponent extends Component<any> {
    constructor() {
        super('voltmeter', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return VOLTMETER_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<VoltmeterSetConfigParams>(
            params,
            VOLTMETER_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Voltmeter.SetConfig', () =>
            device.sendRPC('Voltmeter.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<VoltmeterGetConfigParams>(
            params,
            VOLTMETER_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Voltmeter.GetConfig', () =>
            device.sendRPC('Voltmeter.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<VoltmeterGetStatusParams>(
            params,
            VOLTMETER_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Voltmeter.GetStatus', () =>
            device.sendRPC('Voltmeter.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('CheckExpression')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async checkExpression(params: unknown) {
        const v = validateOrThrow<VoltmeterCheckExpressionParams>(
            params,
            VOLTMETER_CHECK_EXPRESSION_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Voltmeter.CheckExpression', () =>
            device.sendRPC('Voltmeter.CheckExpression', {
                expr: v.expr,
                inputs: v.inputs
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
