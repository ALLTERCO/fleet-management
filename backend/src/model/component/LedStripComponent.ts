// LedStrip.* — addressable LED-strip namespace (Pill `ledstrip` mode).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    LEDSTRIP_ADD_EFFECT_PARAMS_SCHEMA,
    LEDSTRIP_ADD_SCRIPT_EFFECT_PARAMS_SCHEMA,
    LEDSTRIP_DESCRIBE,
    LEDSTRIP_GET_CONFIG_PARAMS_SCHEMA,
    LEDSTRIP_GET_STATUS_PARAMS_SCHEMA,
    LEDSTRIP_LIST_EFFECTS_PARAMS_SCHEMA,
    LEDSTRIP_LIST_PALETTES_PARAMS_SCHEMA,
    LEDSTRIP_LIST_PROTOCOLS_PARAMS_SCHEMA,
    LEDSTRIP_NEXT_EFFECT_PARAMS_SCHEMA,
    LEDSTRIP_REMOVE_EFFECT_PARAMS_SCHEMA,
    LEDSTRIP_REMOVE_SCRIPT_EFFECT_PARAMS_SCHEMA,
    LEDSTRIP_SET_CONFIG_PARAMS_SCHEMA,
    LEDSTRIP_SET_PARAMS_SCHEMA,
    type LedStripEffectAddParams,
    type LedStripEffectRemoveParams,
    type LedStripIdParams,
    type LedStripListPagedParams,
    type LedStripScriptEffectParams,
    type LedStripSetConfigParams,
    type LedStripSetParams
} from '../../types/api/ledstrip';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

function stripShellyID(params: LedStripSetParams): Record<string, unknown> {
    const {shellyID: _ignored, ...rest} = params;
    return rest;
}

export default class LedStripComponent extends Component<any> {
    constructor() {
        super('ledstrip', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return LEDSTRIP_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<LedStripIdParams>(
            params,
            LEDSTRIP_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.GetConfig', () =>
            device.sendRPC('LedStrip.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<LedStripSetConfigParams>(
            params,
            LEDSTRIP_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.SetConfig', () =>
            device.sendRPC('LedStrip.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<LedStripIdParams>(
            params,
            LEDSTRIP_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.GetStatus', () =>
            device.sendRPC('LedStrip.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSet(params: unknown) {
        const v = validateOrThrow<LedStripSetParams>(
            params,
            LEDSTRIP_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.Set', () =>
            device.sendRPC('LedStrip.Set', stripShellyID(v))
        );
    }

    @Component.Expose('ListAllProtocols')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcListAllProtocols(params: unknown) {
        const v = validateOrThrow<LedStripIdParams>(
            params,
            LEDSTRIP_LIST_PROTOCOLS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.ListAllProtocols', () =>
            device.sendRPC('LedStrip.ListAllProtocols', {id: v.id})
        );
    }

    @Component.Expose('ListAllPalettes')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcListAllPalettes(params: unknown) {
        const v = validateOrThrow<LedStripIdParams>(
            params,
            LEDSTRIP_LIST_PALETTES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.ListAllPalettes', () =>
            device.sendRPC('LedStrip.ListAllPalettes', {id: v.id})
        );
    }

    @Component.Expose('ListAllEffects')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcListAllEffects(params: unknown) {
        const v = validateOrThrow<LedStripListPagedParams>(
            params,
            LEDSTRIP_LIST_EFFECTS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.ListAllEffects', () =>
            device.sendRPC('LedStrip.ListAllEffects', {
                id: v.id,
                offset: v.offset ?? 0
            })
        );
    }

    @Component.Expose('AddEffect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcAddEffect(params: unknown) {
        const v = validateOrThrow<LedStripEffectAddParams>(
            params,
            LEDSTRIP_ADD_EFFECT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.AddEffect', () =>
            device.sendRPC('LedStrip.AddEffect', {
                id: v.id,
                effect: v.effect
            })
        );
    }

    @Component.Expose('RemoveEffect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcRemoveEffect(params: unknown) {
        const v = validateOrThrow<LedStripEffectRemoveParams>(
            params,
            LEDSTRIP_REMOVE_EFFECT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.RemoveEffect', () =>
            device.sendRPC('LedStrip.RemoveEffect', {
                id: v.id,
                effect: v.effect
            })
        );
    }

    @Component.Expose('NextEffect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcNextEffect(params: unknown) {
        const v = validateOrThrow<LedStripIdParams>(
            params,
            LEDSTRIP_NEXT_EFFECT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.NextEffect', () =>
            device.sendRPC('LedStrip.NextEffect', {id: v.id})
        );
    }

    @Component.Expose('AddScriptEffect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcAddScriptEffect(params: unknown) {
        const v = validateOrThrow<LedStripScriptEffectParams>(
            params,
            LEDSTRIP_ADD_SCRIPT_EFFECT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.AddScriptEffect', () =>
            device.sendRPC('LedStrip.AddScriptEffect', {
                id: v.id,
                script_id: v.script_id
            })
        );
    }

    @Component.Expose('RemoveScriptEffect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcRemoveScriptEffect(params: unknown) {
        const v = validateOrThrow<LedStripScriptEffectParams>(
            params,
            LEDSTRIP_REMOVE_SCRIPT_EFFECT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('LedStrip.RemoveScriptEffect', () =>
            device.sendRPC('LedStrip.RemoveScriptEffect', {
                id: v.id,
                script_id: v.script_id
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
