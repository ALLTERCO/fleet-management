import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';
import {CURY_MODES, type CuryMode} from './deviceCury';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const CURY_SLOT_SCHEMA: JsonSchema = {type: 'string', enum: ['left', 'right']};

export type CurySlot = 'left' | 'right';

export interface CuryGetConfigParams {
    shellyID: string;
    id: number;
}
export const CURY_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

export interface CurySetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const CURY_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

export interface CuryGetStatusParams {
    shellyID: string;
    id: number;
}
export const CURY_GET_STATUS_PARAMS_SCHEMA: JsonSchema =
    CURY_GET_CONFIG_PARAMS_SCHEMA;

export interface CurySetModeParams {
    shellyID: string;
    id: number;
    mode?: CuryMode | null;
}
export const CURY_SET_MODE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        mode: {type: ['string', 'null'], enum: [null, ...CURY_MODES]}
    }
};

export interface CurySetAwayModeParams {
    shellyID: string;
    id: number;
    on: boolean;
}
export const CURY_SET_AWAY_MODE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'on'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        on: {type: 'boolean'}
    }
};

export interface CurySetParams {
    shellyID: string;
    id: number;
    slot: CurySlot;
    on?: boolean;
    intensity?: number;
}
export const CURY_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'slot'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        slot: CURY_SLOT_SCHEMA,
        on: {type: 'boolean'},
        intensity: {type: 'number', minimum: 0, maximum: 100}
    }
};

export interface CuryBoostParams {
    shellyID: string;
    id: number;
    slot: CurySlot;
}
export const CURY_BOOST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'slot'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        slot: CURY_SLOT_SCHEMA
    }
};

export interface CuryStopBoostParams {
    shellyID: string;
    id: number;
    slot: CurySlot;
}
export const CURY_STOP_BOOST_PARAMS_SCHEMA: JsonSchema =
    CURY_BOOST_PARAMS_SCHEMA;

export interface CuryGetVialInfoParams {
    shellyID: string;
    id: number;
    slot?: CurySlot;
}
export const CURY_GET_VIAL_INFO_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        slot: {
            ...CURY_SLOT_SCHEMA,
            description: 'Optional slot — defaults to both'
        }
    }
};

const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};
const RESP_NULL: JsonSchema = {type: 'null'};
const RESP_BOOST: JsonSchema = {
    type: 'object',
    properties: {
        boost: {
            type: 'object',
            properties: {
                started_at: {type: 'integer'},
                duration: {type: 'integer'}
            }
        }
    }
};
const RESP_WAS_ON: JsonSchema = {
    type: 'object',
    properties: {was_on: {type: 'boolean'}}
};

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const b = new DescribeBuilder('cury', {
    kind: 'device',
    description:
        'Control and monitor Cury vial-slot heating, modes, boost, and away mode.'
});

b.registerMethod('GetConfig', {
    params: CURY_GET_CONFIG_PARAMS_SCHEMA,
    response: {type: 'object'},
    permission: PERM_READ,
    description: 'Cury.GetConfig.'
});

b.registerMethod('SetConfig', {
    params: CURY_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Cury.SetConfig.'
});

b.registerMethod('GetStatus', {
    params: CURY_GET_STATUS_PARAMS_SCHEMA,
    response: {type: 'object'},
    permission: PERM_READ,
    description: 'Cury.GetStatus.'
});

b.registerMethod('SetMode', {
    params: CURY_SET_MODE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Cury.SetMode — inserts predefined schedules for room type.'
});

b.registerMethod('SetAwayMode', {
    params: CURY_SET_AWAY_MODE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Cury.SetAwayMode — toggle away mode.'
});

b.registerMethod('Set', {
    params: CURY_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Cury.Set — control vial slot heating.'
});

b.registerMethod('Boost', {
    params: CURY_BOOST_PARAMS_SCHEMA,
    response: RESP_BOOST,
    permission: PERM_EXECUTE,
    description: 'Cury.Boost — start boost on slot.'
});

b.registerMethod('StopBoost', {
    params: CURY_STOP_BOOST_PARAMS_SCHEMA,
    response: RESP_WAS_ON,
    permission: PERM_EXECUTE,
    description: 'Cury.StopBoost — cancel active boost on slot.'
});

b.registerMethod('GetVialInfo', {
    params: CURY_GET_VIAL_INFO_PARAMS_SCHEMA,
    response: {
        type: 'object',
        description: 'Vial info or null when slot empty'
    },
    permission: PERM_READ,
    description: 'Cury.GetVialInfo.'
});

export const CURY_DESCRIBE: DescribeOutput = b.build();
