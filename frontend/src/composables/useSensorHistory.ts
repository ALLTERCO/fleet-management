import {onScopeDispose, type Ref, ref, watch} from 'vue';
import type {
    SensorEventRow,
    SensorEventsResponse,
    SensorQueryRow,
    SensorQueryResponse,
    SensorSource
} from '@api/sensor';
import {virtualDevices} from '@host/virtualDevices';
import {useDevicesStore} from '@/stores/devices';
import * as ws from '@/tools/websocket';
import type {entity_t} from '@/types';

// Card-side reads of the sensor history the backend already exposes:
// Sensor.Query (the forever 15-minute numeric rollup) and Sensor.Events
// (append-only state changes). No new endpoint — the same two methods the
// Environment dashboard calls.

// One row per hour over the window: 24 rows per sensor, cheap for a tile.
const BUCKET = '1 hour';
const DAY_MS = 24 * 60 * 60 * 1000;

// The rollup only gains a row every 15 minutes, so a tile re-reading faster
// than that would spend round-trips on identical numbers.
const REFRESH_MS = 5 * 60 * 1000;

export interface Sensor24hStats {
    min: number | null;
    avg: number | null;
    max: number | null;
}

const NO_STATS: Sensor24hStats = {min: null, avg: null, max: null};

/**
 * Readings are stamped on the promoted BLU child device, not the gateway that
 * heard the broadcast — resolve the child by BLE address so a gateway-hosted
 * entity still finds its own history.
 */
function readingDeviceId(entity: entity_t): string | undefined {
    const addr = (entity.properties as {addr?: string})?.addr;
    if (!addr) return entity.source;
    for (const device of Object.values(useDevicesStore().devices)) {
        if (device.info?.bleAddress === addr) return device.shellyID;
    }
    return entity.source;
}

function virtualRole(entity: entity_t): {
    externalId: string;
    roleKey: string;
} | null {
    const roleKey = (entity.properties as {roleKey?: unknown} | undefined)
        ?.roleKey;
    if (
        typeof roleKey !== 'string' ||
        roleKey.length === 0 ||
        !entity.source?.startsWith('vdev_')
    ) {
        return null;
    }
    return {externalId: entity.source, roleKey};
}

// Sensor.Query answers with the ambient sources unless a source is named, so a
// chip-temperature entity has to name its own or its tile stays empty. The
// entity carries the answer; nothing here re-derives it.
function entitySource(entity: entity_t): SensorSource | undefined {
    return (entity.properties as {sensorSource?: SensorSource}).sensorSource;
}

// A device reports many sensors; `channel` is the component id that produced
// the row, which is the entity's own component id.
function onThisChannel(
    row: {channel: number | null},
    channel: number | undefined
): boolean {
    return row.channel == null || channel == null || row.channel === channel;
}

function reduceStats(rows: SensorQueryRow[]): Sensor24hStats {
    if (rows.length === 0) return NO_STATS;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let weighted = 0;
    let samples = 0;
    for (const row of rows) {
        min = Math.min(min, row.min ?? row.value);
        max = Math.max(max, row.max ?? row.value);
        // Buckets hold unequal sample counts, so a plain mean would over-weight
        // a quiet bucket.
        weighted += row.value * row.sampleCount;
        samples += row.sampleCount;
    }
    return {
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
        avg: samples > 0 ? weighted / samples : null
    };
}

function windowNow(spanMs: number): {from: string; to: string} {
    const to = new Date();
    return {from: new Date(to.getTime() - spanMs).toISOString(), to: to.toISOString()};
}

// Re-read on entity change and on a slow timer; both paths share one loader.
function pollWhileMounted(load: () => void, source: () => unknown) {
    watch(source, load, {immediate: true});
    const timer = window.setInterval(load, REFRESH_MS);
    onScopeDispose(() => window.clearInterval(timer));
}

/**
 * Min / average / max of a sensor's readings over the last 24 hours, from
 * `device_sensor.numeric_15min` via Sensor.Query. Nulls until the first
 * response, and null for a sensor with no stored history.
 */
export function useSensor24hStats(
    entity: Ref<entity_t>,
    kinds: Ref<readonly string[]>
): Ref<Sensor24hStats> {
    const stats = ref<Sensor24hStats>(NO_STATS);

    async function load() {
        const role = virtualRole(entity.value);
        if (role) {
            try {
                const res = await virtualDevices.history.readRole({
                    ...role,
                    ...windowNow(DAY_MS),
                    bucket: BUCKET
                });
                stats.value = reduceStats(
                    (res.items ?? []).map((item) => ({
                        value: Number(item.value),
                        min: item.min ?? null,
                        max: item.max ?? null,
                        sampleCount: item.sampleCount ?? 1
                    })) as SensorQueryRow[]
                );
            } catch (err) {
                console.error('[sensor history] virtual 24h stats:', err);
                stats.value = NO_STATS;
            }
            return;
        }
        const shellyID = readingDeviceId(entity.value);
        if (!shellyID || kinds.value.length === 0) {
            stats.value = NO_STATS;
            return;
        }
        const channel = entity.value.properties?.id;
        const source = entitySource(entity.value);
        try {
            const res = await ws.sendRPC<SensorQueryResponse>(
                'FLEET_MANAGER',
                'sensor.query',
                {
                    ...windowNow(DAY_MS),
                    kinds: [...kinds.value],
                    devices: [shellyID],
                    bucket: BUCKET,
                    ...(source ? {source} : {})
                }
            );
            stats.value = reduceStats(
                (res?.items ?? []).filter((r) => onThisChannel(r, channel))
            );
        } catch (err) {
            console.error('[sensor history] 24h stats:', err);
            stats.value = NO_STATS;
        }
    }

    pollWhileMounted(load, () => [entity.value.id, kinds.value.join(',')]);
    return stats;
}

/**
 * How many times this sensor went active since local midnight, from
 * `device_sensor.events` via Sensor.Events. Null until the first response.
 */
export function useSensorActivationsToday(
    entity: Ref<entity_t>,
    // Live state of the sensor — a fresh activation must show up now, not at
    // the next slow poll.
    isActive?: Ref<boolean>
): Ref<number | null> {
    const count = ref<number | null>(null);

    async function load() {
        const role = virtualRole(entity.value);
        if (role) {
            const midnight = new Date();
            midnight.setHours(0, 0, 0, 0);
            try {
                const res = await virtualDevices.history.readRole({
                    ...role,
                    from: midnight.toISOString(),
                    to: new Date().toISOString()
                });
                count.value = (res.items ?? []).filter(
                    (item) => Number(item.value) === 1
                ).length;
            } catch (err) {
                console.error('[sensor history] virtual activations:', err);
                count.value = null;
            }
            return;
        }
        const shellyID = readingDeviceId(entity.value);
        if (!shellyID) {
            count.value = null;
            return;
        }
        const channel = entity.value.properties?.id;
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        try {
            const res = await ws.sendRPC<SensorEventsResponse>(
                'FLEET_MANAGER',
                'sensor.events',
                {
                    from: midnight.toISOString(),
                    to: new Date().toISOString(),
                    devices: [shellyID]
                }
            );
            // state 1 = the active edge (open / detected); the closing edge is 0.
            count.value = (res?.items ?? []).filter(
                (r: SensorEventRow) => r.state === 1 && onThisChannel(r, channel)
            ).length;
        } catch (err) {
            console.error('[sensor history] activations today:', err);
            count.value = null;
        }
    }

    pollWhileMounted(load, () => [entity.value.id, isActive?.value]);
    return count;
}
