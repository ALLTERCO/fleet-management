// MbRtuClient.* — Modbus RTU client (Pro line).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MBRTUCLIENT_DESCRIBE,
    MBRTUCLIENT_GET_CONFIG_PARAMS_SCHEMA,
    MBRTUCLIENT_GET_STATUS_PARAMS_SCHEMA,
    MBRTUCLIENT_READ_BITS_PARAMS_SCHEMA,
    MBRTUCLIENT_READ_REGS_PARAMS_SCHEMA,
    MBRTUCLIENT_SET_CONFIG_PARAMS_SCHEMA,
    MBRTUCLIENT_WRITE_COILS_PARAMS_SCHEMA,
    MBRTUCLIENT_WRITE_REGS_PARAMS_SCHEMA,
    MBRTUCLIENT_WRITE_SINGLE_PARAMS_SCHEMA,
    type MbRtuClientGetConfigParams,
    type MbRtuClientGetStatusParams,
    type MbRtuClientReadBitsParams,
    type MbRtuClientReadRegsParams,
    type MbRtuClientSetConfigParams,
    type MbRtuClientWriteCoilsParams,
    type MbRtuClientWriteRegistersParams,
    type MbRtuClientWriteSingleRegisterParams
} from '../../types/api/mbrtuclient';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class MbRtuClientComponent extends Component<any> {
    constructor() {
        super('mbrtuclient', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return MBRTUCLIENT_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<MbRtuClientSetConfigParams>(
            params,
            MBRTUCLIENT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.SetConfig', () =>
            device.sendRPC('MbRtuClient.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<MbRtuClientGetConfigParams>(
            params,
            MBRTUCLIENT_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.GetConfig', () =>
            device.sendRPC('MbRtuClient.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<MbRtuClientGetStatusParams>(
            params,
            MBRTUCLIENT_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.GetStatus', () =>
            device.sendRPC('MbRtuClient.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('ReadHoldingRegisters')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async readHoldingRegisters(params: unknown) {
        const v = validateOrThrow<MbRtuClientReadRegsParams>(
            params,
            MBRTUCLIENT_READ_REGS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.ReadHoldingRegisters', () =>
            device.sendRPC('MbRtuClient.ReadHoldingRegisters', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                qty: v.qty
            })
        );
    }

    @Component.Expose('ReadInputRegisters')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async readInputRegisters(params: unknown) {
        const v = validateOrThrow<MbRtuClientReadRegsParams>(
            params,
            MBRTUCLIENT_READ_REGS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.ReadInputRegisters', () =>
            device.sendRPC('MbRtuClient.ReadInputRegisters', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                qty: v.qty
            })
        );
    }

    @Component.Expose('ReadDiscreteInputs')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async readDiscreteInputs(params: unknown) {
        const v = validateOrThrow<MbRtuClientReadBitsParams>(
            params,
            MBRTUCLIENT_READ_BITS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.ReadDiscreteInputs', () =>
            device.sendRPC('MbRtuClient.ReadDiscreteInputs', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                qty: v.qty
            })
        );
    }

    @Component.Expose('ReadCoils')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async readCoils(params: unknown) {
        const v = validateOrThrow<MbRtuClientReadBitsParams>(
            params,
            MBRTUCLIENT_READ_BITS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.ReadCoils', () =>
            device.sendRPC('MbRtuClient.ReadCoils', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                qty: v.qty
            })
        );
    }

    @Component.Expose('WriteHoldingRegisters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async writeHoldingRegisters(params: unknown) {
        const v = validateOrThrow<MbRtuClientWriteRegistersParams>(
            params,
            MBRTUCLIENT_WRITE_REGS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.WriteHoldingRegisters', () =>
            device.sendRPC('MbRtuClient.WriteHoldingRegisters', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                values: v.values
            })
        );
    }

    @Component.Expose('WriteSingleRegister')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async writeSingleRegister(params: unknown) {
        const v = validateOrThrow<MbRtuClientWriteSingleRegisterParams>(
            params,
            MBRTUCLIENT_WRITE_SINGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.WriteSingleRegister', () =>
            device.sendRPC('MbRtuClient.WriteSingleRegister', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                value: v.value
            })
        );
    }

    @Component.Expose('WriteCoils')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async writeCoils(params: unknown) {
        const v = validateOrThrow<MbRtuClientWriteCoilsParams>(
            params,
            MBRTUCLIENT_WRITE_COILS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('MbRtuClient.WriteCoils', () =>
            device.sendRPC('MbRtuClient.WriteCoils', {
                id: v.id,
                sid: v.sid,
                addr: v.addr,
                values: v.values
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
