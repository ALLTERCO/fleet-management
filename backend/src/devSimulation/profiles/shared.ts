import type {DeviceProfile, JsonObject} from '../types';

export const DEVICE_ID = '{{DEVICE_ID}}';
export const DEVICE_MAC = '{{DEVICE_MAC}}';
export const DEVICE_NAME = '{{DEVICE_NAME}}';

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
    switch: 'Switch',
    sys: 'Sys',
    temperature: 'Temperature',
    ui: 'Ui',
    voltmeter: 'Voltmeter',
    wifi: 'Wifi',
    ws: 'WS'
};

const STATE_METHODS: Readonly<Record<string, readonly string[]>> = {
    blutrv: ['Call'],
    cb: ['Set'],
    cct: ['Set', 'Toggle'],
    cover: ['Open', 'Close', 'Stop', 'GoToPosition'],
    light: ['Set', 'Toggle'],
    rgb: ['Set', 'Toggle'],
    rgbcct: ['Set', 'Toggle'],
    switch: ['Set', 'Toggle']
};

const EXTRA_METHODS: Readonly<Record<string, readonly string[]>> = {
    blutrv: ['CheckForUpdates', 'UpdateFirmware', 'Delete'],
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
            unixtime: 1_783_943_200,
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
    const methods = buildMethods(components);
    if (identity.profile) {
        methods.push('Shelly.ListProfiles', 'Shelly.SetProfile');
        methods.sort();
    }
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
    return {
        id,
        source: 'init',
        output: id % 2 === 0,
        ...(metered
            ? {
                  apower: 120 + id * 85,
                  voltage: 230.2,
                  current: Number(((120 + id * 85) / 230.2).toFixed(3)),
                  freq: 50,
                  pf: 0.97,
                  aenergy: {total: 12_400 + id * 800, by_minute: [2, 2, 3]},
                  temperature: {tC: 38 + id, tF: 100.4 + id * 1.8}
              }
            : {})
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

function lightStatus(id: number): JsonObject {
    return {
        id,
        source: 'init',
        output: true,
        brightness: 65 - id * 10,
        apower: 18.4 + id * 4,
        voltage: 230.2,
        current: 0.09 + id * 0.02,
        aenergy: {total: 842.3 + id * 120, by_minute: [1, 1, 1]},
        temperature: {tC: 41.2, tF: 106.2}
    };
}

export function dimmerComponents(options: {
    lights: number;
    inputs: number;
}): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < options.lights; id++) {
        config[`light:${id}`] = lightConfig(id);
        status[`light:${id}`] = lightStatus(id);
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
        status[`cover:${id}`] = {
            id,
            source: 'init',
            state: 'stopped',
            apower: 0,
            voltage: 230.4,
            current: 0,
            current_pos: 35 + id * 25,
            pos_control: true,
            aenergy: {total: 194.2 + id * 40, by_minute: [0, 0, 0]}
        };
    }
    for (let id = 0; id < options.inputs; id++) {
        config[`input:${id}`] = inputConfig(id);
        status[`input:${id}`] = {id, state: false};
    }
    return {config, status};
}

function em1Components(channels: number): ProfileComponents {
    const config: Record<string, JsonObject> = {};
    const status: Record<string, JsonObject> = {};
    for (let id = 0; id < channels; id++) {
        config[`em1:${id}`] = {id, name: `Energy channel ${id + 1}`};
        config[`em1data:${id}`] = {};
        status[`em1:${id}`] = {
            id,
            current: 4.2 + id,
            voltage: 230.2,
            act_power: 920 + id * 210,
            aprt_power: 960 + id * 220,
            pf: 0.96,
            freq: 50
        };
        status[`em1data:${id}`] = {
            id,
            total_act_energy: 91_842 + id * 10_000,
            total_act_ret_energy: id === 1 ? 680 : 0
        };
    }
    return {config, status};
}

export function energyMeterComponents(options: {
    channels: number;
    threePhase?: boolean;
    relay?: boolean;
}): ProfileComponents {
    const parts: ProfileComponents[] = [em1Components(options.channels)];
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
                'em:0': {
                    id: 0,
                    a_current: 4.2,
                    a_voltage: 230.4,
                    a_act_power: 921,
                    b_current: 3.8,
                    b_voltage: 229.8,
                    b_act_power: 825,
                    c_current: 5.1,
                    c_voltage: 231,
                    c_act_power: 1126,
                    total_current: 13.1,
                    total_act_power: 2872
                },
                'emdata:0': {
                    id: 0,
                    a_total_act_energy: 182_450,
                    b_total_act_energy: 173_220,
                    c_total_act_energy: 201_110,
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
        config[`pm1:${id}`] = {id, name: `Power meter ${id + 1}`};
        status[`pm1:${id}`] = {
            id,
            voltage: 230.2,
            current: 2.4 + id,
            apower: 540 + id * 120,
            freq: 50,
            aenergy: {total: 42_840 + id * 900, by_minute: [8, 9, 8]}
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

export function bulbComponents(kind: 'cct' | 'rgbcct'): ProfileComponents {
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
                brightness: 72,
                ...(kind === 'cct'
                    ? {ct: 3500}
                    : {rgb: [80, 35, 20], white: 35, ct: 3500})
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
