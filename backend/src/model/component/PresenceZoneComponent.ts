// PresenceZone.* — per-zone presence sensor (distinct from Presence.*).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PRESENCE_ZONE_DESCRIBE,
    PRESENCE_ZONE_GET_CONFIG_PARAMS_SCHEMA,
    PRESENCE_ZONE_GET_STATUS_PARAMS_SCHEMA,
    PRESENCE_ZONE_SET_CONFIG_PARAMS_SCHEMA,
    type PzGetConfigParams,
    type PzGetStatusParams,
    type PzSetConfigParams
} from '../../types/api/presencezone';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class PresenceZoneComponent extends Component<any> {
    constructor() {
        super('presencezone', {
            set_config_methods: false,
            auto_apply_config: false,
            // PresenceZone.mdx → Webhook Events. Device catalog also lists
            // them; declared here so we own the schema as SoT.
            events: [
                {
                    event: 'presence',
                    attrs: [
                        {
                            name: 'value',
                            type: 'boolean',
                            desc: 'Zone is occupied'
                        }
                    ]
                },
                {
                    event: 'counter',
                    attrs: [
                        {
                            name: 'num_objects',
                            type: 'number',
                            desc: 'Objects in zone'
                        },
                        {
                            name: 'object',
                            type: 'array',
                            desc: 'Per-object [x,y] coordinates'
                        }
                    ]
                }
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PRESENCE_ZONE_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<PzSetConfigParams>(
            params,
            PRESENCE_ZONE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PresenceZone.SetConfig', () =>
            device.sendRPC('PresenceZone.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<PzGetConfigParams>(
            params,
            PRESENCE_ZONE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PresenceZone.GetConfig', () =>
            device.sendRPC('PresenceZone.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<PzGetStatusParams>(
            params,
            PRESENCE_ZONE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PresenceZone.GetStatus', () =>
            device.sendRPC('PresenceZone.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
