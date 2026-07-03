import {DescribeBuilder, type DescribeOutput} from './_describe';
import {sensor, state} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {
    DEVICE_CONFIG_PATCH_SCHEMA,
    RESTART_REQUIRED_RESPONSE_SCHEMA,
    SHELLY_ID_SCHEMA
} from './_shared';
import {PERIPHERAL_COMPONENTS} from './deviceAddons';

const COMPONENT_ID: JsonSchema = {
    type: 'integer',
    minimum: 0,
    description: 'Component index on the device (0-based)'
};

export interface AddonShellyOnlyParams {
    shellyID: string;
}
export const ADDON_SHELLY_ONLY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA}
};

export interface AddonSensorAddPeripheralParams {
    shellyID: string;
    type: string;
    attrs?: Record<string, unknown>;
}
export const ADDON_SENSOR_ADD_PERIPHERAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'type'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        type: {type: 'string', minLength: 1},
        attrs: {type: 'object'}
    }
};

export interface AddonSensorRemovePeripheralParams {
    shellyID: string;
    component: string;
}
export const ADDON_SENSOR_REMOVE_PERIPHERAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'component'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        component: {type: 'string', minLength: 1}
    }
};

export interface AddonProOutputAddPeripheralParams {
    shellyID: string;
    type: string;
}
export const ADDON_PRO_OUTPUT_ADD_PERIPHERAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'type'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        type: {type: 'string', minLength: 1}
    }
};

export interface AddonProOutputRemovePeripheralParams {
    shellyID: string;
    component: string;
}
export const ADDON_PRO_OUTPUT_REMOVE_PERIPHERAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'component'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        component: {type: 'string', minLength: 1}
    }
};

export interface AddonPeripheralGetConfigParams {
    shellyID: string;
    component: (typeof PERIPHERAL_COMPONENTS)[number];
    id: number;
}
export const ADDON_PERIPHERAL_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'component', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        component: {type: 'string', enum: [...PERIPHERAL_COMPONENTS]},
        id: COMPONENT_ID
    }
};

export interface AddonPeripheralSetConfigParams {
    shellyID: string;
    component: (typeof PERIPHERAL_COMPONENTS)[number];
    id: number;
    config: Record<string, unknown>;
}
export const ADDON_PERIPHERAL_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'component', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        component: {type: 'string', enum: [...PERIPHERAL_COMPONENTS]},
        id: COMPONENT_ID,
        config: DEVICE_CONFIG_PATCH_SCHEMA
    }
};

const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Returns null on success'
};

const RESP_DEVICE: JsonSchema = {
    type: 'object',
    description: 'Forwarded Shelly device response'
};

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

export const ADDON_DESCRIBE: DescribeOutput = new DescribeBuilder('addon', {
    kind: 'device',
    description:
        'Manage add-on peripherals — sensors and Pro outputs: scan, add, remove, configure.'
})
    .registerMethod('Sensor.GetPeripherals', {
        params: ADDON_SHELLY_ONLY_PARAMS_SCHEMA,
        response: {
            type: 'object',
            description: 'SensorAddon peripheral type-keyed map'
        },
        permission: PERM_READ,
        description: 'SensorAddon.GetPeripherals.'
    })
    .registerMethod('Sensor.OneWireScan', {
        params: ADDON_SHELLY_ONLY_PARAMS_SCHEMA,
        response: {
            type: 'object',
            properties: {devices: {type: 'array'}}
        },
        permission: PERM_UPDATE,
        description: 'SensorAddon.OneWireScan.'
    })
    .registerMethod('Sensor.AddPeripheral', {
        params: ADDON_SENSOR_ADD_PERIPHERAL_PARAMS_SCHEMA,
        response: RESP_DEVICE,
        permission: PERM_UPDATE,
        description: 'SensorAddon.AddPeripheral.'
    })
    .registerMethod('Sensor.RemovePeripheral', {
        params: ADDON_SENSOR_REMOVE_PERIPHERAL_PARAMS_SCHEMA,
        response: RESP_NULL,
        permission: PERM_UPDATE,
        description: 'SensorAddon.RemovePeripheral.'
    })
    .registerMethod('ProOutput.GetPeripherals', {
        params: ADDON_SHELLY_ONLY_PARAMS_SCHEMA,
        response: {
            type: 'object',
            description: 'ProOutputAddon peripheral type-keyed map'
        },
        permission: PERM_READ,
        description: 'ProOutputAddon.GetPeripherals.'
    })
    .registerMethod('ProOutput.AddPeripheral', {
        params: ADDON_PRO_OUTPUT_ADD_PERIPHERAL_PARAMS_SCHEMA,
        response: RESP_DEVICE,
        permission: PERM_UPDATE,
        description: 'ProOutputAddon.AddPeripheral.'
    })
    .registerMethod('ProOutput.RemovePeripheral', {
        params: ADDON_PRO_OUTPUT_REMOVE_PERIPHERAL_PARAMS_SCHEMA,
        response: RESP_NULL,
        permission: PERM_UPDATE,
        description: 'ProOutputAddon.RemovePeripheral.'
    })
    .registerMethod('Peripheral.GetConfig', {
        params: ADDON_PERIPHERAL_GET_CONFIG_PARAMS_SCHEMA,
        response: {
            type: 'object',
            description:
                'Peripheral component config, shape per component family'
        },
        permission: PERM_READ,
        description: '{component}.GetConfig on addon peripheral components.'
    })
    .registerMethod('Peripheral.SetConfig', {
        params: ADDON_PERIPHERAL_SET_CONFIG_PARAMS_SCHEMA,
        response: RESTART_REQUIRED_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description: '{component}.SetConfig on addon peripheral components.'
    })
    // Sensors plugged into the add-on surface these readings (optional —
    // depends what peripheral is attached). Each also shows up as its own
    // temperature/humidity/input/voltmeter component instance.
    .setMetrics([
        sensor('tc', '°C', {optional: true}),
        sensor('tf', '°F', {optional: true}),
        sensor('rh', '%', {optional: true}),
        sensor('lux', 'lx', {optional: true}),
        sensor('voltage', 'V', {optional: true}),
        sensor('percent', '%', {optional: true}),
        sensor('battery_percent', '%', {optional: true}),
        state('input', {optional: true})
    ])
    .build();
