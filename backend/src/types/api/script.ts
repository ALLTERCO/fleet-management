// Device-side Script.* — mJS scripting on Gen2+ devices.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
// Script ids are device-assigned positive ints; device is the validator.
const SCRIPT_ID: JsonSchema = {type: 'integer'};

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const RESP_NULL: JsonSchema = {type: 'null'};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
// Script.Start / Script.Stop return whether the script was running before.
const RESP_WAS_RUNNING: JsonSchema = {
    type: 'object',
    required: ['was_running'],
    properties: {was_running: {type: 'boolean'}}
};
// Script.Eval returns {result: string} per spec.
const RESP_EVAL: JsonSchema = {
    type: 'object',
    required: ['result'],
    properties: {result: {type: 'string'}}
};

// ── Per-method exports — field names mirror device contract ─────────

export interface ScriptListParams {
    shellyID: string;
}
export const SCRIPT_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// Spec: name is optional — device picks a default if omitted.
export interface ScriptCreateParams {
    shellyID: string;
    name?: string;
}
export const SCRIPT_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, name: {type: 'string'}}
};

export interface ScriptIdParams {
    shellyID: string;
    id: number;
}
export const SCRIPT_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: SCRIPT_ID}
};

// GetCode supports paging via offset+length.
export interface ScriptGetCodeParams {
    shellyID: string;
    id: number;
    offset?: number;
    len?: number;
}
export const SCRIPT_GET_CODE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: SCRIPT_ID,
        offset: {type: 'integer'},
        len: {type: 'integer'}
    }
};

// PutCode supports chunked upload via offset (verified live).
export interface ScriptPutCodeParams {
    shellyID: string;
    id: number;
    code: string;
    offset?: number;
    append?: boolean;
}
export const SCRIPT_PUT_CODE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'code'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: SCRIPT_ID,
        code: {type: 'string'},
        offset: {type: 'integer'},
        append: {type: 'boolean'}
    }
};

export interface ScriptEvalParams {
    shellyID: string;
    id: number;
    code: string;
}
export const SCRIPT_EVAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'code'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: SCRIPT_ID,
        code: {type: 'string'}
    }
};

export interface ScriptSetConfigParams {
    shellyID: string;
    id: number;
    config: {
        name?: string;
        enable?: boolean;
    };
}
export const SCRIPT_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: SCRIPT_ID,
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: {type: 'string'},
                enable: {type: 'boolean'}
            }
        }
    }
};

// ── Describe ────────────────────────────────────────────────────────

const b = new DescribeBuilder('script', {
    kind: 'device',
    description: 'Manage and run mJS scripts on the target Shelly device.'
});

b.registerMethod('List', {
    params: SCRIPT_LIST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Script.List — all scripts on the device.'
});
b.registerMethod('Create', {
    params: SCRIPT_CREATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Script.Create — allocate a script slot. Returns {id}.'
});
b.registerMethod('Delete', {
    params: SCRIPT_ID_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'Script.Delete.'
});
b.registerMethod('GetConfig', {
    params: SCRIPT_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Script.GetConfig.'
});
b.registerMethod('SetConfig', {
    params: SCRIPT_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Script.SetConfig — name / enable.'
});
b.registerMethod('GetStatus', {
    params: SCRIPT_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Script.GetStatus — running state, mem usage, errors.'
});
b.registerMethod('GetCode', {
    params: SCRIPT_GET_CODE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Script.GetCode — returns {data, left}. Page via offset + len.'
});
b.registerMethod('PutCode', {
    params: SCRIPT_PUT_CODE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Script.PutCode — write script source. append:false truncates first.'
});
b.registerMethod('Start', {
    params: SCRIPT_ID_PARAMS_SCHEMA,
    response: RESP_WAS_RUNNING,
    permission: PERM_EXECUTE,
    description: 'Script.Start — begin execution. Returns {was_running}.'
});
b.registerMethod('Stop', {
    params: SCRIPT_ID_PARAMS_SCHEMA,
    response: RESP_WAS_RUNNING,
    permission: PERM_EXECUTE,
    description: 'Script.Stop — halt execution. Returns {was_running}.'
});
b.registerMethod('Eval', {
    params: SCRIPT_EVAL_PARAMS_SCHEMA,
    response: RESP_EVAL,
    permission: PERM_EXECUTE,
    description:
        'Script.Eval — evaluate code in the context of a running script. Returns {result}.'
});

export const SCRIPT_DESCRIBE: DescribeOutput = b.build();
