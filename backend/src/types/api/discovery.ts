import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const HOST_STRING: JsonSchema = {type: 'string', minLength: 1, maxLength: 255};

export interface DiscoveryAdmitDeviceParams {
    host: string;
    password?: string;
    organizationId?: string;
    groupId?: number;
}

export const DISCOVERY_ADMIT_DEVICE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['host'],
    properties: {
        host: HOST_STRING,
        password: {type: 'string', minLength: 1, maxLength: 256},
        organizationId: {type: 'string', minLength: 1, maxLength: 120},
        groupId: {type: 'integer'}
    }
};

export interface DiscoveryAdmitDeviceResult {
    shellyId: string;
    gen: 2 | 3 | 4;
    rebootingMs: number;
    intentRecorded: true;
    expectedConnectionWithinSec: number;
}

export const DISCOVERY_ADMIT_DEVICE_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'shellyId',
        'gen',
        'rebootingMs',
        'intentRecorded',
        'expectedConnectionWithinSec'
    ],
    properties: {
        shellyId: {type: 'string'},
        gen: {type: 'integer', enum: [2, 3, 4]},
        rebootingMs: {type: 'integer', minimum: 0},
        intentRecorded: {type: 'boolean', enum: [true]},
        expectedConnectionWithinSec: {type: 'integer', minimum: 1}
    }
};

export interface DiscoveryProbeParams {
    host: string;
    organizationId?: string;
}

export const DISCOVERY_PROBE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['host'],
    properties: {
        host: HOST_STRING,
        organizationId: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface DiscoveryProbeResult {
    ip: string;
    shellyId: string;
    gen: 2 | 3 | 4;
    model: string;
    ver: string;
    mac: string;
    authRequired: boolean;
    authDomain: string | null;
    alreadyKnown: boolean;
    inWaitingRoom: boolean;
}

export const DISCOVERY_PROBE_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'ip',
        'shellyId',
        'gen',
        'model',
        'ver',
        'mac',
        'authRequired',
        'authDomain',
        'alreadyKnown',
        'inWaitingRoom'
    ],
    properties: {
        ip: {type: 'string'},
        shellyId: {type: 'string'},
        gen: {type: 'integer', enum: [2, 3, 4]},
        model: {type: 'string'},
        ver: {type: 'string'},
        mac: {type: 'string'},
        authRequired: {type: 'boolean'},
        authDomain: {type: ['string', 'null']},
        alreadyKnown: {type: 'boolean'},
        inWaitingRoom: {type: 'boolean'}
    }
};

export interface DiscoveryScanLanParams {
    timeoutMs?: number;
    organizationId?: string;
}

export const DISCOVERY_SCAN_LAN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        timeoutMs: {type: 'integer', minimum: 500, maximum: 15000},
        organizationId: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export const DISCOVERY_SCAN_LAN_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['hits', 'scannedAt', 'durationMs', 'warnings'],
    properties: {
        hits: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'ip',
                    'shellyId',
                    'model',
                    'gen',
                    'mac',
                    'alreadyKnown',
                    'inWaitingRoom'
                ],
                properties: {
                    ip: {type: 'string'},
                    shellyId: {type: 'string'},
                    model: {type: 'string'},
                    gen: {type: 'integer', enum: [1, 2, 3, 4]},
                    mac: {type: 'string'},
                    alreadyKnown: {type: 'boolean'},
                    inWaitingRoom: {type: 'boolean'}
                }
            }
        },
        scannedAt: {type: 'string'},
        durationMs: {type: 'integer', minimum: 0},
        warnings: {type: 'array', items: {type: 'string'}}
    }
};

export const DISCOVERY_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'discovery',
    {
        kind: 'fleet-manager',
        description:
            'Probe, scan, and admit LAN-reachable Shelly devices into the fleet.'
    }
)
    .registerMethod('AdmitDevice', {
        params: DISCOVERY_ADMIT_DEVICE_PARAMS_SCHEMA,
        response: DISCOVERY_ADMIT_DEVICE_RESPONSE,
        permission: {component: 'devices', operation: 'create'},
        description:
            'Reach out to a device at a given host (IP or hostname), configure its outbound websocket to point at FM, reboot it, and record an admission intent so it auto-joins the requesting org on reconnect.'
    })
    .registerMethod('Probe', {
        params: DISCOVERY_PROBE_PARAMS_SCHEMA,
        response: DISCOVERY_PROBE_RESPONSE,
        permission: {component: 'devices', operation: 'read'},
        description:
            "Read-only probe of a LAN-reachable Shelly device by IP or hostname. Returns its identity, firmware, and whether it requires auth or is already in this organization's fleet. No mutation — the wizard shows this to the user before AdmitDevice writes the WS config."
    })
    .registerMethod('ScanLan', {
        params: DISCOVERY_SCAN_LAN_PARAMS_SCHEMA,
        response: DISCOVERY_SCAN_LAN_RESPONSE,
        permission: {component: 'devices', operation: 'create'},
        description:
            'Active mDNS sweep for Shelly devices on the local network, cross-referenced with the device list and active admission intents.'
    })
    .build();
