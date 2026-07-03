// EM.* — triphase energy meter.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    EM_DESCRIBE,
    EM_GET_CONFIG_PARAMS_SCHEMA,
    EM_GET_CT_TYPES_PARAMS_SCHEMA,
    EM_GET_STATUS_PARAMS_SCHEMA,
    EM_PHASE_TO_PHASE_CALIB_PARAMS_SCHEMA,
    EM_PHASE_TO_PHASE_CALIB_RESET_PARAMS_SCHEMA,
    EM_SET_CONFIG_PARAMS_SCHEMA,
    type EmGetConfigParams,
    type EmGetCTTypesParams,
    type EmGetStatusParams,
    type EmPhaseToPhaseCalibParams,
    type EmPhaseToPhaseCalibResetParams,
    type EmSetConfigParams
} from '../../types/api/em';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class EmComponent extends Component<any> {
    constructor() {
        super('em', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return EM_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<EmSetConfigParams>(
            params,
            EM_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM.SetConfig', () =>
            device.sendRPC('EM.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<EmGetConfigParams>(
            params,
            EM_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM.GetConfig', () =>
            device.sendRPC('EM.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<EmGetStatusParams>(
            params,
            EM_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM.GetStatus', () =>
            device.sendRPC('EM.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('GetCTTypes')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getCTTypes(params: unknown) {
        const v = validateOrThrow<EmGetCTTypesParams>(
            params,
            EM_GET_CT_TYPES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM.GetCTTypes', () =>
            device.sendRPC('EM.GetCTTypes', {id: v.id})
        );
    }

    @Component.Expose('PhaseToPhaseCalib')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async phaseToPhaseCalib(params: unknown) {
        const v = validateOrThrow<EmPhaseToPhaseCalibParams>(
            params,
            EM_PHASE_TO_PHASE_CALIB_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM.PhaseToPhaseCalib', () =>
            device.sendRPC('EM.PhaseToPhaseCalib', {
                id: v.id,
                from: v.from,
                to: v.to
            })
        );
    }

    @Component.Expose('PhaseToPhaseCalibReset')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async phaseToPhaseCalibReset(params: unknown) {
        const v = validateOrThrow<EmPhaseToPhaseCalibResetParams>(
            params,
            EM_PHASE_TO_PHASE_CALIB_RESET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('EM.PhaseToPhaseCalibReset', () =>
            device.sendRPC('EM.PhaseToPhaseCalibReset', {
                id: v.id,
                phase: v.phase
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
