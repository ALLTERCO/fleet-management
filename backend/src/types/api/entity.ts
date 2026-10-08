// Public API types for the `Entity.*` namespace — typed per-entity ops.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

// --- GetCapabilities -----------------------------------------------------

export interface EntityGetCapabilitiesParams {
    /** Entity identifier — globally unique across all devices */
    id: string;
}

export interface EntityCapabilityResponse {
    /** The entity's type discriminator (e.g. 'switch', 'light', 'cover') */
    type: string;
    /** Action verbs the entity supports (control + maintenance) */
    actions: string[];
    /** Subset of `actions` that are maintenance (reset/calibrate), not output
     *  control — clients present these quietly, not as primary controls. */
    maintenanceActions: string[];
}

export const ENTITY_GET_CAPABILITIES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {
            type: 'string',
            minLength: 1,
            description: 'Entity identifier'
        }
    }
};

export const ENTITY_GET_CAPABILITIES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['type', 'actions', 'maintenanceActions'],
    properties: {
        type: {
            type: 'string',
            description: 'Entity type discriminator'
        },
        actions: {
            type: 'array',
            items: {type: 'string'},
            description:
                'Action verbs the entity supports (control + maintenance)'
        },
        maintenanceActions: {
            type: 'array',
            items: {type: 'string'},
            description:
                'Subset of actions that are maintenance (reset/calibrate), not output control'
        }
    }
};

// --- Get -----------------------------------------------------------------

export interface EntityGetParams {
    id: string;
}

/** Normalized entity summary — same shape as the frontend already consumes.
 *  `online` is derived from the parent (gateway) device's presence — so a
 *  BLU sensor whose BTHome gateway disconnected reports `online: false`,
 *  same as a native entity on an offline Shelly. Single source of truth. */
export interface EntityGetResponse {
    id: string;
    name: string;
    type: string;
    source: string;
    online: boolean;
    properties: Record<string, unknown>;
}

export const ENTITY_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'string', minLength: 1, description: 'Entity identifier'}
    }
};

export const ENTITY_GET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'name', 'type', 'source', 'online', 'properties'],
    properties: {
        id: {type: 'string'},
        name: {type: 'string'},
        type: {type: 'string'},
        source: {
            type: 'string',
            description: 'Parent device shellyID'
        },
        online: {
            type: 'boolean',
            description:
                'True iff the parent (gateway) device is currently connected. BLU sensors inherit their gateway’s state.'
        },
        properties: {type: 'object'}
    }
};

// --- InvokeAction --------------------------------------------------------

export interface EntityInvokeActionParams {
    id: string;
    action: string;
    params?: Record<string, unknown>;
}

export interface EntityInvokeActionResponse {
    id: string;
    action: string;
    /** The raw response from the underlying Shelly device RPC. */
    result: unknown;
}

export const ENTITY_INVOKE_ACTION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'action'],
    properties: {
        id: {type: 'string', minLength: 1},
        action: {
            type: 'string',
            minLength: 1,
            description:
                'Action verb — must appear in GetCapabilities(id).actions'
        },
        params: {
            type: 'object',
            description:
                'Action-specific parameters. Shape depends on the action and entity type.'
        }
    }
};

export const ENTITY_INVOKE_ACTION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'action', 'result'],
    properties: {
        id: {type: 'string'},
        action: {type: 'string'},
        result: {
            description:
                'Raw Shelly device RPC response — untyped at the Entity.* layer'
        }
    }
};

// --- GetActionSchema -----------------------------------------------------

export interface EntityGetActionSchemaParams {
    id: string;
    action: string;
}

export interface EntityGetActionSchemaResponse {
    /** Entity type at resolution time — actions are typed per-type. */
    type: string;
    /** Action verb echoed back for client caching. */
    action: string;
    /** JSON Schema for the `params` payload of Entity.InvokeAction. */
    schema: JsonSchema;
}

export const ENTITY_GET_ACTION_SCHEMA_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'action'],
    properties: {
        id: {type: 'string', minLength: 1},
        action: {type: 'string', minLength: 1}
    }
};

export const ENTITY_GET_ACTION_SCHEMA_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['type', 'action', 'schema'],
    properties: {
        type: {type: 'string'},
        action: {type: 'string'},
        schema: {
            type: 'object',
            description:
                'JSON Schema describing the params object for InvokeAction.'
        }
    }
};

// --- Describe() output ---------------------------------------------------

/** Largest page entity.list serves; a bigger limit is served as this. */
export const ENTITY_LIST_MAX_LIMIT = 5000;
/** Most devices one entity.list `shellyIDs` read may name. */
export const ENTITY_LIST_MAX_IDS = 100;

export interface EntityListParams {
    limit?: number;
    offset?: number;
    cursor?: string;
    shellyIDs?: string[];
}
export const ENTITY_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        limit: {
            type: 'integer',
            minimum: 0,
            description: `Default FM_ENTITY_LIST_DB_PAGE_MAX (500). A limit above ${ENTITY_LIST_MAX_LIMIT} is served as ${ENTITY_LIST_MAX_LIMIT}. 0 returns every row on an offset page and ${ENTITY_LIST_MAX_LIMIT} on a cursor page.`
        },
        offset: {
            type: 'integer',
            minimum: 0,
            description: 'Default 0. Not with `cursor`.'
        },
        cursor: {
            type: 'string',
            minLength: 1,
            maxLength: 400,
            description:
                '`next_cursor` of the previous page. Skips the total. Not with `offset`.'
        },
        shellyIDs: {
            type: 'array',
            items: SHELLY_ID_SCHEMA,
            minItems: 1,
            maxItems: ENTITY_LIST_MAX_IDS,
            description:
                'Read only the entities of these devices. Each device is checked for read access; an unknown or unreadable one is left out.'
        }
    }
};

export const ENTITY_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'limit', 'has_more', 'next_cursor'],
    properties: {
        items: {type: 'array', items: {type: 'object'}},
        total: {
            type: 'integer',
            minimum: 0,
            description: 'All matches. Present on offset pages only.'
        },
        limit: {type: 'integer', minimum: 0},
        offset: {
            type: 'integer',
            minimum: 0,
            description: 'Present on offset pages only.'
        },
        has_more: {type: 'boolean'},
        next_cursor: {
            type: ['string', 'null'],
            description:
                'Pass as `cursor` for the next page. null on the last page.'
        }
    }
};

export const ENTITY_DESCRIBE: DescribeOutput = new DescribeBuilder('entity', {
    kind: 'fleet-manager',
    description:
        'List, read, and invoke actions on normalized fleet entities across devices.'
})
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: ENTITY_LIST_PARAMS_SCHEMA,
        response: ENTITY_LIST_RESPONSE_SCHEMA,
        permission: {note: 'authenticated — filtered by device access'},
        description:
            'Paginated list of entities the caller can read, filtered against device-level access. Ordered physical, virtual, then BLU, each by device id and entity id. Page with `cursor`; `shellyIDs` reads the entities of up to 100 devices.'
    })
    .registerMethod('Get', {
        params: ENTITY_GET_PARAMS_SCHEMA,
        response: ENTITY_GET_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Return the normalized summary of a single entity. Replaces Entity.GetInfo (removed in the Phase 1 cutover).'
    })
    .registerMethod('GetActionSchema', {
        params: ENTITY_GET_ACTION_SCHEMA_PARAMS_SCHEMA,
        response: ENTITY_GET_ACTION_SCHEMA_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Return the JSON Schema for an action on a specific entity. Callers use this to build forms or validate InvokeAction params without hardcoding shapes.'
    })
    .registerMethod('InvokeAction', {
        safety: {effectDependsOnInput: true},
        params: ENTITY_INVOKE_ACTION_PARAMS_SCHEMA,
        response: ENTITY_INVOKE_ACTION_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'execute'},
        description:
            'Invoke a capability action on an entity (toggle, setBrightness, open/close, ...). Backend translates to the right Shelly device RPC.'
    })
    .registerMethod('GetCapabilities', {
        params: ENTITY_GET_CAPABILITIES_PARAMS_SCHEMA,
        response: ENTITY_GET_CAPABILITIES_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Return the backend-declared capability set for an entity — what actions it supports.'
    })
    .build();
