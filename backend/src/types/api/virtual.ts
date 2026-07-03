import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';
import {VIRTUAL_ADD_TYPES, VIRTUAL_ROLE_COMPONENTS} from './deviceVirtual';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Null on success'
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

// Per-virtual-component schemas — all share {shellyID, id} for reads,
// {shellyID, id, config} for SetConfig, and {shellyID, id, value} for Set.
const P_VIRTUAL_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const P_VIRTUAL_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};
const P_VIRTUAL_BOOLEAN_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        value: {type: 'boolean'}
    }
};
const P_VIRTUAL_NUMBER_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        value: {type: 'number'}
    }
};
const P_VIRTUAL_TEXT_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        value: {type: 'string'}
    }
};
// Enum.Set value can be a valid option string OR null per spec.
const P_VIRTUAL_ENUM_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        value: {type: ['string', 'null']}
    }
};
// Group.Set value is array of component-key strings per spec.
const P_VIRTUAL_GROUP_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        value: {type: 'array', items: {type: 'string'}}
    }
};

export type VirtualRoleComponentName = (typeof VIRTUAL_ROLE_COMPONENTS)[number];

export interface VirtualComponentSetParams {
    shellyID: string;
    component: VirtualRoleComponentName;
    id: number;
    value: unknown;
}
export const VIRTUAL_COMPONENT_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'component', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        component: {type: 'string', enum: [...VIRTUAL_ROLE_COMPONENTS]},
        id: COMPONENT_ID,
        value: {
            description: 'boolean | number | string — type per component'
        }
    }
};

export interface VirtualAddParams {
    shellyID: string;
    type: (typeof VIRTUAL_ADD_TYPES)[number];
    config?: Record<string, unknown>;
}
export const VIRTUAL_ADD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'type'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        type: {type: 'string', enum: [...VIRTUAL_ADD_TYPES]},
        config: {type: 'object'}
    }
};

export interface VirtualDeleteParams {
    shellyID: string;
    key: string;
}
export const VIRTUAL_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'key'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        key: {type: 'string', minLength: 1}
    }
};

export interface VirtualTriggerParams {
    shellyID: string;
    id: number;
    event?: 'single_push' | 'double_push' | 'triple_push' | 'long_push';
}
export const VIRTUAL_TRIGGER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: {
            type: 'integer',
            minimum: 0,
            description: 'Component index on the device (0-based)'
        },
        event: {
            type: 'string',
            enum: ['single_push', 'double_push', 'triple_push', 'long_push'],
            description:
                'Shelly Virtual Button docs mark event required. Backend wrapper treats it as optional to preserve pre-migration wire shape.'
        }
    }
};

const b = new DescribeBuilder('virtual', {
    kind: 'device',
    description:
        'Relay the device virtual-components namespace (add, remove, get, set).'
});

b.registerMethod('ComponentSet', {
    params: VIRTUAL_COMPONENT_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        '{component}.Set for Boolean / Number / Enum / Text virtual components.'
});

b.registerMethod('Add', {
    params: VIRTUAL_ADD_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {id: {type: 'integer'}},
        description: 'Virtual.Add returns {id: new_component_id}'
    },
    permission: PERM_UPDATE,
    description: 'Virtual.Add — creates component at id 200-299.'
});

b.registerMethod('Delete', {
    params: VIRTUAL_DELETE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'Virtual.Delete.'
});

b.registerMethod('Trigger', {
    params: VIRTUAL_TRIGGER_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Virtual.Trigger — fire a Button virtual component.'
});

// ── Virtual scaffolding component-interface methods (per docs) ───────────
// Boolean / Number / Text / Enum / Group device-side namespaces are exposed
// here under the Virtual umbrella with type prefixes (Boolean.Set,
// Number.Set, etc.) to avoid the FM `group` ns collision (FM `group` is
// reserved for fleet-level grouping of devices, not the device-side virtual
// Group component which holds component-key arrays).

// Per-method exports
export interface VirtualBooleanSetParams {
    shellyID: string;
    id: number;
    value: boolean;
}
export const VIRTUAL_BOOLEAN_SET_PARAMS_SCHEMA = P_VIRTUAL_BOOLEAN_SET;

export interface VirtualNumberSetParams {
    shellyID: string;
    id: number;
    value: number;
}
export const VIRTUAL_NUMBER_SET_PARAMS_SCHEMA = P_VIRTUAL_NUMBER_SET;

export interface VirtualTextSetParams {
    shellyID: string;
    id: number;
    value: string;
}
export const VIRTUAL_TEXT_SET_PARAMS_SCHEMA = P_VIRTUAL_TEXT_SET;

export interface VirtualEnumSetParams {
    shellyID: string;
    id: number;
    value: string | null;
}
export const VIRTUAL_ENUM_SET_PARAMS_SCHEMA = P_VIRTUAL_ENUM_SET;

export interface VirtualGroupSetParams {
    shellyID: string;
    id: number;
    value: string[];
}
export const VIRTUAL_GROUP_SET_PARAMS_SCHEMA = P_VIRTUAL_GROUP_SET;

export interface VirtualSubcomponentIdParams {
    shellyID: string;
    id: number;
}
export const VIRTUAL_SUBCOMPONENT_ID_PARAMS_SCHEMA = P_VIRTUAL_ID;

export interface VirtualSubcomponentSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const VIRTUAL_SUBCOMPONENT_SET_CONFIG_PARAMS_SCHEMA =
    P_VIRTUAL_ID_CONFIG;

// Boolean
b.registerMethod('Boolean.Set', {
    params: VIRTUAL_BOOLEAN_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Boolean.Set — write a virtual boolean.'
});
b.registerMethod('Boolean.GetConfig', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Boolean.GetConfig — {id, name, persisted, default_value, meta}.'
});
b.registerMethod('Boolean.GetStatus', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Boolean.GetStatus — {value, source, last_update_ts}.'
});
b.registerMethod('Boolean.SetConfig', {
    params: P_VIRTUAL_ID_CONFIG,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Boolean.SetConfig.'
});

// Number
b.registerMethod('Number.Set', {
    params: VIRTUAL_NUMBER_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Number.Set — write a virtual number.'
});
b.registerMethod('Number.GetConfig', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Number.GetConfig.'
});
b.registerMethod('Number.GetStatus', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Number.GetStatus.'
});
b.registerMethod('Number.SetConfig', {
    params: P_VIRTUAL_ID_CONFIG,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Number.SetConfig.'
});

// Text
b.registerMethod('Text.Set', {
    params: VIRTUAL_TEXT_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Text.Set — write a virtual text value.'
});
b.registerMethod('Text.GetConfig', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Text.GetConfig.'
});
b.registerMethod('Text.GetStatus', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Text.GetStatus.'
});
b.registerMethod('Text.SetConfig', {
    params: P_VIRTUAL_ID_CONFIG,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Text.SetConfig.'
});

// Enum
b.registerMethod('Enum.Set', {
    params: VIRTUAL_ENUM_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Enum.Set — write a virtual enum value (must be a valid option or null).'
});
b.registerMethod('Enum.GetConfig', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Enum.GetConfig — {id, name, default_value, options[], ...}.'
});
b.registerMethod('Enum.GetStatus', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Enum.GetStatus.'
});
b.registerMethod('Enum.SetConfig', {
    params: P_VIRTUAL_ID_CONFIG,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Enum.SetConfig.'
});

// Group (device-side virtual Group, NOT the FM fleet-group ns).
b.registerMethod('Group.Set', {
    params: VIRTUAL_GROUP_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Group.Set — write a virtual group (array of component keys).'
});
b.registerMethod('Group.GetConfig', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Group.GetConfig.'
});
b.registerMethod('Group.GetStatus', {
    params: P_VIRTUAL_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Group.GetStatus.'
});
b.registerMethod('Group.SetConfig', {
    params: P_VIRTUAL_ID_CONFIG,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Group.SetConfig.'
});

export const VIRTUAL_DESCRIBE: DescribeOutput = b.build();
