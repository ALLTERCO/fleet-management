import Log4js from 'log4js';
import {bthomeObjectInfos} from '../config/BTHomeData';
import type ShellyDevice from '../model/ShellyDevice';
import {
    type bthomesensor_entity,
    type cct_entity,
    type cover_entity,
    type cury_entity,
    type em1_entity,
    em_entity,
    type entity_t,
    type humidity_entity,
    type light_entity,
    type rgbcct_entity,
    type switch_entity,
    type temperature_entity,
    type virtual_boolean_entity,
    type virtual_button_entity,
    type virtual_number_entity,
    type virtual_text_entity,
    type voltmeter_entity
} from '../types';
const logger = Log4js.getLogger('ShellyComponents');

// Constants

const VIRTUAL_TYPES = [
    'boolean',
    'number',
    'text',
    'enum',
    'button',
    'bthomesensor'
];

/**
 * Get all instances keys of a specific type
 * @param type type of the component
 * @param status device status
 * @returns List of existing components keys
 */
function getAllInstancesKeys(type: string, status: any) {
    return Object.keys(status).filter((key) => key.startsWith(type));
}

// ----------------------------------------------------------------------------------
// BTHome Sensors
// ----------------------------------------------------------------------------------

export function composeBTHomeSensor(
    config: any,
    deviceName: string,
    deviceId: number
): bthomesensor_entity {
    const objId = config.obj_id;
    const info = bthomeObjectInfos[objId] ?? {};

    const objName = info?.name;
    const unit = info?.unit ?? '';
    const sensorType = info?.type ?? '';

    const objIndex = config.idx;
    const componentId = config.id;

    const id = `${deviceId}_${componentId}:bthomesensor`;
    const name =
        config?.name ??
        `${objName || objId}[${objIndex}] BLU Sensor ${deviceName || deviceId}`;

    return {
        name,
        id,
        type: 'bthomesensor',
        source: String(deviceId),
        properties: {
            id: componentId,
            unit,
            sensorType
        }
    };
}

// ----------------------------------------------------------------------------------
// Virtual Components
// ----------------------------------------------------------------------------------

function composeVirtualComponent(
    config: any,
    deviceName: string,
    deviceId: number,
    displayName: string,
    type: string,
    restProps?: any
) {
    const name = config?.name ?? `${displayName} ${deviceName || deviceId}`;

    const componentId = config.id; // important

    const id = `${deviceId}_${componentId}:${type}`;
    const view = config.meta?.ui?.view ?? null;

    return {
        name,
        id,
        source: String(deviceId),
        type,
        properties: {
            id: componentId,
            view,
            ...(typeof restProps === 'object' ? restProps : {})
        }
    };
}

function composeVirtualBoolean(
    config: any,
    deviceName: string,
    deviceId: number
): virtual_boolean_entity {
    const labels = config.meta?.ui?.titles;

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Boolean',
        'boolean',
        {
            labelFalse: labels?.[0] || 'Off',
            labelTrue: labels?.[1] || 'On'
        }
    );
}

function composeVirtualNumber(
    config: any,
    deviceName: string,
    deviceId: number
): virtual_number_entity {
    const min = config.min;
    const max = config.max;
    const unit = config.meta?.ui?.unit;
    const step = config?.meta.ui?.step ?? 1;

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Number',
        'number',
        {
            unit,
            min,
            max,
            step
        }
    );
}

function composeVirtualText(
    config: any,
    deviceName: string,
    deviceId: number
): virtual_text_entity {
    const maxLength = config.max_len;

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Text',
        'text',
        {
            maxLength
        }
    );
}

function composeVirtualEnum(
    config: any,
    deviceName: string,
    deviceId: number
): virtual_text_entity {
    const values = config.options;
    const labels = config.meta?.ui?.titles ?? {};

    const options: Record<string, string> = {};

    for (const value of values) {
        const label = labels[value] || value;
        options[value] = label;
    }

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Enum',
        'enum',
        {
            options
        }
    );
}

function composeVirtualButton(
    config: any,
    deviceName: string,
    deviceId: number
): virtual_button_entity {
    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Button',
        'button'
    );
}

export function composeDynamicComponent(
    type:
        | 'button'
        | 'boolean'
        | 'number'
        | 'text'
        | 'enum'
        | 'bthomesensor'
        | string,
    config: any,
    deviceName: string,
    deviceId: number
): entity_t | null {
    switch (type) {
        case 'boolean':
            return composeVirtualBoolean(config, deviceName, deviceId);

        case 'number':
            return composeVirtualNumber(config, deviceName, deviceId);

        case 'text':
            return composeVirtualText(config, deviceName, deviceId);

        case 'enum':
            return composeVirtualEnum(config, deviceName, deviceId);

        case 'button':
            return composeVirtualButton(config, deviceName, deviceId);

        case 'bthomesensor':
            return composeBTHomeSensor(config, deviceName, deviceId);

        default:
            logger.warn('Unknown virtual component type: %s', type);
            return null;
    }
}

function composeVirtualComponents(shelly: ShellyDevice): entity_t[] {
    const deviceStatus = shelly.status;
    const deviceConfig = shelly.config;
    const deviceName = shelly.info.name as string;
    const deviceId = shelly.id;

    const entities: entity_t[] = [];

    for (const type of VIRTUAL_TYPES) {
        const allVirtualComponentsKeys = getAllInstancesKeys(
            type,
            deviceStatus
        );

        for (const key of allVirtualComponentsKeys) {
            const config = deviceConfig[key];

            const entity: entity_t | null = composeDynamicComponent(
                type,
                config,
                deviceName,
                deviceId
            );

            if (entity) {
                entities.push(entity);
            }
        }
    }

    return entities;
}

// ----------------------------------------------------------------------------------
// Build-in Components
// ----------------------------------------------------------------------------------

function composeComponents(
    shelly: ShellyDevice,
    type: string,
    title: string,
    parser?: (config: any, status: any) => Record<string, number | string>
): entity_t[] {
    const keys = Object.keys(shelly.status).filter((key) =>
        key.startsWith(`${type}:`)
    );

    return keys.map((key) => {
        const entity_status = shelly.status[key];
        const entity_config = shelly.config[key];
        const device_name = shelly.info.name;

        const name =
            typeof entity_config?.name === 'string' && entity_config.name
                ? entity_config.name
                : `${
                      (keys.length > 1 ? `${entity_status.id}) ` : '') +
                      (title || type)
                  } ${device_name || String(shelly.id)}`;

        let restProps = null;
        try {
            if (typeof parser === 'function') {
                restProps = parser(entity_config, entity_status) ?? {};
            }
        } catch (e) {
            logger.error(`Error parsing ${key}`, e);
        }

        return {
            name,
            id: `${shelly.shellyID}_${entity_status.id}:${type}`,
            type: type as any,
            source: shelly.shellyID,
            properties: {
                id: entity_status.id,
                ...(restProps ?? {})
            }
        };
    });
}

function composeInputs(shelly: ShellyDevice): entity_t[] {
    return composeComponents(shelly, 'input', 'Input', (config, status) => {
        const type = config.type;

        let unit = '';

        if (type === 'analog') {
            unit = config?.xpercent?.unit || '%';
        }

        return {
            type,
            unit
        };
    });
}

function proposeOutputs(shelly: ShellyDevice): switch_entity[] {
    const switch_keys = Object.keys(shelly.status).filter((elem) =>
        elem.startsWith('switch:')
    );
    return switch_keys.map((key) => {
        const entity_status = shelly.status[key];
        const entity_config = shelly.config[key];
        const device_name = shelly.info.name;

        return {
            name:
                typeof entity_config?.name === 'string' && entity_config.name
                    ? entity_config.name
                    : (switch_keys.length > 1
                          ? `${entity_status.id}) Output `
                          : '') + (device_name || shelly.shellyID),
            id: `${shelly.shellyID}_${entity_status.id}:out`,
            type: 'switch',
            source: shelly.shellyID,
            properties: {
                id: entity_status.id
            }
        };
    });
}

function proposeTemperatures(shelly: ShellyDevice): temperature_entity[] {
    const temperature_keys = Object.keys(shelly.status).filter((elem) =>
        elem.startsWith('temperature:')
    );
    return temperature_keys.map((key) => {
        const entity_status = shelly.status[key];
        const device_name = shelly.info.name;

        return {
            name:
                (temperature_keys.length > 1
                    ? `${entity_status.id}) Temperature `
                    : '') + (device_name || shelly.shellyID),
            id: `${shelly.shellyID}_${entity_status.id}:temp`,
            type: 'temperature',
            source: shelly.shellyID,
            properties: {
                id: entity_status.id
            }
        };
    });
}

function proposeEM1(shelly: ShellyDevice): em1_entity[] {
    const em1_keys = Object.keys(shelly.status).filter((elem) =>
        elem.startsWith('em1:')
    );
    return em1_keys.map((key) => {
        const entity_status = shelly.status[key];
        const device_name = shelly.info.name;

        return {
            name:
                (em1_keys.length > 1
                    ? `${entity_status.id}) Energy Meter `
                    : '') + (device_name || shelly.shellyID),
            id: `${shelly.shellyID}_${entity_status.id}:em1`,
            type: 'em1',
            source: shelly.shellyID,
            properties: {
                id: entity_status.id
            }
        };
    });
}

function proposeLights(shelly: ShellyDevice): light_entity[] {
    const light_keys = Object.keys(shelly.status).filter((elem) =>
        elem.startsWith('light:')
    );
    return light_keys.map((key) => {
        const entity_status = shelly.status[key];
        const entity_config = shelly.config[key];
        const device_name = shelly.info.name;

        return {
            name:
                typeof entity_config?.name === 'string' && entity_config.name
                    ? entity_config.name
                    : (light_keys.length > 1
                          ? `${entity_status.id}) Light `
                          : '') + (device_name || shelly.shellyID),
            id: `${shelly.shellyID}_${entity_status.id}:light`,
            type: 'light',
            source: shelly.shellyID,
            properties: {
                id: entity_status.id
            }
        };
    });
}

function composeCovers(shelly: ShellyDevice): cover_entity[] {
    const covers = composeComponents(
        shelly,
        'cover',
        'Cover'
    ) as cover_entity[];

    const sysConfig = shelly.config.sys;

    covers.forEach((cover) => {
        const key =
            cover.properties.id === 0 ? 'cover' : `cover${cover.properties.id}`;
        const favorites =
            sysConfig.ui_data?.[key]
                ?.split(',')
                ?.map(Number)
                ?.filter((x: number) => x >= 0 && x <= 100)
                ?.sort((a: number, b: number) => a - b) ?? [];

        cover.properties.favorites = [...new Set<number>(favorites)];
    });

    return covers;
}

// ----------------------------------------------------------------------------------
// Cury (Scent Diffuser) Component
// ----------------------------------------------------------------------------------

function composeCury(shelly: ShellyDevice): cury_entity[] {
    const curyKeys = Object.keys(shelly.status).filter((key) =>
        key.startsWith('cury:')
    );
    return curyKeys.map((key) => {
        const entityStatus = shelly.status[key];
        const entityConfig = shelly.config[key];
        const deviceName = shelly.info.name;

        return {
            name:
                entityConfig?.name ||
                (curyKeys.length > 1
                    ? `${entityStatus.id}) Cury `
                    : 'Scent Diffuser ') + (deviceName || shelly.shellyID),
            id: `${shelly.shellyID}_${entityStatus.id}:cury`,
            type: 'cury' as const,
            source: shelly.shellyID,
            properties: {
                id: entityStatus.id,
                mode: entityStatus.mode,
                awayMode: entityStatus.away_mode
            }
        };
    });
}

// ----------------------------------------------------------------------------------
// Humidity Component
// ----------------------------------------------------------------------------------

function composeHumidity(shelly: ShellyDevice): humidity_entity[] {
    const humidityKeys = Object.keys(shelly.status).filter((key) =>
        key.startsWith('humidity:')
    );
    return humidityKeys.map((key) => {
        const entityStatus = shelly.status[key];
        const deviceName = shelly.info.name;

        return {
            name:
                (humidityKeys.length > 1
                    ? `${entityStatus.id}) Humidity `
                    : 'Humidity ') + (deviceName || shelly.shellyID),
            id: `${shelly.shellyID}_${entityStatus.id}:humidity`,
            type: 'humidity' as const,
            source: shelly.shellyID,
            properties: {
                id: entityStatus.id
            }
        };
    });
}

// ----------------------------------------------------------------------------------
// Voltmeter Component
// ----------------------------------------------------------------------------------

function composeVoltmeter(shelly: ShellyDevice): voltmeter_entity[] {
    const voltmeterKeys = Object.keys(shelly.status).filter((key) =>
        key.startsWith('voltmeter:')
    );
    return voltmeterKeys.map((key) => {
        const entityStatus = shelly.status[key];
        const entityConfig = shelly.config[key];
        const deviceName = shelly.info.name;

        return {
            name:
                entityConfig?.name ||
                (voltmeterKeys.length > 1
                    ? `${entityStatus.id}) Voltmeter `
                    : 'Voltmeter ') + (deviceName || shelly.shellyID),
            id: `${shelly.shellyID}_${entityStatus.id}:voltmeter`,
            type: 'voltmeter' as const,
            source: shelly.shellyID,
            properties: {
                id: entityStatus.id
            }
        };
    });
}

// ----------------------------------------------------------------------------------
// CCT (Color Temperature) Component - for devices like ShellyDuoBulbG3
// ----------------------------------------------------------------------------------

function composeCCT(shelly: ShellyDevice): cct_entity[] {
    const cctKeys = Object.keys(shelly.status).filter((key) =>
        key.startsWith('cct:')
    );
    return cctKeys.map((key) => {
        const entityStatus = shelly.status[key];
        const entityConfig = shelly.config[key];
        const deviceName = shelly.info.name;

        return {
            name:
                entityConfig?.name ||
                (cctKeys.length > 1
                    ? `${entityStatus.id}) CCT Light `
                    : 'CCT Light ') + (deviceName || shelly.shellyID),
            id: `${shelly.shellyID}_${entityStatus.id}:cct`,
            type: 'cct' as const,
            source: shelly.shellyID,
            properties: {
                id: entityStatus.id
            }
        };
    });
}

// ----------------------------------------------------------------------------------
// RGBCCT Component - for devices like ShellyRGBCCTBulbG3 (RGB + Color Temperature)
// ----------------------------------------------------------------------------------

function composeRGBCCT(shelly: ShellyDevice): rgbcct_entity[] {
    const rgbcctKeys = Object.keys(shelly.status).filter((key) =>
        key.startsWith('rgbcct:')
    );
    return rgbcctKeys.map((key) => {
        const entityStatus = shelly.status[key];
        const entityConfig = shelly.config[key];
        const deviceName = shelly.info.name;

        return {
            name:
                entityConfig?.name ||
                (rgbcctKeys.length > 1
                    ? `${entityStatus.id}) RGBCCT Light `
                    : 'RGBCCT Light ') + (deviceName || shelly.shellyID),
            id: `${shelly.shellyID}_${entityStatus.id}:rgbcct`,
            type: 'rgbcct' as const,
            source: shelly.shellyID,
            properties: {
                id: entityStatus.id
            }
        };
    });
}

// ----------------------------------------------------------------------------------
// Collector function
// ----------------------------------------------------------------------------------

export function proposeEntities(shelly: ShellyDevice): entity_t[] {
    const entities: entity_t[] = [];

    // Debug: log all status keys to help identify component types
    logger.info(
        'Composing entities for %s, status keys: %s',
        shelly.shellyID,
        Object.keys(shelly.status).join(', ')
    );

    entities.push(...composeInputs(shelly));
    entities.push(...proposeOutputs(shelly));
    entities.push(...proposeTemperatures(shelly));
    entities.push(...proposeEM1(shelly));
    entities.push(...composeComponents(shelly, 'em', 'Energy Meter'));
    entities.push(...proposeLights(shelly));

    entities.push(...composeComponents(shelly, 'rgbw', 'RGBW'));
    entities.push(...composeComponents(shelly, 'rgb', 'RGB'));
    entities.push(...composeCCT(shelly));
    entities.push(...composeRGBCCT(shelly));
    entities.push(...composeComponents(shelly, 'pm1', 'Power Meter'));

    entities.push(...composeCovers(shelly));

    // Cury (Scent Diffuser)
    entities.push(...composeCury(shelly));

    // Humidity sensors (for Pill DHT22 mode)
    entities.push(...composeHumidity(shelly));

    // Voltmeter (for Pill analog mode)
    entities.push(...composeVoltmeter(shelly));

    entities.push(...composeVirtualComponents(shelly));

    // Debug: log created entities
    logger.info(
        'Created %d entities for %s: %s',
        entities.length,
        shelly.shellyID,
        entities.map((e) => `${e.type}:${e.properties.id}`).join(', ')
    );

    return entities;
}
