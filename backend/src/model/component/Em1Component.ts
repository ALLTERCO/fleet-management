// EM1.* — monophase energy meter.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    EM1_CALIBRATE_FROM_PARAMS_SCHEMA,
    EM1_DESCRIBE,
    EM1_GET_CONFIG_PARAMS_SCHEMA,
    EM1_GET_CT_TYPES_PARAMS_SCHEMA,
    EM1_GET_STATUS_PARAMS_SCHEMA,
    EM1_REVERT_TO_FACTORY_CALIBRATION_PARAMS_SCHEMA,
    EM1_SET_CONFIG_PARAMS_SCHEMA,
    type Em1CalibrateFromParams,
    type Em1GetConfigParams,
    type Em1GetCTTypesParams,
    type Em1GetStatusParams,
    type Em1RevertToFactoryCalibrationParams,
    type Em1SetConfigParams
} from '../../types/api/em1';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class Em1Component extends Component<any> {
    constructor() {
        super('em1', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return EM1_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<Em1SetConfigParams>(
            params,
            EM1_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM1.SetConfig', () =>
            device.sendRPC('EM1.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<Em1GetConfigParams>(
            params,
            EM1_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM1.GetConfig', () =>
            device.sendRPC('EM1.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<Em1GetStatusParams>(
            params,
            EM1_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM1.GetStatus', () =>
            device.sendRPC('EM1.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('GetCTTypes')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getCTTypes(params: unknown) {
        const v = validateOrThrow<Em1GetCTTypesParams>(
            params,
            EM1_GET_CT_TYPES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM1.GetCTTypes', () =>
            device.sendRPC('EM1.GetCTTypes', {id: v.id})
        );
    }

    @Component.Expose('CalibrateFrom')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async calibrateFrom(params: unknown) {
        const v = validateOrThrow<Em1CalibrateFromParams>(
            params,
            EM1_CALIBRATE_FROM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM1.CalibrateFrom', () =>
            device.sendRPC('EM1.CalibrateFrom', {
                id: v.id,
                other_id: v.other_id
            })
        );
    }

    @Component.Expose('RevertToFactoryCalibration')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async revertToFactoryCalibration(params: unknown) {
        const v = validateOrThrow<Em1RevertToFactoryCalibrationParams>(
            params,
            EM1_REVERT_TO_FACTORY_CALIBRATION_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM1.RevertToFactoryCalibration', () =>
            device.sendRPC('EM1.RevertToFactoryCalibration', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
