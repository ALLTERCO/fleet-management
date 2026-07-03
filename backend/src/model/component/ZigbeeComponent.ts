// Zigbee.* — Gen4 native Zigbee bridge pass-through.

import type {DescribeOutput} from '../../rpc/describe';
import {
    ZIGBEE_DESCRIBE,
    ZIGBEE_SET_CONFIG_PARAMS_SCHEMA,
    ZIGBEE_SHELLY_ONLY_PARAMS_SCHEMA,
    type ZigbeeSetConfigParams,
    type ZigbeeShellyOnlyParams
} from '../../types/api/zigbee';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class ZigbeeComponent extends Component<any> {
    constructor() {
        super('zigbee', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ZIGBEE_DESCRIBE;
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<ZigbeeShellyOnlyParams>(params, {
            namespace: 'Zigbee',
            method: 'GetStatus',
            paramsSchema: ZIGBEE_SHELLY_ONLY_PARAMS_SCHEMA,
            payload: () => ({})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<ZigbeeShellyOnlyParams>(params, {
            namespace: 'Zigbee',
            method: 'GetConfig',
            paramsSchema: ZIGBEE_SHELLY_ONLY_PARAMS_SCHEMA,
            payload: () => ({})
        });
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<ZigbeeSetConfigParams>(params, {
            namespace: 'Zigbee',
            method: 'SetConfig',
            paramsSchema: ZIGBEE_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({config: v.config})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
