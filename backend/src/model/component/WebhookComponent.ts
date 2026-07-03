// Device-side Webhook.* — outbound HTTP webhooks managed per device.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    WEBHOOK_CREATE_PARAMS_SCHEMA,
    WEBHOOK_DELETE_ALL_PARAMS_SCHEMA,
    WEBHOOK_DELETE_PARAMS_SCHEMA,
    WEBHOOK_DESCRIBE,
    WEBHOOK_LIST_ALL_SUPPORTED_PARAMS_SCHEMA,
    WEBHOOK_LIST_PARAMS_SCHEMA,
    WEBHOOK_LIST_SUPPORTED_PARAMS_SCHEMA,
    WEBHOOK_UPDATE_PARAMS_SCHEMA,
    type WebhookCreateParams,
    type WebhookDeleteAllParams,
    type WebhookDeleteParams,
    type WebhookListAllSupportedParams,
    type WebhookListParams,
    type WebhookListSupportedParams,
    type WebhookUpdateParams
} from '../../types/api/webhook';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

// Strip shellyID from validated params; rest goes verbatim to the device.
function devicePayload<T extends {shellyID: string}>(
    v: T
): Record<string, unknown> {
    const {shellyID: _shellyID, ...rest} = v;
    return rest as Record<string, unknown>;
}

export default class WebhookComponent extends Component<any> {
    constructor() {
        super('webhook', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return WEBHOOK_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async list(params: unknown) {
        const v = validateOrThrow<WebhookListParams>(
            params,
            WEBHOOK_LIST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.List', () =>
            device.sendRPC('Webhook.List', {})
        );
    }

    @Component.Expose('ListSupported')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listSupported(params: unknown) {
        const v = validateOrThrow<WebhookListSupportedParams>(
            params,
            WEBHOOK_LIST_SUPPORTED_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.ListSupported', () =>
            device.sendRPC('Webhook.ListSupported', {})
        );
    }

    @Component.Expose('ListAllSupported')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listAllSupported(params: unknown) {
        const v = validateOrThrow<WebhookListAllSupportedParams>(
            params,
            WEBHOOK_LIST_ALL_SUPPORTED_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.ListAllSupported', () =>
            device.sendRPC('Webhook.ListAllSupported', {offset: v.offset})
        );
    }

    @Component.Expose('Create')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async create(params: unknown) {
        const v = validateOrThrow<WebhookCreateParams>(
            params,
            WEBHOOK_CREATE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.Create', () =>
            device.sendRPC('Webhook.Create', devicePayload(v))
        );
    }

    @Component.Expose('Update')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async update(params: unknown) {
        const v = validateOrThrow<WebhookUpdateParams>(
            params,
            WEBHOOK_UPDATE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.Update', () =>
            device.sendRPC('Webhook.Update', devicePayload(v))
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async delete(params: unknown) {
        const v = validateOrThrow<WebhookDeleteParams>(
            params,
            WEBHOOK_DELETE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.Delete', () =>
            device.sendRPC('Webhook.Delete', {id: v.id})
        );
    }

    @Component.Expose('DeleteAll')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteAll(params: unknown) {
        const v = validateOrThrow<WebhookDeleteAllParams>(
            params,
            WEBHOOK_DELETE_ALL_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Webhook.DeleteAll', () =>
            device.sendRPC('Webhook.DeleteAll', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
