import {defineStore} from 'pinia';
import {ref, toRaw, type WatchStopHandle, watch} from 'vue';
import {useDevicesStore} from './devices';

export type SensorDevice = {
    id: string;
    name: string;
    state?: 'open' | 'closed';
    battery?: number;
    kind: 'door_window' | 'button' | 'remote_controller' | 'motion_sensor';
};

/** BTHome object IDs for sensor classification */
const BTHOME_OBJ_DOOR = 45;
const BTHOME_OBJ_BATTERY = 1;
const BTHOME_OBJ_MOTION = 33;

function detectSensorKind(
    name: string,
    objIds: Set<number>
): SensorDevice['kind'] {
    if (objIds.has(BTHOME_OBJ_DOOR)) return 'door_window';
    if (objIds.has(BTHOME_OBJ_MOTION)) return 'motion_sensor';
    const lower = name.toLowerCase();
    if (lower.includes('rc') || lower.includes('remote'))
        return 'remote_controller';
    return 'button';
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

        const byMac = new Map<
            string,
            {
                name: string;
                doorValue?: boolean;
                doorTs?: number;
                battery?: number;
                batteryTs?: number;
                motionValue?: boolean;
                motionTs?: number;
                objIds: Set<number>;
            }
        >();

        const deviceNames = new Map<string, string>();

        for (const dev of Object.values(rawDevices)) {
            const settings = toRaw(dev.settings) as Record<string, any>;
            for (const key of Object.keys(settings)) {
                if (!key.startsWith('bthomedevice:')) continue;
                const dcfg = settings[key] as {addr: string; name?: string};
                if (dcfg.name?.trim()) {
                    deviceNames.set(dcfg.addr, dcfg.name.trim());
                }
            }
        }

        for (const dev of Object.values(rawDevices)) {
            const settings = toRaw(dev.settings) as Record<string, any>;
            const status = toRaw(dev.status) as Record<string, any>;

            for (const key of Object.keys(settings)) {
                if (!key.startsWith('bthomesensor:')) continue;

                const cfg = settings[key] as {
                    id: number;
                    addr: string;
                    name?: string;
                    obj_id: number;
                    idx: number;
                };

                const mac = cfg.addr;
                const label = cfg.name?.trim() || deviceNames.get(mac) || mac;
                const stat = status[`bthomesensor:${cfg.id}`] as
                    | {value: any; last_updated_ts?: number}
                    | undefined;
                if (!stat) continue;

                const ts = stat.last_updated_ts ?? 0;
                const val = stat.value;

                let agg = byMac.get(mac);
                if (!agg) {
                    agg = {name: label, objIds: new Set<number>()};
                    byMac.set(mac, agg);
                }
                agg.objIds.add(cfg.obj_id);

                if (cfg.obj_id === BTHOME_OBJ_DOOR && typeof val === 'boolean') {
                    if (agg.doorTs === undefined || ts > agg.doorTs) {
                        agg.doorValue = val;
                        agg.doorTs = ts;
                        agg.name = label;
                    }
                } else if (cfg.obj_id === BTHOME_OBJ_BATTERY && typeof val === 'number') {
                    if (agg.batteryTs === undefined || ts > agg.batteryTs) {
                        agg.battery = val;
                        agg.batteryTs = ts;
                    }
                } else if (cfg.obj_id === BTHOME_OBJ_MOTION && typeof val === 'boolean') {
                    if (agg.motionTs === undefined || ts > agg.motionTs) {
                        agg.motionValue = val;
                        agg.motionTs = ts;
                    }
                }
            }
        }

        return Array.from(byMac.entries()).map(([mac, agg]) => {
            const kind = detectSensorKind(agg.name, agg.objIds);

            return {
                id: mac,
                name: agg.name,
                battery: agg.battery,
                kind,
                ...(kind === 'door_window' && agg.doorValue !== undefined
                    ? {state: agg.doorValue ? 'open' : ('closed' as const)}
                    : {}),
                ...(kind === 'motion_sensor' && agg.motionValue !== undefined
                    ? {state: agg.motionValue ? 'open' : ('closed' as const)}
                    : {})
            };
        });
    }

    function activateSensors() {
        _refCount++;
        if (_refCount === 1) {
            _stopWatch = watch(
                () => devicesStore.sensorDataVersion,
                () => {
                    sensors.value = buildSensors();
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
            sensors.value = [];
        }
    }

    function getLogo(device?: SensorDevice) {
        if (!device) return '/shelly_logo_black.jpg';
        switch (device.kind) {
            case 'door_window':
                return '/door_window.png';
            case 'button':
                return '/button.png';
            case 'remote_controller':
                return '/rc.png';
            case 'motion_sensor':
                return '/motion.png';
            default:
                return '/shelly_logo_black.jpg';
        }
    }

    return {sensors, activateSensors, deactivateSensors, getLogo};
});
