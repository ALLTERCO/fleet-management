import {BLU_DEVICES, BLU_TRV_MODEL_ID} from '../../config/BTHomeData';
import type {DeviceProfile, JsonObject} from '../types';
import {makeProfile, type ProfileComponents} from './shared';

interface SensorDefinition {
    objectId: number;
    name: string;
    value: unknown;
    index?: number;
}

interface BluSimulationProduct {
    model: string;
    productName?: string;
    imageModel?: string;
}

// Protocol identities stay canonical in BLU_DEVICES. Presentation variants
// may share one identity while using a distinct bundled product image.
export const BLU_SIMULATION_PRODUCTS: readonly BluSimulationProduct[] =
    Object.freeze([
        {model: 'SBBT-002C'},
        {
            model: 'SBBT-002C',
            productName: 'Shelly BLU Button Tough 1',
            imageModel: 'SBBT-002C-T-Ivr'
        },
        {model: 'SBDW-002C'},
        {model: 'SBHT-003C'},
        {model: 'SBMO-003Z'},
        {model: 'SBBT-004CEU'},
        {model: 'SBBT-004CUS'},
        {model: 'SBBT-102C'},
        {model: 'SBDI-003E'},
        {model: 'SBDW-103C'},
        {model: 'SBHT-103C'},
        {model: 'SBHT-203C'},
        {model: 'SBMO-103Z'},
        {model: 'SBBT-104CUS'},
        {model: 'SBRC-005B'},
        {model: BLU_TRV_MODEL_ID},
        {model: 'SBBT-104CEU'},
        {model: 'SBWS-90CM'}
    ]);

export const BLU_SIMULATION_MODELS = Object.freeze(
    BLU_SIMULATION_PRODUCTS.map((product) => product.model)
);

function buttonSensors(count: number): SensorDefinition[] {
    return Array.from({length: count}, (_, index) => ({
        objectId: 58,
        index,
        name: `Button ${index + 1}`,
        value: 0
    }));
}

function sensorsFor(model: string, productName: string): SensorDefinition[] {
    if (model === BLU_TRV_MODEL_ID) return [];
    if (model === 'SBWS-90CM') {
        return [
            {objectId: 69, name: 'Outdoor temperature', value: 18.6},
            {objectId: 46, name: 'Humidity', value: 61},
            {objectId: 4, name: 'Pressure', value: 1014.2},
            {objectId: 5, name: 'Illuminance', value: 9400},
            {objectId: 8, name: 'Dew point', value: 11.1},
            {objectId: 32, name: 'Rain status', value: false},
            {objectId: 68, index: 0, name: 'Wind speed', value: 3.4},
            {objectId: 68, index: 1, name: 'Wind gust', value: 6.8},
            {objectId: 94, name: 'Wind direction', value: 245},
            {objectId: 95, name: 'Precipitation', value: 1.2},
            {objectId: 70, name: 'UV index', value: 3.1},
            {objectId: 74, name: 'Capacitor voltage', value: 2.9}
        ];
    }
    if (model === 'SBDW-103C') {
        return [
            {objectId: 45, name: 'Window', value: false},
            {objectId: 100, name: 'Light level', value: 2},
            {objectId: 63, name: 'Rotation', value: 4}
        ];
    }
    if (model === 'SBDW-002C') {
        return [
            {objectId: 45, name: 'Window', value: false},
            {objectId: 5, name: 'Illuminance', value: 96},
            {objectId: 63, name: 'Rotation', value: 4}
        ];
    }
    if (model === 'SBHT-103C') {
        return [
            {objectId: 69, name: 'Temperature', value: 22.8},
            {objectId: 46, name: 'Humidity', value: 48},
            {objectId: 100, name: 'Light level', value: 1},
            {objectId: 58, name: 'Button', value: 0}
        ];
    }
    if (model === 'SBHT-003C' || model === 'SBHT-203C') {
        return [
            {objectId: 69, name: 'Temperature', value: 22.8},
            {objectId: 46, name: 'Humidity', value: 48},
            {objectId: 58, name: 'Button', value: 0}
        ];
    }
    if (model === 'SBMO-103Z') {
        return [
            {objectId: 33, name: 'Motion', value: true},
            {objectId: 100, name: 'Light level', value: 2}
        ];
    }
    if (model === 'SBMO-003Z') {
        return [
            {objectId: 33, name: 'Motion', value: true},
            {objectId: 5, name: 'Illuminance', value: 132}
        ];
    }
    if (productName.includes('Distance')) {
        return [{objectId: 64, name: 'Distance', value: 860}];
    }
    if (model === 'SBRC-005B') {
        return [
            ...buttonSensors(2),
            {objectId: 60, name: 'Dimmer wheel', value: 0},
            {objectId: 63, name: 'Wheel rotation', value: 0},
            {objectId: 96, name: 'Channel', value: 1}
        ];
    }
    const buttonCount =
        productName.includes('Button 4') ||
        productName.includes('Switch 4') ||
        productName.includes('Remote')
            ? 4
            : 1;
    return buttonSensors(buttonCount);
}

function bluetoothAddressToken(index: number): string {
    return `{{BLU_ADDR_${index.toString().padStart(2, '0')}}}`;
}

function addBTHomeDevice(input: {
    config: Record<string, JsonObject>;
    status: Record<string, JsonObject>;
    model: string;
    productName: string;
    modelId?: number;
    imageModel?: string;
    index: number;
}): void {
    const componentId = 200 + input.index * 10;
    const addr = bluetoothAddressToken(input.index);
    input.config[`bthomedevice:${componentId}`] = {
        id: componentId,
        addr,
        name: input.productName,
        key: null,
        meta: {
            productName: input.productName,
            modelId: input.model,
            ...(input.imageModel
                ? {visual: {imageModel: input.imageModel}}
                : {}),
            ...(input.modelId === undefined
                ? {}
                : {numericModelId: input.modelId})
        }
    };
    input.status[`bthomedevice:${componentId}`] = {
        id: componentId,
        rssi: -48 - (input.index % 18),
        battery: 82,
        packet_id: input.index + 1,
        paired: true,
        rpc: false,
        errors: [],
        last_updated_ts: 1_783_943_200
    };

    sensorsFor(input.model, input.productName).forEach(
        (sensor, sensorIndex) => {
            const sensorId = componentId + sensorIndex + 1;
            input.config[`bthomesensor:${sensorId}`] = {
                id: sensorId,
                addr,
                obj_id: sensor.objectId,
                idx: sensor.index ?? 0,
                name: sensor.name
            };
            input.status[`bthomesensor:${sensorId}`] = {
                id: sensorId,
                value: sensor.value,
                last_updated_ts: 1_783_943_200
            };
        }
    );
}

function addBluTrv(
    components: ProfileComponents,
    model: string,
    productName: string,
    index: number
): void {
    const addr = bluetoothAddressToken(index);
    components.config['blutrv:0'] = {
        id: 0,
        addr,
        name: productName,
        model,
        target_C: 21.5
    };
    components.status['blutrv:0'] = {
        id: 0,
        addr,
        target_C: 21.5,
        current_C: 20.8,
        battery: 78,
        valve_position: 42,
        boost: false,
        errors: []
    };
}

function bluCatalogComponents(): ProfileComponents {
    const components: ProfileComponents = {
        config: {blugw: {sys_led_enable: true}},
        status: {blugw: {}}
    };
    BLU_SIMULATION_PRODUCTS.forEach((product, index) => {
        const {model} = product;
        const info = BLU_DEVICES[model];
        if (!info) throw new Error(`unknown BLU simulation model: ${model}`);
        const productName = product.productName ?? info.productName;
        if (model === BLU_TRV_MODEL_ID) {
            addBluTrv(components, model, productName, index);
            return;
        }
        addBTHomeDevice({
            ...components,
            model,
            productName,
            modelId: info.modelId,
            imageModel: product.imageModel,
            index
        });
    });
    return components;
}

export const BLU_GATEWAY_GEN2 = makeProfile({
    identity: {
        key: 'shelly-blu-gateway',
        displayName: 'Shelly BLU Gateway',
        idPrefix: 'shellyblugw',
        macPrefix: 'A2020100',
        model: 'SNGW-BT01',
        gen: 2,
        app: 'Gateway',
        sourceUrl:
            'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2/ShellyBluGw/'
    },
    components: {
        config: {blugw: {sys_led_enable: true}},
        status: {blugw: {}}
    },
    connectivity: {bthome: true}
});

export const BLU_GATEWAY_GEN3 = makeProfile({
    identity: {
        key: 'shelly-blu-gateway-g3',
        displayName: 'Shelly BLU Gateway Gen3',
        idPrefix: 'shellyblugwg3',
        macPrefix: 'A3020100',
        model: 'S3GW-1DBT001',
        gen: 3,
        app: 'BluGwG3',
        sourceUrl:
            'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen3/ShellyBluGwG3/'
    },
    components: bluCatalogComponents(),
    connectivity: {bthome: true}
});

export const BLU_PROFILES: readonly DeviceProfile[] = Object.freeze([
    BLU_GATEWAY_GEN2,
    BLU_GATEWAY_GEN3
]);

export const BLU_SIMULATED_DEVICE_COUNT = BLU_SIMULATION_PRODUCTS.length;

// Used by profile expansion to make each gateway copy own distinct children.
export function bluAddressTokens(
    mac: string
): Readonly<Record<string, string>> {
    return Object.fromEntries(
        BLU_SIMULATION_PRODUCTS.map((_, index) => {
            const suffix = index.toString(16).toUpperCase().padStart(2, '0');
            const addr = [
                '02',
                mac.slice(2, 4),
                mac.slice(4, 6),
                mac.slice(6, 8),
                mac.slice(10, 12),
                suffix
            ].join(':');
            return [bluetoothAddressToken(index), addr];
        })
    );
}
