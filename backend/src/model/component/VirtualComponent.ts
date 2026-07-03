import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    VIRTUAL_ADD_PARAMS_SCHEMA,
    VIRTUAL_BOOLEAN_SET_PARAMS_SCHEMA,
    VIRTUAL_COMPONENT_SET_PARAMS_SCHEMA,
    VIRTUAL_DELETE_PARAMS_SCHEMA,
    VIRTUAL_DESCRIBE,
    VIRTUAL_ENUM_SET_PARAMS_SCHEMA,
    VIRTUAL_GROUP_SET_PARAMS_SCHEMA,
    VIRTUAL_NUMBER_SET_PARAMS_SCHEMA,
    VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA,
    VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA,
    VIRTUAL_TEXT_SET_PARAMS_SCHEMA,
    VIRTUAL_TRIGGER_PARAMS_SCHEMA,
    type VirtualAddParams,
    type VirtualBooleanSetParams,
    type VirtualComponentSetParams,
    type VirtualDeleteParams,
    type VirtualEnumSetParams,
    type VirtualGroupSetParams,
    type VirtualNumberSetParams,
    type VirtualSubcomponentIdParams,
    type VirtualSubcomponentSetConfigParams,
    type VirtualTextSetParams,
    type VirtualTriggerParams
} from '../../types/api/virtual';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class VirtualComponent extends Component<any> {
    constructor() {
        super('virtual', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return VIRTUAL_DESCRIBE;
    }

    @Component.Expose('ComponentSet')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async componentSet(params: unknown) {
        const v = validateOrThrow<VirtualComponentSetParams>(
            params,
            VIRTUAL_COMPONENT_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Virtual.ComponentSet', () =>
            device.sendRPC(`${v.component}.Set`, {id: v.id, value: v.value})
        );
    }

    @Component.Expose('Add')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async add(params: unknown) {
        const v = validateOrThrow<VirtualAddParams>(
            params,
            VIRTUAL_ADD_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {type: v.type};
        if (v.config !== undefined) payload.config = v.config;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Virtual.Add', () =>
            device.sendRPC('Virtual.Add', payload)
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async delete(params: unknown) {
        const v = validateOrThrow<VirtualDeleteParams>(
            params,
            VIRTUAL_DELETE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Virtual.Delete', () =>
            device.sendRPC('Virtual.Delete', {key: v.key})
        );
    }

    @Component.Expose('Trigger')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async trigger(params: unknown) {
        const v = validateOrThrow<VirtualTriggerParams>(
            params,
            VIRTUAL_TRIGGER_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.event !== undefined) payload.event = v.event;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Virtual.Trigger', () =>
            device.sendRPC('Button.Trigger', payload)
        );
    }

    // ── Per-virtual-type component-interface methods ────────────────
    // Boolean / Number / Text / Enum / Group device-side namespaces are
    // exposed under the Virtual umbrella with type prefixes (avoids the
    // FM `group` ns collision with fleet-level groups).

    @Component.Expose('Boolean.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async booleanSet(params: unknown) {
        const v = validateOrThrow<VirtualBooleanSetParams>(
            params,
            VIRTUAL_BOOLEAN_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Boolean.Set', () =>
            device.sendRPC('Boolean.Set', {id: v.id, value: v.value})
        );
    }

    @Component.Expose('Boolean.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async booleanGetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Boolean.GetConfig', () =>
            device.sendRPC('Boolean.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Boolean.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async booleanGetStatus(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Boolean.GetStatus', () =>
            device.sendRPC('Boolean.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Boolean.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async booleanSetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentSetConfigParams>(
            params,
            VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Boolean.SetConfig', () =>
            device.sendRPC('Boolean.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Number.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async numberSet(params: unknown) {
        const v = validateOrThrow<VirtualNumberSetParams>(
            params,
            VIRTUAL_NUMBER_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Number.Set', () =>
            device.sendRPC('Number.Set', {id: v.id, value: v.value})
        );
    }

    @Component.Expose('Number.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async numberGetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Number.GetConfig', () =>
            device.sendRPC('Number.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Number.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async numberGetStatus(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Number.GetStatus', () =>
            device.sendRPC('Number.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Number.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async numberSetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentSetConfigParams>(
            params,
            VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Number.SetConfig', () =>
            device.sendRPC('Number.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Text.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async textSet(params: unknown) {
        const v = validateOrThrow<VirtualTextSetParams>(
            params,
            VIRTUAL_TEXT_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Text.Set', () =>
            device.sendRPC('Text.Set', {id: v.id, value: v.value})
        );
    }

    @Component.Expose('Text.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async textGetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Text.GetConfig', () =>
            device.sendRPC('Text.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Text.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async textGetStatus(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Text.GetStatus', () =>
            device.sendRPC('Text.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Text.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async textSetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentSetConfigParams>(
            params,
            VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Text.SetConfig', () =>
            device.sendRPC('Text.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Enum.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async enumSet(params: unknown) {
        const v = validateOrThrow<VirtualEnumSetParams>(
            params,
            VIRTUAL_ENUM_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Enum.Set', () =>
            device.sendRPC('Enum.Set', {id: v.id, value: v.value})
        );
    }

    @Component.Expose('Enum.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async enumGetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Enum.GetConfig', () =>
            device.sendRPC('Enum.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Enum.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async enumGetStatus(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Enum.GetStatus', () =>
            device.sendRPC('Enum.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Enum.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async enumSetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentSetConfigParams>(
            params,
            VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Enum.SetConfig', () =>
            device.sendRPC('Enum.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Group.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async groupSet(params: unknown) {
        const v = validateOrThrow<VirtualGroupSetParams>(
            params,
            VIRTUAL_GROUP_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Group.Set', () =>
            device.sendRPC('Group.Set', {id: v.id, value: v.value})
        );
    }

    @Component.Expose('Group.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async groupGetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Group.GetConfig', () =>
            device.sendRPC('Group.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Group.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async groupGetStatus(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentIdParams>(
            params,
            VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Group.GetStatus', () =>
            device.sendRPC('Group.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Group.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async groupSetConfig(params: unknown) {
        const v = validateOrThrow<VirtualSubcomponentSetConfigParams>(
            params,
            VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Group.SetConfig', () =>
            device.sendRPC('Group.SetConfig', {id: v.id, config: v.config})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
