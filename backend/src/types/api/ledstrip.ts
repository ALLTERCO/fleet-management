import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

export type LedStripFieldKind =
    | 'toggle'
    | 'slider'
    | 'color'
    | 'enum'
    | 'multiEnum'
    | 'text'
    | 'number';

export interface LedStripUiField {
    key: string;
    kind: LedStripFieldKind;
    min?: number;
    max?: number;
    unit?: string;
    requiresMod?: string;
    catalogKey?: 'effects' | 'palettes' | 'protocols';
    allowlistKey?: string;
}

export interface LedStripCatalogEntry {
    key: string;
    name?: string;
    description?: string;
    mods?: string[];
}

export interface LedStripCatalog {
    protocols?: string[];
    palettes?: LedStripCatalogEntry[];
    effects?: LedStripCatalogEntry[];
}

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const EFFECT_KEY_FIELD: JsonSchema = {
    type: 'string',
    minLength: 1,
    title: 'Effect key',
    description: 'Effect identifier as exposed by LedStrip.ListAllEffects.'
};
const SCRIPT_ID_FIELD: JsonSchema = {
    type: 'integer',
    minimum: 0,
    title: 'Script id',
    description: 'Id of an existing Script component supplying the effect.'
};

const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        // Inner config kept opaque so new firmware fields pass through.
        config: {type: 'object', additionalProperties: true}
    }
};

const P_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: true,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

const P_LIST_PAGED: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

const P_EFFECT_ADD: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'effect'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        effect: {type: 'object', additionalProperties: true}
    }
};

const P_EFFECT_REMOVE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'effect'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        effect: EFFECT_KEY_FIELD
    }
};

const P_SCRIPT_EFFECT: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'script_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        script_id: SCRIPT_ID_FIELD
    }
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

const RESP_PROTOCOLS: JsonSchema = {
    type: 'object',
    required: ['protocols'],
    properties: {
        protocols: {type: 'array', items: {type: 'string'}}
    }
};

const RESP_PALETTES: JsonSchema = {
    type: 'object',
    required: ['palettes'],
    properties: {
        palettes: {
            type: 'array',
            items: {type: 'object', additionalProperties: true}
        },
        total: {type: 'integer', minimum: 0}
    }
};

const RESP_EFFECTS: JsonSchema = {
    type: 'object',
    required: ['effects'],
    properties: {
        effects: {
            type: 'array',
            items: {type: 'object', additionalProperties: true}
        },
        offset: {type: 'integer', minimum: 0},
        total: {type: 'integer', minimum: 0}
    }
};

export interface LedStripIdParams {
    shellyID: string;
    id: number;
}
export interface LedStripSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export interface LedStripSetParams {
    shellyID: string;
    id: number;
    [field: string]: unknown;
}
export interface LedStripListPagedParams {
    shellyID: string;
    id: number;
    offset?: number;
}
export interface LedStripEffectAddParams {
    shellyID: string;
    id: number;
    effect: Record<string, unknown>;
}
export interface LedStripEffectRemoveParams {
    shellyID: string;
    id: number;
    effect: string;
}
export interface LedStripScriptEffectParams {
    shellyID: string;
    id: number;
    script_id: number;
}

export const LEDSTRIP_GET_CONFIG_PARAMS_SCHEMA = P_ID;
export const LEDSTRIP_GET_STATUS_PARAMS_SCHEMA = P_ID;
export const LEDSTRIP_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;
export const LEDSTRIP_SET_PARAMS_SCHEMA = P_SET;
export const LEDSTRIP_LIST_PROTOCOLS_PARAMS_SCHEMA = P_ID;
export const LEDSTRIP_LIST_PALETTES_PARAMS_SCHEMA = P_ID;
export const LEDSTRIP_LIST_EFFECTS_PARAMS_SCHEMA = P_LIST_PAGED;
export const LEDSTRIP_ADD_EFFECT_PARAMS_SCHEMA = P_EFFECT_ADD;
export const LEDSTRIP_REMOVE_EFFECT_PARAMS_SCHEMA = P_EFFECT_REMOVE;
export const LEDSTRIP_NEXT_EFFECT_PARAMS_SCHEMA = P_ID;
export const LEDSTRIP_ADD_SCRIPT_EFFECT_PARAMS_SCHEMA = P_SCRIPT_EFFECT;
export const LEDSTRIP_REMOVE_SCRIPT_EFFECT_PARAMS_SCHEMA = P_SCRIPT_EFFECT;

const b = new DescribeBuilder('ledstrip', {
    kind: 'device',
    description: 'Control an addressable LED strip and its effect catalog.'
});

b.registerMethod('GetConfig', {
    params: LEDSTRIP_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'LedStrip.GetConfig — current strip configuration.'
});
b.registerMethod('SetConfig', {
    params: LEDSTRIP_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'LedStrip.SetConfig — protocol, num_leds, effects allow-list.'
});
b.registerMethod('GetStatus', {
    params: LEDSTRIP_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'LedStrip.GetStatus — live on/brightness/rgb/effect/palette.'
});
b.registerMethod('Set', {
    params: LEDSTRIP_SET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'LedStrip.Set — update any subset of runtime fields (on, brightness, rgb, effect, palette, speed, intensity).'
});
b.registerMethod('ListAllProtocols', {
    params: LEDSTRIP_LIST_PROTOCOLS_PARAMS_SCHEMA,
    response: RESP_PROTOCOLS,
    permission: PERM_READ,
    description: 'LedStrip.ListAllProtocols — protocol catalog for this build.'
});
b.registerMethod('ListAllPalettes', {
    params: LEDSTRIP_LIST_PALETTES_PARAMS_SCHEMA,
    response: RESP_PALETTES,
    permission: PERM_READ,
    description: 'LedStrip.ListAllPalettes — palette catalog with color stops.'
});
b.registerMethod('ListAllEffects', {
    params: LEDSTRIP_LIST_EFFECTS_PARAMS_SCHEMA,
    response: RESP_EFFECTS,
    permission: PERM_READ,
    description:
        'LedStrip.ListAllEffects — effect catalog (paginated). Each entry carries a `mods` array advertising which runtime fields apply.'
});
b.registerMethod('AddEffect', {
    params: LEDSTRIP_ADD_EFFECT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'LedStrip.AddEffect — enable an effect from the catalog.'
});
b.registerMethod('RemoveEffect', {
    params: LEDSTRIP_REMOVE_EFFECT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'LedStrip.RemoveEffect — disable an effect by key.'
});
b.registerMethod('NextEffect', {
    params: LEDSTRIP_NEXT_EFFECT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'LedStrip.NextEffect — cycle to the next enabled effect.'
});
b.registerMethod('AddScriptEffect', {
    params: LEDSTRIP_ADD_SCRIPT_EFFECT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'LedStrip.AddScriptEffect — bind a Script component as a custom effect source.'
});
b.registerMethod('RemoveScriptEffect', {
    params: LEDSTRIP_REMOVE_SCRIPT_EFFECT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'LedStrip.RemoveScriptEffect — unbind a script effect.'
});

export const LEDSTRIP_DESCRIBE: DescribeOutput = b.build();
