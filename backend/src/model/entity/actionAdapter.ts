/**
 * Entity action adapter — Phase 1c.
 *
 * Translates a backend-owned action verb (`toggle`, `setOutput`,
 * `setBrightness`, `open`, ...) into the concrete Shelly device RPC call
 * required to execute it.
 *
 * Design rules:
 *   - One source of truth: every verb declares its expected params via
 *     JSON Schema; the dispatcher validates before calling the adapter.
 *   - Stateless where possible: use `<Component>.Toggle` instead of
 *     `<Component>.Set({on: !currentState})` to avoid a read-then-write
 *     race on every toggle.
 *   - Idempotent Set calls: `setBrightness(N>0)` always includes
 *     `on: true` so the device doesn't have to infer intent.
 *   - Per-type whitelist: only entity types in
 *     `ENTITY_TYPE_TO_SHELLY_COMPONENT` accept actions. Everything else
 *     is routed through a dedicated `Device.*` wrapper (BluTRV, BTHome*)
 *     or refused (read-only sensors, virtual components).
 *
 * Mirrors the behavior of `frontend/src/components/entity-registry.ts`
 * so the cutover commit can delete the frontend action composition
 * without any behavioral change visible to end users.
 */

import type {JsonSchema} from '../../rpc/validation';
import {
    ENTITY_TYPE_TO_SHELLY_COMPONENT,
    shellyComponentForEntityType
} from './capabilities';

/** Every distinct action verb the adapter has a builder for */
export const ACTION_KINDS = [
    'toggle',
    'toggleAfter',
    'setOutput',
    'setValue',
    'setBrightness',
    'setColor',
    'setWhite',
    'setColorTemperature',
    'setMode',
    'setPosition',
    'setTilt',
    'open',
    'close',
    'stop',
    'calibrate',
    'setTarget',
    'setSchedule',
    'setEnabled',
    'trigger',
    'press',
    'play',
    'pause',
    'playPause',
    'next',
    'previous',
    'setVolume',
    'setVariable',
    'setBoost',
    'startBoost',
    'clearBoost',
    'setAwayMode',
    'setCuryMode',
    'setSlot',
    'setIntensity',
    'setAmbientColor',
    'mute',
    'setArmed',
    'setPrivacy',
    'capture',
    'startRecording',
    'stopRecording',
    'resetCounters',
    'playFavourite',
    'playNextFavourite',
    'playPreviousFavourite',
    'radioStop',
    'setScreen',
    'swipe',
    'tap',
    'setDaliGroup',
    'setLedStripField',
    'nextLedStripEffect'
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

// --- Action parameter schemas -------------------------------------------

/** Schema for a single action's `params` payload. Empty object = no params. */
export const ACTION_PARAM_SCHEMAS: Record<string, JsonSchema> = {
    toggle: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    toggleAfter: {
        type: 'object',
        required: ['on', 'seconds'],
        additionalProperties: false,
        properties: {
            on: {type: 'boolean'},
            seconds: {type: 'integer', minimum: 1, maximum: 86400}
        }
    },
    setOutput: {
        type: 'object',
        required: ['on'],
        additionalProperties: false,
        properties: {
            on: {type: 'boolean'}
        }
    },
    setValue: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
            value: {
                description: 'Entity-type-specific value payload'
            }
        }
    },
    setBrightness: {
        type: 'object',
        required: ['brightness'],
        additionalProperties: false,
        properties: {
            brightness: {type: 'integer', minimum: 0, maximum: 100}
        }
    },
    setColor: {
        type: 'object',
        required: ['rgb'],
        additionalProperties: false,
        properties: {
            rgb: {
                type: 'array',
                items: {type: 'integer', minimum: 0, maximum: 255},
                minItems: 3,
                maxItems: 3
            }
        }
    },
    setWhite: {
        type: 'object',
        required: ['white'],
        additionalProperties: false,
        properties: {
            white: {type: 'integer', minimum: 0, maximum: 255}
        }
    },
    setColorTemperature: {
        type: 'object',
        required: ['ct'],
        additionalProperties: false,
        properties: {
            ct: {
                type: 'integer',
                minimum: 2000,
                maximum: 6500,
                description: 'Color temperature in Kelvin'
            }
        }
    },
    setMode: {
        type: 'object',
        required: ['mode'],
        additionalProperties: false,
        properties: {
            mode: {type: 'string', minLength: 1}
        }
    },
    open: {
        type: 'object',
        additionalProperties: false,
        properties: {
            duration: {type: 'integer', minimum: 1, maximum: 86400}
        }
    },
    close: {
        type: 'object',
        additionalProperties: false,
        properties: {
            duration: {type: 'integer', minimum: 1, maximum: 86400}
        }
    },
    stop: {type: 'object', additionalProperties: false, properties: {}},
    setPosition: {
        type: 'object',
        required: ['pos'],
        additionalProperties: false,
        properties: {
            pos: {type: 'integer', minimum: 0, maximum: 100}
        }
    },
    press: {
        type: 'object',
        additionalProperties: false,
        properties: {
            event: {type: 'string', minLength: 1}
        }
    },
    setTilt: {
        type: 'object',
        required: ['slat_pos'],
        additionalProperties: false,
        properties: {
            slat_pos: {type: 'integer', minimum: 0, maximum: 100}
        }
    },
    setTarget: {
        type: 'object',
        required: ['target_C'],
        additionalProperties: false,
        properties: {
            target_C: {type: 'number', minimum: -50, maximum: 50}
        }
    },
    setSchedule: {
        type: 'object',
        required: ['schedule'],
        additionalProperties: false,
        properties: {
            schedule: {
                type: 'object',
                description: 'Opaque schedule config forwarded to the device'
            }
        }
    },
    setEnabled: {
        type: 'object',
        required: ['enabled'],
        additionalProperties: false,
        properties: {
            enabled: {type: 'boolean'}
        }
    },
    play: {type: 'object', additionalProperties: false, properties: {}},
    pause: {type: 'object', additionalProperties: false, properties: {}},
    next: {type: 'object', additionalProperties: false, properties: {}},
    previous: {type: 'object', additionalProperties: false, properties: {}},
    setVolume: {
        type: 'object',
        required: ['volume'],
        additionalProperties: false,
        properties: {
            volume: {type: 'integer', minimum: 0, maximum: 100}
        }
    },
    setVariable: {
        type: 'object',
        required: ['key', 'value'],
        additionalProperties: false,
        properties: {
            key: {
                type: 'string',
                minLength: 1,
                description:
                    'Virtual component key — "<type>:<id>" (e.g. "boolean:201")'
            },
            value: {description: 'Virtual-component-typed payload'}
        }
    },
    trigger: {
        type: 'object',
        required: ['key', 'event'],
        additionalProperties: false,
        properties: {
            key: {
                type: 'string',
                minLength: 1,
                description: 'Virtual button key — "button:<id>"'
            },
            event: {type: 'string', minLength: 1}
        }
    },
    setBoost: {
        type: 'object',
        required: ['slot', 'on'],
        additionalProperties: false,
        properties: {
            slot: {type: 'string', enum: ['left', 'right']},
            on: {type: 'boolean'}
        }
    },
    startBoost: {
        type: 'object',
        required: ['duration'],
        additionalProperties: false,
        properties: {
            duration: {type: 'integer', minimum: 1, maximum: 86400}
        }
    },
    clearBoost: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    setAwayMode: {
        type: 'object',
        required: ['on'],
        additionalProperties: false,
        properties: {
            on: {type: 'boolean'}
        }
    },
    setCuryMode: {
        type: 'object',
        required: ['mode'],
        additionalProperties: false,
        properties: {
            // `null` clears back to Manual — mirrored from the device RPC
            mode: {type: ['string', 'null']}
        }
    },
    setSlot: {
        type: 'object',
        required: ['slot', 'on'],
        additionalProperties: false,
        properties: {
            slot: {type: 'string', enum: ['left', 'right']},
            on: {type: 'boolean'},
            intensity: {type: 'integer', minimum: 0, maximum: 100}
        }
    },
    calibrate: {type: 'object', additionalProperties: false, properties: {}},
    resetCounters: {
        type: 'object',
        additionalProperties: false,
        properties: {
            types: {
                type: 'array',
                items: {type: 'string'},
                minItems: 1
            }
        }
    },
    playFavourite: {
        type: 'object',
        required: ['favouriteId'],
        additionalProperties: false,
        properties: {favouriteId: {type: 'integer', minimum: 0}}
    },
    playNextFavourite: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    playPreviousFavourite: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    radioStop: {type: 'object', additionalProperties: false, properties: {}},
    setScreen: {
        type: 'object',
        required: ['screen'],
        additionalProperties: false,
        properties: {
            screen: {type: 'string', minLength: 1}
        }
    },
    swipe: {
        type: 'object',
        required: ['direction'],
        additionalProperties: false,
        properties: {
            direction: {
                type: 'string',
                enum: ['up', 'down', 'left', 'right']
            }
        }
    },
    tap: {type: 'object', additionalProperties: false, properties: {}},
    setDaliGroup: {
        type: 'object',
        required: ['groupId'],
        additionalProperties: false,
        properties: {
            groupId: {type: 'integer', minimum: 0},
            on: {type: 'boolean'},
            brightness: {type: 'number', minimum: 0, maximum: 100},
            transition: {type: 'number', minimum: 0}
        }
    },
    setLedStripField: {
        type: 'object',
        required: ['key', 'value'],
        additionalProperties: false,
        properties: {
            key: {type: 'string', minLength: 1},
            value: {description: 'Dynamic LED strip field value'}
        }
    },
    nextLedStripEffect: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    playPause: {type: 'object', additionalProperties: false, properties: {}},
    mute: {
        type: 'object',
        required: ['mute'],
        additionalProperties: false,
        properties: {mute: {type: 'boolean'}}
    },
    setAmbientColor: {
        type: 'object',
        required: ['rgb'],
        additionalProperties: false,
        properties: {
            rgb: {
                type: 'array',
                items: {type: 'integer', minimum: 0, maximum: 255},
                minItems: 3,
                maxItems: 3
            }
        }
    },
    setIntensity: {
        type: 'object',
        required: ['slot', 'intensity'],
        additionalProperties: false,
        properties: {
            slot: {type: 'string', enum: ['left', 'right']},
            intensity: {type: 'integer', minimum: 0, maximum: 100}
        }
    },
    setArmed: {
        type: 'object',
        required: ['armed'],
        additionalProperties: false,
        properties: {armed: {type: 'boolean'}}
    },
    setPrivacy: {
        type: 'object',
        required: ['privacy'],
        additionalProperties: false,
        properties: {privacy: {type: 'boolean'}}
    },
    capture: {type: 'object', additionalProperties: false, properties: {}},
    startRecording: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    stopRecording: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    }
};

/**
 * Result of translating an entity action into a device RPC call.
 * The dispatcher passes `method` + `params` straight to
 * `ShellyDevice.sendRPC(method, params)`.
 */
export interface DeviceRpcCall {
    method: string;
    params: Record<string, unknown>;
}

// --- Per-action builders -------------------------------------------------

type ActionBuilder = (input: TranslateActionInput) => DeviceRpcCall;

// Shelly firmware mismatch: Dimmer's Light.Set uses `temp`, every CCT-capable
// component (CCT.*, RGBCCT.*) uses `ct`. Data-driven to avoid inline ternaries.
const COLOR_TEMP_FIELD_BY_ENTITY: Record<string, 'temp' | 'ct'> = {
    light: 'temp',
    cct: 'ct',
    rgbcct: 'ct'
};

// Only thermostat config keys we expose through Entity.* verbs. BluTrv wraps
// the same payload inside a BluTrv.Call envelope, so the inner shape stays
// identical.
type ThermostatConfigPatch = {
    target_C?: number;
    enable?: boolean;
    schedule?: unknown;
};

/**
 * Thermostat config patch dispatch: native `thermostat` hits the component
 * directly; `blutrv` tunnels the same Thermostat.SetConfig through the
 * gateway's BluTrv.Call wrapper. Keeps per-verb builders free of ternaries.
 */
function buildThermostatSetConfig(
    entityType: string,
    channelId: number,
    config: ThermostatConfigPatch
): DeviceRpcCall {
    if (entityType === 'thermostat') {
        return {
            method: 'Thermostat.SetConfig',
            params: {id: channelId, config}
        };
    }
    if (entityType === 'blutrv') {
        return {
            method: 'BluTrv.Call',
            params: {
                id: channelId,
                method: 'Thermostat.SetConfig',
                params: {id: 0, config}
            }
        };
    }
    throw new Error(
        `Thermostat config patch not supported for '${entityType}'`
    );
}

function buildBluTrvCall(
    channelId: number,
    method: string,
    params: Record<string, unknown>
): DeviceRpcCall {
    return {
        method: 'BluTrv.Call',
        params: {
            id: channelId,
            method,
            params: {id: 0, ...params}
        }
    };
}

// setValue dispatch by entityType — single source of truth for the
// builder + param schema (replaces two parallel switches).
interface SetValueStrategy {
    method: string;
    paramSchema: JsonSchema;
    castValue: (v: unknown) => boolean | number | string;
}

const SET_VALUE_STRATEGIES: Record<string, SetValueStrategy> = {
    boolean: {
        method: 'Boolean.Set',
        paramSchema: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: {value: {type: 'boolean'}}
        },
        castValue: (v) => v as boolean
    },
    number: {
        method: 'Number.Set',
        paramSchema: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: {value: {type: 'number'}}
        },
        castValue: (v) => v as number
    },
    text: {
        method: 'Text.Set',
        paramSchema: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: {value: {type: 'string'}}
        },
        castValue: (v) => v as string
    },
    enum: {
        method: 'Enum.Set',
        paramSchema: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: {value: {type: 'string'}}
        },
        castValue: (v) => v as string
    }
};

const BUILDERS: Record<string, ActionBuilder> = {
    toggle: ({entityType, channelId}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {
            method: `${component}.Toggle`,
            params: {id: channelId}
        };
    },
    toggleAfter: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {
            method: `${component}.Set`,
            params: {
                id: channelId,
                on: actionParams.on as boolean,
                toggle_after: actionParams.seconds as number
            }
        };
    },
    setOutput: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {
            method: `${component}.Set`,
            params: {id: channelId, on: actionParams.on as boolean}
        };
    },
    setValue: ({entityType, channelId, actionParams}) => {
        const strategy = SET_VALUE_STRATEGIES[entityType];
        if (!strategy) {
            throw new Error(`setValue is not supported for '${entityType}'`);
        }
        return {
            method: strategy.method,
            params: {
                id: channelId,
                value: strategy.castValue(actionParams.value)
            }
        };
    },
    setBrightness: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        const level = actionParams.brightness as number;
        return {
            method: `${component}.Set`,
            params:
                level === 0
                    ? {id: channelId, on: false}
                    : {id: channelId, brightness: level, on: true}
        };
    },
    setColor: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {
            method: `${component}.Set`,
            params: {id: channelId, rgb: actionParams.rgb as number[], on: true}
        };
    },
    setWhite: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {
            method: `${component}.Set`,
            params: {
                id: channelId,
                white: actionParams.white as number,
                on: true
            }
        };
    },
    setColorTemperature: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        const field = COLOR_TEMP_FIELD_BY_ENTITY[entityType];
        if (!field) {
            throw new Error(
                `setColorTemperature not supported for '${entityType}'`
            );
        }
        return {
            method: `${component}.Set`,
            params: {
                id: channelId,
                [field]: actionParams.ct as number,
                on: true
            }
        };
    },
    setMode: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`setMode is not supported for '${entityType}'`);
        }
        return {
            method: `${component}.Set`,
            params: {id: channelId, mode: actionParams.mode as string}
        };
    },
    open: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        const params: Record<string, unknown> = {id: channelId};
        if (typeof actionParams.duration === 'number') {
            params.duration = actionParams.duration;
        }
        return {method: `${component}.Open`, params};
    },
    close: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        const params: Record<string, unknown> = {id: channelId};
        if (typeof actionParams.duration === 'number') {
            params.duration = actionParams.duration;
        }
        return {method: `${component}.Close`, params};
    },
    stop: ({entityType, channelId}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {method: `${component}.Stop`, params: {id: channelId}};
    },
    setPosition: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`No Shelly component mapping for '${entityType}'`);
        }
        return {
            method: `${component}.GoToPosition`,
            params: {id: channelId, pos: actionParams.pos as number}
        };
    },
    press: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'button') {
            throw new Error(`press is not supported for '${entityType}'`);
        }
        const payload: Record<string, unknown> = {id: channelId};
        if (typeof actionParams.event === 'string') {
            payload.event = actionParams.event;
        }
        return {method: 'Button.Trigger', params: payload};
    },
    setTilt: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cover') {
            throw new Error(`setTilt is not supported for '${entityType}'`);
        }
        return {
            method: 'Cover.GoToPosition',
            params: {id: channelId, slat_pos: actionParams.slat_pos as number}
        };
    },
    setTarget: ({entityType, channelId, actionParams}) =>
        buildThermostatSetConfig(entityType, channelId, {
            target_C: actionParams.target_C as number
        }),
    setSchedule: ({entityType, channelId, actionParams}) =>
        buildThermostatSetConfig(entityType, channelId, {
            schedule: actionParams.schedule
        }),
    setEnabled: ({entityType, channelId, actionParams}) => {
        const enable = actionParams.enabled as boolean;
        // Matter is a singleton component — firmware wants id:null.
        if (entityType === 'matter') {
            return {
                method: 'Matter.SetConfig',
                params: {id: null, config: {enable}}
            };
        }
        return buildThermostatSetConfig(entityType, channelId, {enable});
    },
    // Wall-Display media player — firmware methods live under
    // Media.MediaPlayer.* (PlayOrPause/Next/Previous). SetVolume is top-level.
    play: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(`play is not supported for '${entityType}'`);
        }
        return {
            method: 'Media.MediaPlayer.PlayOrPause',
            params: {id: channelId}
        };
    },
    pause: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(`pause is not supported for '${entityType}'`);
        }
        return {
            method: 'Media.MediaPlayer.PlayOrPause',
            params: {id: channelId}
        };
    },
    playPause: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(`playPause is not supported for '${entityType}'`);
        }
        return {
            method: 'Media.MediaPlayer.PlayOrPause',
            params: {id: channelId}
        };
    },
    next: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(`next is not supported for '${entityType}'`);
        }
        return {method: 'Media.MediaPlayer.Next', params: {id: channelId}};
    },
    previous: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(`previous is not supported for '${entityType}'`);
        }
        return {method: 'Media.MediaPlayer.Previous', params: {id: channelId}};
    },
    setVolume: ({entityType, actionParams}) => {
        if (entityType !== 'media') {
            throw new Error(`setVolume is not supported for '${entityType}'`);
        }
        return {
            method: 'Media.SetVolume',
            params: {volume: actionParams.volume as number}
        };
    },
    playPreviousFavourite: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(
                `playPreviousFavourite is not supported for '${entityType}'`
            );
        }
        return {
            method: 'Media.Radio.PlayPreviousFavourite',
            params: {id: channelId}
        };
    },
    radioStop: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(`radioStop is not supported for '${entityType}'`);
        }
        return {method: 'Media.Radio.Stop', params: {id: channelId}};
    },
    // Service entities key virtual components by "<type>:<id>". Splitting
    // here keeps the frontend free of RPC routing. Only the four virtual
    // component families are valid (Boolean/Number/Enum/Text).
    setVariable: ({entityType, actionParams}) => {
        if (entityType !== 'service') {
            throw new Error(`setVariable is not supported for '${entityType}'`);
        }
        const {component, id} = parseVirtualComponentKey(
            actionParams.key as string
        );
        return {
            method: `${component}.Set`,
            params: {id, value: actionParams.value}
        };
    },
    trigger: ({entityType, actionParams}) => {
        if (entityType !== 'service') {
            throw new Error(`trigger is not supported for '${entityType}'`);
        }
        const {component, id} = parseVirtualComponentKey(
            actionParams.key as string
        );
        if (component !== 'Button') {
            throw new Error(
                `trigger requires a button key, got '${component}'`
            );
        }
        return {
            method: 'Button.Trigger',
            params: {id, event: actionParams.event as string}
        };
    },
    setSlot: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cury') {
            throw new Error(`setSlot is not supported for '${entityType}'`);
        }
        const params: Record<string, unknown> = {
            id: channelId,
            slot: actionParams.slot as string,
            on: actionParams.on as boolean
        };
        if (typeof actionParams.intensity === 'number') {
            params.intensity = actionParams.intensity;
        }
        return {method: 'Cury.Set', params};
    },
    // Set just the intensity of an active Cury slot without toggling on/off.
    setIntensity: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cury') {
            throw new Error(
                `setIntensity is not supported for '${entityType}'`
            );
        }
        return {
            method: 'Cury.Set',
            params: {
                id: channelId,
                slot: actionParams.slot as string,
                intensity: actionParams.intensity as number
            }
        };
    },
    setAmbientColor: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cury') {
            throw new Error(
                `setAmbientColor is not supported for '${entityType}'`
            );
        }
        return {
            method: 'Cury.SetConfig',
            params: {
                id: channelId,
                config: {ambient: {color: actionParams.rgb as number[]}}
            }
        };
    },
    mute: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'smoke') {
            throw new Error(`mute is not supported for '${entityType}'`);
        }
        return {
            method: 'Smoke.SetConfig',
            params: {
                id: channelId,
                config: {mute: actionParams.mute as boolean}
            }
        };
    },
    setArmed: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'camera') {
            throw new Error(`setArmed is not supported for '${entityType}'`);
        }
        return {
            method: 'Camera.SetConfig',
            params: {
                id: channelId,
                config: {arm: actionParams.armed as boolean}
            }
        };
    },
    setPrivacy: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'camera') {
            throw new Error(`setPrivacy is not supported for '${entityType}'`);
        }
        return {
            method: 'Camera.SetConfig',
            params: {
                id: channelId,
                config: {privacy: actionParams.privacy as boolean}
            }
        };
    },
    capture: ({entityType, channelId}) => {
        if (entityType !== 'camera') {
            throw new Error(`capture is not supported for '${entityType}'`);
        }
        return {method: 'Camera.CaptureImage', params: {id: channelId}};
    },
    startRecording: ({entityType, channelId}) => {
        if (entityType !== 'camera') {
            throw new Error(
                `startRecording is not supported for '${entityType}'`
            );
        }
        return {method: 'Camera.StartRecording', params: {id: channelId}};
    },
    stopRecording: ({entityType, channelId}) => {
        if (entityType !== 'camera') {
            throw new Error(
                `stopRecording is not supported for '${entityType}'`
            );
        }
        return {method: 'Camera.StopRecording', params: {id: channelId}};
    },
    // Single verb folds Cury.Boost / Cury.StopBoost — `on: false` stops an
    // active boost, `on: true` starts one on the given slot.
    setBoost: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cury') {
            throw new Error(`setBoost is not supported for '${entityType}'`);
        }
        const slot = actionParams.slot as string;
        const on = actionParams.on as boolean;
        return {
            method: on ? 'Cury.Boost' : 'Cury.StopBoost',
            params: {id: channelId, slot}
        };
    },
    startBoost: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'blutrv') {
            throw new Error(`startBoost is not supported for '${entityType}'`);
        }
        return buildBluTrvCall(channelId, 'TRV.SetBoost', {
            duration: actionParams.duration as number
        });
    },
    clearBoost: ({entityType, channelId}) => {
        if (entityType !== 'blutrv') {
            throw new Error(`clearBoost is not supported for '${entityType}'`);
        }
        return buildBluTrvCall(channelId, 'TRV.ClearBoost', {});
    },
    setAwayMode: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cury') {
            throw new Error(`setAwayMode is not supported for '${entityType}'`);
        }
        return {
            method: 'Cury.SetAwayMode',
            params: {id: channelId, on: actionParams.on as boolean}
        };
    },
    setCuryMode: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'cury') {
            throw new Error(`setCuryMode is not supported for '${entityType}'`);
        }
        return {
            method: 'Cury.SetMode',
            params: {id: channelId, mode: actionParams.mode as string | null}
        };
    },
    // Cover + light both declare calibrate; the device RPC is namespaced by
    // the component. Look up via shellyComponentForEntityType so new CCT-
    // capable components (e.g. DALI) inherit automatically.
    calibrate: ({entityType, channelId}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(`calibrate is not supported for '${entityType}'`);
        }
        return {method: `${component}.Calibrate`, params: {id: channelId}};
    },
    // Generic counter reset — every device component that has counters exposes
    // `.ResetCounters({id, types?})`. Optional types[] narrows which counters
    // are cleared; omitted = device default (usually 'aenergy').
    resetCounters: ({entityType, channelId, actionParams}) => {
        const component = shellyComponentForEntityType(entityType);
        if (!component) {
            throw new Error(
                `resetCounters is not supported for '${entityType}'`
            );
        }
        const params: Record<string, unknown> = {id: channelId};
        if (Array.isArray(actionParams.types)) {
            params.types = actionParams.types;
        }
        return {method: `${component}.ResetCounters`, params};
    },
    // Radio-capable media players only. `favouriteId` = station slot (0-based).
    playFavourite: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'media') {
            throw new Error(
                `playFavourite is not supported for '${entityType}'`
            );
        }
        return {
            method: 'Media.Radio.PlayFavourite',
            params: {id: channelId, fav_id: actionParams.favouriteId as number}
        };
    },
    playNextFavourite: ({entityType, channelId}) => {
        if (entityType !== 'media') {
            throw new Error(
                `playNextFavourite is not supported for '${entityType}'`
            );
        }
        return {
            method: 'Media.Radio.PlayNextFavourite',
            params: {id: channelId}
        };
    },
    setScreen: ({entityType, actionParams}) => {
        if (entityType !== 'ui') {
            throw new Error(`setScreen is not supported for '${entityType}'`);
        }
        return {
            method: 'Ui.Screen.Set',
            params: {on: actionParams.screen as string}
        };
    },
    swipe: ({entityType, actionParams}) => {
        if (entityType !== 'ui') {
            throw new Error(`swipe is not supported for '${entityType}'`);
        }
        return {
            method: 'Ui.Swipe',
            params: {direction: actionParams.direction as string}
        };
    },
    tap: ({entityType}) => {
        if (entityType !== 'ui') {
            throw new Error(`tap is not supported for '${entityType}'`);
        }
        return {method: 'Ui.Tap', params: {}};
    },
    setDaliGroup: ({entityType, actionParams}) => {
        if (entityType !== 'light') {
            throw new Error(
                `setDaliGroup is not supported for '${entityType}'`
            );
        }
        const params: Record<string, unknown> = {
            id: actionParams.groupId as number
        };
        if (typeof actionParams.on === 'boolean') params.on = actionParams.on;
        if (typeof actionParams.brightness === 'number') {
            params.brightness = actionParams.brightness;
        }
        if (typeof actionParams.transition === 'number') {
            params.transition = actionParams.transition;
        }
        return {method: 'Group.Set', params};
    },
    setLedStripField: ({entityType, channelId, actionParams}) => {
        if (entityType !== 'ledstrip') {
            throw new Error(
                `setLedStripField is not supported for '${entityType}'`
            );
        }
        return {
            method: 'LedStrip.Set',
            params: {
                id: channelId,
                [actionParams.key as string]: actionParams.value
            }
        };
    },
    nextLedStripEffect: ({entityType, channelId}) => {
        if (entityType !== 'ledstrip') {
            throw new Error(
                `nextLedStripEffect is not supported for '${entityType}'`
            );
        }
        return {method: 'LedStrip.NextEffect', params: {id: channelId}};
    }
};

// --- Helpers -------------------------------------------------------------

// Virtual component keys — case-insensitive "type:id". Settable roles
// (Boolean/Number/Enum/Text) plus Button for service.trigger.
const VIRTUAL_COMPONENT_TYPES: Record<string, string> = {
    boolean: 'Boolean',
    number: 'Number',
    enum: 'Enum',
    text: 'Text',
    button: 'Button'
};

function parseVirtualComponentKey(key: string): {
    component: string;
    id: number;
} {
    const [rawType, rawId] = key.split(':');
    if (!rawType || !rawId) {
        throw new Error(`Invalid virtual component key '${key}'`);
    }
    const component = VIRTUAL_COMPONENT_TYPES[rawType.toLowerCase()];
    if (!component) {
        throw new Error(`Unsupported virtual component type '${rawType}'`);
    }
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
        throw new Error(`Invalid virtual component id in '${key}'`);
    }
    return {component, id};
}

// --- Public API ----------------------------------------------------------

export interface TranslateActionInput {
    entityType: string;
    channelId: number;
    action: string;
    actionParams: Record<string, unknown>;
}

export type TranslateActionResult =
    | {ok: true; call: DeviceRpcCall}
    | {ok: false; reason: string};

/**
 * Translate an entity action invocation into the device RPC it should
 * dispatch. Returns a discriminated union so callers can handle the
 * "unsupported" case without try/catch.
 */
export function translateAction(
    input: TranslateActionInput
): TranslateActionResult {
    const builder = BUILDERS[input.action];
    if (!builder) {
        return {
            ok: false,
            reason: `Action '${input.action}' is not supported by entity type '${input.entityType}'`
        };
    }

    try {
        return {
            ok: true,
            call: builder(input)
        };
    } catch (err) {
        return {
            ok: false,
            reason:
                err instanceof Error
                    ? err.message
                    : `Unable to translate '${input.action}' for '${input.entityType}'`
        };
    }
}

/**
 * Does this action verb have a matching builder? Used by the dispatcher
 * to detect capability-registry/builder drift at startup.
 */
export function hasActionBuilder(action: string): boolean {
    return action in BUILDERS;
}

// Minimal valid inputs for each action — used by `shellyMethodForAction` to
// coax the builder into emitting its concrete `{method, params}` shape so we
// can check membership against `Shelly.ListMethods` output. These values are
// never sent to a device; they only drive method-name derivation.
const METHOD_PROBE_PARAMS: Record<string, Record<string, unknown>> = {
    toggle: {},
    toggleAfter: {on: true, seconds: 60},
    setOutput: {on: true},
    setValue: {value: true},
    setBrightness: {brightness: 50},
    setColor: {rgb: [0, 0, 0]},
    setWhite: {white: 100},
    setColorTemperature: {ct: 3000},
    setMode: {mode: 'color'},
    setPosition: {pos: 50},
    setTilt: {slat_pos: 50},
    open: {},
    close: {},
    stop: {},
    calibrate: {},
    setTarget: {target_C: 20},
    setSchedule: {schedule: []},
    setEnabled: {enabled: true},
    trigger: {key: 'Button:0', event: 'single_push'},
    press: {},
    play: {},
    pause: {},
    next: {},
    previous: {},
    setVolume: {volume: 50},
    setVariable: {key: 'Boolean:0', value: true},
    setBoost: {slot: 'left', on: true},
    startBoost: {duration: 1800},
    clearBoost: {},
    setAwayMode: {on: true},
    setCuryMode: {mode: null},
    setSlot: {slot: 'left', on: true},
    resetCounters: {},
    playFavourite: {favouriteId: 0},
    playNextFavourite: {},
    playPreviousFavourite: {},
    radioStop: {},
    playPause: {},
    setIntensity: {slot: 'left', intensity: 50},
    setAmbientColor: {rgb: [0, 0, 0]},
    mute: {mute: true},
    setArmed: {armed: true},
    setPrivacy: {privacy: true},
    capture: {},
    startRecording: {},
    stopRecording: {},
    setScreen: {screen: 'home'},
    swipe: {direction: 'up'},
    tap: {},
    setDaliGroup: {groupId: 0, on: true},
    setLedStripField: {key: 'effect', value: 'rainbow'},
    nextLedStripEffect: {}
};

/**
 * Returns the Shelly RPC method the given action would dispatch on the
 * given entity type, or `null` when the action isn't supported for that
 * type. Used by `Entity.GetCapabilities` to filter the full action list
 * by the device's actual `Shelly.ListMethods` output.
 */
export function shellyMethodForAction(
    entityType: string,
    action: string
): string | null {
    const probe = METHOD_PROBE_PARAMS[action] ?? {};
    const result = translateAction({
        entityType,
        channelId: 0,
        action,
        actionParams: probe
    });
    return result.ok ? result.call.method : null;
}

/**
 * Every action verb the adapter can translate for `entityType`. Derived
 * from the builder map, not a static list — the device-methods filter
 * in `Entity.GetCapabilities` narrows it further to what this specific
 * firmware advertises.
 */
export function actionsForEntityType(entityType: string): ActionKind[] {
    return ACTION_KINDS.filter(
        (action) => shellyMethodForAction(entityType, action) !== null
    );
}

/**
 * Return the JSON Schema for a given action's `params` payload.
 * Defaults to an empty-object schema for unknown actions so the
 * validation pass still rejects them cleanly.
 */
export function actionParamsSchemaFor(
    action: string,
    entityType?: string
): JsonSchema {
    if (action === 'setValue' && entityType) {
        const strategy = SET_VALUE_STRATEGIES[entityType];
        if (strategy) return strategy.paramSchema;
    }
    return (
        ACTION_PARAM_SCHEMAS[action] ?? {
            type: 'object',
            additionalProperties: false,
            properties: {}
        }
    );
}

/**
 * Registry snapshot for tests and introspection — every action that has
 * both a builder and a param schema.
 */
export function listSupportedActions(): string[] {
    return Object.keys(BUILDERS)
        .filter((a) => a in ACTION_PARAM_SCHEMAS)
        .sort();
}

// Re-export for callers that don't want to import capabilities directly
export {ENTITY_TYPE_TO_SHELLY_COMPONENT};

// Fails boot if the three action-keyed maps drift.
export function validateActionAdapterMaps(): string[] {
    const errors: string[] = [];
    const schemas = new Set(Object.keys(ACTION_PARAM_SCHEMAS));
    const builders = new Set(Object.keys(BUILDERS));
    const probes = new Set(Object.keys(METHOD_PROBE_PARAMS));
    for (const action of builders) {
        if (!schemas.has(action)) {
            errors.push(
                `actionAdapter: '${action}' has BUILDER but no ACTION_PARAM_SCHEMAS entry`
            );
        }
        if (!probes.has(action)) {
            errors.push(
                `actionAdapter: '${action}' has BUILDER but no METHOD_PROBE_PARAMS entry`
            );
        }
    }
    for (const action of schemas) {
        if (!builders.has(action)) {
            errors.push(
                `actionAdapter: '${action}' has ACTION_PARAM_SCHEMAS but no BUILDER`
            );
        }
    }
    for (const action of probes) {
        if (!builders.has(action)) {
            errors.push(
                `actionAdapter: '${action}' has METHOD_PROBE_PARAMS but no BUILDER`
            );
        }
    }
    return errors;
}

{
    const drift = validateActionAdapterMaps();
    if (drift.length > 0) {
        throw new Error(
            `actionAdapter parallel-map drift:\n  - ${drift.join('\n  - ')}`
        );
    }
}
