import {
    EM_PHASES,
    lightingPower,
    NOMINAL_FREQUENCY_HZ,
    neutralCurrent,
    type PhasorReading,
    powerTriangle,
    round
} from '../electrical';
import type {DeviceProfile, JsonObject} from '../types';

export const DEVICE_ID = '{{DEVICE_ID}}';
export const DEVICE_MAC = '{{DEVICE_MAC}}';
export const DEVICE_NAME = '{{DEVICE_NAME}}';

const DEVICE_UNIXTIME = 1_783_943_200;
/** The timestamp Shelly stamps on `aenergy.by_minute`. */
const DEVICE_MINUTE_TS = Math.floor(DEVICE_UNIXTIME / 60) * 60;

/** `aenergy.by_minute` is in milliwatt-hours, one entry per minute. */
function minuteEnergyWindow(power: number): number[] {
    const perMinute = round((power * 1000) / 60);
    return [perMinute, perMinute, perMinute];
}

function activeEnergy(total: number, power: number): JsonObject {
    return {
        total: round(total, 3),
        by_minute: minuteEnergyWindow(power),
        minute_ts: DEVICE_MINUTE_TS
    };
}

const BASE_METHODS = [
    'Shelly.GetDeviceInfo',
    'Shelly.GetStatus',
    'Shelly.GetConfig',
    'Shelly.GetComponents',
    'Shelly.ListMethods',
    'Schedule.List',
    'Schedule.Create',
    'Schedule.Update',
    'Schedule.Delete',
    'Schedule.DeleteAll',
    'Webhook.List',
    'Webhook.ListSupported',
    'Webhook.ListAllSupported',
    'Webhook.Create',
    'Webhook.Update',
    'Webhook.Delete',
    'Webhook.DeleteAll'
] as const;

const NAMESPACES: Readonly<Record<string, string>> = {
    ble: 'BLE',
    blugw: 'BluGw',
    blutrv: 'BluTrv',
    bthome: 'BTHome',
    bthomedevice: 'BTHomeDevice',
    bthomesensor: 'BTHomeSensor',
    cb: 'CB',
    cct: 'CCT',
    cloud: 'Cloud',
    cover: 'Cover',
    devicepower: 'DevicePower',
    em: 'EM',
    em1: 'EM1',
    em1data: 'EM1Data',
    emdata: 'EMData',
    eth: 'Eth',
    flood: 'Flood',
    ht_ui: 'HT_UI',
    humidity: 'Humidity',
    illuminance: 'Illuminance',
    input: 'Input',
    light: 'Light',
    mbrtuclient: 'MbRtuClient',
    modbus: 'Modbus',
    mqtt: 'Mqtt',
    pill: 'Pill',
    plugs_ui: 'PLUGS_UI',
    plugpm_ui: 'PLUGPM_UI',
    pm1: 'PM1',
    powerstrip_ui: 'POWERSTRIP_UI',
    presence: 'Presence',
    presencezone: 'PresenceZone',
    pro_rgbwwpm: 'ProRGBWWPM',
    rgb: 'RGB',
    rgbcct: 'RGBCCT',
    serial: 'Serial',
    smoke: 'Smoke',
    switch: 'Switch',
    sys: 'Sys',
    temperature: 'Temperature',
    ui: 'Ui',
    voltmeter: 'Voltmeter',
    wifi: 'Wifi',
    ws: 'WS',
    // Virtual (dynamic) components: user-defined controls layered on a device
    // through the Shelly virtual-component API. Unlike the hardware namespaces
    // above they are created at runtime and each carries a `meta.ui.view`.
    boolean: 'Boolean',
    button: 'Button',
    enum: 'Enum',
    group: 'Group',
    number: 'Number',
    object: 'Object',
    text: 'Text'
};

const STATE_METHODS: Readonly<Record<string, readonly string[]>> = {
    blutrv: ['Call'],
    cb: ['Set'],
    cct: ['Set', 'Toggle'],
    cover: ['Open', 'Close', 'Stop', 'GoToPosition'],
    light: ['Set', 'Toggle'],
    rgb: ['Set', 'Toggle'],
    rgbcct: ['Set', 'Toggle'],
    // Smoke has no setter; the one action it takes is silencing the sounder.
    smoke: ['Mute'],
    switch: ['Set', 'Toggle'],
    // Virtual components take a value through <Namespace>.Set; a button fires
    // <Namespace>.Trigger instead.
    boolean: ['Set'],
    button: ['Trigger'],
    enum: ['Set'],
    group: ['Set'],
    number: ['Set'],
    object: ['Set'],
    text: ['Set']
};

const EXTRA_METHODS: Readonly<Record<string, readonly string[]>> = {
    blutrv: ['CheckForUpdates', 'UpdateFirmware', 'Delete'],
    // A gateway unpairs a BLU device on request, as firmware does.
    bthome: ['DeleteDevice'],
    em1data: ['GetData'],
    emdata: ['GetData']
};

export interface ProfileComponents {
    config: Record<string, JsonObject>;
    status: Record<string, JsonObject>;
}

export interface ProfileIdentity {
    key: string;
    displayName: string;
    idPrefix: string;
    macPrefix: string;
    model: string;
    gen: 2 | 3 | 4;
    app: string;
    sourceUrl: string;
    profile?: string;
}

interface ConnectivityOptions {
    bthome?: boolean;
    eth?: boolean;
    modbus?: boolean;
}

interface ProfileOptions {
    identity: ProfileIdentity;
    components: ProfileComponents;
    connectivity?: ConnectivityOptions;
    initialNotificationMethod?: 'NotifyFullStatus' | 'NotifyStatus';
}

function namespaceFor(componentKey: string): string {
    const base = componentKey.split(':', 1)[0];
    const namespace = NAMESPACES[base];
    if (!namespace) throw new Error(`unsupported simulator component: ${base}`);
    return namespace;
}

function buildMethods(components: ProfileComponents): string[] {
    const methods = new Set<string>(BASE_METHODS);
    const configKeys = Object.keys(components.config);
    const statusKeys = Object.keys(components.status);
    const bases = new Set(
        [...configKeys, ...statusKeys].map((key) => key.split(':', 1)[0])
    );

    for (const base of bases) {
        const namespace = namespaceFor(base);
        if (statusKeys.some((key) => key.split(':', 1)[0] === base)) {
            methods.add(`${namespace}.GetStatus`);
        }
        if (configKeys.some((key) => key.split(':', 1)[0] === base)) {
            methods.add(`${namespace}.GetConfig`);
            methods.add(`${namespace}.SetConfig`);
        }
        for (const operation of STATE_METHODS[base] ?? []) {
            methods.add(`${namespace}.${operation}`);
        }
        for (const operation of EXTRA_METHODS[base] ?? []) {
            methods.add(`${namespace}.${operation}`);
        }
    }
    return [...methods].sort();
}

function profileComponents(components: ProfileComponents): JsonObject[] {
    const counts = new Map<string, number>();
    for (const key of [
        ...Object.keys(components.config),
        ...Object.keys(components.status)
    ]) {
        if (!key.includes(':')) continue;
        const type = key.split(':', 1)[0];
        counts.set(
            type,
            Math.max(counts.get(type) ?? 0, Number(key.split(':')[1]) + 1)
        );
    }
    return [...counts].map(([type, count]) => ({type, count}));
}

function networkComponents(options: ConnectivityOptions): ProfileComponents {
    const config: Record<string, JsonObject> = {
        sys: {
            device: {
                name: DEVICE_NAME,
                mac: DEVICE_MAC,
                discoverable: true,
                eco_mode: false
            },
            location: {tz: 'Europe/Sofia', lat: 42.6977, lon: 23.3219}
        },
        wifi: {
            ap: {ssid: DEVICE_NAME, is_open: true, enable: false},
            sta: {
                ssid: 'Fleet Simulator',
                is_open: false,
                enable: true,
                ipv4mode: 'dhcp'
            },
            sta1: {ssid: null, is_open: true, enable: false},
            roam: {rssi_thr: -80, interval: 60}
        },
        ble: {enable: true, rpc: {enable: false}},
        cloud: {enable: false, server: 'iot.shelly.cloud:6012/jrpc'},
        mqtt: {
            enable: false,
            server: null,
            client_id: DEVICE_ID,
            topic_prefix: DEVICE_ID,
            enable_rpc: true,
            enable_control: true
        },
        ws: {enable: true, server: 'ws://fleet-manager/shelly'}
    };
    const status: Record<string, JsonObject> = {
        sys: {
            mac: DEVICE_MAC,
            restart_required: false,
            time: '12:00',
            unixtime: DEVICE_UNIXTIME,
            uptime: 3600,
            ram_size: 256_000,
            ram_free: 128_000,
            fs_size: 1_048_576,
            fs_free: 524_288,
            cfg_rev: 1,
            device: {name: DEVICE_NAME}
        },
        wifi: {
            sta_ip: '192.0.2.10',
            status: 'got ip',
            ssid: 'Fleet Simulator',
            rssi: -48
        },
        ble: {},
        cloud: {connected: false},
        mqtt: {connected: false},
        ws: {connected: true}
    };
    if (options.eth) {
        config.eth = {enable: true, server_mode: false, ipv4mode: 'dhcp'};
        status.eth = {ip: '192.0.2.20', ip6: null};
    }
    if (options.bthome) {
        config.bthome = {};
        status.bthome = {};
    }
    if (options.modbus) {
        config.modbus = {enable: true};
        status.modbus = {};
    }
    return {config, status};
}

export function mergeComponents(
    ...parts: readonly ProfileComponents[]
): ProfileComponents {
    return {
        config: Object.assign({}, ...parts.map((part) => part.config)),
        status: Object.assign({}, ...parts.map((part) => part.status))
    };
}

/** The method list a component set answers. `selectable` adds the two profile
 *  methods only a device with more than one firmware profile exposes. */
function profileMethods(
    components: ProfileComponents,
    selectable: boolean
): string[] {
    const methods = buildMethods(components);
    if (selectable) methods.push('Shelly.ListProfiles', 'Shelly.SetProfile');
    return [...new Set(methods)].sort();
}

/** Fits extra components onto a built profile and re-derives its method list,
 *  so a deployment can add hardware a stock catalog entry does not carry
 *  without the device answering RPCs it never declared. */
export function withComponents<T extends DeviceProfile>(
    profile: T,
    components: ProfileComponents
): T {
    const merged = mergeComponents(
        {config: profile.config, status: profile.status},
        components
    );
    return {
        ...profile,
        config: merged.config,
        status: merged.status,
        methods: profileMethods(merged, profile.profiles !== undefined)
    };
}

export function makeProfile(options: ProfileOptions): DeviceProfile {
    const connectivity = networkComponents(options.connectivity ?? {});
    const components = mergeComponents(connectivity, options.components);
    const identity = options.identity;
    if (identity.profile) {
        const sysConfig = components.config.sys;
        sysConfig.device = {
            ...(sysConfig.device as JsonObject),
            profile: identity.profile
        };
    }
    const methods = profileMethods(components, identity.profile !== undefined);
    return {
        key: identity.key,
        displayName: identity.displayName,
        idPrefix: identity.idPrefix,
        macPrefix: identity.macPrefix,
        sourcePaths: [identity.sourceUrl],
        initialNotificationMethod:
            options.initialNotificationMethod ?? 'NotifyFullStatus',
        info: {
            id: DEVICE_ID,
            name: DEVICE_NAME,
            mac: DEVICE_MAC,
            model: identity.model,
            gen: identity.gen,
            fw_id: '20260701/shelly-os',
            ver: '1.7.5',
            app: identity.app,
            auth_en: false,
            provision: 'complete',
            ...(identity.profile ? {profile: identity.profile} : {})
        },
        methods,
        ...(identity.profile
            ? {
                  profiles: {
                      [identity.profile]: {
                          components: profileComponents(components)
                      }
                  }
              }
            : {}),
        config: components.config,
        status: components.status
    };
}

function inputConfig(id: number): JsonObject {
    return {id, name: `Input ${id + 1}`, type: 'switch', invert: false};
}

function switchConfig(id: number): JsonObject {
    return {
        id,
        name: `Output ${id + 1}`,
        in_mode: 'follow',
        initial_state: 'restore_last',
        auto_on: false,
        auto_off: false
    };
}

function switchStatus(id: number, metered: boolean): JsonObject {
    if (!metered) return {id, source: 'init', output: id % 2 === 0};
    const voltage = 230.2;
    // Different appliance mix per output, so no shared phase angle.
    const reading = powerTriangle({
        actPower: 120 + id * 85,
        voltage,
        powerFactor: 0.98 - id * 0.03
    });
    return {
        id,
        source: 'init',
        output: id % 2 === 0,
        apower: reading.actPower,
        voltage,
        current: reading.current,
        freq: NOMINAL_FREQUENCY_HZ,
        pf: reading.powerFactor,
        aenergy: activeEnergy(12_400 + id * 800, reading.actPower),
        temperature: {tC: 38 + id, tF: round(100.4 + id * 1.8, 1)}
    };
}

export function relayComponents(options: {
    outputs: number;
    inputs: number;
    metered: boolean;
}): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < options.outputs; id++) {
        config[`switch:${id}`] = switchConfig(id);
        status[`switch:${id}`] = switchStatus(id, options.metered);
    }
    for (let id = 0; id < options.inputs; id++) {
        config[`input:${id}`] = inputConfig(id);
        status[`input:${id}`] = {id, state: false};
    }
    return {config, status};
}

/** Which "shown if applicable" metering fields each light component documents.
 *  Light/RGB/RGBW: apower, voltage, current, aenergy, temperature. CCT: the
 *  same minus aenergy — its status table has no energy counter. RGBCCT: apower
 *  and aenergy only, no line or temperature properties at all. */
const LIGHT_METERING: Readonly<Record<string, readonly string[]>> = {
    light: ['line', 'energy', 'temperature'],
    rgb: ['line', 'energy', 'temperature'],
    rgbw: ['line', 'energy', 'temperature'],
    cct: ['line', 'temperature'],
    rgbcct: ['energy']
};

/** Constant-voltage LED rail. `RGB.GetStatus` on a real RGBW PM reads 12.1 V. */
export const LED_RAIL_VOLTAGE_V = 12.1;

/** A mains dimmer feeds an LED lamp through its own driver, not a resistor. */
const LED_LAMP_POWER_FACTOR = 0.89;

interface LightMeteringSpec {
    namespace: string;
    brightness: number;
    ratedPower: number;
    voltage: number;
    /** DC rails carry no phase angle, so their apparent power equals active. */
    powerFactor: number;
    energyTotal?: number;
    temperatureC?: number;
}

function lightMeteringStatus(spec: LightMeteringSpec): JsonObject {
    const fields = LIGHT_METERING[spec.namespace];
    if (!fields) {
        throw new Error(`no light metering model for: ${spec.namespace}`);
    }
    if (fields.includes('energy') && spec.energyTotal === undefined) {
        throw new Error(`${spec.namespace} reports aenergy but has no total`);
    }
    if (fields.includes('temperature') && spec.temperatureC === undefined) {
        throw new Error(`${spec.namespace} reports temperature but has none`);
    }
    const reading = powerTriangle({
        actPower: lightingPower({
            ratedPower: spec.ratedPower,
            brightnessPercent: spec.brightness
        }),
        voltage: spec.voltage,
        powerFactor: spec.powerFactor
    });
    const status: JsonObject = {apower: reading.actPower};
    if (fields.includes('line')) {
        status.voltage = spec.voltage;
        status.current = reading.current;
    }
    if (fields.includes('energy')) {
        status.aenergy = activeEnergy(spec.energyTotal ?? 0, reading.actPower);
    }
    if (fields.includes('temperature')) {
        const tC = spec.temperatureC ?? 0;
        status.temperature = {tC, tF: round((tC * 9) / 5 + 32, 1)};
    }
    return status;
}

/** The `rgb:0` + `cct:0` pair a Pro RGBWW PM exposes in its `rgbcct` profile,
 *  both driving constant-voltage strips off the same LED rail. */
export function ledStripComponents(): ProfileComponents {
    return {
        config: {
            'rgb:0': {id: 0, name: 'RGB strip'},
            'cct:0': {id: 0, name: 'White strip'},
            pro_rgbwwpm: {hf_mode: false}
        },
        status: {
            'rgb:0': {
                id: 0,
                source: 'init',
                output: true,
                brightness: 70,
                rgb: [85, 30, 15],
                ...lightMeteringStatus({
                    namespace: 'rgb',
                    brightness: 70,
                    ratedPower: 48,
                    voltage: LED_RAIL_VOLTAGE_V,
                    powerFactor: 1,
                    energyTotal: 1284.6,
                    temperatureC: 53.1
                })
            },
            'cct:0': {
                id: 0,
                source: 'init',
                output: true,
                brightness: 62,
                ct: 3600,
                ...lightMeteringStatus({
                    namespace: 'cct',
                    brightness: 62,
                    ratedPower: 36,
                    voltage: LED_RAIL_VOLTAGE_V,
                    powerFactor: 1,
                    temperatureC: 49.4
                })
            },
            pro_rgbwwpm: {}
        }
    };
}

function lightConfig(id: number): JsonObject {
    return {
        id,
        name: `Light ${id + 1}`,
        in_mode: 'dim',
        initial_state: 'restore_last',
        transition_duration: 1,
        night_mode: {enable: false, brightness: 20}
    };
}

function lightStatus(id: number, metered: boolean): JsonObject {
    const brightness = 65 - id * 10;
    const state: JsonObject = {
        id,
        source: 'init',
        output: true,
        brightness
    };
    if (!metered) return state;
    return {
        ...state,
        // Light.GetStatus has no `pf`; the phase angle shows only in current.
        ...lightMeteringStatus({
            namespace: 'light',
            brightness,
            ratedPower: 45 + id * 10,
            voltage: 230.2,
            powerFactor: LED_LAMP_POWER_FACTOR,
            energyTotal: 842.3 + id * 120,
            temperatureC: 41.2 + id * 1.5
        })
    };
}

export function dimmerComponents(options: {
    lights: number;
    inputs: number;
    metered: boolean;
}): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < options.lights; id++) {
        config[`light:${id}`] = lightConfig(id);
        status[`light:${id}`] = lightStatus(id, options.metered);
    }
    for (let id = 0; id < options.inputs; id++) {
        config[`input:${id}`] = {...inputConfig(id), type: 'button'};
        status[`input:${id}`] = {id, state: null};
    }
    return {config, status};
}

export function coverComponents(options: {
    covers: number;
    inputs: number;
}): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < options.covers; id++) {
        config[`cover:${id}`] = {
            id,
            name: `Cover ${id + 1}`,
            in_mode: 'dual',
            initial_state: 'stopped',
            maxtime_open: 45,
            maxtime_close: 45,
            motor: {idle_power_thr: 2, idle_confirm_period: 0.25}
        };
        // Stopped motor: Shelly reports pf 0, not a stale angle.
        status[`cover:${id}`] = {
            id,
            source: 'init',
            state: 'stopped',
            apower: 0,
            voltage: 230.4,
            current: 0,
            pf: 0,
            freq: NOMINAL_FREQUENCY_HZ,
            current_pos: 35 + id * 25,
            pos_control: true,
            last_direction: id % 2 === 0 ? 'open' : 'close',
            aenergy: activeEnergy(194.2 + id * 40, 0)
        };
    }
    for (let id = 0; id < options.inputs; id++) {
        config[`input:${id}`] = inputConfig(id);
        status[`input:${id}`] = {id, state: false};
    }
    return {config, status};
}

/** The generation channel: it exports, so its active power is negative. */
const EXPORTING_EM1_CHANNEL = 1;

function em1Components(channels: number): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < channels; id++) {
        const exporting = id === EXPORTING_EM1_CHANNEL;
        const voltage = 230.2;
        const reading = powerTriangle({
            actPower: (exporting ? -1 : 1) * (920 + id * 210),
            voltage,
            powerFactor: 0.96 - id * 0.02
        });
        config[`em1:${id}`] = {id, name: `Energy channel ${id + 1}`};
        config[`em1data:${id}`] = {};
        status[`em1:${id}`] = {
            id,
            current: reading.current,
            voltage,
            act_power: reading.actPower,
            aprt_power: reading.aprtPower,
            pf: reading.powerFactor,
            freq: NOMINAL_FREQUENCY_HZ,
            calibration: 'factory'
        };
        status[`em1data:${id}`] = {
            id,
            total_act_energy: 91_842 + id * 10_000,
            total_act_ret_energy: exporting ? 680 : 0
        };
    }
    return {config, status};
}

/** Unequal loads on unequal phase angles, which puts current in the neutral. */
const THREE_PHASE_SUPPLY = [
    {actPower: 921, voltage: 230.4, powerFactor: 0.96},
    {actPower: 825, voltage: 229.8, powerFactor: 0.92},
    {actPower: 1126, voltage: 231, powerFactor: 0.98}
] as const;

function threePhaseStatus(): JsonObject {
    const status: JsonObject = {id: 0};
    const readings: PhasorReading[] = [];
    for (const [index, phase] of EM_PHASES.entries()) {
        const supply = THREE_PHASE_SUPPLY[index];
        const reading = powerTriangle(supply);
        status[`${phase}_current`] = reading.current;
        status[`${phase}_voltage`] = supply.voltage;
        status[`${phase}_act_power`] = reading.actPower;
        status[`${phase}_aprt_power`] = reading.aprtPower;
        status[`${phase}_pf`] = reading.powerFactor;
        status[`${phase}_freq`] = NOMINAL_FREQUENCY_HZ;
        readings.push(reading);
    }
    status.n_current = neutralCurrent(readings);
    status.total_current = round(
        readings.reduce((sum, reading) => sum + reading.current, 0),
        3
    );
    status.total_act_power = round(
        readings.reduce((sum, reading) => sum + reading.actPower, 0)
    );
    status.total_aprt_power = round(
        readings.reduce((sum, reading) => sum + reading.aprtPower, 0)
    );
    status.user_calibrated_phase = [];
    return status;
}

/** A three-phase meter reports through EM/EMData, a single-phase one through
 *  EM1/EM1Data — never both. Real firmware picks by profile: `em1:*` and
 *  `em1data:*` exist ONLY in the `monophase` profile (Shelly Pro 3EM docs),
 *  and every three-phase profile here declares `triphase`. Emitting both made
 *  one meter report its energy twice, under two different keys. */
export function energyMeterComponents(options: {
    channels: number;
    threePhase?: boolean;
    relay?: boolean;
}): ProfileComponents {
    const parts: ProfileComponents[] = options.threePhase
        ? []
        : [em1Components(options.channels)];
    if (options.relay) {
        parts.push(relayComponents({outputs: 1, inputs: 0, metered: false}));
    }
    if (options.threePhase) {
        parts.push({
            config: {
                'em:0': {id: 0, name: 'Three-phase supply'},
                'emdata:0': {}
            },
            status: {
                'em:0': threePhaseStatus(),
                'emdata:0': {
                    id: 0,
                    a_total_act_energy: 182_450,
                    a_total_act_ret_energy: 4,
                    b_total_act_energy: 173_220,
                    b_total_act_ret_energy: 3,
                    c_total_act_energy: 201_110,
                    c_total_act_ret_energy: 4,
                    total_act: 556_780,
                    total_act_ret: 11
                }
            }
        });
    }
    return mergeComponents(...parts);
}

export function pmComponents(channels = 1): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < channels; id++) {
        const voltage = 230.2;
        const reading = powerTriangle({
            actPower: 540 + id * 120,
            voltage,
            powerFactor: 0.94 - id * 0.02
        });
        config[`pm1:${id}`] = {id, name: `Power meter ${id + 1}`};
        // PM1 spells it `aprtpower`, no underscore.
        status[`pm1:${id}`] = {
            id,
            voltage,
            current: reading.current,
            apower: reading.actPower,
            aprtpower: reading.aprtPower,
            pf: reading.powerFactor,
            freq: NOMINAL_FREQUENCY_HZ,
            aenergy: activeEnergy(42_840 + id * 900, reading.actPower)
        };
    }
    return {config, status};
}

export function inputComponents(count: number): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < count; id++) {
        config[`input:${id}`] = inputConfig(id);
        status[`input:${id}`] = {id, state: id === 0};
    }
    return {config, status};
}

export function climateComponents(): ProfileComponents {
    return {
        config: {
            'temperature:0': {id: 0, name: 'Temperature', report_thr_C: 0.5},
            'humidity:0': {id: 0, name: 'Humidity', report_thr: 5},
            'devicepower:0': {id: 0},
            ht_ui: {clock: '24', temperature_unit: 'C'}
        },
        status: {
            'temperature:0': {id: 0, tC: 23.4, tF: 74.1},
            'humidity:0': {id: 0, rh: 47.2},
            'devicepower:0': {
                id: 0,
                battery: {V: 3.6, percent: 84},
                external: {present: false}
            },
            ht_ui: {}
        }
    };
}

/** E27 bulb. `metered` is per device, not per component: the Duo Bulb's own
 *  `CCT.GetStatus` response carries no electrical fields, while the RGBCCT
 *  Bulb's carries `apower` and `aenergy.total`. */
export function bulbComponents(options: {
    kind: 'cct' | 'rgbcct';
    metered: boolean;
}): ProfileComponents {
    const {kind} = options;
    const brightness = 72;
    return {
        config: {
            [`${kind}:0`]: {
                id: 0,
                name: 'Bulb',
                initial_state: 'restore_last',
                transition_duration: 1
            }
        },
        status: {
            [`${kind}:0`]: {
                id: 0,
                source: 'init',
                output: true,
                brightness,
                // Only RGBCCT reports `mode`.
                ...(kind === 'cct'
                    ? {ct: 3500}
                    : {mode: 'rgb', rgb: [80, 35, 20], white: 35, ct: 3500}),
                ...(options.metered
                    ? lightMeteringStatus({
                          namespace: kind,
                          brightness,
                          ratedPower: 9,
                          voltage: 230.2,
                          powerFactor: LED_LAMP_POWER_FACTOR,
                          energyTotal: 214.6
                      })
                    : {})
            }
        }
    };
}

export function floodComponents(): ProfileComponents {
    return {
        config: {
            'flood:0': {id: 0, name: 'Leak sensor', alarm_mode: 'normal'},
            'devicepower:0': {id: 0}
        },
        status: {
            'flood:0': {id: 0, alarm: false, mute: false, errors: []},
            'devicepower:0': {
                id: 0,
                battery: {V: 3.7, percent: 92},
                external: {present: false}
            }
        }
    };
}

/** Shelly Plus Smoke. `Smoke.GetStatus` returns exactly `{id, alarm, mute}` —
 *  no concentration, no temperature — so the simulated component carries those
 *  three fields and nothing invented alongside them. The device is battery
 *  powered, which is what DevicePower reports. */
export function smokeComponents(): ProfileComponents {
    return {
        config: {
            'smoke:0': {id: 0, name: 'Smoke sensor'},
            'devicepower:0': {id: 0}
        },
        status: {
            'smoke:0': {id: 0, alarm: false, mute: false},
            'devicepower:0': {
                id: 0,
                battery: {V: 3, percent: 88},
                external: {present: false}
            }
        }
    };
}

/** Firmware gives an add-on board component ids in [100..199] and keeps
 *  [0..99] for the device's own peripherals, so an add-on reading can never be
 *  read as one the device measures itself. Both add-on pages state the split. */
export const ADDON_COMPONENT_ID_BASE = 100;

/** `Sys.SetConfig device.addon_type` — firmware only spawns the components
 *  below while the board is declared, so a profile that carries add-on
 *  components without this would be a device state no firmware produces. */
export const ADDON_TYPE_SENSOR = 'sensor';

/** A DS18B20 on the add-on's one-wire bus, as a Temperature component. */
export function addonTemperatureComponents(options: {
    id?: number;
    name: string;
    tC: number;
    oneWireAddress: string;
}): ProfileComponents {
    const id = options.id ?? ADDON_COMPONENT_ID_BASE;
    return {
        config: {
            [`temperature:${id}`]: {
                id,
                name: options.name,
                report_thr_C: 0.5,
                addr: options.oneWireAddress
            }
        },
        status: {
            [`temperature:${id}`]: {
                id,
                tC: options.tC,
                tF: round((options.tC * 9) / 5 + 32, 1)
            }
        }
    };
}

/** A dry contact on the add-on's digital input, as an Input component. */
export function addonInputComponents(options: {
    id?: number;
    name: string;
    state: boolean;
}): ProfileComponents {
    const id = options.id ?? ADDON_COMPONENT_ID_BASE;
    return {
        config: {
            [`input:${id}`]: {
                id,
                name: options.name,
                type: 'switch',
                invert: false
            }
        },
        status: {[`input:${id}`]: {id, state: options.state}}
    };
}

export function presenceComponents(): ProfileComponents {
    return {
        config: {
            presence: {
                enable: true,
                num_tracks: 6,
                main_zone: 'presencezone:200'
            },
            'presencezone:200': {id: 200, name: 'Whole room', enable: true},
            'presencezone:201': {id: 201, name: 'Desk area', enable: true},
            'illuminance:0': {id: 0, name: 'Ambient light'}
        },
        status: {
            presence: {},
            'presencezone:200': {id: 200, value: true, num_objects: 2},
            'presencezone:201': {id: 201, value: true, num_objects: 1},
            'illuminance:0': {id: 0, lux: 184, illumination: 'bright'}
        }
    };
}

export function uiComponents(key = 'ui'): ProfileComponents {
    return {
        config: {[key]: {idle_brightness: 30}},
        status: {[key]: {}}
    };
}
