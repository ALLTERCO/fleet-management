import {flattie} from 'flattie';
import * as log4js from 'log4js';
import {floats} from '../config/shelly.dataTypes';
import type ShellyDevice from '../model/ShellyDevice';
import {parseComponentKey} from '../model/ShellyDevice';
import type {
    ShellyMessageData,
    ShellyMessageIncoming,
    shelly_bthome_type_t
} from '../types';
import * as Observability from './Observability';
import {callMethod, rawCall} from './PostgresProvider';
import {InitEm} from './ShellyEmHandler';
import * as ShellyEvents from './ShellyEvents';
const logger = log4js.getLogger('message-parser');

// O(1) field→group lookup (replaces O(n) indexOf on every field)
const floatFieldMap = new Map<string, string>();
for (let i = 0; i < floats.raw.length; i++) {
    floatFieldMap.set(floats.raw[i], floats.group[i]);
}

const lastDeviceStatusValue = new Map<number, Map<string, number>>();

/** Clean up status cache when a device disconnects (O(1) per device) */
export function clearDeviceStatusCache(deviceId: number) {
    lastDeviceStatusValue.delete(deviceId);
}
let status_push_queue: t_intermid_1 = {
    p_ts: [],
    p_id: [],
    p_field: [],
    p_field_group: [],
    p_value: [],
    p_prev_value: []
};
let statusFlushInProgress = false;
let lastFlushMs = 0;
let lastFlushBatchSize = 0;

// Pending message buffer — hot path just pushes here
type PendingMessage = {
    ts: number;
    deviceId: number;
    params: Record<string, any>;
};
const pendingMessages: PendingMessage[] = [];

const FLUSH_INTERVAL_MS = 250;

// Merged interval: process buffered messages → flush to DB
setInterval(async () => {
    if (statusFlushInProgress) return;

    // 1. Process buffered messages into flush queue
    if (pendingMessages.length > 0) {
        const batch = pendingMessages.splice(0);
        const processStart = performance.now();
        await processPendingMessages(batch);
        Observability.recordDbTiming(
            'status_process',
            performance.now() - processStart
        );
    }

    // 2. Flush queue to DB
    const sl = status_push_queue.p_ts.length;
    if (sl) {
        lastFlushBatchSize = sl;
        if (Observability.isDbWritesDisabled()) {
            Observability.incrementCounter('status_flushes_skipped');
            status_push_queue = {
                p_ts: [],
                p_id: [],
                p_field: [],
                p_field_group: [],
                p_value: [],
                p_prev_value: []
            };
            return;
        }
        const toFlush = status_push_queue;
        status_push_queue = {
            p_ts: [],
            p_id: [],
            p_field: [],
            p_field_group: [],
            p_value: [],
            p_prev_value: []
        };
        statusFlushInProgress = true;
        Observability.incrementCounter('status_flushes');
        const flushStart = performance.now();
        try {
            logger.info('---->>> Syncing status, length %d', sl);
            await rawCall('device.fn_status_push', toFlush);
            const flushElapsed = performance.now() - flushStart;
            lastFlushMs = flushElapsed;
            Observability.recordDbTiming('status_flush', flushElapsed);
        } catch (e) {
            logger.error('Failed to flush status queue:', e);
            Observability.incrementCounter('status_flush_errors');
        } finally {
            statusFlushInProgress = false;
        }
    }
}, FLUSH_INTERVAL_MS);

// ── em_stats: collect energy-related data from PM/Plug/Switch/Cover into device_em.stats ──
type t_em_stats_queue = {
    p_device: number[];
    p_tag: string[];
    p_phase: string[];
    p_channel: number[];
    p_ts: number[];
    p_val: number[];
};

let em_stats_queue: t_em_stats_queue = {
    p_device: [],
    p_tag: [],
    p_phase: [],
    p_channel: [],
    p_ts: [],
    p_val: []
};

setInterval(async () => {
    const sl = em_stats_queue.p_ts.length;
    if (sl) {
        if (Observability.isDbWritesDisabled()) {
            Observability.incrementCounter('em_stats_flushes_skipped');
            em_stats_queue = {
                p_device: [],
                p_tag: [],
                p_phase: [],
                p_channel: [],
                p_ts: [],
                p_val: []
            };
            return;
        }
        Observability.incrementCounter('em_stats_flushes');
        try {
            logger.info(
                '---->>> Syncing em_stats (PM/Plug/Switch), length %d',
                sl
            );
            const emFlushStart = performance.now();
            await callMethod('device_em.fn_append_stats', em_stats_queue);
            Observability.recordDbTiming(
                'em_stats_flush',
                performance.now() - emFlushStart
            );
        } catch (e) {
            Observability.incrementCounter('em_stats_flush_errors');
            throw e;
        } finally {
            em_stats_queue = {
                p_device: [],
                p_tag: [],
                p_phase: [],
                p_channel: [],
                p_ts: [],
                p_val: []
            };
        }
    }
}, 120000);

// Match switch/pm1/cover energy-related fields from flattened NotifyStatus
const EM_STATS_FIELD_RE =
    /^(switch|pm1|cover):(\d+)\.(current|voltage|apower|aenergy\.total|ret_aenergy\.total)$/;

const EM_STATS_TAG_MAP: Record<string, {tag: string; isDelta: boolean}> = {
    current: {tag: 'current', isDelta: false},
    voltage: {tag: 'voltage', isDelta: false},
    apower: {tag: 'power', isDelta: false},
    'aenergy.total': {tag: 'total_act_energy', isDelta: true},
    'ret_aenergy.total': {tag: 'total_act_ret_energy', isDelta: true}
};

const em = InitEm();
type shelly_event_t =
    | 'config_changed'
    | 'component_added'
    | 'component_removed'
    | 'device_discovered' // bthome discovery result
    | 'discovery_done' // bthome discovery finished
    | 'single_push'
    | 'double_push'
    | 'triple_push'
    | 'long_push';

export function handleMessage(
    shelly: ShellyDevice,
    res: ShellyMessageIncoming,
    req?: ShellyMessageData
) {
    // period updates
    em.evaluate(res, shelly);
    if (res.method === 'NotifyStatus') {
        statusSelectivePush(res, shelly);
        patchStatus(shelly, res.params);
    } else if (res.method === 'NotifyEvent') {
        if (
            typeof res.params?.events === 'object' &&
            Array.isArray(res.params.events)
        ) {
            for (const event of res.params.events) {
                if (typeof event !== 'object') {
                    continue;
                }

                const {
                    event: evt,
                    component
                }: {event: shelly_event_t; component: string} = event;

                switch (evt) {
                    case 'config_changed':
                        onConfigChange(shelly, component, event.data);
                        break;

                    case 'component_added':
                        logger.info('Component added', event.target);
                        shelly.fetchComponent(event.target);
                        break;

                    case 'component_removed':
                        shelly.removeComponent(event.target);
                        break;

                    case 'single_push':
                    case 'double_push':
                    case 'triple_push':
                    case 'long_push':
                        shelly.forwardComponentEvent(component, evt);
                        break;

                    case 'device_discovered':
                        ShellyEvents.emitBTHomeDiscoveryResult(
                            event?.device?.local_name as shelly_bthome_type_t,
                            event?.device?.addr as string,
                            shelly.shellyID
                        );
                        logger.info(
                            'BTHome device discovered',
                            event?.device?.local_name,
                            'from',
                            shelly.shellyID
                        );
                        break;

                    case 'discovery_done':
                        // {"component":"bthome","event":"discovery_done","device_count":1,"ts":1733001388.36}
                        logger.info(
                            'BTHome discovery done',
                            event.device_count,
                            'for',
                            shelly.shellyID
                        );
                        ShellyEvents.emitShellyDiscoveryDone(
                            shelly.shellyID,
                            event.device_count
                        );
                        break;

                    default:
                        continue;
                }
            }
        }
    }

    // logger.debug("new message shelly_id:[%s] msg:[%s]", shelly.shellyID, JSON.stringify(res));
    ShellyEvents.emitShellyMessage(shelly, res, req);
}

function patchStatus(shelly: ShellyDevice, data: Record<string, any>) {
    const patch: Record<string, any> = {};
    for (const key in data) {
        if (key === 'ts') continue;
        patch[key] = data[key];
    }
    shelly.batchSetComponentStatus(patch);
}

type t_intermid_1 = {
    p_ts: number[];
    p_id: number[];
    p_field: string[];
    p_field_group: string[];
    p_value: number[];
    p_prev_value: number[];
};

// Hot path: just buffer the raw message (O(1), <1μs)
export function statusSelectivePush(
    req: ShellyMessageIncoming,
    device: ShellyDevice
) {
    Observability.incrementCounter('status_messages');
    pendingMessages.push({
        ts: req.params.ts,
        deviceId: device.id,
        params: req.params
    });
}

// Cold path: process buffered messages into flush queue (runs in 250ms interval)
async function processPendingMessages(batch: PendingMessage[]) {
    for (const msg of batch) {
        const {ts, ...components} = msg.params;
        const d = flattie(components);
        try {
            for (const k of Object.keys(d)) {
                const group = floatFieldMap.get(k);
                if (group === undefined) continue;

                const v = d[k];
                let deviceCache = lastDeviceStatusValue.get(msg.deviceId);
                if (!deviceCache) {
                    deviceCache = new Map();
                    lastDeviceStatusValue.set(msg.deviceId, deviceCache);
                }
                if (!deviceCache.has(k)) {
                    const {
                        rows: [lr]
                    } = await rawCall('device.fn_status_last_value', {
                        p_id: msg.deviceId,
                        p_field: k
                    });
                    if (lr?.last_value) {
                        deviceCache.set(k, lr.last_value);
                    }
                }
                const lastVal = deviceCache.get(k);
                status_push_queue.p_ts.push(ts.toFixed(0));
                status_push_queue.p_id.push(msg.deviceId);
                status_push_queue.p_field.push(k);
                status_push_queue.p_field_group.push(group);
                status_push_queue.p_value.push(v);
                status_push_queue.p_prev_value.push(
                    lastVal !== undefined ? lastVal : v
                );

                // Also collect energy-related PM/Plug/Switch/Cover data for device_em.stats
                const emMatch = EM_STATS_FIELD_RE.exec(k);
                if (emMatch) {
                    const channel = Number.parseInt(emMatch[2], 10);
                    const mapping = EM_STATS_TAG_MAP[emMatch[3]];
                    if (mapping) {
                        if (mapping.isDelta) {
                            if (lastVal !== undefined) {
                                const delta = v - (lastVal as number);
                                if (delta > 0) {
                                    em_stats_queue.p_device.push(msg.deviceId);
                                    em_stats_queue.p_tag.push(mapping.tag);
                                    em_stats_queue.p_phase.push('z');
                                    em_stats_queue.p_channel.push(channel);
                                    em_stats_queue.p_ts.push(
                                        Number.parseInt(ts.toFixed(0), 10)
                                    );
                                    em_stats_queue.p_val.push(delta);
                                }
                            }
                        } else {
                            em_stats_queue.p_device.push(msg.deviceId);
                            em_stats_queue.p_tag.push(mapping.tag);
                            em_stats_queue.p_phase.push('z');
                            em_stats_queue.p_channel.push(channel);
                            em_stats_queue.p_ts.push(
                                Number.parseInt(ts.toFixed(0), 10)
                            );
                            em_stats_queue.p_val.push(v);
                        }
                    }
                }

                deviceCache.set(k, v);
            }
        } catch (e) {
            logger.error('Collect device status: ', e);
        }
    }
}

async function onConfigChange(shelly: ShellyDevice, key: string, config: any) {
    const {type, id} = parseComponentKey(key);

    try {
        // Use id !== undefined instead of id && to handle id=0 correctly
        const config = await shelly.sendRPC(
            `${type}.GetConfig`,
            id !== undefined ? {id} : undefined
        );
        // Update the config
        shelly.setComponentConfig(key, config);
    } catch (error) {
        logger.error('Error getting config for %s:%s -> %s', type, id, error);
        return;
    }

    if (type === 'sys') {
        try {
            const info = await shelly.sendRPC('Shelly.GetDeviceInfo');
            // Update the device info
            shelly.setInfo(info);
        } catch (error) {
            logger.error('Error getting device info -> %s', error);
        }
    }
}

// Register observability module stats
Observability.registerModule('statusQueue', () => ({
    pending: pendingMessages.length,
    queueSize: status_push_queue.p_ts.length,
    flushing: statusFlushInProgress,
    emStatsQueueSize: em_stats_queue.p_ts.length,
    lastFlushMs,
    lastFlushBatchSize,
    statusCacheDevices: lastDeviceStatusValue.size,
    statusCacheEntries: [...lastDeviceStatusValue.values()].reduce(
        (s, m) => s + m.size,
        0
    )
}));
