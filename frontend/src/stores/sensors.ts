import {defineStore} from 'pinia';
import {ref, toRaw, type WatchStopHandle, watch} from 'vue';
import {formatBTHomeEventSummary} from '@/helpers/bthome-controls';
import {getLogoFromModel} from '@/helpers/device';
import {useDevicesStore} from './devices';

export type SensorDevice = {
    id: string;
    name: string;
    // Presence of the gateway that carries this BLE sensor. Optional so the
    // aggregated-sensor path (no gateway) can omit it.
    online?: boolean;
    state?: 'open' | 'closed';
    battery?: number;
    summary?: string;
    lastEvent?: string;
    // Backend-formatted active channel (e.g. "Channel 2") for remote controllers.
    activeChannelLabel?: string;
    kind:
        | 'door_window'
        | 'button'
        | 'remote_controller'
        | 'motion_sensor'
        | 'climate_sensor'
        | 'distance_sensor'
        | 'trv'
        | 'weather_station'
        | 'sensor';
    modelId?: string;
    productName?: string;
};

/** BTHome object IDs for sensor classification */
const BTHOME_OBJ_BATTERY = 1;
const DOOR_OBJ_IDS = new Set([17, 26, 45]);
const MOTION_OBJ_IDS = new Set([33, 34, 35, 37]);
const TEMPERATURE_OBJ_IDS = new Set([2, 69, 87, 88]);
const HUMIDITY_OBJ_IDS = new Set([3, 46]);
const DISTANCE_OBJ_IDS = new Set([64, 65]);
const WEATHER_OBJ_IDS = new Set([68, 94, 95, 96]);
const BUTTON_EVENT_OBJ_IDS = new Set([58, 60, 63, 96]);

type SensorAggregate = {
    name: string;
    battery?: number;
    batteryTs?: number;
    doorValue?: boolean;
    doorTs?: number;
    motionValue?: boolean;
    motionTs?: number;
    temperature?: string;
    temperatureTs?: number;
    humidity?: string;
    humidityTs?: number;
    distance?: string;
    distanceTs?: number;
    weather?: string;
    weatherTs?: number;
    trvSummary?: string;
    trvTs?: number;
    lastEvent?: string;
    lastEventTs?: number;
    kindHint?: SensorDevice['kind'];
    modelId?: string;
    productName?: string;
    objIds: Set<number>;
};

function formatLabel(value: string): string {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNumericValue(value: number, unit?: string): string {
    const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${text} ${unit}` : text;
}

function updateLatest(
    aggregate: SensorAggregate,
    key: keyof SensorAggregate,
    tsKey: keyof SensorAggregate,
    value: string | number | boolean,
    ts: number
) {
    const currentTs = aggregate[tsKey];
    if (typeof currentTs === 'number' && currentTs > ts) return;
    (aggregate[key] as string | number | boolean | undefined) = value;
    (aggregate[tsKey] as number | undefined) = ts;
}

function inferKindFromName(name: string): SensorDevice['kind'] | undefined {
    const lower = name.toLowerCase();
    if (lower.includes('weather') || lower.includes('ws90'))
        return 'weather_station';
    if (lower.includes('distance')) return 'distance_sensor';
    if (lower.includes('trv')) return 'trv';
    if (lower.includes('h&t') || lower.includes('humidity'))
        return 'climate_sensor';
    if (lower.includes('motion')) return 'motion_sensor';
    if (lower.includes('door') || lower.includes('window'))
        return 'door_window';
    if (
        lower.includes('remote') ||
        lower.includes('wall switch') ||
        lower.includes(' rc ')
    ) {
        return 'remote_controller';
    }
    if (lower.includes('button')) return 'button';
    return undefined;
}

function detectSensorKind(aggregate: SensorAggregate): SensorDevice['kind'] {
    const inferredNameKind = inferKindFromName(aggregate.name);

    if (Array.from(aggregate.objIds).some((objId) => DOOR_OBJ_IDS.has(objId)))
        return 'door_window';
    if (
        Array.from(aggregate.objIds).some((objId) => MOTION_OBJ_IDS.has(objId))
    ) {
        return 'motion_sensor';
    }
    if (aggregate.kindHint) return aggregate.kindHint;
    if (
        Array.from(aggregate.objIds).some((objId) =>
            DISTANCE_OBJ_IDS.has(objId)
        )
    ) {
        return 'distance_sensor';
    }
    if (
        Array.from(aggregate.objIds).some((objId) => WEATHER_OBJ_IDS.has(objId))
    ) {
        return 'weather_station';
    }
    if (
        Array.from(aggregate.objIds).some(
            (objId) =>
                TEMPERATURE_OBJ_IDS.has(objId) || HUMIDITY_OBJ_IDS.has(objId)
        )
    ) {
        return 'climate_sensor';
    }
    if (
        Array.from(aggregate.objIds).some((objId) =>
            BUTTON_EVENT_OBJ_IDS.has(objId)
        )
    ) {
        if (
            aggregate.objIds.has(63) ||
            aggregate.objIds.has(96) ||
            inferredNameKind === 'remote_controller'
        ) {
            return 'remote_controller';
        }
        return 'button';
    }
    return inferredNameKind ?? 'sensor';
}

function buildSummary(
    kind: SensorDevice['kind'],
    aggregate: SensorAggregate
): string | undefined {
    switch (kind) {
        case 'climate_sensor':
            return [aggregate.temperature, aggregate.humidity]
                .filter(Boolean)
                .join(' · ');
        case 'distance_sensor':
            return aggregate.distance;
        case 'weather_station':
            return aggregate.weather;
        case 'trv':
            return aggregate.trvSummary;
        case 'door_window':
            if (aggregate.doorValue === undefined) return undefined;
            return aggregate.doorValue ? 'Open' : 'Closed';
        case 'button':
        case 'remote_controller':
            return aggregate.lastEvent ?? 'No recent events';
        default:
            return undefined;
    }
}

export const useSensorsStore = defineStore('sensors', () => {
    const devicesStore = useDevicesStore();

    // Lazy sensors — only watches devicesStore when devices page is mounted.
    // Prevents O(N) double-scan on every sensorDataVersion bump when page isn't visible.
    const sensors = ref<SensorDevice[]>([]);
    let _refCount = 0;
    let _stopWatch: WatchStopHandle | null = null;

    function buildSensors(): SensorDevice[] {
        const rawDevices = toRaw(devicesStore.devices);

        const byMac = new Map<string, SensorAggregate>();

        const getAggregate = (mac: string, fallbackName?: string) => {
            let aggregate = byMac.get(mac);
            if (!aggregate) {
                aggregate = {
                    name: fallbackName || mac,
                    objIds: new Set<number>()
                };
                byMac.set(mac, aggregate);
            } else if (fallbackName && aggregate.name === mac) {
                aggregate.name = fallbackName;
            }
            return aggregate;
        };

        for (const dev of Object.values(rawDevices)) {
            const settings = toRaw(dev.settings) as
                | Record<string, Record<string, any>>
                | undefined;
            if (!settings) continue;

            const status = toRaw(dev.status) as
                | Record<string, Record<string, any>>
                | undefined;

            const keys = Object.keys(settings);

            // Collect physical BLE device records first so device-level events
            // and richer naming are available to the aggregate card.
            for (const key of keys) {
                if (!key.startsWith('bthomedevice:')) continue;
                const dcfg = settings[key] as {
                    addr: string;
                    name?: string;
                    productName?: string;
                    modelId?: string;
                    controls?: Array<{
                        objId: number;
                        idx: number;
                        kind: 'button' | 'dimmer';
                        label: string;
                    }>;
                    meta?: {
                        productName?: string;
                        controls?: Array<{
                            objId: number;
                            idx: number;
                            kind: 'button' | 'dimmer';
                            label: string;
                        }>;
                    };
                };
                const mac = dcfg.addr;
                if (!mac) continue;

                const aggregate = getAggregate(
                    mac,
                    dcfg.name?.trim() ||
                        dcfg.productName ||
                        dcfg.meta?.productName ||
                        mac
                );
                aggregate.kindHint =
                    inferKindFromName(aggregate.name) ?? aggregate.kindHint;
                aggregate.modelId ??= dcfg.modelId;
                aggregate.productName ??=
                    dcfg.productName ?? dcfg.meta?.productName;

                const dstatus = status?.[key] as
                    | {
                          last_event?: any;
                          last_event_idx?: number;
                          last_event_ts?: number;
                      }
                    | undefined;
                const eventValue = dstatus?.last_event;
                if (typeof eventValue === 'string' && eventValue.trim()) {
                    updateLatest(
                        aggregate,
                        'lastEvent',
                        'lastEventTs',
                        formatBTHomeEventSummary(
                            eventValue,
                            typeof dstatus?.last_event_idx === 'number'
                                ? dstatus.last_event_idx
                                : null,
                            dcfg.controls ?? dcfg.meta?.controls ?? []
                        ),
                        dstatus?.last_event_ts ?? 0
                    );
                }
            }

            // BLU TRV devices live outside bthomesensor composition, so fold
            // them into the aggregate list directly from their own status.
            for (const key of keys) {
                if (!key.startsWith('blutrv:')) continue;

                const cfg = settings[key] as {
                    addr: string;
                    name?: string;
                };
                const mac = cfg.addr;
                if (!mac) continue;

                const aggregate = getAggregate(mac, cfg.name?.trim() || mac);
                aggregate.kindHint = 'trv';

                const trvStatus = status?.[key] as
                    | {
                          battery?: number;
                          current_C?: number;
                          target_C?: number;
                      }
                    | undefined;
                if (!trvStatus) continue;

                if (typeof trvStatus.battery === 'number') {
                    updateLatest(
                        aggregate,
                        'battery',
                        'batteryTs',
                        trvStatus.battery,
                        Math.floor(Date.now() / 1000)
                    );
                }

                const trvParts = [
                    typeof trvStatus.target_C === 'number'
                        ? `Target ${formatNumericValue(trvStatus.target_C, '°C')}`
                        : '',
                    typeof trvStatus.current_C === 'number'
                        ? `Room ${formatNumericValue(trvStatus.current_C, '°C')}`
                        : ''
                ].filter(Boolean);
                if (trvParts.length) {
                    updateLatest(
                        aggregate,
                        'trvSummary',
                        'trvTs',
                        trvParts.join(' · '),
                        Math.floor(Date.now() / 1000)
                    );
                }
            }

            // Process sensors (same device, same pass)
            if (!status) continue;
            for (const key of keys) {
                if (!key.startsWith('bthomesensor:')) continue;

                const cfg = settings[key] as {
                    id: number;
                    addr: string;
                    name?: string;
                    obj_id: number;
                    idx: number;
                };

                const mac = cfg.addr;
                const label = cfg.name?.trim();
                const stat = status[`bthomesensor:${cfg.id}`] as
                    | {
                          value: any;
                          last_updated_ts?: number;
                          last_event?: string;
                          last_event_ts?: number;
                      }
                    | undefined;
                if (!stat) continue;

                const ts = stat.last_updated_ts ?? 0;
                const val = stat.value;

                const agg = getAggregate(mac, label || mac);
                agg.objIds.add(cfg.obj_id);
                if (label) {
                    agg.kindHint = inferKindFromName(label) ?? agg.kindHint;
                }

                if (DOOR_OBJ_IDS.has(cfg.obj_id) && typeof val === 'boolean') {
                    updateLatest(agg, 'doorValue', 'doorTs', val, ts);
                } else if (
                    cfg.obj_id === BTHOME_OBJ_BATTERY &&
                    typeof val === 'number'
                ) {
                    updateLatest(agg, 'battery', 'batteryTs', val, ts);
                } else if (
                    MOTION_OBJ_IDS.has(cfg.obj_id) &&
                    typeof val === 'boolean'
                ) {
                    updateLatest(agg, 'motionValue', 'motionTs', val, ts);
                } else if (
                    TEMPERATURE_OBJ_IDS.has(cfg.obj_id) &&
                    typeof val === 'number'
                ) {
                    updateLatest(
                        agg,
                        'temperature',
                        'temperatureTs',
                        formatNumericValue(val, '°C'),
                        ts
                    );
                } else if (
                    HUMIDITY_OBJ_IDS.has(cfg.obj_id) &&
                    typeof val === 'number'
                ) {
                    updateLatest(
                        agg,
                        'humidity',
                        'humidityTs',
                        formatNumericValue(val, '%'),
                        ts
                    );
                } else if (
                    DISTANCE_OBJ_IDS.has(cfg.obj_id) &&
                    typeof val === 'number'
                ) {
                    updateLatest(
                        agg,
                        'distance',
                        'distanceTs',
                        formatNumericValue(val, cfg.obj_id === 64 ? 'mm' : 'm'),
                        ts
                    );
                } else if (
                    WEATHER_OBJ_IDS.has(cfg.obj_id) &&
                    typeof val === 'number'
                ) {
                    const nextParts = [
                        agg.weather?.includes('Wind')
                            ? agg.weather
                                  .split(' · ')
                                  .find((part) => part.startsWith('Wind'))
                            : undefined,
                        agg.weather?.includes('Dir')
                            ? agg.weather
                                  .split(' · ')
                                  .find((part) => part.startsWith('Dir'))
                            : undefined,
                        agg.weather?.includes('Rain')
                            ? agg.weather
                                  .split(' · ')
                                  .find((part) => part.startsWith('Rain'))
                            : undefined
                    ];

                    if (cfg.obj_id === 68) {
                        nextParts[0] = `Wind ${formatNumericValue(val, 'm/s')}`;
                    } else if (cfg.obj_id === 94) {
                        nextParts[1] = `Dir ${formatNumericValue(val, '°')}`;
                    } else if (cfg.obj_id === 95) {
                        nextParts[2] = `Rain ${formatNumericValue(val, 'mm')}`;
                    }

                    updateLatest(
                        agg,
                        'weather',
                        'weatherTs',
                        nextParts.filter(Boolean).join(' · '),
                        ts
                    );
                }

                const eventValue = stat.last_event ?? val;
                if (
                    BUTTON_EVENT_OBJ_IDS.has(cfg.obj_id) &&
                    typeof eventValue === 'string' &&
                    eventValue.trim()
                ) {
                    updateLatest(
                        agg,
                        'lastEvent',
                        'lastEventTs',
                        formatLabel(eventValue),
                        stat.last_event_ts ?? ts
                    );
                }
            }
        }

        return Array.from(byMac.entries()).map(([mac, agg]) => {
            const kind = detectSensorKind(agg);

            return {
                id: mac,
                name: agg.name,
                battery: agg.battery,
                lastEvent: agg.lastEvent,
                summary: buildSummary(kind, agg),
                kind,
                modelId: agg.modelId,
                productName: agg.productName,
                ...(kind === 'door_window' && agg.doorValue !== undefined
                    ? {state: agg.doorValue ? 'open' : ('closed' as const)}
                    : {}),
                ...(kind === 'motion_sensor' && agg.motionValue !== undefined
                    ? {state: agg.motionValue ? 'open' : ('closed' as const)}
                    : {})
            };
        });
    }

    let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function activateSensors() {
        _refCount++;
        if (_refCount === 1) {
            // Debounce rebuilds — coalesces rapid BTHome status updates (500ms window)
            // to avoid rebuilding the full sensor list on every individual sensor tick.
            _stopWatch = watch(
                () => devicesStore.sensorDataVersion,
                () => {
                    if (_debounceTimer) clearTimeout(_debounceTimer);
                    _debounceTimer = setTimeout(() => {
                        _debounceTimer = null;
                        sensors.value = buildSensors();
                    }, 500);
                },
                {immediate: true}
            );
        }
    }

    function deactivateSensors() {
        _refCount = Math.max(0, _refCount - 1);
        if (_refCount === 0 && _stopWatch) {
            _stopWatch();
            _stopWatch = null;
            if (_debounceTimer) {
                clearTimeout(_debounceTimer);
                _debounceTimer = null;
            }
            sensors.value = [];
        }
    }

    function getLogo(device?: SensorDevice) {
        if (!device) return '/images/devices/generic-blu-device.png';
        if (device.modelId) {
            return getLogoFromModel(device.modelId);
        }
        switch (device.kind) {
            case 'door_window':
                return '/images/devices/door_window.png';
            case 'button':
                return '/images/devices/button.png';
            case 'remote_controller':
                return '/images/devices/rc.png';
            case 'motion_sensor':
                return '/images/devices/motion.png';
            default:
                return '/images/devices/generic-blu-device.png';
        }
    }

    return {sensors, activateSensors, deactivateSensors, getLogo};
});
