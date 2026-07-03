// Eth.* — device-side wired Ethernet interface.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {RESTART_REQUIRED_RESPONSE_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

// dhcp_start_ip / dhcp_end_ip honored only when server_mode is true
// (device acts as a DHCP server on the wired interface).
export interface EthSetConfigParams {
    shellyID: string;
    config: {
        enable?: boolean;
        server_mode?: boolean;
        ipv4mode?: string;
        ip?: string | null;
        netmask?: string | null;
        gw?: string | null;
        nameserver?: string | null;
        dhcp_start_ip?: string | null;
        dhcp_end_ip?: string | null;
    };
}
export const ETH_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {
                enable: {type: 'boolean'},
                server_mode: {type: 'boolean'},
                ipv4mode: {type: 'string'},
                ip: {type: ['string', 'null']},
                netmask: {type: ['string', 'null']},
                gw: {type: ['string', 'null']},
                nameserver: {type: ['string', 'null']},
                dhcp_start_ip: {type: ['string', 'null']},
                dhcp_end_ip: {type: ['string', 'null']}
            }
        }
    }
};

export interface EthGetConfigParams {
    shellyID: string;
}
export const ETH_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface EthGetStatusParams {
    shellyID: string;
}
export const ETH_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface EthListClientsParams {
    shellyID: string;
}
export const ETH_LIST_CLIENTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('eth', {
    kind: 'device',
    description: 'Configure and read the wired Ethernet interface on a device.'
});

b.registerMethod('SetConfig', {
    params: ETH_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'Eth.SetConfig — wired interface config. ipv4mode/IP/gateway/dhcp_start_ip/dhcp_end_ip values gated by device.'
});
b.registerMethod('GetConfig', {
    params: ETH_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Eth.GetConfig — current ethernet configuration.'
});
b.registerMethod('GetStatus', {
    params: ETH_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Eth.GetStatus — link state, ip, ip6 of the ethernet interface.'
});
b.registerMethod('ListClients', {
    params: ETH_LIST_CLIENTS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Eth.ListClients — DHCP leases when the device is in Ethernet server_mode.'
});

export const ETH_DESCRIBE: DescribeOutput = b.build();
