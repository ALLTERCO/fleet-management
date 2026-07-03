// HTTP.* — outbound HTTP/HTTPS requests from the device.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    HTTP_DESCRIBE,
    HTTP_GET_PARAMS_SCHEMA,
    HTTP_POST_PARAMS_SCHEMA,
    HTTP_REQUEST_PARAMS_SCHEMA,
    type HttpGetParams,
    type HttpPostParams,
    type HttpRequestParams
} from '../../types/api/http';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

// Strip shellyID from validated params; rest goes verbatim to the device.
function stripShellyID<T extends {shellyID: string}>(
    v: T
): Record<string, unknown> {
    const {shellyID: _shellyID, ...rest} = v;
    return rest as Record<string, unknown>;
}

export default class HttpComponent extends Component<any> {
    constructor() {
        super('http', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return HTTP_DESCRIBE;
    }

    @Component.Expose('GET')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async get(params: unknown) {
        const v = validateOrThrow<HttpGetParams>(
            params,
            HTTP_GET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('HTTP.GET', () =>
            device.sendRPC('HTTP.GET', stripShellyID(v))
        );
    }

    @Component.Expose('POST')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async post(params: unknown) {
        const v = validateOrThrow<HttpPostParams>(
            params,
            HTTP_POST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('HTTP.POST', () =>
            device.sendRPC('HTTP.POST', stripShellyID(v))
        );
    }

    @Component.Expose('Request')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async request(params: unknown) {
        const v = validateOrThrow<HttpRequestParams>(
            params,
            HTTP_REQUEST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('HTTP.Request', () =>
            device.sendRPC('HTTP.Request', stripShellyID(v))
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
