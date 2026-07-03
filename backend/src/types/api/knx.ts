// Device-side KNX bus integration (Pro line). 6 methods per official spec:
// global SetConfig + per-component bindings (KNXSwitch/Light/Cover/Input).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {RESTART_REQUIRED_RESPONSE_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

// ── Local atoms ──────────────────────────────────────────────────────────

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

// ── Global KNX config ───────────────────────────────────────────────

// Live shape from 2PM Gen 4: {enable, ia, routing:{addr}}.
// Field names mirror KNX.SetConfig contract; values device-validated.
export interface KnxSetConfigParams {
    shellyID: string;
    config: {
        enable?: boolean;
        ia?: string;
        routing?: {addr?: string};
    };
}
export const KNX_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
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
                ia: {type: 'string'},
                routing: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {addr: {type: 'string'}}
                }
            }
        }
    }
};

// KNX.GetConfig — read the global KNX config back.
export interface KnxGetConfigParams {
    shellyID: string;
}
export const KNX_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// KNX.GetStatus — spec: "The global KNX component does not have status at
// the moment" (returns {}). Wrap it for completeness; passthrough.
export interface KnxGetStatusParams {
    shellyID: string;
}
export const KNX_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// ── Per-component KNX bindings (KNXSwitch / KNXLight / KNXCover / KNXInput) ─
// `key` is the component identifier in `<type>:<cid>` form (e.g. 'switch:0').

export interface KnxComponentKeyParams {
    shellyID: string;
    key: string;
}
export const KNX_COMPONENT_KEY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'key'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        key: {type: 'string'}
    }
};

export interface KnxSetComponentConfigParams {
    shellyID: string;
    key: string;
    config: Record<string, unknown>;
}
export const KNX_SET_COMPONENT_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'key', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        key: {type: 'string'},
        config: {type: 'object'}
    }
};

export interface KnxListComponentsParams {
    shellyID: string;
    offset?: number;
}
export const KNX_LIST_COMPONENTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        offset: {type: 'integer'}
    }
};

const b = new DescribeBuilder('knx', {
    kind: 'device',
    description: 'Configure KNX bus integration and per-component bindings.'
});

b.registerMethod('SetConfig', {
    params: KNX_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'KNX.SetConfig — global enable / individual address / routing. Pro line only.'
});
b.registerMethod('GetConfig', {
    params: KNX_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'KNX.GetConfig — global KNX config (enable / ia / routing).'
});
b.registerMethod('GetStatus', {
    params: KNX_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'KNX.GetStatus — global component status (empty per spec).'
});
b.registerMethod('GetComponentConfig', {
    params: KNX_COMPONENT_KEY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'KNX.GetComponentConfig — fetch per-component KNX binding (cmd/fb group addresses).'
});
b.registerMethod('SetComponentConfig', {
    params: KNX_SET_COMPONENT_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'KNX.SetComponentConfig — bind a switch/light/cover/input to KNX group addresses.'
});
b.registerMethod('ListComponents', {
    params: KNX_LIST_COMPONENTS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'KNX.ListComponents — paginated list of KNX-bound components.'
});

export const KNX_DESCRIBE: DescribeOutput = b.build();
