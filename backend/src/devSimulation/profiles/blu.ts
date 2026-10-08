import {createHash} from 'node:crypto';
import {
    BLU_DEVICES,
    BLU_TRV_MODEL_ID,
    bthomeObjectInfos
} from '../../config/BTHomeData';
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

// A Shelly gateway also pairs BTHome sensors Shelly does not make. Fleet
// Manager's safety and access templates watch objects (carbon monoxide, gas,
// tamper, lock, occupancy...) that no Shelly BLU device broadcasts, so the
// simulated gateway carries two such sensors. They have no numeric Shelly
// model id; the gateway reports the model string alone, as it does for any
// third-party BTHome device.
const THIRD_PARTY_BTHOME: Readonly<Record<string, {productName: string}>> =
    Object.freeze({
        'BTHOME-SAFETY': {productName: 'BTHome safety sensor'},
        'BTHOME-ACCESS': {productName: 'BTHome access sensor'}
    });

function bluProductInfo(model: string): {
    productName: string;
    modelId?: number;
} {
    const info = BLU_DEVICES[model] ?? THIRD_PARTY_BTHOME[model];
    if (!info) throw new Error(`unknown BLU simulation model: ${model}`);
    return info;
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
        {model: 'SBWS-90CM'},
        {model: 'SBMS-001A'},
        {model: 'BTHOME-SAFETY'},
        {model: 'BTHOME-ACCESS'}
    ]);

export const BLU_SIMULATION_MODELS = Object.freeze(
    BLU_SIMULATION_PRODUCTS.map((product) => product.model)
);

/** BTHome binary objects are uint8 on the wire, not booleans: the BLU
 *  Door/Window page defines object 0x2D as "1 - open, 0 - closed" and the BLU
 *  Motion page defines 0x21 as "1 - motion, 0 - no motion". Emitting a real
 *  boolean would be a shape no BLU device produces. */
const BTHOME_BINARY_ACTIVE = 1;
const BTHOME_BINARY_INACTIVE = 0;

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
    // BTHome v2 object ids; a device block holds nine sensors, so the
    // third-party objects are split over two devices.
    if (model === 'BTHOME-SAFETY') {
        return [
            {
                objectId: 23,
                name: 'Carbon monoxide',
                value: BTHOME_BINARY_INACTIVE
            },
            {objectId: 28, name: 'Gas', value: BTHOME_BINARY_INACTIVE},
            {objectId: 43, name: 'Tamper', value: BTHOME_BINARY_INACTIVE},
            {objectId: 44, name: 'Vibration', value: BTHOME_BINARY_INACTIVE},
            {objectId: 42, name: 'Sound', value: BTHOME_BINARY_INACTIVE},
            {objectId: 18, name: 'CO2', value: 620},
            {objectId: 19, name: 'TVOC', value: 140}
        ];
    }
    if (model === 'BTHOME-ACCESS') {
        return [
            {objectId: 27, name: 'Garage door', value: BTHOME_BINARY_INACTIVE},
            {objectId: 31, name: 'Lock', value: BTHOME_BINARY_ACTIVE},
            {objectId: 35, name: 'Occupancy', value: BTHOME_BINARY_INACTIVE}
        ];
    }
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
    if (model === 'SBMS-001A') {
        return [
            {objectId: 47, name: 'Soil moisture', value: 38},
            {objectId: 2, name: 'Soil temperature', value: 24.7},
            {objectId: 58, name: 'Button', value: 0}
        ];
    }
    if (model === 'SBDW-103C') {
        return [
            {objectId: 45, name: 'Window', value: BTHOME_BINARY_INACTIVE},
            {objectId: 100, name: 'Light level', value: 2},
            {objectId: 63, name: 'Rotation', value: 4}
        ];
    }
    if (model === 'SBDW-002C') {
        return [
            {objectId: 45, name: 'Window', value: BTHOME_BINARY_INACTIVE},
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
            {objectId: 33, name: 'Motion', value: BTHOME_BINARY_ACTIVE},
            {objectId: 100, name: 'Light level', value: 2}
        ];
    }
    if (model === 'SBMO-003Z') {
        return [
            {objectId: 33, name: 'Motion', value: BTHOME_BINARY_ACTIVE},
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

// The gateway's BTHomeSensor status reports a binary object as a boolean
// (shelly-api-docs BTHomeSensor); the uint8 is only on the BLE packet.
function sensorStatusValue(sensor: SensorDefinition): unknown {
    if (bthomeObjectInfos[sensor.objectId]?.type !== 'binary_sensor') {
        return sensor.value;
    }
    return sensor.value === BTHOME_BINARY_ACTIVE || sensor.value === true;
}

function bluetoothAddressToken(index: number): string {
    return `{{BLU_ADDR_${index.toString().padStart(2, '0')}}}`;
}

/** BTHome component ids are firmware-assigned, never chosen by a sensor:
 *  `BTHome.AddDevice` and `BTHome.AddSensor` both accept ids in [200..299]
 *  only. A paired device takes a block so its sensors sit immediately behind
 *  its own component and one gateway can carry several children. */
const BTHOME_ID_BASE = 200;
const BTHOME_ID_BLOCK = 10;

function bthomeDeviceId(index: number): number {
    return BTHOME_ID_BASE + index * BTHOME_ID_BLOCK;
}

/** Component key a paired BLU device itself reports on, battery included. */
export function bthomeDeviceKey(index: number): string {
    return `bthomedevice:${bthomeDeviceId(index)}`;
}

/** Component key a paired BLU device reports one BTHome object on. Read off
 *  the same sensor list the profile is built from, so re-ordering a model's
 *  objects moves the key with it instead of leaving a stale literal behind. */
export function bthomeSensorKey(input: {
    model: string;
    index: number;
    objectId: number;
    objectIndex?: number;
}): string {
    const info = bluProductInfo(input.model);
    const wanted = input.objectIndex ?? 0;
    const sensorIndex = sensorsFor(input.model, info.productName).findIndex(
        (sensor) =>
            sensor.objectId === input.objectId && (sensor.index ?? 0) === wanted
    );
    if (sensorIndex < 0) {
        throw new Error(
            `${input.model} broadcasts no BTHome object ${input.objectId}`
        );
    }
    return `bthomesensor:${bthomeDeviceId(input.index) + sensorIndex + 1}`;
}

/** One paired BLU device in TOKEN form, for a device profile to DECLARE as
 *  its own child: `addr` stays `{{BLU_ADDR_nn}}` so profile expansion mints a
 *  distinct address per copy of the profile.
 *
 *  This is the form a profile must use, and the distinction is not cosmetic.
 *  At profile-definition time a profile's MAC is still the literal string
 *  `{{DEVICE_MAC}}`, so resolving the address there would hash that same
 *  string for every copy — and `bluChildDeviceIds` de-duplicates by address,
 *  so eighteen plugs would silently collapse into ONE BLU child. */
export function bluChildProfileComponents(input: {
    model: string;
    index: number;
    /** Installation-specific label. Product identity remains in meta. */
    displayName?: string;
}): ProfileComponents {
    const info = bluProductInfo(input.model);
    const components: ProfileComponents = {config: {}, status: {}};
    addBTHomeDevice({
        ...components,
        model: input.model,
        productName: info.productName,
        displayName: input.displayName,
        modelId: info.modelId,
        index: input.index
    });
    return components;
}

/** One paired BLU device as a Shelly gateway exposes it: the BTHomeDevice
 *  component plus one BTHomeSensor per object the model broadcasts. Fitting
 *  this onto a mains device is what makes that device a BLU gateway — the
 *  same components the catalog gateway profile carries, one child instead of
 *  eighteen.
 *
 *  Addresses come from the gateway's MAC through the same derivation profile
 *  expansion uses, because a child fitted after expansion has no token pass
 *  left to run. */
export function bluChildComponents(input: {
    model: string;
    index: number;
    gatewayMac: string;
    /** Installation-specific label. Product identity remains in meta. */
    displayName?: string;
}): ProfileComponents {
    const components = bluChildProfileComponents(input);
    const token = bluetoothAddressToken(input.index);
    const addr = bluAddressTokens(input.gatewayMac)[token];
    for (const config of Object.values(components.config)) {
        if (config.addr === token) config.addr = addr;
    }
    return components;
}

function addBTHomeDevice(input: {
    config: Record<string, JsonObject>;
    status: Record<string, JsonObject>;
    model: string;
    productName: string;
    displayName?: string;
    modelId?: number;
    imageModel?: string;
    index: number;
}): void {
    const componentId = bthomeDeviceId(input.index);
    const addr = bluetoothAddressToken(input.index);
    input.config[`bthomedevice:${componentId}`] = {
        id: componentId,
        addr,
        name: input.displayName ?? input.productName,
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
                value: sensorStatusValue(sensor),
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
        pos: 42,
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
        const info = bluProductInfo(model);
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

/** A simulated BLU child's BLE address: '02' marks it locally administered,
 *  the next four bytes identify the gateway, and the last is the child's
 *  pairing index on it.
 *
 *  The four gateway bytes are a digest, not a slice of the MAC, because a slice
 *  loses information a BLU child cannot afford to lose. Six MAC bytes do not
 *  fit in four, and the slice this used to take dropped exactly the byte that
 *  separates the product lines: a Shelly 1PM Gen4 (A4010200) and a Shelly Pro
 *  1PM (A2010200) minted identical child addresses, so a display case's probe
 *  and a freezer island's probe promoted as ONE device with two gateways
 *  writing over each other. */
const BLU_ADDRESS_LOCALLY_ADMINISTERED = '02';
const BLU_ADDRESS_GATEWAY_BYTES = 4;

export function bluAddressTokens(
    mac: string
): Readonly<Record<string, string>> {
    const digest = createHash('sha256').update(mac).digest('hex');
    const gateway = Array.from({length: BLU_ADDRESS_GATEWAY_BYTES}, (_, byte) =>
        digest.slice(byte * 2, byte * 2 + 2).toUpperCase()
    );
    return Object.fromEntries(
        BLU_SIMULATION_PRODUCTS.map((_, index) => {
            const suffix = index.toString(16).toUpperCase().padStart(2, '0');
            const addr = [
                BLU_ADDRESS_LOCALLY_ADMINISTERED,
                ...gateway,
                suffix
            ].join(':');
            return [bluetoothAddressToken(index), addr];
        })
    );
}
