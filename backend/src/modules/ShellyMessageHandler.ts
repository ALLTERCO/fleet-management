import {flattie} from 'flattie';
import * as log4js from 'log4js';
import {tuning} from '../config';
import {statusFieldGroup} from '../config/shelly.dataTypes';
import type {BTHomeActionEvent} from '../model/bthome/bthomeOverview';
import {
    findComponentEvent,
    type ResolvedEvent
} from '../model/component/componentEvents';
import {isWallDisplayInfo} from '../model/deviceCapabilities';
import type ShellyDevice from '../model/ShellyDevice';
import {parseComponentKey} from '../model/ShellyDevice';
import type {
    PathChange,
    ShellyMessageData,
    ShellyMessageIncoming
} from '../types';
import {
    SINGLE_FREQ_FIELD,
    SINGLE_VOLTAGE_FIELD
} from '../types/api/componentPower';
import {boundedLogDedupeSet} from './boundedLogDedupeSet';
import * as DeviceCollector from './DeviceCollector';
import * as DeviceEventLogger from './DeviceEventLogger';
import {getDeviceOrg} from './EventDistributor';
import {emStatsQueue} from './emStatsQueue';
import {
    type ComponentConfigResolver,
    type ComponentSignalResolver,
    captureEnergyRow,
    type EnergyRowInput,
    type ResolvedRowObserver
} from './energyCapture';
import {domainContradictsSignals} from './energyClassifier';
import {energyClassifierCache} from './energyClassifierCache';
import {energyOverrideCache} from './energyOverrideCache';
import {appendEmStats} from './energyRollup';
import {flushLifetimeBatch} from './lifetimeFlush';
import {lifetimeQueue} from './lifetimeQueue';
import * as Observability from './Observability';
import {callMethod, rawCall} from './PostgresProvider';
import {createQueueFlusher} from './queueFlusher';
import {InitEm} from './ShellyEmHandler';
import type {NotifyEventEnvelope} from './ShellyEvents';
import * as ShellyEvents from './ShellyEvents';
import {
    appendEvents,
    appendNumeric,
    classifyNativeNumeric,
    type EventRow,
    type NumericRow,
    type SensorSource
} from './sensorCapture';
import {
    appendStatusBatch,
    appendStatusBatchBestEffort
} from './status/StatusStream';
import {projectPersistedStatusBatch} from './status/statusProjection';
import {toEpochSeconds} from './util/epochSeconds';
import {isPlainObject} from './util/isPlainObject';

const logger = log4js.getLogger('message-parser');

// Bounded dedup keyed on (componentType, event) so same name on two
// components both surface and hostile firmware can't grow it forever.
const loggedUnknownEvents = boundedLogDedupeSet();
function unknownEventKey(component: unknown, eventName: string): string {
    const type = typeof component === 'string' ? component.split(':')[0] : '';
    return `${type}|${eventName}`;
}

// Walks FM component-class declarations first (doc-grounded SoT), then
// the device's live Webhook.ListAllSupported catalog. Same pattern as
// Matter cluster XML + openHAB thing-type XML: schema lives in code,
// device data is a discovery/validation signal.
function resolveEvent(
    shelly: ShellyDevice,
    component: unknown,
    eventName: string
): ResolvedEvent | undefined {
    return findComponentEvent({
        componentKey: component,
        eventName,
        deviceCatalog: shelly.eventCatalog
    });
}

// Narrows the resolver output to the on-the-wire descriptor shape
// (attrs-bearing). Notification-only events with no attrs collapse to
// undefined so the emitter renders `schema: null` consistently.
function toDeviceEventDescriptor(
    resolved: ResolvedEvent | undefined
):
    | {attrs: ReadonlyArray<{name: string; type: string; desc: string}>}
    | undefined {
    const attrs = resolved?.descriptor.attrs;
    if (!attrs || attrs.length === 0) return undefined;
    return {attrs};
}

// Redacts common secret keys + caps payload at 2 KB so a hostile or
// noisy device payload can't bloat the log line.
const SECRET_KEY_RE = /secret|password|token|key/i;
const RAW_EVENT_MAX_CHARS = 2048;
// A presence sensor reports one entry per tracked object; cap the forwarded
// array so a malformed or hostile device can't amplify a huge payload to every
// org UI. Real sensors report a handful.
const PRESENCE_TRACK_MAX_OBJECTS = 128;
function safeStringifyRawEvent(raw: Record<string, unknown>): string {
    const json = JSON.stringify(raw, (key, value) =>
        SECRET_KEY_RE.test(key) && typeof value === 'string' ? '***' : value
    );
    return json.length > RAW_EVENT_MAX_CHARS
        ? `${json.slice(0, RAW_EVENT_MAX_CHARS)}…(truncated, ${json.length}B)`
        : json;
}

// One-shot WARN with full diagnostic so we can root-cause without guessing.
function logUnknownEventDiagnostic(
    shelly: ShellyDevice,
    component: unknown,
    eventName: string,
    rawEvent: Record<string, unknown>
): void {
    const catalog = shelly.eventCatalog;
    const entriesForName =
        catalog?.byEventName
            .get(eventName)
            ?.map((d) => `${d.component}.${d.event}`) ?? [];
    const knownComponents = catalog
        ? [...new Set(catalog.all.map((d) => d.component))].sort()
        : [];
    logger.warn(
        'Unknown device event "%s" — auto-forwarded. shellyID=%s component=%s fw=%s catalog=%s catalogSize=%d catalogComplete=%s entriesForName=%s knownComponents=%s rawEvent=%s',
        eventName,
        shelly.shellyID,
        String(component),
        shelly.info?.fw_id ?? 'unknown',
        catalog ? 'present' : 'absent',
        catalog?.all.length ?? 0,
        catalog ? (catalog.complete ? 'true' : 'false') : 'n/a',
        entriesForName.length ? entriesForName.join(',') : 'none',
        knownComponents.length ? knownComponents.join(',') : 'none',
        safeStringifyRawEvent(rawEvent)
    );
}

function broadcastUmbrellaDeviceEvent(
    shelly: ShellyDevice,
    rawEvent: Record<string, unknown>,
    resolved: ResolvedEvent | undefined
): void {
    const component =
        typeof rawEvent.component === 'string' ? rawEvent.component : '';
    const eventName = typeof rawEvent.event === 'string' ? rawEvent.event : '';
    if (!component || !eventName) return;
    // Persist + live-stream the device-reported event (button push, etc.) into
    // the change journal alongside status deltas.
    DeviceEventLogger.captureDeviceEvent({
        device: shelly,
        component,
        event: eventName,
        data: rawEvent.data,
        tsEpochSec: typeof rawEvent.ts === 'number' ? rawEvent.ts : undefined
    });
    ShellyEvents.broadcastDeviceEventForBackend({
        device: shelly,
        raw: rawEvent as NotifyEventEnvelope,
        descriptor: toDeviceEventDescriptor(resolved),
        descriptorSource: resolved?.source ?? null
    });
}

let statusDrops = 0;
function emptyStatusPushQueue(): t_intermid_1 {
    return {
        p_ts: [],
        p_id: [],
        p_field: [],
        p_field_group: [],
        p_value: [],
        p_prev_value: []
    };
}
let status_push_queue: t_intermid_1 = emptyStatusPushQueue();
let statusQueueOrgIds = new Set<string>();
let statusFlushInProgress = false;
let lastFlushMs = 0;
let lastFlushBatchSize = 0;
let statusFlushTimer: ReturnType<typeof setInterval> | undefined;
let inFlightStatusFlush: Promise<void> | null = null;

// Pending message buffer — hot path just pushes here.
// `changes` is the field-level diff computed by AbstractDevice.merge
// at patch time. Cold-path flush reads prev from here instead of
// round-tripping to PG (Phase 2.2a).
export type PendingMessage = {
    ts: number;
    // Server receive time; fallback when the device omits a valid `ts`.
    receivedAtSec: number;
    deviceId: number;
    // Shelly device ID — stable string key the classifier uses to
    // reach the parent device's config + cache its tier-3/4 result.
    shellyId: string;
    params: Record<string, any>;
    changes: PathChange[];
};
const pendingMessages: PendingMessage[] = [];

export interface StatusValueInput {
    ts: number;
    deviceId: number;
    shellyId: string;
    organizationId?: string;
    field: string;
    value: number;
    previousValue?: unknown;
}

// Spill batches to the DLQ stream with explicit error logging — the
// status-flush hot path used to fire-and-forget with `void`, which left
// Redis outages as silent unhandledRejection warnings.
function spillBatchSafely(
    batch: t_intermid_1,
    organizationIds: readonly string[] = []
): void {
    void appendStatusBatchBestEffort({batch, organizationIds});
}

export function enqueueStatusValues(values: readonly StatusValueInput[]): void {
    const batch = emptyStatusPushQueue();
    const organizationIds = new Set<string>();
    for (const input of values) {
        const group = statusFieldGroup(input.field);
        if (!group || !Number.isFinite(input.value)) continue;
        batch.p_ts.push(
            toEpochSeconds(input.ts, Math.round(Date.now() / 1000))
        );
        batch.p_id.push(input.deviceId);
        batch.p_field.push(input.field);
        batch.p_field_group.push(group);
        batch.p_value.push(input.value);
        batch.p_prev_value.push(
            typeof input.previousValue === 'number' &&
                Number.isFinite(input.previousValue)
                ? input.previousValue
                : input.value
        );
        const organizationId =
            input.organizationId ?? getDeviceOrg(input.shellyId);
        if (organizationId) organizationIds.add(organizationId);
    }
    if (batch.p_ts.length === 0) return;
    if (
        status_push_queue.p_ts.length + batch.p_ts.length >
        tuning.status.queueMax
    ) {
        Observability.incrementCounter('status_queue_spilled');
        spillBatchSafely(batch, [...organizationIds]);
        return;
    }
    for (let i = 0; i < batch.p_ts.length; i++) {
        status_push_queue.p_ts.push(batch.p_ts[i]);
        status_push_queue.p_id.push(batch.p_id[i]);
        status_push_queue.p_field.push(batch.p_field[i]);
        status_push_queue.p_field_group.push(batch.p_field_group[i]);
        status_push_queue.p_value.push(batch.p_value[i]);
        status_push_queue.p_prev_value.push(batch.p_prev_value[i]);
    }
    for (const organizationId of organizationIds) {
        statusQueueOrgIds.add(organizationId);
    }
}

function takeStatusQueue(): {
    batch: t_intermid_1;
    organizationIds: string[];
} {
    const batch = status_push_queue;
    const organizationIds = [...statusQueueOrgIds];
    status_push_queue = emptyStatusPushQueue();
    statusQueueOrgIds = new Set();
    return {batch, organizationIds};
}

function prependStatusQueue(
    batch: t_intermid_1,
    organizationIds: readonly string[]
): void {
    status_push_queue = {
        p_ts: [...batch.p_ts, ...status_push_queue.p_ts],
        p_id: [...batch.p_id, ...status_push_queue.p_id],
        p_field: [...batch.p_field, ...status_push_queue.p_field],
        p_field_group: [
            ...batch.p_field_group,
            ...status_push_queue.p_field_group
        ],
        p_value: [...batch.p_value, ...status_push_queue.p_value],
        p_prev_value: [...batch.p_prev_value, ...status_push_queue.p_prev_value]
    };
    for (const orgId of organizationIds) statusQueueOrgIds.add(orgId);
}

async function appendStatusQueueToRedis(input: {
    batch: t_intermid_1;
    organizationIds: readonly string[];
}): Promise<void> {
    const appendStart = performance.now();
    await appendStatusBatch(input);
    Observability.recordDbTiming(
        'status_stream_append',
        performance.now() - appendStart
    );
}

// Build a status batch without the cold-start PG seed — prev comes from the
// in-event diff, else falls back to value (delta=0). Used to spill to the DLQ.
function pendingMessageToStatusBatch(msg: PendingMessage): t_intermid_1 {
    const out = emptyStatusPushQueue();
    const prevByField = new Map<string, unknown>();
    for (const c of msg.changes) prevByField.set(c.path, c.prev);
    const {ts: rawTs, ...components} = msg.params;
    const tsSec = toEpochSeconds(rawTs, msg.receivedAtSec);
    const flat = flattie(components);
    for (const k of Object.keys(flat)) {
        const group = statusFieldGroup(k);
        if (group === undefined) continue;
        const v = flat[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const prev = prevByField.get(k);
        out.p_ts.push(tsSec);
        out.p_id.push(msg.deviceId);
        out.p_field.push(k);
        out.p_field_group.push(group);
        out.p_value.push(v);
        out.p_prev_value.push(typeof prev === 'number' ? prev : v);
    }
    return out;
}

// On queue-full, spill to the DLQ instead of dropping so at-least-once holds.
// Empty batches (no float fields) need no spill.
function spillOverflowMessage(msg: PendingMessage): void {
    const batch = pendingMessageToStatusBatch(msg);
    if (batch.p_ts.length === 0) return;
    Observability.incrementCounter('status_queue_spilled');
    const orgId = getDeviceOrg(msg.shellyId);
    spillBatchSafely(batch, orgId ? [orgId] : []);
}

// Process buffered messages → flush the status queue to PG once.
// Shared by the periodic timer and the graceful-shutdown drain so the last
// batch isn't dropped on reboot.
async function flushStatusQueueOnce(): Promise<void> {
    if (pendingMessages.length > 0) {
        const batch = pendingMessages.splice(0);
        const processStart = performance.now();
        await processPendingMessages(batch);
        Observability.recordDbTiming(
            'status_process',
            performance.now() - processStart
        );
    }

    const sl = status_push_queue.p_ts.length;
    if (!sl) return;
    lastFlushBatchSize = sl;
    const {batch: toFlush, organizationIds} = takeStatusQueue();
    statusFlushInProgress = true;
    if (tuning.status.redisFirst) {
        try {
            await appendStatusQueueToRedis({batch: toFlush, organizationIds});
        } catch (e) {
            Observability.incrementCounter('status_stream_append_errors');
            Observability.incrementCounter('status_stream_degraded');
            logger.error('status Redis-first append failed:', e);
            prependStatusQueue(toFlush, organizationIds);
        } finally {
            statusFlushInProgress = false;
        }
        return;
    }
    if (Observability.isDbWritesDisabled()) {
        Observability.incrementCounter('status_flushes_skipped');
        // Spill instead of clearing — DLQ stream drains when PG resumes.
        spillBatchSafely(toFlush, organizationIds);
        statusFlushInProgress = false;
        return;
    }
    if (tuning.status.redisShadow) {
        appendStatusQueueToRedis({batch: toFlush, organizationIds}).catch(
            (e) => {
                Observability.incrementCounter('status_stream_append_errors');
                logger.warn('status shadow append failed: %s', e);
            }
        );
    }
    Observability.incrementCounter('status_flushes');
    const flushStart = performance.now();
    try {
        logger.info('---->>> Syncing status, length %d', sl);
        await rawCall('device.fn_status_push', toFlush);
        try {
            await projectPersistedStatusBatch(toFlush);
        } catch (error) {
            Observability.incrementCounter('virtual_projection_drain_errors');
            logger.warn(
                'status projection failed (non-fatal): %s',
                error instanceof Error ? error.message : String(error)
            );
        }
        const flushElapsed = performance.now() - flushStart;
        lastFlushMs = flushElapsed;
        Observability.recordDbTiming('status_flush', flushElapsed);
    } catch (e) {
        logger.error('Failed to flush status queue:', e);
        Observability.incrementCounter('status_flush_errors');
        // Spill to DLQ so the drainer can replay when PG recovers.
        spillBatchSafely(toFlush, organizationIds);
    } finally {
        statusFlushInProgress = false;
    }
}

// Merged interval: process buffered messages → flush to DB. The in-flight
// promise serialises ticks and lets shutdown await the active flush.
// Deferred start — tuning is not available at module load time due to import order.
function startStatusFlushInterval() {
    statusFlushTimer = setInterval(() => {
        void runStatusFlush();
    }, tuning.status.flushIntervalMs);
    statusFlushTimer.unref?.();
}
process.nextTick(startStatusFlushInterval);

async function runStatusFlush(): Promise<void> {
    if (inFlightStatusFlush) return inFlightStatusFlush;
    inFlightStatusFlush = flushStatusQueueOnce().finally(() => {
        inFlightStatusFlush = null;
    });
    return inFlightStatusFlush;
}

// device_em.stats + device_em.lifetime_counters flushes use the same
// drain→flush→retry-on-failure→drop-on-overflow loop. Cadence (2 min)
// kept identical so each lifetime UPSERT lands in lockstep with the
// em_stats rows it was derived from.
const FLUSH_INTERVAL_MS = 120_000;
const FLUSH_RETRY_MAX = 50_000;

const emStatsFlusher = createQueueFlusher({
    name: 'em_stats',
    queue: emStatsQueue,
    // This is the 15-second live status pipeline — the secondary series.
    flush: (batch) =>
        appendEmStats({...batch, p_source: 'live'}, {callDb: callMethod}),
    batchSize: (batch) => batch.p_ts.length,
    intervalMs: FLUSH_INTERVAL_MS,
    retryMax: FLUSH_RETRY_MAX
});

const lifetimeFlusher = createQueueFlusher({
    name: 'lifetime',
    queue: lifetimeQueue,
    flush: flushLifetimeBatch,
    batchSize: (batch) => batch.p_ts.length,
    intervalMs: FLUSH_INTERVAL_MS,
    retryMax: FLUSH_RETRY_MAX
});

// Graceful-shutdown drain: stop the timers and write every in-memory buffer
// (status, em_stats, lifetime) to PG once, so a reboot doesn't drop them.
// Called from onShutdown after device frames stop, before the PG pool closes.
export async function flushPendingOnShutdown(): Promise<void> {
    if (statusFlushTimer) clearInterval(statusFlushTimer);
    await runStatusFlush();
    await emStatsFlusher.stop();
    await lifetimeFlusher.stop();
}

export async function flushBeforeDeviceIdentityChange(): Promise<void> {
    await runStatusFlush();
    await emStatsFlusher.flushNow();
    await lifetimeFlusher.flushNow();
}

// Match energy-related fields from flattened NotifyStatus.
// Group 1: component type, Group 2: instance, Group 3: optional phase (a/b/c),
// Group 4: field name (current, voltage, act_power, etc.)
// PM1 docs use `aprtpower` (no underscore) for apparent power; EM / Switch
// / Cover use `aprt_power`. Both spellings accepted so PM1's apparent
// power isn't silently dropped.
export const EM_STATS_FIELD_RE =
    /^(switch|pm1|cover|em|em1|light|rgb|rgbw|cct|rgbcct):(\d+)\.(?:([abc])_)?(current|voltage|apower|act_power|aprt_power|aprtpower|pf|freq|total_act_power|total_aprt_power|total_current|n_current|aenergy\.total|ret_aenergy\.total)$/;

export const EM_STATS_TAG_MAP: Record<string, {tag: string; isDelta: boolean}> =
    {
        current: {tag: 'current', isDelta: false},
        voltage: {tag: 'voltage', isDelta: false},
        apower: {tag: 'power', isDelta: false},
        act_power: {tag: 'power', isDelta: false},
        aprt_power: {tag: 'apparent_power', isDelta: false},
        aprtpower: {tag: 'apparent_power', isDelta: false},
        pf: {tag: 'power_factor', isDelta: false},
        freq: {tag: 'frequency', isDelta: false},
        total_act_power: {tag: 'total_power', isDelta: false},
        total_aprt_power: {tag: 'total_apparent_power', isDelta: false},
        total_current: {tag: 'total_current', isDelta: false},
        n_current: {tag: 'neutral_current', isDelta: false},
        'aenergy.total': {tag: 'total_act_energy', isDelta: true},
        'ret_aenergy.total': {tag: 'total_act_ret_energy', isDelta: true}
    };

const em = InitEm();

// Seeds the EM sync queue from devices already loaded by DeviceCollector
// before any NotifyStatus arrives. Idempotent — safe to call multiple times.
export async function seedEmSyncFromDeviceCollector(): Promise<void> {
    // DeviceCollector holds ShellyDevice instances at runtime (the only
    // concrete subclass of AbstractDevice produced by ShellyDeviceFactory).
    await em.seedFromDevices(DeviceCollector.getAll() as ShellyDevice[]);
}
type shelly_event_t =
    | 'config_changed'
    | 'component_added'
    | 'component_removed'
    | 'device_discovered' // bthome discovery result
    | 'discovery_done' // bthome discovery finished
    | 'scan_complete' // dali bus scan finished
    | 'ping_complete' // dali ping finished
    | 'single_push'
    | 'double_push'
    | 'triple_push'
    | 'long_push'
    | 'long_double_push'
    | 'long_triple_push'
    | 'rotate_left'
    | 'rotate_right'
    | 'hold_press' // BLU Wall EU/US 4-button devices, fw 1.0.23+
    | 'track' // presence sensor live tracking object detected
    | 'no_track' // presence sensor live tracking: no objects
    | 'ota_begin' // firmware update started
    | 'ota_progress' // firmware update progress (has progress_percent)
    | 'ota_success' // firmware update completed, device will reboot
    | 'ota_error' // firmware update failed
    | 'sleep' // battery device about to sleep; ts marker for read paths
    | 'media_ready' // camera: image/video finalized on device
    | 'upload_complete' // camera: media uploaded to cloud
    | 'upload_failed'; // camera: media upload to cloud failed

// Catalog cache must drop when firmware republishes its event vocabulary.
const priorCfgRev = new WeakMap<ShellyDevice, number>();

function resolveDiscoveryRssi(event: any): number | undefined {
    if (typeof event?.rssi === 'number') return event.rssi;
    if (typeof event?.device?.rssi === 'number') return event.device.rssi;
    return undefined;
}

// Resolved context handed to every per-family NotifyEvent handler. `event` is
// the firmware-shaped payload — untyped like the raw NotifyEvent frame the
// switch read directly, so field access stays cast-free.
interface DeviceEventContext {
    shelly: ShellyDevice;
    component: string;
    evt: shelly_event_t;
    event: any;
    resolved: ResolvedEvent | undefined;
}

type DeviceEventHandler = (ctx: DeviceEventContext) => void;

// The nine BTHome action events share one handler. Kept as a set so the same
// list narrows the type (isButtonEvent) and populates the dispatch map.
const BUTTON_EVENTS: ReadonlySet<BTHomeActionEvent> = new Set([
    'single_push',
    'double_push',
    'triple_push',
    'long_push',
    'long_double_push',
    'long_triple_push',
    'rotate_left',
    'rotate_right',
    'hold_press'
]);

function isButtonEvent(evt: shelly_event_t): evt is BTHomeActionEvent {
    return (BUTTON_EVENTS as ReadonlySet<string>).has(evt);
}

function handleConfigChangedEvent({
    shelly,
    component,
    event
}: DeviceEventContext): void {
    onConfigChange(shelly, component, event.data);
}

function handleComponentLifecycle({
    shelly,
    evt,
    event
}: DeviceEventContext): void {
    if (evt === 'component_added') {
        // Non-string target would throw and abort sibling events.
        if (typeof event.target !== 'string') {
            logger.warn(
                'component_added with non-string target from %s — skipped',
                shelly.shellyID
            );
            return;
        }
        logger.info('Component added', event.target);
        // Fire-and-forget probe: surface a probe/compose
        // failure instead of leaking an unhandled rejection.
        Promise.resolve(shelly.fetchComponent(event.target)).catch((err) => {
            logger.warn(
                'fetchComponent failed for %s on %s: %s',
                event.target,
                shelly.shellyID,
                err instanceof Error ? err.message : String(err)
            );
        });
        return;
    }
    // component_removed
    if (typeof event.target !== 'string') {
        logger.warn(
            'component_removed with non-string target from %s — skipped',
            shelly.shellyID
        );
        return;
    }
    shelly.removeComponent(event.target);
}

function handleButtonEvent({
    shelly,
    component,
    evt,
    event
}: DeviceEventContext): void {
    // The map only routes the nine BTHome action events here.
    if (!isButtonEvent(evt)) return;
    shelly.forwardComponentEvent(component, evt);
    if (
        typeof component === 'string' &&
        component.startsWith('bthomedevice:')
    ) {
        shelly.rememberBTHomeRuntimeEvent(
            component,
            evt,
            event.idx ?? null,
            event.channel ?? null,
            event.ts ?? null
        );
    } else {
        shelly.setComponentStatus(component, {
            last_event: evt,
            last_event_idx: event.idx ?? 0,
            last_event_ts: event.ts
        });
    }
}

function handlePresenceTrack({
    shelly,
    component,
    evt,
    event
}: DeviceEventContext): void {
    if (evt === 'track') {
        if (component === 'presence') {
            const objects = Array.isArray(event.object)
                ? event.object.slice(0, PRESENCE_TRACK_MAX_OBJECTS)
                : [];
            ShellyEvents.emitShellyPresenceTrack(
                shelly,
                objects,
                event.ts ?? 0
            );
        }
        return;
    }
    // no_track
    if (component === 'presence') {
        ShellyEvents.emitShellyPresenceTrack(shelly, [], event.ts ?? 0);
    }
}

function handleBthomeDiscovery({shelly, evt, event}: DeviceEventContext): void {
    if (evt === 'device_discovered') {
        const addr = event?.device?.addr;
        if (typeof addr !== 'string') return;
        const rssi = resolveDiscoveryRssi(event);
        shelly.rememberBTHomeDiscovery({
            addr,
            localName: event.device.local_name ?? 'unknown',
            modelNumericId: event.device.shelly_mfdata?.model_id,
            rssi,
            ts: event.ts
        });
        ShellyEvents.emitBTHomeDiscoveryResult(
            event.device.local_name ?? 'unknown',
            addr,
            shelly.shellyID,
            event.device.shelly_mfdata?.model_id,
            rssi
        );
        logger.info(
            'BTHome device discovered %s (%s) model_id:%s from %s',
            event.device.local_name ?? 'unknown',
            addr,
            event.device.shelly_mfdata?.model_id ?? 'n/a',
            shelly.shellyID
        );
        return;
    }
    // discovery_done
    // {"component":"bthome","event":"discovery_done","device_count":1,"ts":1733001388.36}
    logger.info(
        'BTHome discovery done',
        event.device_count,
        'for',
        shelly.shellyID
    );
    ShellyEvents.emitShellyDiscoveryDone(shelly.shellyID, event.device_count);
}

function handleDaliEvent({shelly, evt, event}: DeviceEventContext): void {
    if (evt === 'scan_complete') {
        // {"component":"dali","event":"scan_complete","cg_count":2,"ts":...}
        logger.info(
            'DALI scan complete on %s, cg_count: %d',
            shelly.shellyID,
            event.cg_count
        );
        shelly.setComponentStatus('dali', {cg_count: event.cg_count});
        return;
    }
    // ping_complete: {"component":"dali","event":"ping_complete","ts":...}
    logger.info('DALI ping complete on %s', shelly.shellyID);
    // Patch status so frontend can detect completion reactively
    shelly.setComponentStatus('dali', {ping_complete_ts: event.ts});
}

function handleOta({shelly, evt, event}: DeviceEventContext): void {
    if (evt === 'ota_success') {
        handleOtaSuccess(shelly, event);
        return;
    }
    // ota_begin | ota_progress | ota_error — live progress broadcast.
    if (evt === 'ota_begin' || evt === 'ota_progress' || evt === 'ota_error') {
        ShellyEvents.emitShellyOtaProgress(
            shelly,
            evt,
            event.progress_percent,
            event.msg
        );
    }
}

function handleSleepEvent({shelly, event}: DeviceEventContext): void {
    handleSleep(shelly, event);
}

function handleCameraMedia({
    shelly,
    component,
    evt,
    event,
    resolved
}: DeviceEventContext): void {
    patchCameraMedia(shelly, component, evt, event);
    // Keep UI/bus parity with the old default-branch route.
    ShellyEvents.emitDeviceEvent({
        device: shelly,
        raw: event,
        descriptor: toDeviceEventDescriptor(resolved)
    });
}

// Default arm: forward any event kind not in the dispatch map, counting the
// firehose and diagnosing genuinely-unknown (unresolved) events once.
function handleUnknownEvent({
    shelly,
    component,
    evt,
    event,
    resolved
}: DeviceEventContext): void {
    // Firehose volume — every event hitting default.
    // Replaces the old meaning of unknown_device_event.
    Observability.incrementCounter('device_event_default_route');
    if (!resolved) {
        // Genuinely-unknown volume; resolved events
        // are forwarded silently.
        Observability.incrementCounter('unknown_device_event');
        const dedupeKey = unknownEventKey(component, evt);
        if (!loggedUnknownEvents.has(dedupeKey)) {
            loggedUnknownEvents.record(dedupeKey);
            logUnknownEventDiagnostic(shelly, component, evt, event);
        }
    }
    ShellyEvents.emitDeviceEvent({
        device: shelly,
        raw: event,
        descriptor: toDeviceEventDescriptor(resolved)
    });
}

// Strategy map: NotifyEvent kind -> per-family handler. Kinds absent here fall
// through to handleUnknownEvent — the same set the old switch's default arm
// caught. Button events are registered from BUTTON_EVENTS so the list has a
// single home.
const deviceEventHandlers: Partial<Record<shelly_event_t, DeviceEventHandler>> =
    {
        config_changed: handleConfigChangedEvent,
        component_added: handleComponentLifecycle,
        component_removed: handleComponentLifecycle,
        track: handlePresenceTrack,
        no_track: handlePresenceTrack,
        device_discovered: handleBthomeDiscovery,
        discovery_done: handleBthomeDiscovery,
        scan_complete: handleDaliEvent,
        ping_complete: handleDaliEvent,
        ota_begin: handleOta,
        ota_progress: handleOta,
        ota_error: handleOta,
        ota_success: handleOta,
        sleep: handleSleepEvent,
        media_ready: handleCameraMedia,
        upload_complete: handleCameraMedia,
        upload_failed: handleCameraMedia
    };
for (const action of BUTTON_EVENTS) {
    deviceEventHandlers[action] = handleButtonEvent;
}

export function handleMessage(
    shelly: ShellyDevice,
    res: ShellyMessageIncoming,
    req?: ShellyMessageData
) {
    // period updates
    em.evaluate(res, shelly);
    if (res.method === 'NotifyStatus') {
        // Skip malformed params rather than throw away the update.
        if (!isPlainObject(res.params)) {
            Observability.incrementCounter('notify_status_malformed');
            logger.warn(
                'NotifyStatus with non-object params from %s — skipped',
                shelly.shellyID
            );
            return;
        }
        // Patch first so the merge runs and we capture {path, prev, next}
        // for the flush path — eliminates the per-field fn_status_last_value
        // N+1 in processPendingMessages.
        const changes = patchStatus(shelly, res.params);
        statusSelectivePush(res, shelly, changes);
    } else if (res.method === 'NotifyEvent') {
        if (
            typeof res.params?.events === 'object' &&
            Array.isArray(res.params.events)
        ) {
            for (const event of res.params.events) {
                if (
                    event === null ||
                    typeof event !== 'object' ||
                    Array.isArray(event)
                ) {
                    continue;
                }

                const {
                    event: evt,
                    component
                }: {event: shelly_event_t; component: string} = event;

                // Resolve once per event. Backend bus + the default
                // fall-through both reuse this — avoids O(N) double work.
                const resolved = resolveEvent(shelly, component, evt);

                // Backend-internal fan-out for every event. UI traffic
                // still flows via the per-family default-branch emission.
                broadcastUmbrellaDeviceEvent(shelly, event, resolved);

                // Dispatch each kind to its family handler; unmapped kinds
                // fall through to the default forwarder.
                const handler = deviceEventHandlers[evt] ?? handleUnknownEvent;
                handler({shelly, component, evt, event, resolved});
            }
        }
    }

    // logger.debug("new message shelly_id:[%s] msg:[%s]", shelly.shellyID, JSON.stringify(res));
    ShellyEvents.emitShellyMessage(shelly, res, req);
}

function patchStatus(
    shelly: ShellyDevice,
    data: Record<string, any>
): PathChange[] {
    const patch: Record<string, any> = {};
    for (const key in data) {
        if (key === 'ts') continue;
        patch[key] = data[key];
    }
    return shelly.batchSetComponentStatus(patch);
}

type t_intermid_1 = {
    p_ts: number[];
    p_id: number[];
    p_field: string[];
    p_field_group: string[];
    p_value: number[];
    p_prev_value: number[];
};

// Hot path: just buffer the raw message + the merge diff (O(1), <1μs)
export function statusSelectivePush(
    req: ShellyMessageIncoming,
    device: ShellyDevice,
    changes: PathChange[] = []
) {
    Observability.incrementCounter('status_messages');
    // Capture the deltas into the durable device event log first — before the
    // telemetry-buffer drop guard below, so a full status buffer never costs
    // us an audit row. The logger has its own bounded queue.
    DeviceEventLogger.captureChanges({
        device,
        tsEpochSec: req.params.ts,
        changes
    });
    const message: PendingMessage = {
        ts: req.params.ts,
        receivedAtSec: Math.floor(Date.now() / 1000),
        deviceId: device.id,
        shellyId: device.shellyID,
        params: req.params,
        changes
    };
    if (pendingMessages.length >= tuning.status.queueMax) {
        statusDrops++;
        Observability.incrementCounter('status_queue_drops');
        spillOverflowMessage(message);
        return;
    }
    pendingMessages.push(message);
}

// Cold path: process buffered messages into flush queue (runs in 250ms
// interval).
//
// Phase 2.2a — prev values come from the in-event diff (msg.changes)
// computed by AbstractDevice.batchSetComponentStatus at patch time. When
// the diff says prev=undefined (first message for the field since the
// device connected after a restart), fall back to a SINGLE batched
// fn_status_last_values call per device-batch — no per-field N+1.
export async function processPendingMessages(batch: PendingMessage[]) {
    // Build a {deviceId → {field → prev}} lookup from the in-event diffs.
    // For each leaf change emitted by the merge we already have prev.
    const prevByDevice = new Map<number, Map<string, unknown>>();
    for (const msg of batch) {
        let perField = prevByDevice.get(msg.deviceId);
        if (!perField) {
            perField = new Map();
            prevByDevice.set(msg.deviceId, perField);
        }
        for (const c of msg.changes) perField.set(c.path, c.prev);
    }

    // Identify (device, field) pairs we'd need a cold-start PG seed for —
    // fields the flush cares about whose prev is undefined in the diff.
    const seedNeeded = new Map<number, Set<string>>();
    for (const msg of batch) {
        const {ts: _ts, ...components} = msg.params;
        const flat = flattie(components);
        const perField = prevByDevice.get(msg.deviceId)!;
        for (const k of Object.keys(flat)) {
            if (statusFieldGroup(k) === undefined) continue;
            if (perField.get(k) !== undefined) continue;
            let s = seedNeeded.get(msg.deviceId);
            if (!s) {
                s = new Set();
                seedNeeded.set(msg.deviceId, s);
            }
            s.add(k);
        }
    }

    // One batched PG round-trip per device that needs a seed (boot-time
    // cold start only — once the merge runs, prev for the next batch
    // comes from in-memory device.#status with zero PG traffic).
    if (tuning.status.redisFirst) {
        seedNeeded.clear();
    }
    for (const [deviceId, fields] of seedNeeded) {
        try {
            const {rows} = await rawCall('device.fn_status_last_values', {
                p_id: deviceId,
                p_fields: Array.from(fields)
            });
            const perField = prevByDevice.get(deviceId)!;
            for (const r of rows as Array<{
                field: string;
                last_value: number | null;
            }>) {
                if (
                    r.last_value !== null &&
                    perField.get(r.field) === undefined
                ) {
                    perField.set(r.field, r.last_value);
                }
            }
        } catch (e) {
            logger.warn(
                'cold-start prev-value seed failed device=%d: %s',
                deviceId,
                e
            );
        }
    }

    // Now walk every message and push to the flush queue using the
    // resolved prev values.
    const numericRows: NumericRow[] = [];
    const eventRows: EventRow[] = [];
    for (const msg of batch) {
        const {ts: rawTs, ...components} = msg.params;
        const tsSec = toEpochSeconds(rawTs, msg.receivedAtSec);
        const d = flattie(components);
        const perField = prevByDevice.get(msg.deviceId)!;
        try {
            for (const k of Object.keys(d)) {
                const group = statusFieldGroup(k);
                if (group === undefined) continue;

                const v = d[k];
                // Errored meter channels report null; skip non-finite so they
                // don't poison the status batch + energy queue (matches the
                // EM-sync guard in ShellyEmHandler).
                if (typeof v !== 'number' || !Number.isFinite(v)) continue;
                const lastVal = perField.get(k);
                status_push_queue.p_ts.push(tsSec);
                status_push_queue.p_id.push(msg.deviceId);
                status_push_queue.p_field.push(k);
                status_push_queue.p_field_group.push(group);
                status_push_queue.p_value.push(v);
                status_push_queue.p_prev_value.push(
                    typeof lastVal === 'number' ? lastVal : v
                );
                const orgId = getDeviceOrg(msg.shellyId);
                if (orgId) statusQueueOrgIds.add(orgId);

                // Energy/power capture path. Two implementations gated by
                // tuning.energyClassifier — see docs/architecture/
                // energy-storage-reference.md section 7.3 for the rollout
                // matrix.
                routeEnergyRow({
                    componentKey: extractComponentKey(k),
                    fieldName: extractFieldName(k),
                    deviceId: msg.deviceId,
                    shellyId: msg.shellyId,
                    value: v,
                    lastValue: lastVal,
                    ts: tsSec
                });

                // Forever sensor rollup (temperature/humidity today; more
                // native kinds land as classifyNativeNumeric grows), captured
                // here like energy so it is independent of the flush mode
                // (direct or redis-first).
                const numeric = classifyNativeNumeric(k);
                if (numeric) {
                    numericRows.push({
                        device: msg.deviceId,
                        source: resolveNativeSensorSource(
                            msg.shellyId,
                            numeric.channel,
                            numeric.embedded
                        ),
                        kind: numeric.kind,
                        channel: numeric.channel,
                        ts: tsSec,
                        val: v
                    });
                }

                // Keep perField current for any later messages from the
                // same device in this same batch — successive messages
                // see "previous" as the most-recent v.
                perField.set(k, v);
            }
            // Native binary sensors (flood/smoke/occupancy): msg.changes is
            // this exact message's merge diff (AbstractDevice.mergeStatusAndDiff),
            // so "this leaf is a binary sensor and appears in the diff" IS the
            // edge — no separate change-tracking needed, and it can't false-fire
            // on a resend of an unchanged sibling field in the same component.
            captureNativeBinaryEvents(msg, tsSec, eventRows);
        } catch (e) {
            logger.error('Collect device status: ', e);
        }
    }
    // Isolated: appendNumeric/appendEvents never throw, so they cannot affect the status flush.
    void appendNumeric(numericRows, {callDb: rawCall});
    void appendEvents(eventRows, {callDb: rawCall});
}

// Native sensorSource — mirrors EntityComposer's per-component parsers
// (temperature/humidity/devicepower): Wall Display + config.sys.ext_sensor_id
// is a paired BLU sensor; component id >= 100 with an addon board attached is
// an addon; everything else is the device's own sensor. `embedded` (a
// switch/light/cover's own chip temperature) is always internal, no lookup
// needed. Wall Display detection reuses the real exported helper; the addon
// check is mirrored (not exported) because this task keeps the diff to
// ShellyMessageHandler.ts/ShellyDevice.ts — EntityComposer.ts owns the SSOT.
function resolveNativeSensorSource(
    shellyId: string,
    componentId: number,
    embedded: boolean
): SensorSource {
    if (embedded) return 'internal';
    const device = DeviceCollector.getDevice(shellyId);
    if (
        device &&
        isWallDisplayInfo(device.info) &&
        device.config.sys?.ext_sensor_id
    ) {
        return 'blu';
    }
    const isAddon =
        componentId >= 100 && !!device?.config.sys?.device?.addon_type;
    return isAddon ? 'addon' : 'builtin';
}

// Native binary leaf -> event kind. Field names confirmed against the Shelly
// API docs (Flood.GetStatus.alarm, Smoke.GetStatus.alarm) and FM's own
// occupancy:N.value (Wall Display binary presence — see types.ts
// occupancy_entity; Presence.GetStatus has no binary field, only live_track
// metadata, so it is intentionally not wired here).
const NATIVE_BINARY_LEAF: Record<string, {kind: string; leaf: string}> = {
    flood: {kind: 'flood', leaf: 'alarm'},
    smoke: {kind: 'smoke', leaf: 'alarm'},
    occupancy: {kind: 'occupancy', leaf: 'value'}
};

function classifyNativeBinary(
    field: string
): {kind: string; channel: number} | null {
    const m = /^([a-z]+):(\d+)\.([a-zA-Z]+)$/.exec(field);
    if (!m) return null;
    const def = NATIVE_BINARY_LEAF[m[1]];
    if (!def || def.leaf !== m[3]) return null;
    return {kind: def.kind, channel: Number(m[2])};
}

// Native binary fields are booleans on the wire; numeric 0/1 accepted in
// case firmware ever reports pre-coerced. Anything else isn't a valid
// reading (skip rather than guess).
function toNativeBinaryState(value: unknown): number | null {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === 0 || value === 1) return value;
    return null;
}

// One message's merge diff already says exactly which leaves flipped —
// walk it instead of re-deriving change detection over the flattened status.
function captureNativeBinaryEvents(
    msg: PendingMessage,
    tsSec: number,
    eventRows: EventRow[]
): void {
    for (const change of msg.changes) {
        const binary = classifyNativeBinary(change.path);
        if (!binary) continue;
        const state = toNativeBinaryState(change.next);
        if (state === null) continue;
        eventRows.push({
            device: msg.deviceId,
            source: resolveNativeSensorSource(
                msg.shellyId,
                binary.channel,
                false
            ),
            kind: binary.kind,
            channel: binary.channel,
            ts: tsSec,
            state
        });
    }
}

// Splits "switch:0.aenergy.total" → ("switch:0", "aenergy.total").
function extractComponentKey(flatKey: string): string {
    const dot = flatKey.indexOf('.');
    return dot === -1 ? flatKey : flatKey.slice(0, dot);
}

function extractFieldName(flatKey: string): string {
    const dot = flatKey.indexOf('.');
    return dot === -1 ? '' : flatKey.slice(dot + 1);
}

// Legacy regex resolver fed to captureEnergyRow until v2 cuts over.
// scale=1 — legacy storage was always in canonical units.
function legacyResolve(row: EnergyRowInput) {
    const flat = `${row.componentKey}.${row.fieldName}`;
    const m = EM_STATS_FIELD_RE.exec(flat);
    if (!m) return null;
    const mapping = EM_STATS_TAG_MAP[m[4]];
    if (!mapping) return null;
    return {
        tag: mapping.tag,
        domain: 'ac_mains',
        phase: m[3] || 'z',
        isDelta: mapping.isDelta,
        channel: Number.parseInt(m[2], 10),
        scale: 1
    };
}

const parityCounters: Record<string, string> = {
    both_null: 'energy_classifier_parity_both_null',
    v2_only: 'energy_classifier_parity_v2_only',
    legacy_only: 'energy_classifier_parity_legacy_only',
    match: 'energy_classifier_parity_match',
    mismatch: 'energy_classifier_parity_mismatch'
};

const observabilityParitySink = {
    record(outcome: keyof typeof parityCounters): void {
        Observability.incrementCounter(parityCounters[outcome]);
    }
};

// Live device config lookup — DeviceCollector keeps the latest config
// in memory, so tier 3/4 always classify against current state. Null
// when the device hasn't been seen yet or the component is unknown.
const componentConfigResolver: ComponentConfigResolver = (
    shellyId,
    componentKey
) => {
    const device = DeviceCollector.getDevice(shellyId);
    if (!device) return null;
    return (
        (device.config as Record<string, unknown> | undefined)?.[
            componentKey
        ] ?? null
    );
};

// Latest freq/voltage for the component from merged status (not the partial
// frame), so AC/DC detection sees current values even when a NotifyStatus
// omits them. Null when the device or component isn't known yet.
const componentSignalResolver: ComponentSignalResolver = (
    shellyId,
    componentKey
) => {
    const device = DeviceCollector.getDevice(shellyId);
    if (!device) return null;
    const status = (device.status as Record<string, unknown> | undefined)?.[
        componentKey
    ];
    if (!status || typeof status !== 'object') return null;
    const s = status as Record<string, unknown>;
    const freq = s[SINGLE_FREQ_FIELD];
    const voltage = s[SINGLE_VOLTAGE_FIELD];
    return {
        freq: typeof freq === 'number' ? freq : undefined,
        voltage: typeof voltage === 'number' ? voltage : undefined
    };
};

// Domain observability — count DC classifications and trace each to the exact
// device once, so a mis-detected domain is pinpointed without flooding the hot
// path. Redis-shadow saturation is observed separately in StatusStream.
const energyDomainTraced = boundedLogDedupeSet();
function traceOnce(key: string, emit: () => void): void {
    if (energyDomainTraced.has(key)) return;
    energyDomainTraced.record(key);
    emit();
}
const onEnergyRowResolved: ResolvedRowObserver = (row) => {
    if (!row.domain.startsWith('dc_')) return;
    Observability.incrementCounter('energy_domain_dc');
    // Physical-consistency check: a dc_* row on a component reporting a real AC
    // frequency is almost certainly misclassified. Count + WARN once per point.
    const signals = componentSignalResolver(row.shellyId, row.componentKey);
    if (signals && domainContradictsSignals(row.domain, signals)) {
        Observability.incrementCounter('energy_domain_contradiction');
        traceOnce(`contradiction|${row.shellyId}|${row.componentKey}`, () =>
            logger.warn(
                'energy domain contradiction: %s %s tagged %s but reports freq=%d Hz — DC has no frequency',
                row.shellyId,
                row.componentKey,
                row.domain,
                signals.freq
            )
        );
    }
    traceOnce(`${row.shellyId}|${row.componentKey}|${row.domain}`, () =>
        logger.debug(
            'energy domain %s: %s %s tag=%s',
            row.domain,
            row.shellyId,
            row.componentKey,
            row.tag
        )
    );
};

// Exported so the BTHome capture hook (ShellyDevice.ts) can route an
// MCB electrical reading through the exact same entry point as the
// native EM path — one home for energy-row dispatch.
export function routeEnergyRow(row: EnergyRowInput): void {
    captureEnergyRow(row, tuning.energyClassifier, {
        queue: emStatsQueue,
        lifetimeQueue,
        onRowResolved: onEnergyRowResolved,
        legacyResolve,
        parity: observabilityParitySink,
        classifierCache: energyClassifierCache,
        componentConfigResolver,
        componentSignalResolver,
        acMinVoltage: tuning.energyClassifier.acMinVoltage,
        overrideCache: energyOverrideCache
    });
}

async function onConfigChange(shelly: ShellyDevice, key: string, _config: any) {
    const {type, id} = parseComponentKey(key);
    await refreshComponentConfig(shelly, key, type, id);
    if (type === 'sys') {
        await refreshDeviceInfo(shelly);
    }
}

async function refreshComponentConfig(
    shelly: ShellyDevice,
    key: string,
    type: string,
    id: number | undefined
): Promise<void> {
    try {
        // Use id !== undefined instead of id && to handle id=0 correctly
        const latestConfig = await shelly.sendRPC(
            `${type}.GetConfig`,
            id !== undefined ? {id} : undefined
        );
        shelly.setComponentConfig(key, latestConfig);
        // Same-cfg_rev config refreshes (rare but possible) must also
        // invalidate so the tier-3/4 classifier re-reads name/unit/obj_id.
        energyClassifierCache.invalidateDevice(shelly.shellyID);
    } catch (error) {
        logger.error('Error getting config for %s:%s -> %s', type, id, error);
    }
}

// Separate so a GetConfig failure can't suppress the device-info refresh.
async function refreshDeviceInfo(shelly: ShellyDevice): Promise<void> {
    try {
        const info = await shelly.sendRPC('Shelly.GetDeviceInfo');
        shelly.setInfo(info);
    } catch (error) {
        logger.error('Error getting device info -> %s', error);
    }
    invalidateEventCatalogOnCfgRevJump(shelly);
}

// Camera media lifecycle. Stamp the latest media onto camera status so the UI
// reacts to a new still/clip. Persisting a searchable recording history is a
// separate feature (needs a media store plus a reader) and lands with that work.
function patchCameraMedia(
    shelly: ShellyDevice,
    component: string,
    evt: string,
    event: Record<string, unknown>
): void {
    if (!component.startsWith('camera:')) return;
    shelly.setComponentStatus(component, {
        last_media: {
            event: evt,
            rec_id: event.rec_id ?? null,
            media_id: event.media_id ?? null,
            mime_type: event.mime_type ?? null,
            ts: event.ts ?? null
        }
    });
}

function handleOtaSuccess(
    shelly: ShellyDevice,
    event: Record<string, unknown>
): void {
    invalidateCatalogAfterOta(shelly);
    ShellyEvents.emitShellyOtaProgress(
        shelly,
        'ota_success',
        event.progress_percent as number | undefined,
        event.msg as string | undefined
    );
}

function invalidateCatalogAfterOta(shelly: ShellyDevice): void {
    shelly.setEventCatalog(undefined);
}

function handleSleep(
    shelly: ShellyDevice,
    event: Record<string, unknown>
): void {
    shelly.setLastSeenSleeping(sleepTimestampMs(event));
}

function sleepTimestampMs(event: Record<string, unknown>): number {
    return typeof event.ts === 'number'
        ? Math.round(event.ts * 1000)
        : Date.now();
}

function invalidateEventCatalogOnCfgRevJump(shelly: ShellyDevice): void {
    const current = currentCfgRev(shelly);
    if (current === undefined) return;
    const prior = priorCfgRev.get(shelly);
    priorCfgRev.set(shelly, current);
    if (cfgRevJumped(prior, current) && shelly.eventCatalog) {
        invalidateCatalogForCfgRev(shelly, prior!, current);
    }
}

function currentCfgRev(shelly: ShellyDevice): number | undefined {
    const sys = shelly.config.sys as {cfg_rev?: unknown} | undefined;
    return typeof sys?.cfg_rev === 'number' ? sys.cfg_rev : undefined;
}

function cfgRevJumped(prior: number | undefined, current: number): boolean {
    return prior !== undefined && current > prior;
}

function invalidateCatalogForCfgRev(
    shelly: ShellyDevice,
    prior: number,
    current: number
): void {
    shelly.setEventCatalog(undefined);
    energyClassifierCache.invalidateDevice(shelly.shellyID);
    logger.info(
        'cfg_rev jumped %d→%d on %s — eventCatalog + energy classifier cache invalidated',
        prior,
        current,
        shelly.shellyID
    );
}

// Register observability module stats
Observability.registerModule('statusQueue', {
    stats: () => ({
        pending: pendingMessages.length,
        pendingMax: tuning.status.queueMax,
        drops: statusDrops,
        queueSize: status_push_queue.p_ts.length,
        flushing: statusFlushInProgress,
        emStatsQueueSize: emStatsQueue.size(),
        lastFlushMs,
        lastFlushBatchSize,
        // Phase 2.2a: prev-value cache replaced by in-event PathChange diff.
        // Stats kept at 0 for back-compat with dashboards reading these keys.
        statusCacheDevices: 0,
        statusCacheEntries: 0
    }),
    topology: {
        role: 'transform',
        cluster: 'pipeline',
        upstreams: ['registry'],
        downstreams: ['dbPool', 'emSync'],
        label: 'Status Queue',
        description: 'Device status message pipeline',
        route: '/monitoring/services'
    }
});
