import {flattie} from 'flattie';
import * as log4js from 'log4js';
import type ShellyDevice from '../model/ShellyDevice';
import * as DeviceCollector from '../modules/DeviceCollector';
import type {ShellyMessageIncoming} from '../types';
import * as Observability from './Observability';
import {callMethod, get, rawCall} from './PostgresProvider';

type EMModels =
    | 'SPEM-002CEBEU50'
    | 'SPEM-003CEBEU400'
    | 'SPEM-003CEBEU'
    | 'S3EM-002CXCEU'
    | 'S3EM-003CXCEU63';
type MonoPhase = {
    method: string;
    channels: number[];
    phases?: string[];
};
type TriPhase = {
    method: string;
    channels: number[];
    phases: string[];
};

const logger = log4js.getLogger('message-parser');
const emProfiles = {
    'SPEM-002CEBEU50': {
        monophase: {
            method: 'em1data.getdata',
            channels: [0, 1]
        }
    },
    'SPEM-003CEBEU400': {
        monophase: {
            method: 'em1data.getdata',
            channels: [0, 1, 2]
        },
        triphase: {
            method: 'emdata.getdata',
            channels: [0],
            phases: ['a', 'b', 'c']
        }
    },
    'SPEM-003CEBEU': {
        monophase: {
            method: 'em1data.getdata',
            channels: [0, 1, 2]
        },
        triphase: {
            method: 'emdata.getdata',
            channels: [0],
            phases: ['a', 'b', 'c']
        }
    },
    'S3EM-002CXCEU': {
        monophase: {
            method: 'em1data.getdata',
            channels: [0, 1]
        },
        triphase: {
            method: 'emdata.getdata',
            channels: [0],
            phases: ['a', 'b', 'c']
        }
    },
    'S3EM-003CXCEU63': {
        monophase: {
            method: 'em1data.getdata',
            channels: [0, 1, 2]
        },
        triphase: {
            method: 'emdata.getdata',
            channels: [0],
            phases: ['a', 'b', 'c']
        }
    }
};
// @ts-ignore
const dataFields = [
    'total_act_energy',
    'total_act_ret_energy',
    'min_voltage',
    'max_voltage',
    'total_current',
    'min_current',
    'max_current'
];

const day0 = (before = 90) => {
    const past = new Date();
    const now = new Date();
    const d = new Date(past.setDate(now.getDate() - before));
    return (
        new Date(
            Date.UTC(
                d.getUTCFullYear(),
                d.getUTCMonth(),
                d.getUTCDate(),
                0,
                0,
                0
            )
        ).getTime() / 1000
    );
};

const timeThreshold = (threshold: number): ((check: number) => boolean) => {
    return (check: number): boolean => {
        return Math.floor(Date.now() / 1000) - check > threshold;
    };
};
/**
 * EM Sync scaling limits (monolith, in-memory, single postgres):
 *
 * Each sync does ~3-4 DB queries + 1 device RPC (~100-200ms total).
 * At MAX_CONCURRENT_SYNCS=40, throughput is ~200-400 syncs/sec.
 *
 * Strict 10-minute window: base 9min + up to 60s jitter = max 10min.
 * Devices needing sync per tick = total_devices / (9min * 60s + avg_jitter).
 *
 *   700 devices  → ~1.3 due/sec  → 40 concurrent handles easily
 *   5k devices   → ~9 due/sec    → 40 concurrent handles easily
 *   20k devices  → ~37 due/sec   → 40 concurrent handles it
 *   50k devices  → ~93 due/sec   → may need MAX_CONCURRENT_SYNCS=60-80
 *   160k+ devices → requires Redis + microservices (multiple workers)
 */
const SYNC_THRESHOLD_S = 60 * 9; // 9 minutes base — with max 60s jitter, total never exceeds 10 minutes
const inPast = timeThreshold(SYNC_THRESHOLD_S);
const EM_SYNC_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT_SYNCS = 40;
const TICK_INTERVAL_MS = 1000; // scan queue every 1 second

export const InitEm = (): {
    evaluate: (m: ShellyMessageIncoming, device: ShellyDevice) => void;
} => {
    const syncQueue = new Map<
        string,
        {
            locked: boolean;
            id: number;
            profile: 'monophase' | 'triphase';
            model: EMModels;
            offlineSince?: number;
            lastSyncedTs?: number; // in-memory cache of last sync timestamp (unix seconds)
            syncJitter: number; // random offset (0-60s) to stagger syncs and prevent stampede
        }
    >();

    // Track how many syncs are currently in-flight
    let activeSyncs = 0;

    Observability.registerModule('emSync', () => ({
        queueSize: syncQueue.size,
        activeSyncs,
        maxConcurrent: MAX_CONCURRENT_SYNCS
    }));

    setInterval(() => {
        if (syncQueue.size === 0) return;

        const now = Math.floor(Date.now() / 1000);

        // Scan all devices — the in-memory check is just a Map lookup, costs nothing
        // Only dispatch up to MAX_CONCURRENT_SYNCS - activeSyncs new syncs
        const available = MAX_CONCURRENT_SYNCS - activeSyncs;
        if (available <= 0) return;

        let dispatched = 0;
        for (const [id, entry] of syncQueue) {
            if (dispatched >= available) break;
            if (entry.locked) continue;

            // In-memory "is due" check with per-device jitter — no DB hit
            if (entry.lastSyncedTs !== undefined) {
                const elapsed = now - entry.lastSyncedTs;
                if (elapsed < SYNC_THRESHOLD_S + entry.syncJitter) {
                    continue;
                }
            }

            dispatched++;
            lockAndSync(id);
        }
    }, TICK_INTERVAL_MS);

    const lockAndSync = async (id: string) => {
        activeSyncs++;
        try {
            if (await lock(id)) {
                await sync(id);
            }
        } catch (e) {
            logger.warn(`EM sync error for ${id}: ${e}`);
            Observability.incrementCounter('em_syncs_failed');
            // Ensure unlock on unexpected errors
            try {
                unlock(id);
            } catch (_) {
                /* already unlocked or removed */
            }
        } finally {
            activeSyncs--;
        }
    };

    const lock = async (id: string): Promise<boolean> => {
        const sd = syncQueue.get(id);
        if (sd && sd.locked === true) {
            return false;
        }
        if (!sd?.id) {
            throw new Error('InternalIdIsRequired');
        }
        sd.locked = true;
        syncQueue.set(id, sd);
        return true;
    };
    const unlock = (id: string): void => {
        const sd = syncQueue.get(id);
        if (!sd?.id) {
            throw new Error('InternalIdIsRequired');
        }
        sd.locked = false;
        syncQueue.set(id, sd);
    };
    const addForSync = async (
        device: string,
        model: EMModels,
        profile: 'monophase' | 'triphase'
    ) => {
        if (!syncQueue.get(device)) {
            const [r] = await get(device);
            // Load last sync timestamp from DB so we don't re-query it every tick
            let lastSyncedTs: number | undefined;
            try {
                const {rows} = await callMethod('device_em.fn_last_sync', {
                    p_device: r.id,
                    p_channel: -1
                });
                if (rows.length > 0) {
                    lastSyncedTs = rows[0].created;
                }
            } catch (_) {
                // First sync — no record yet, leave undefined
            }
            syncQueue.set(device, {
                locked: false,
                id: r.id,
                model,
                profile,
                lastSyncedTs,
                syncJitter: Math.floor(Math.random() * 60)
            });
        }
    };
    const appendMeasurements = async ({
        fields,
        device,
        channel,
        payload
    }: {
        fields: {
            name: string;
            phase: string;
            ref: string;
        }[];
        device: number;
        channel: number;
        payload: {
            keys: string[];
            data: {
                period: number;
                ts: number;
                values: number[][];
            }[];
        };
    }) => {
        if (!payload) {
            return;
        }
        const dataIndexes = fields
            .map((v) => ({...v, idx: payload.keys.indexOf(v.name)}))
            .filter((v) => v.idx > -1);
        const inserts: {
            p_device: number[];
            p_tag: string[];
            p_phase: string[];
            p_channel: number[];
            p_ts: number[];
            p_val: number[];
        } = {
            p_device: [],
            p_tag: [],
            p_phase: [],
            p_channel: [],
            p_ts: [],
            p_val: []
        };
        payload.data.map(({values, ts}: {values: number[][]; ts: number}) =>
            values.map((el1: number[]): any =>
                dataIndexes.map(({idx, ref, phase}) => {
                    inserts.p_device.push(device);
                    inserts.p_tag.push(ref);
                    inserts.p_phase.push(phase || 'z');
                    inserts.p_channel.push(channel);
                    inserts.p_ts.push(ts);
                    inserts.p_val.push(el1[idx]);
                })
            )
        );
        await callMethod('device_em.fn_append_stats', inserts);
    };

    const sync = async (shellyId: string): Promise<any> => {
        const device = syncQueue.get(shellyId);
        const id = device?.id;
        if (!id) {
            return;
        }

        // Check online FIRST — before any DB calls
        const shellyDev = DeviceCollector.getDevice(shellyId);
        if (!shellyDev) {
            // Device fully deleted — remove immediately (no unlock needed, entry is gone)
            syncQueue.delete(shellyId);
            logger.info(
                `EM Sync: removed deleted device ${id} from sync queue`
            );
            return;
        }
        if (!shellyDev.online) {
            // Device offline — apply grace period
            if (!device.offlineSince) {
                device.offlineSince = Date.now();
            }
            if (Date.now() - device.offlineSince > EM_SYNC_GRACE_PERIOD_MS) {
                // Grace period expired — remove (no unlock needed, entry is gone)
                syncQueue.delete(shellyId);
                logger.info(
                    `EM Sync: removed device ${id} after ${EM_SYNC_GRACE_PERIOD_MS / 1000}s offline`
                );
            } else {
                // Still within grace period — unlock so next cycle can check again
                unlock(shellyId);
            }
            return;
        }

        // Device is online — reset offline timer
        device.offlineSince = undefined;

        logger.info(`EM Sync started for device: ${id}`);
        try {
            const dProf = device.profile;
            const model: EMModels = device.model;
            // @ts-ignore
            const params: MonoPhase | TriPhase = emProfiles[model][dProf];

            if (!params) {
                logger.info(`No Params for device: ${id}`);
                return;
            }
            const channels = params.channels || [];
            const {rows: lastTx} = await callMethod('device_em.fn_last_sync', {
                p_device: id,
                p_channel: -1
            });
            if (!lastTx.length) {
                const ts = day0();
                await Promise.all(
                    channels.map(async (ch) => {
                        logger.info(
                            `Pushing zero day! for id: ${id}, channel: ${ch}, ts: ${ts}`
                        );
                        return await callMethod('device_em.fn_synced', {
                            p_device: id,
                            p_created: ts,
                            p_channel: ch
                        });
                    })
                );
                // Cache the zero-day timestamp
                if (device) device.lastSyncedTs = ts;
                return;
            }
            const [{created}] = lastTx;
            if (!inPast(created)) {
                // Cache the timestamp in memory so next tick skips the DB check
                if (device) device.lastSyncedTs = created;
                logger.info(
                    `Device: ${id} last record(${created}) is not in the past`
                );
                return;
            }
            const fields = dataFields.reduce((a: any, df: string) => {
                if (!params?.phases) {
                    return a.concat({name: df, ref: df});
                }
                return a.concat(
                    params?.phases?.map((p) => {
                        return {name: [p, df].join('_'), ref: df, phase: p};
                    })
                );
            }, []);
            await channels?.reduce(async (a: any, channel: number) => {
                await a;
                const nextTsLoc = Math.floor(Date.now() / 1000) - 100;
                const {
                    rows: [{created: lastSyncDate}]
                } = await callMethod('device_em.fn_last_sync', {
                    p_device: id,
                    p_channel: channel
                });
                const {
                    keys,
                    data,
                    next_record_ts: nextTs
                }: {
                    keys: string[];
                    data: {
                        period: number;
                        ts: number;
                        values: number[][];
                    }[];
                    next_record_ts: number;
                } = await shellyDev.sendRPC(params.method, {
                    id: channel,
                    ts: Number.parseInt(lastSyncDate)
                });
                logger.info(
                    `Pushing device=${id}/channel=${channel}/date=${lastSyncDate}/nextDate=${nextTs}/nextDateLocal=${nextTsLoc}/nextDateSync=${nextTs || nextTsLoc}`
                );
                await appendMeasurements({
                    fields,
                    device: id,
                    channel,
                    payload: {keys, data}
                });
                const nextDate = nextTs || nextTsLoc;
                await callMethod('device_em.fn_synced', {
                    p_device: id,
                    p_created: nextDate,
                    p_channel: channel
                });
                // Cache the new sync timestamp in memory
                if (device) device.lastSyncedTs = nextDate;
                logger.info(
                    `Query Finished device=${id} for channel=${channel} @ nextDate=${nextDate}`
                );
            }, Promise.resolve());
        } catch (e) {
            logger.warn(e);
            logger.warn(`Sync error for device: ${id}`);
        } finally {
            logger.info(`Sync finished for device: ${id}`);
            Observability.incrementCounter('em_syncs_completed');
            unlock(shellyId);
        }
    };
    const o = {
        evaluate(m: ShellyMessageIncoming, device: ShellyDevice): void {
            (async () => {
                if (
                    !device.info.model ||
                    [
                        'SPEM-002CEBEU50',
                        'SPEM-003CEBEU400',
                        'SPEM-003CEBEU',
                        'S3EM-002CXCEU',
                        'S3EM-003CXCEU63'
                    ].indexOf(device?.info.model) === -1
                ) {
                    return;
                }
                await addForSync(
                    device.shellyID,
                    device?.info?.model as EMModels,
                    device?.config?.sys?.device?.profile || 'monophase'
                );
            })();
        }
    };
    return o;
};
