import * as log4js from 'log4js';
import {tuning} from '../config';
import {
    BLU_DEVICES,
    type BTHomeSensorSample,
    bthomeObjectInfos,
    collectBTHomeKnownObjectSamples,
    findConfiguredBTHomeSensor,
    formatBTHomeControlLabel,
    formatBTHomeEventSummary,
    getBTHomeControlKind,
    isBTHomeDeviceLevelObjectId,
    normalizeBTHomeComponentConfig,
    normalizeBTHomeComponentConfigs,
    pickBTHomeSensorComponentId,
    pickFreeReservedBTHomeId,
    resolveBluDeviceInfo,
    resolveBluSensorOverride,
    resolveBTHomeSensorSample,
    resolveModelNumericId,
    rememberBTHomeSensorSample as storeBTHomeSensorSample
} from '../config/BTHomeData';
import {BoundedMap} from '../modules/boundedMap';
import {lookupBTHomeEnergy} from '../modules/bthomeSpec';
import {
    appendDeviceSnapshot,
    appendDeviceSnapshotBestEffort
} from '../modules/device/SnapshotStream';
import {
    collectBTHomeChildSensorIds,
    composeBthomeDevice,
    composeDynamicComponent,
    getBTHomeGatewayEventObjIds,
    proposeEntities
} from '../modules/EntityComposer';
import {
    getBluetoothInventoryVersion,
    getDeviceOrg
} from '../modules/EventDistributor';
import * as Observability from '../modules/Observability';
import {rawCall, store} from '../modules/PostgresProvider';
import * as ShellyEvents from '../modules/ShellyEvents';
import {
    enqueueStatusValues,
    handleMessage,
    routeEnergyRow,
    type StatusValueInput
} from '../modules/ShellyMessageHandler';
import {
    appendEvents,
    appendNumeric,
    classifyBthomeObj,
    type EventRow,
    type NumericRow,
    type SensorSource
} from '../modules/sensorCapture';
import {fireAndForget} from '../modules/util/fireAndForget';
import {runBoundedParallel} from '../modules/util/runBoundedParallel';
import {resolveBluetoothSourceTargets} from '../modules/virtualDevice/bluetoothProvenance';
import type {
    BTHomeControlBinding,
    BTHomeLearningState,
    DeviceCapabilities,
    entity_t,
    PathChange,
    ShellyDeviceExternal,
    ShellyMessageData,
    ShellyMessageIncoming,
    shelly_presence_t
} from '../types';
import AbstractDevice, {mergeStatusObjects} from './AbstractDevice';
import {
    hasUnpromotedBluChild,
    reconcileBluChildrenForDevice
} from './bluChildReconcile';
import {
    type BTHomeActionEvent,
    type BTHomeChildSensor,
    type BTHomeRuntimeEvent,
    buildBTHomeOverview,
    firstNonEmptyString,
    formatBTHomeSensorDisplayValue,
    type NormalizedBTHomeControl,
    normalizeBTHomeChannel
} from './bthome/bthomeOverview';
import type RpcTransport from './transport/RpcTransport';

const logger = log4js.getLogger('device');

const BTHOME_ACTIVE_EVENT_WINDOW_MS = 4000;
const BTHOME_TELEMETRY_TARGET_CACHE_TTL_MS = 5 * 60 * 1000;

// Ecowitt WS90 — the one BLU model that gets its own telemetry source tag
// instead of generic 'blu' (stable model string, BTHomeData.BLU_DEVICES).
const WEATHER_STATION_MODEL_ID = 'SBWS-90CM';

// BTHomeSensor.GetStatus reports binary values as boolean; numeric 0/1
// accepted in case firmware ever reports pre-coerced. Anything else (a
// 'text'/'raw' BTHome object routed here by mistake) isn't a valid binary
// reading — skip rather than guess.
function toBTHomeBinaryState(value: unknown): number | null {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === 0 || value === 1) return value;
    return null;
}

// Where one BTHome sensor reading goes: the energy pipeline (device_em, for
// MCB/electrical obj_ids), the device_sensor store (with the resolved kind +
// store), or nowhere (unclassifiable). Pure — no device access — so the
// per-model overrides (WS90, TRV) are unit-testable without a live device.
export type BTHomeSensorCaptureDecision =
    | {route: 'energy'}
    | {route: 'sensor'; kind: string; store: 'numeric' | 'events'}
    | {route: 'skip'};

export function decideBTHomeSensorCapture(
    objId: number,
    model: string | undefined,
    idx: number | undefined
): BTHomeSensorCaptureDecision {
    const override = resolveBluSensorOverride(model, objId, idx);
    // Electrical readings (MCB voltage/current/power/energy) belong to the
    // energy pipeline, the single home for electrical data — never
    // device_sensor. A model override can pull a specific obj_id back out
    // (WS90's own capacitor voltage rides the generic voltage obj_id).
    if (!override?.excludeFromEnergy && lookupBTHomeEnergy(objId)) {
        return {route: 'energy'};
    }
    // An override only renames the kind — the store (numeric vs. event) is
    // still the obj_id's own real type, so it stays in one home
    // (bthomeObjectInfos) rather than being redeclared per override.
    const hit = override
        ? {kind: override.kind, store: bthomeSensorStore(objId)}
        : classifyBthomeObj(objId);
    return hit
        ? {route: 'sensor', kind: hit.kind, store: hit.store}
        : {route: 'skip'};
}

function bthomeSensorStore(objId: number): 'numeric' | 'events' {
    return bthomeObjectInfos[objId]?.type === 'binary_sensor'
        ? 'events'
        : 'numeric';
}

// Pair-flow timing lives in the tuning config (FM_BTHOME_PAIR_* env vars)
// so ops can raise timeouts in noisy-BLE environments without a code change.

type BTHomeDiscoveryRecord = {
    addr: string;
    localName?: string;
    modelId?: string;
    modelNumericId?: number;
    productName?: string;
    isRemote?: boolean;
    rssi?: number;
    ts?: number;
};

type BTHomeEventSensor = {
    id?: number;
    value?: any;
    last_updated_ts?: number;
};

type BTHomeTelemetryFact = {
    bthomeDeviceKey: string;
    sensor: BTHomeEventSensor;
    objId: number;
    idx: number;
    previousValue: unknown;
    sourceComponentKey: string;
};

type BTHomeCaptureContext = {
    objId: number;
    idx: number;
    deviceId: number;
    deviceShellyID: string;
    previousValue: unknown;
};

export default class ShellyDevice extends AbstractDevice {
    #persistTimer?: ReturnType<typeof setTimeout>;
    // Last reconciled BLU child fingerprint + identity keys. Diffed after each
    // persist so promotion runs on bind/unbind and on model/component enrichment.
    #lastBluFingerprint = '';
    #lastBluChildKeys: string[] = [];
    // Guards against stacking immediate persists while a fast promote is mid-flight.
    #bluFastPersistPending = false;
    // Keyed by untrusted device-reported BLE addr; bounded so a flood of
    // spoofed discovery broadcasts can't grow it without limit.
    #bthomeDiscovery = new BoundedMap<string, BTHomeDiscoveryRecord>({
        maxSize: tuning.bthome.discoveryCacheMax
    });
    #bthomeTelemetryTargetIds = new BoundedMap<
        string,
        {
            version: number;
            deviceId: number;
            externalId: string;
            organizationId: string;
        }
    >({
        maxSize: tuning.bthome.discoveryCacheMax,
        ttlMs: BTHOME_TELEMETRY_TARGET_CACHE_TTL_MS
    });
    #bthomeRuntimeEvents = new Map<string, BTHomeRuntimeEvent>();
    #bthomeRuntimeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    #bthomeSensorSamples = new Map<string, BTHomeSensorSample>();
    #bthomeLearning: {
        inputId: number;
        stage: BTHomeLearningState['stage'];
        err: BTHomeLearningState['err'];
        errorCount: number;
        pollTimer: ReturnType<typeof setInterval> | null;
    } | null = null;

    constructor(
        shellyID: string,
        transport: RpcTransport | undefined,
        presence: shelly_presence_t,
        info: any,
        status: Record<string, any>,
        config: Record<string, any>,
        reconnected: boolean,
        id: number,
        lastReportTs = Date.now(),
        capabilities?: DeviceCapabilities,
        methods?: string[]
    ) {
        super(
            shellyID,
            undefined,
            presence,
            info,
            status,
            normalizeBTHomeComponentConfigs(config),
            reconnected,
            id,
            lastReportTs,
            capabilities,
            methods
        );

        stripPersistedBTHomeRuntimeStatus(this.status);
        this.hydrateBTHomeSensorSamplesInMemory();
        this.hydrateBTHomeSensorDisplayValues();
        this.hydrateBTHomeOverviewsInMemory();
        if (transport) {
            // Label the socket so post-onboard slow-command timings name the device.
            transport.deviceLabel = shellyID;
            this.setTransport(transport);
        }
    }

    protected override findMessageReason(key: string, message: any): string {
        return findMessageReason(key, message);
    }

    generateEntities() {
        return proposeEntities(this);
    }

    protected override onStateChange(): void {
        // A newly bound BLU child promotes on the next persist. Flush now instead
        // of waiting out the status-persist debounce so the device appears in ~1s.
        if (this.#hasUnpromotedBluChild() && !this.#bluFastPersistPending) {
            this.#bluFastPersistPending = true;
            if (this.#persistTimer) {
                clearTimeout(this.#persistTimer);
                this.#persistTimer = undefined;
            }
            fireAndForget(
                'device-persist',
                this.#persistState().finally(() => {
                    this.#bluFastPersistPending = false;
                })
            );
            return;
        }
        if (this.#persistTimer) return;
        this.#persistTimer = setTimeout(() => {
            this.#persistTimer = undefined;
            fireAndForget('device-persist', this.#persistState());
        }, tuning.dashboard.persistDebounceMs);
    }

    // A bound child config key present now but not yet reconciled into a device.
    #hasUnpromotedBluChild(): boolean {
        return hasUnpromotedBluChild(this.config, this.#lastBluChildKeys);
    }

    async #persistState() {
        const snapshot = buildPersistableDeviceSnapshot(this.toJSON());
        if (Observability.isDbWritesDisabled()) {
            Observability.incrementCounter('device_persists_skipped');
            await appendDeviceSnapshotBestEffort({
                externalId: this.shellyID,
                organizationId: getDeviceOrg(this.shellyID),
                jdoc: snapshot
            });
            return;
        }
        try {
            Observability.incrementCounter('device_persists');
            if (tuning.deviceSnapshot.redisFirst) {
                await appendDeviceSnapshot({
                    externalId: this.shellyID,
                    organizationId: getDeviceOrg(this.shellyID),
                    jdoc: snapshot
                });
                return;
            }
            if (tuning.deviceSnapshot.redisShadow) {
                void appendDeviceSnapshotBestEffort({
                    externalId: this.shellyID,
                    organizationId: getDeviceOrg(this.shellyID),
                    jdoc: snapshot
                });
            }
            await store(this.shellyID, snapshot);
            this.reconcilePersistedBluetoothChildren();
        } catch (error) {
            logger.warn(
                'failed to persist state for',
                this.shellyID,
                String(error)
            );
        }
    }

    // Promote bound BLU children, demote unbound. Detached so it never blocks
    // persistence. Uses persistedConfig (what storage has), not live config.
    reconcilePersistedBluetoothChildren(
        persistedConfig: Record<string, unknown> = this.config
    ): void {
        void this.#reconcileBluChildren(persistedConfig);
    }

    async #reconcileBluChildren(
        persistedConfig: Record<string, unknown>
    ): Promise<void> {
        const next = await reconcileBluChildrenForDevice(
            this.shellyID,
            persistedConfig,
            {
                fingerprint: this.#lastBluFingerprint,
                keys: this.#lastBluChildKeys
            }
        );
        this.#lastBluFingerprint = next.fingerprint;
        this.#lastBluChildKeys = next.keys;
    }

    protected override onMessage(
        message: ShellyMessageIncoming,
        request?: ShellyMessageData
    ): void {
        handleMessage(this, message, request);

        if (message.method === 'NotifyEvent') {
            const telemetryFacts: BTHomeTelemetryFact[] = [];
            for (const eventBody of (message?.params?.events ?? []) as {
                event?: string;
                component?: string;
                channel?: number;
                device?: {
                    addr: string;
                    local_name: string;
                    shelly_mfdata?: {
                        model_id: number;
                    };
                };
                sensors?: Record<string, BTHomeEventSensor[]>;
            }[]) {
                // Devices can send null/array event slots — skip them.
                if (
                    eventBody === null ||
                    typeof eventBody !== 'object' ||
                    Array.isArray(eventBody)
                ) {
                    continue;
                }
                if (
                    typeof eventBody.component === 'string' &&
                    eventBody.component.startsWith('bthomedevice:')
                ) {
                    const channel = normalizeBTHomeChannel(eventBody.channel);
                    if (
                        channel != null &&
                        this.status[eventBody.component]?.channel !== channel
                    ) {
                        this.setComponentStatus(eventBody.component, {
                            channel
                        });
                    }

                    const sensors = eventBody.sensors;
                    if (sensors && typeof sensors === 'object') {
                        const deviceConfig = this.config[eventBody.component];
                        const addr =
                            typeof deviceConfig?.addr === 'string'
                                ? deviceConfig.addr
                                : null;
                        for (const [objIdKey, sensorArray] of Object.entries(
                            sensors
                        )) {
                            const objId = Number.parseInt(objIdKey, 10);
                            if (
                                !Number.isFinite(objId) ||
                                !Array.isArray(sensorArray)
                            ) {
                                continue;
                            }
                            for (const [
                                fallbackIdx,
                                sensor
                            ] of sensorArray.entries()) {
                                if (!sensor || sensor.value === undefined) {
                                    continue;
                                }
                                const idx = this.resolveBTHomeEventSensorIndex(
                                    addr,
                                    objId,
                                    fallbackIdx,
                                    sensor.id
                                );
                                if (addr) {
                                    this.rememberBTHomeSensorSample({
                                        addr,
                                        objId,
                                        idx,
                                        value: sensor.value,
                                        lastUpdatedTs:
                                            typeof sensor.last_updated_ts ===
                                            'number'
                                                ? sensor.last_updated_ts
                                                : null
                                    });
                                }
                                if (typeof sensor?.id !== 'number') continue;
                                const sensorKey = `bthomesensor:${sensor.id}`;
                                telemetryFacts.push({
                                    bthomeDeviceKey: eventBody.component,
                                    sensor,
                                    objId,
                                    idx,
                                    previousValue:
                                        this.status[sensorKey]?.value,
                                    sourceComponentKey: sensorKey
                                });
                                const statusPatch =
                                    this.buildBTHomeEventSensorStatus(
                                        sensorKey,
                                        sensor,
                                        sensor.id,
                                        objId,
                                        idx,
                                        addr
                                    );
                                this.setComponentStatus(sensorKey, statusPatch);
                            }
                        }
                    }
                }
            }
            if (telemetryFacts.length > 0) {
                fireAndForget(
                    'bthome-telemetry-capture',
                    this.captureBTHomeTelemetryBatch(telemetryFacts)
                );
            }
        }
    }

    private async captureBTHomeTelemetryBatch(
        facts: readonly BTHomeTelemetryFact[]
    ): Promise<void> {
        const sourceComponentKeys = [
            ...new Set(facts.map((fact) => fact.sourceComponentKey))
        ];
        const inventoryVersion = getBluetoothInventoryVersion();
        const targets = new Map<
            string,
            {deviceId: number; externalId: string; organizationId: string}
        >();
        const unresolvedSourceKeys: string[] = [];
        for (const sourceComponentKey of sourceComponentKeys) {
            const cached =
                this.#bthomeTelemetryTargetIds.get(sourceComponentKey);
            if (!cached || cached.version !== inventoryVersion) {
                unresolvedSourceKeys.push(sourceComponentKey);
            } else {
                targets.set(sourceComponentKey, cached);
            }
        }
        if (unresolvedSourceKeys.length > 0) {
            try {
                const resolved = await resolveBluetoothSourceTargets(
                    unresolvedSourceKeys.map((componentKey) => ({
                        sourceDeviceListId: this.id,
                        componentKey
                    }))
                );
                for (const target of resolved) {
                    const value = {
                        deviceId: target.blu_device_list_id,
                        externalId: target.bluetooth_external_id,
                        organizationId: target.organization_id
                    };
                    targets.set(target.component_key, value);
                    this.#bthomeTelemetryTargetIds.set(target.component_key, {
                        ...value,
                        version: inventoryVersion
                    });
                }
            } catch (error) {
                Observability.incrementCounter(
                    'bthome_telemetry_target_resolve_failed'
                );
                logger.warn(
                    'BTHome telemetry target resolution failed gateway=%s: %s',
                    this.shellyID,
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        const numericRows: NumericRow[] = [];
        const eventRows: EventRow[] = [];
        const statusValues: StatusValueInput[] = [];
        for (const fact of facts) {
            const target = targets.get(fact.sourceComponentKey);
            if (
                typeof fact.sensor.value === 'number' &&
                Number.isFinite(fact.sensor.value)
            ) {
                statusValues.push({
                    ts:
                        typeof fact.sensor.last_updated_ts === 'number'
                            ? fact.sensor.last_updated_ts
                            : Date.now() / 1000,
                    deviceId: target?.deviceId ?? this.id,
                    shellyId: target?.externalId ?? this.shellyID,
                    organizationId:
                        target?.organizationId ?? getDeviceOrg(this.shellyID),
                    field: `${fact.sourceComponentKey}.value`,
                    value: fact.sensor.value,
                    previousValue: fact.previousValue
                });
            }
            this.captureBTHomeSensorTelemetry(
                fact.bthomeDeviceKey,
                fact.sensor,
                numericRows,
                eventRows,
                {
                    objId: fact.objId,
                    idx: fact.idx,
                    deviceId: target?.deviceId ?? this.id,
                    deviceShellyID: target?.externalId ?? this.shellyID,
                    previousValue: fact.previousValue
                }
            );
        }
        enqueueStatusValues(statusValues);
        await Promise.all([
            appendNumeric(numericRows, {callDb: rawCall}),
            appendEvents(eventRows, {callDb: rawCall})
        ]);
    }

    // Classifies one BTHome sensor reading — electrical readings (MCB
    // voltage/current/power/energy) go to the energy pipeline; everything
    // else is numeric (forever rollup) or binary/button (event on change),
    // appended to the batch. Live events supply obj_id + idx; direct callers
    // may fall back to configured sensor metadata. Malformed readings are
    // dropped without affecting status updates.
    private captureBTHomeSensorTelemetry(
        bthomeDeviceKey: string,
        sensor: BTHomeEventSensor,
        numericRows: NumericRow[],
        eventRows: EventRow[],
        context?: BTHomeCaptureContext
    ): void {
        const sensorKey = `bthomesensor:${sensor.id}`;
        const objId = context?.objId ?? this.config[sensorKey]?.obj_id;
        if (typeof objId !== 'number') return;

        const model = this.config[bthomeDeviceKey]?.meta?.modelId;
        const idx = context?.idx ?? this.config[sensorKey]?.idx;
        const decision = decideBTHomeSensorCapture(objId, model, idx);
        if (decision.route === 'skip') return;

        const ts =
            typeof sensor.last_updated_ts === 'number'
                ? sensor.last_updated_ts
                : Date.now() / 1000;

        if (decision.route === 'energy') {
            this.captureBTHomeEnergyReading(sensorKey, sensor, ts, context);
            return;
        }

        const channel = sensor.id as number;
        const source = this.resolveBTHomeSensorSource(bthomeDeviceKey);

        if (decision.store === 'numeric') {
            const val = sensor.value;
            if (typeof val !== 'number' || !Number.isFinite(val)) return;
            numericRows.push({
                device: context?.deviceId ?? this.id,
                source,
                kind: decision.kind,
                channel,
                ts,
                val
            });
            return;
        }

        const state = toBTHomeBinaryState(sensor.value);
        if (state === null) return;
        // Buttons store every push (Phase B scope — none of the sensors
        // routed through this bthomesensor loop can be a button in
        // practice: BTHome.AddSensor rejects device-level objects, and
        // button/dimmer are device-level — see isBTHomeDeviceLevelObjectId).
        // Binary sensors store on change only.
        if (decision.kind !== 'button') {
            const prevState = toBTHomeBinaryState(
                context?.previousValue ?? this.status[sensorKey]?.value
            );
            if (prevState === state) return;
        }
        eventRows.push({
            device: context?.deviceId ?? this.id,
            source,
            kind: decision.kind,
            channel,
            ts,
            state
        });
    }

    // Routes an MCB electrical reading (or any future BTHome device sharing
    // these obj_ids) into the energy pipeline through the exact entry point
    // the native EM path uses (ShellyMessageHandler.routeEnergyRow) —
    // BTHOME_ENERGY_SPEC (bthomeSpec.ts) supplies tag/domain/scale via the
    // classifier's own BTHome tier, so this never re-maps obj_ids itself.
    // componentKey/fieldName match what the tier-3 classifier expects from a
    // Shelly.GetConfig-shaped bthomesensor:N entry — the same shape the
    // measurement-point enumerator (measurementPoints.ts) already reads.
    private captureBTHomeEnergyReading(
        sensorKey: string,
        sensor: {value?: any},
        ts: number,
        context?: BTHomeCaptureContext
    ): void {
        const value = sensor.value;
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        routeEnergyRow({
            componentKey: sensorKey,
            fieldName: 'value',
            deviceId: context?.deviceId ?? this.id,
            shellyId: context?.deviceShellyID ?? this.shellyID,
            value,
            lastValue: context?.previousValue ?? this.status[sensorKey]?.value,
            ts
        });
    }

    // Weather station (Ecowitt WS90 / SBWS-90CM) tags its own readings
    // 'weather' so the dashboard can split it from a room BLU sensor; every
    // other paired BLU sensor is 'blu'. Model comes from the parent
    // bthomedevice's meta.modelId, set once by syncSingleBTHomeDeviceMeta
    // after the device's first broadcast.
    private resolveBTHomeSensorSource(bthomeDeviceKey: string): SensorSource {
        return this.config[bthomeDeviceKey]?.meta?.modelId ===
            WEATHER_STATION_MODEL_ID
            ? 'weather'
            : 'blu';
    }

    override setComponentStatus(key: string, status: any) {
        if (key.startsWith('bthomesensor:')) {
            status = this.stampBTHomeSensorDisplay(key, status);
        }
        // super.setComponentStatus emits Shelly.Status with the component
        // changes — that is the only path the UI needs. Entity status is
        // read from the device store (keyed by component), so no separate
        // per-entity status event is emitted here.
        super.setComponentStatus(key, status);
        if (key.startsWith('bthomesensor:')) {
            this.rememberConfiguredBTHomeSensorSample(key);
        }
        this.refreshAffectedBTHomeOverviews([key]);
    }

    override batchSetComponentStatus(data: Record<string, any>): PathChange[] {
        for (const key of Object.keys(data)) {
            if (key.startsWith('bthomesensor:')) {
                data[key] = this.stampBTHomeSensorDisplay(key, data[key]);
            }
        }
        const changes = super.batchSetComponentStatus(data);
        this.refreshAffectedBTHomeOverviews(Object.keys(data));
        return changes;
    }

    // One durable reading per sensor: the overview's formatter, stamped on the
    // sensor status so every surface reads it without re-deriving units. Merges
    // patch over current status so it reflects the full sensor state.
    private stampBTHomeSensorDisplay(
        key: string,
        patch: Record<string, any>
    ): Record<string, any> {
        const config = this.config[key];
        const objId = config?.obj_id;
        if (typeof objId !== 'number' || !patch || typeof patch !== 'object') {
            return patch;
        }
        const child: BTHomeChildSensor = {
            key,
            id: config.id,
            objId,
            config,
            status: {...(this.status[key] ?? {}), ...patch}
        };
        return {...patch, displayValue: formatBTHomeSensorDisplayValue(child)};
    }

    override setComponentConfig(key: string, config: any) {
        super.setComponentConfig(
            key,
            normalizeBTHomeComponentConfig(key, config)
        );
        this.refreshAffectedBTHomeOverviews([key]);

        if (key.startsWith('bthomedevice:') && this.findEntity(key)) {
            this.refreshBTHomeDeviceEntity(key);
        }
    }

    public updateComponent(key: string, status: any, config: any) {
        this.setComponentStatus(key, status);
        this.setComponentConfig(key, config);

        const {type, id} = parseComponentKey(key);

        const entity: entity_t | null = composeDynamicComponent(
            type,
            this.config[key],
            this.info.name as string,
            this.id,
            this.shellyID
        );

        if (entity) {
            logger.info('Composed entity %s:%s', type, id);
            this.addEntity(entity);
            return;
        }

        // Native component types (switch, cover, temperature, ...) aren't
        // handled by composeDynamicComponent (virtual/BTHome only). Recompose
        // via the full registry path and add any entity that newly appeared —
        // addEntity dedups by id, so existing entities are untouched.
        const existingIds = new Set(this.entities.map((e) => e.id));
        const added = this.generateEntities().filter(
            (e) => !existingIds.has(e.id)
        );
        if (added.length === 0) {
            logger.error('Error composing entity for %s:%s', type, id);
            return;
        }
        for (const e of added) {
            logger.info('Composed entity %s', e.id);
            this.addEntity(e);
        }
    }

    private findParentBTHomeDeviceKey(addr: string): string | null {
        for (const key of Object.keys(this.config)) {
            if (!key.startsWith('bthomedevice:')) continue;
            if (this.config[key]?.addr === addr) return key;
        }
        return null;
    }

    private enrichSensorEntityFromParent(
        sensorKey: string,
        parentKey: string
    ): void {
        const entity = this.findEntity(sensorKey);
        if (!entity) return;
        const parentCfg = this.config[parentKey];
        if (!parentCfg) return;
        const props = entity.properties as Record<string, unknown>;
        const meta = parentCfg.meta ?? {};
        if (meta.productName) props.bleProductName = meta.productName;
        if (meta.modelId) props.bleModelId = meta.modelId;
        const displayName = firstNonEmptyString(
            parentCfg.name,
            meta.productName,
            meta.localName
        );
        if (displayName) props.bleDisplayName = displayName;
        props.parentDeviceKey = parentKey;
    }

    /**
     * Starts BLE Control learning mode on the device and begins backend polling
     * for state changes. Frontends listen via BTHome.ControlLearning WS event —
     * no frontend polling. Any existing learning session is cancelled first.
     */
    public async startBTHomeControlLearning(inputId: number): Promise<void> {
        this.#clearBTHomeLearningPoll();
        await this.sendRPC('BTHomeControl.StartLearning', {input_id: inputId});
        this.#bthomeLearning = {
            inputId,
            stage: null,
            err: null,
            errorCount: 0,
            pollTimer: null
        };
        this.#emitBTHomeLearning();
        this.#bthomeLearning.pollTimer = setInterval(() => {
            void this.#pollBTHomeLearning();
        }, 1500);
    }

    public async stopBTHomeControlLearning(): Promise<void> {
        this.#clearBTHomeLearningPoll();
        this.#bthomeLearning = null;
        this.#emitBTHomeLearning();
        try {
            await this.sendRPC('BTHomeControl.StopLearning', {});
        } catch (err) {
            logger.warn(
                'BTHomeControl.StopLearning failed on %s: %s',
                this.shellyID,
                err instanceof Error ? err.message : String(err)
            );
        }
    }

    public getBTHomeLearningState(): BTHomeLearningState | null {
        if (!this.#bthomeLearning) return null;
        return {
            inputId: this.#bthomeLearning.inputId,
            stage: this.#bthomeLearning.stage,
            err: this.#bthomeLearning.err
        };
    }

    /**
     * Returns normalized BLE control bindings for this device by iterating
     * over bthomecontrol:N components and calling BTHomeControl.List {id}
     * per component. The frontend consumes the normalized shape directly.
     */
    public async getBTHomeControls(): Promise<BTHomeControlBinding[]> {
        const targets: Array<{componentKey: string; id: number}> = [];
        for (const componentKey of Object.keys(this.config)) {
            if (!componentKey.startsWith('bthomecontrol:')) continue;
            const id = this.config[componentKey]?.id;
            if (typeof id !== 'number') continue;
            targets.push({componentKey, id});
        }
        // Concurrency: one device, avoid spamming N parallel RPCs. Timeout
        // matches the device-init probe — a hung RPC frees its slot fast.
        const BTHOME_LIST_CONCURRENCY = 4;
        const settled = await runBoundedParallel({
            tasks: targets,
            run: ({id}, signal) =>
                this.sendRPC('BTHomeControl.List', {id}, false, signal),
            concurrency: BTHOME_LIST_CONCURRENCY,
            perTaskTimeoutMs: tuning.rpc.initProbeTimeoutMs,
            label: `BTHomeControl.List@${this.shellyID}`
        });
        const out: BTHomeControlBinding[] = [];
        for (let i = 0; i < settled.length; i++) {
            const result = settled[i];
            const {componentKey, id} = targets[i];
            if (result.status === 'rejected') {
                logger.warn(
                    'BTHomeControl.List failed for %s:%d on %s: %s',
                    componentKey,
                    id,
                    this.shellyID,
                    result.reason instanceof Error
                        ? result.reason.message
                        : String(result.reason)
                );
                continue;
            }
            const binding = this.#normalizeBTHomeControlBinding(
                result.value,
                id
            );
            if (binding !== null) out.push(binding);
        }
        return out;
    }

    #normalizeBTHomeControlBinding(
        resp: any,
        fallbackId: number
    ): BTHomeControlBinding | null {
        if (!resp || typeof resp !== 'object') return null;
        const id = typeof resp.id === 'number' ? resp.id : fallbackId;
        const key = typeof resp.key === 'string' ? resp.key : '';
        const rawInputs = Array.isArray(resp.inputs) ? resp.inputs : [];
        const inputs: BTHomeControlBinding['inputs'] = [];
        for (const i of rawInputs) {
            if (!i || typeof i !== 'object') continue;
            if (
                typeof i.bthomedevice !== 'string' ||
                typeof i.obj_id !== 'string' ||
                typeof i.event !== 'string' ||
                typeof i.action !== 'string'
            ) {
                continue;
            }
            inputs.push({
                bthomedevice: i.bthomedevice,
                obj_id: i.obj_id,
                event: i.event,
                action: i.action
            });
        }
        return {id, key, inputs};
    }

    async #pollBTHomeLearning() {
        const state = this.#bthomeLearning;
        if (!state) return;
        try {
            const resp = await this.sendRPC('BTHomeControl.GetStatus', {});
            if (this.#bthomeLearning !== state) return;
            state.errorCount = 0;
            const learning = resp?.learning;
            const newStage = (learning?.stage ??
                null) as BTHomeLearningState['stage'];
            const newErr = (learning?.err ??
                null) as BTHomeLearningState['err'];
            const changed =
                newStage !== state.stage ||
                JSON.stringify(newErr) !== JSON.stringify(state.err);
            state.stage = newStage;
            state.err = newErr;
            if (changed) this.#emitBTHomeLearning();
            if (newStage === 'done' || newStage === 'error') {
                this.#clearBTHomeLearningPoll();
                this.#bthomeLearning = null;
                this.#emitBTHomeLearning();
                if (newStage === 'done') {
                    // New bthomecontrol:N will arrive via component_added → fetchComponent,
                    // which emits BTHome.ControlsUpdated. Nothing to do here.
                }
            }
        } catch {
            if (this.#bthomeLearning !== state) return;
            state.errorCount++;
            if (state.errorCount >= 5) {
                this.#clearBTHomeLearningPoll();
                this.#bthomeLearning = null;
                this.#emitBTHomeLearning();
            }
        }
    }

    #clearBTHomeLearningPoll() {
        if (this.#bthomeLearning?.pollTimer) {
            clearInterval(this.#bthomeLearning.pollTimer);
            this.#bthomeLearning.pollTimer = null;
        }
    }

    #emitBTHomeLearning() {
        const id = this.shellyID;
        if (typeof id !== 'string') return;
        ShellyEvents.emitBTHomeControlLearning(
            id,
            this.getBTHomeLearningState()
        );
    }

    private emitBTHomeControlsUpdated() {
        const id = this.shellyID;
        if (typeof id !== 'string') return;
        ShellyEvents.emitBTHomeControlsUpdated(id);
    }

    private refreshBTHomeDeviceEntity(key: string) {
        const cfg = this.config[key];
        if (!cfg?.addr) return;

        const entity = this.findEntity(key);
        if (entity) {
            this.removeEntity(entity);
        }

        const nextEntity = composeBthomeDevice(
            cfg,
            this.status[key],
            this.info.name as string,
            this.id,
            this.shellyID,
            collectBTHomeChildSensorIds(this.config, cfg.addr, this.id),
            getBTHomeGatewayEventObjIds(this.info.ver as string)
        );
        this.addEntity(nextEntity);
    }

    public rememberBTHomeDiscovery(record: {
        addr: string;
        localName?: string;
        modelNumericId?: number;
        rssi?: number;
        ts?: number;
    }) {
        const {modelId, modelNumericId, productName, isRemote} =
            resolveBluDeviceInfo(undefined, record.modelNumericId);
        this.#bthomeDiscovery.set(record.addr, {
            addr: record.addr,
            localName: record.localName,
            modelId,
            modelNumericId,
            productName: productName !== 'BLE Device' ? productName : undefined,
            isRemote,
            rssi: record.rssi,
            ts: record.ts
        });
    }

    public syncAllBTHomeOverviews() {
        const keys = Object.keys(this.config).filter((key) =>
            key.startsWith('bthomedevice:')
        );
        this.refreshAffectedBTHomeOverviews(keys);
    }

    private refreshAffectedBTHomeOverviews(keys: string[]) {
        const parentKeys = new Set<string>();
        for (const key of keys) {
            if (key.startsWith('bthomedevice:')) {
                parentKeys.add(key);
                continue;
            }
            if (!key.startsWith('bthomesensor:')) continue;
            const addr = this.config[key]?.addr;
            if (!addr) continue;
            const parentKey = this.findParentBTHomeDeviceKey(addr);
            if (parentKey) parentKeys.add(parentKey);
        }

        for (const parentKey of parentKeys) {
            this.refreshSingleBTHomeOverview(parentKey);
        }
    }

    private refreshSingleBTHomeOverview(
        key: string,
        statusPatch?: Record<string, any>
    ) {
        const cfg = this.config[key];
        if (!cfg?.addr) return;
        const nextStatus = statusPatch
            ? {...(this.status[key] ?? {}), ...statusPatch}
            : (this.status[key] ?? {});

        const overview = buildBTHomeOverview({
            config: cfg,
            status: nextStatus,
            allConfig: this.config,
            allStatus: this.status,
            runtimeEvent: this.#bthomeRuntimeEvents.get(key)
        });
        const runtimePatch = statusPatch
            ? {...statusPatch, overview}
            : {overview};
        // setRuntimeComponentStatus emits Shelly.Status with the overview
        // patch; the UI reads entity status from the device store, so no
        // separate Entity.StatusChange event is needed.
        this.setRuntimeComponentStatus(key, runtimePatch, key);
    }

    private hydrateBTHomeSensorSamplesInMemory() {
        for (const key of Object.keys(this.config)) {
            if (!key.startsWith('bthomesensor:')) continue;
            this.rememberConfiguredBTHomeSensorSample(key);
        }
    }

    private rememberConfiguredBTHomeSensorSample(key: string) {
        const rawConfig = this.config[key];
        if (!rawConfig?.addr || typeof rawConfig?.obj_id !== 'number') return;

        const config = normalizeBTHomeComponentConfig(key, rawConfig);
        const idx = typeof config?.idx === 'number' ? config.idx : 0;
        const sampleStatus = this.status[key];
        if (sampleStatus?.value === undefined) return;

        this.rememberBTHomeSensorSample({
            addr: config.addr,
            objId: config.obj_id,
            idx,
            value: sampleStatus.value,
            lastUpdatedTs:
                typeof sampleStatus?.last_updated_ts === 'number'
                    ? sampleStatus.last_updated_ts
                    : null
        });
    }

    private rememberBTHomeSensorSample(options: {
        addr: string;
        objId: number;
        idx: number;
        value: any;
        lastUpdatedTs?: number | null;
    }) {
        storeBTHomeSensorSample(this.#bthomeSensorSamples, {
            ...options,
            lastUpdatedTs:
                typeof options.lastUpdatedTs === 'number'
                    ? options.lastUpdatedTs
                    : null
        });
    }

    private resolveBTHomeEventSensorIndex(
        addr: string | null,
        objId: number,
        fallbackIdx: number,
        sensorId: number | undefined
    ): number {
        if (!addr || typeof sensorId !== 'number') return fallbackIdx;
        const sensorConfig = normalizeBTHomeComponentConfig(
            `bthomesensor:${sensorId}`,
            this.config[`bthomesensor:${sensorId}`]
        );
        return sensorConfig?.addr === addr &&
            sensorConfig?.obj_id === objId &&
            typeof sensorConfig?.idx === 'number'
            ? sensorConfig.idx
            : fallbackIdx;
    }

    private buildBTHomeEventSensorStatus(
        sensorKey: string,
        sensor: BTHomeEventSensor,
        sensorId: number,
        objId: number,
        idx: number,
        addr: string | null
    ): Record<string, any> {
        const patch = {
            id: sensorId,
            value: sensor.value,
            last_updated_ts: sensor.last_updated_ts
        };
        const configured = this.config[sensorKey];
        const config =
            typeof configured?.obj_id === 'number'
                ? configured
                : {id: sensorId, addr, obj_id: objId, idx};
        const child: BTHomeChildSensor = {
            key: sensorKey,
            id: sensorId,
            objId,
            config,
            status: {...(this.status[sensorKey] ?? {}), ...patch}
        };
        return {
            ...patch,
            displayValue: formatBTHomeSensorDisplayValue(child)
        };
    }

    private rememberBTHomeKnownObjectSamples(
        componentKey: string,
        objects: Array<Record<string, any>>
    ) {
        const addr = this.config[componentKey]?.addr;
        if (!addr) return;

        for (const sample of collectBTHomeKnownObjectSamples(addr, objects)) {
            this.rememberBTHomeSensorSample(sample);
        }
    }

    private getBTHomeSensorSample(options: {
        addr: string;
        objId: number;
        idx: number;
    }): BTHomeSensorSample | null {
        const parentKey = this.findParentBTHomeDeviceKey(options.addr);
        const parentStatus = parentKey ? this.status[parentKey] : null;
        return resolveBTHomeSensorSample({
            samples: this.#bthomeSensorSamples,
            addr: options.addr,
            objId: options.objId,
            idx: options.idx,
            parentStatus
        });
    }

    private seedBTHomeSensorStatusFromCache(key: string) {
        const rawConfig = this.config[key];
        if (!rawConfig?.addr || typeof rawConfig?.obj_id !== 'number') return;

        const existingStatus = this.status[key] ?? {};
        if (existingStatus.value !== undefined) return;

        const config = normalizeBTHomeComponentConfig(key, rawConfig);
        const idx = typeof config?.idx === 'number' ? config.idx : 0;
        const sample = this.getBTHomeSensorSample({
            addr: config.addr,
            objId: config.obj_id,
            idx
        });
        if (!sample) return;

        this.setComponentStatus(key, {
            id: config.id,
            value: sample.value,
            ...(typeof sample.lastUpdatedTs === 'number'
                ? {last_updated_ts: sample.lastUpdatedTs}
                : {})
        });
    }

    // Re-stamp on load so a device that hasn't broadcast since restart
    // still has a reading.
    private hydrateBTHomeSensorDisplayValues() {
        for (const key of Object.keys(this.status)) {
            if (!key.startsWith('bthomesensor:')) continue;
            this.status[key] = this.stampBTHomeSensorDisplay(
                key,
                this.status[key] ?? {}
            );
        }
    }

    private hydrateBTHomeOverviewsInMemory() {
        for (const key of Object.keys(this.config)) {
            if (!key.startsWith('bthomedevice:')) continue;

            const cfg = this.config[key];
            if (!cfg?.addr) continue;

            const overview = buildBTHomeOverview({
                config: cfg,
                status: this.status[key] ?? {},
                allConfig: this.config,
                allStatus: this.status,
                runtimeEvent: this.#bthomeRuntimeEvents.get(key)
            });
            this.status[key] = mergeStatusObjects(this.status[key] ?? {}, {
                overview
            });
        }
    }

    private async syncSingleBTHomeDeviceMeta(key: string): Promise<boolean> {
        const cfg = this.config[key];
        if (!cfg?.addr) return false;

        const discovered = this.#bthomeDiscovery.get(cfg.addr);
        const existingMeta = cfg.meta ?? {};
        const resolvedModelString = resolveModelStringFromMeta({
            existingModelId: existingMeta.modelId,
            discoveredModelId: discovered?.modelId,
            numericModelId:
                cfg._attrs?.model_id ??
                existingMeta.modelNumericId ??
                discovered?.modelNumericId
        });
        const resolvedNumericModelId =
            cfg._attrs?.model_id ??
            existingMeta.modelNumericId ??
            discovered?.modelNumericId ??
            resolveModelNumericId(resolvedModelString);
        const identity = resolveBluDeviceInfo(
            resolvedModelString,
            resolvedNumericModelId,
            firstNonEmptyString(existingMeta.visual?.imageModel)
        );
        const nextMeta = {...existingMeta};
        let changed = false;

        if (
            identity.productName !== 'BLE Device' &&
            existingMeta.productName !== identity.productName
        ) {
            nextMeta.productName = identity.productName;
            changed = true;
        }
        if (identity.modelId && existingMeta.modelId !== identity.modelId) {
            nextMeta.modelId = identity.modelId;
            changed = true;
        }
        if (
            typeof identity.modelNumericId === 'number' &&
            existingMeta.modelNumericId !== identity.modelNumericId
        ) {
            nextMeta.modelNumericId = identity.modelNumericId;
            changed = true;
        }
        if (
            discovered?.localName &&
            existingMeta.localName !== discovered.localName
        ) {
            nextMeta.localName = discovered.localName;
            changed = true;
        }
        if (existingMeta.isRemote !== identity.isRemote) {
            nextMeta.isRemote = identity.isRemote;
            changed = true;
        }

        const currentName = firstNonEmptyString(cfg.name);
        const preferredName = firstNonEmptyString(
            nextMeta.productName,
            nextMeta.localName
        );
        const nextName =
            preferredName &&
            isAutoGeneratedBTHomeDeviceName({
                name: currentName,
                addr: cfg.addr,
                componentId: cfg.id,
                autoGeneratedLabels: [
                    existingMeta.productName,
                    existingMeta.localName,
                    nextMeta.productName,
                    nextMeta.localName
                ]
            })
                ? preferredName
                : currentName;
        if (nextName !== currentName) {
            changed = true;
        }

        try {
            const resp = await this.sendRPC('BTHomeDevice.GetKnownObjects', {
                id: cfg.id
            });
            this.rememberBTHomeKnownObjectSamples(key, resp?.objects ?? []);
            const controls: NormalizedBTHomeControl[] = (resp?.objects ?? [])
                .flatMap((obj: any): NormalizedBTHomeControl[] => {
                    if (
                        typeof obj?.idx !== 'number' ||
                        obj.idx < 0 ||
                        typeof obj?.obj_id !== 'number'
                    ) {
                        return [];
                    }
                    const kind = getBTHomeControlKind(obj.obj_id);
                    if (!kind) return [];
                    return [
                        {
                            objId: obj.obj_id,
                            idx: obj.idx,
                            kind,
                            label: formatBTHomeControlLabel(obj.obj_id, obj.idx)
                        }
                    ];
                })
                .sort(
                    (a: NormalizedBTHomeControl, b: NormalizedBTHomeControl) =>
                        a.idx - b.idx || a.objId - b.objId
                );

            const prevControls = Array.isArray(existingMeta.controls)
                ? existingMeta.controls
                : [];
            if (JSON.stringify(prevControls) !== JSON.stringify(controls)) {
                nextMeta.controls = controls;
                changed = true;
            }
        } catch (error) {
            // Non-critical — device might not support GetKnownObjects yet.
            logger.debug(
                'BTHomeDevice.GetKnownObjects failed for %s on %s: %s',
                key,
                this.shellyID,
                error instanceof Error ? error.message : String(error)
            );
        }

        if (!changed) return false;

        try {
            await this.sendRPC('BTHomeDevice.SetConfig', {
                id: cfg.id,
                config: {
                    ...(nextName ? {name: nextName} : {}),
                    meta: nextMeta
                }
            });
        } catch (error) {
            // Non-critical — device might not support SetConfig meta.
            logger.debug(
                'BTHomeDevice.SetConfig meta failed for %s on %s: %s',
                key,
                this.shellyID,
                error instanceof Error ? error.message : String(error)
            );
        }

        this.setComponentConfig(key, {
            ...cfg,
            ...(nextName ? {name: nextName} : {}),
            meta: nextMeta
        });
        logger.info('Enriched bthomedevice:%d meta: %j', cfg.id, nextMeta);
        return true;
    }

    private async syncBTHomeComponentsFromGateway(): Promise<void> {
        const previousKeys = new Set(Object.keys(this.config));
        const nextConfig = normalizeBTHomeComponentConfigs(
            await this.sendRPC('Shelly.GetConfig')
        );

        this.setConfig(nextConfig);

        for (const key of Object.keys(nextConfig)) {
            if (!key.startsWith('bthomedevice:') || !previousKeys.has(key)) {
                continue;
            }
            this.refreshSingleBTHomeOverview(key);
            this.refreshBTHomeDeviceEntity(key);
        }

        for (const key of Object.keys(nextConfig)) {
            if (!isBTHomeDynamicComponentKey(key) || previousKeys.has(key)) {
                continue;
            }
            await this.fetchComponent(key);
        }

        this.syncAllBTHomeOverviews();
    }

    public async fetchComponent(key: string) {
        const {type, id} = parseComponentKey(key);
        const params = id !== undefined ? {id} : undefined;
        const timeoutMs = tuning.rpc.initProbeTimeoutMs;
        const [statusRes, configRes] = await Promise.allSettled([
            this.sendRPC(
                `${type}.GetStatus`,
                params,
                false,
                AbortSignal.timeout(timeoutMs)
            ),
            this.sendRPC(
                `${type}.GetConfig`,
                params,
                false,
                AbortSignal.timeout(timeoutMs)
            )
        ]);
        if (
            statusRes.status === 'rejected' ||
            configRes.status === 'rejected'
        ) {
            logger.error('Error fetching component for %s:%s', type, id);
            return;
        }
        const status = statusRes.value;
        const config = configRes.value;
        logger.info('Fetched component %s:%s', type, id);
        this.updateComponent(key, status, config);

        if (type === 'bthomedevice') {
            await this.syncSingleBTHomeDeviceMetaSafely(key);
            this.refreshSingleBTHomeOverview(key);
            this.refreshBTHomeDeviceEntity(key);
            return;
        }

        if (type === 'bthomesensor' && config?.addr) {
            const parentKey = this.findParentBTHomeDeviceKey(config.addr);
            if (parentKey) {
                await this.syncSingleBTHomeDeviceMetaSafely(parentKey);
                this.enrichSensorEntityFromParent(key, parentKey);
            }
            this.seedBTHomeSensorStatusFromCache(key);
            if (parentKey) {
                this.refreshSingleBTHomeOverview(parentKey);
                this.refreshBTHomeDeviceEntity(parentKey);
            }
        }

        if (type === 'bthomecontrol') {
            this.emitBTHomeControlsUpdated();
        }
    }

    public override removeComponent(key: string) {
        const parentAddr =
            key.startsWith('bthomesensor:') && this.config[key]?.addr
                ? this.config[key].addr
                : null;
        const wasBTHomeControl = key.startsWith('bthomecontrol:');
        if (key.startsWith('bthomedevice:')) {
            this.clearBTHomeRuntimeEvent(key);
        }
        super.removeComponent(key);
        const entity = this.findEntity(key);
        if (!entity) {
            if (parentAddr) {
                const parentKey = this.findParentBTHomeDeviceKey(parentAddr);
                if (parentKey) this.refreshSingleBTHomeOverview(parentKey);
            }
            if (wasBTHomeControl) this.emitBTHomeControlsUpdated();
            return;
        }

        this.removeEntity(entity);
        if (parentAddr) {
            const parentKey = this.findParentBTHomeDeviceKey(parentAddr);
            if (parentKey) this.refreshSingleBTHomeOverview(parentKey);
        }
        if (wasBTHomeControl) this.emitBTHomeControlsUpdated();
    }

    public forwardComponentEvent(key: string, event: BTHomeActionEvent) {
        // search for entity with type and id
        const entity = this.findEntity(key);

        // exit if doesn't exist
        if (!entity) {
            return;
        }

        ShellyEvents.emitEntityEvent(entity, event);
    }

    public rememberBTHomeRuntimeEvent(
        key: string,
        event: BTHomeActionEvent,
        idx?: number | null,
        channel?: number | null,
        ts?: number | null
    ) {
        const normalizedIdx = typeof idx === 'number' && idx >= 0 ? idx : null;
        const normalizedChannel = normalizeBTHomeChannel(channel);
        const normalizedTs = typeof ts === 'number' ? ts : null;
        const activeUntilMs = Date.now() + BTHOME_ACTIVE_EVENT_WINDOW_MS;
        const runtimeEvent: BTHomeRuntimeEvent = {
            event,
            idx: normalizedIdx,
            channel: normalizedChannel,
            ts: normalizedTs,
            activeUntilMs
        };

        this.#bthomeRuntimeEvents.set(key, runtimeEvent);

        this.logBTHomeRuntimeEvent(key, runtimeEvent);
        this.refreshSingleBTHomeOverview(key, {
            last_event: event,
            last_event_idx: normalizedIdx,
            last_event_ts: normalizedTs,
            ...(normalizedChannel != null ? {channel: normalizedChannel} : {})
        });

        // On first broadcast after pair, GetKnownObjects may have returned empty
        // so meta.controls stays []. Retry now that the device is proven alive —
        // GetKnownObjects returns the full button/dimmer list, populating the
        // persistent Controls grid in the overview.
        const controls = this.config[key]?.meta?.controls;
        if (!Array.isArray(controls) || controls.length === 0) {
            this.syncSingleBTHomeDeviceMeta(key)
                .then((changed) => {
                    if (changed) {
                        this.refreshBTHomeDeviceEntity(key);
                        this.refreshSingleBTHomeOverview(key);
                    }
                })
                .catch((error) => {
                    logger.debug(
                        'BTHome runtime metadata sync failed for %s: %s',
                        key,
                        error instanceof Error ? error.message : String(error)
                    );
                });
        }

        const existingTimer = this.#bthomeRuntimeTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
            const current = this.#bthomeRuntimeEvents.get(key);
            if (!current || current.activeUntilMs !== activeUntilMs) return;

            this.#bthomeRuntimeEvents.delete(key);
            this.#bthomeRuntimeTimers.delete(key);
            this.refreshSingleBTHomeOverview(key, {
                last_event: null,
                last_event_idx: null,
                last_event_ts: null
            });
        }, BTHOME_ACTIVE_EVENT_WINDOW_MS);
        this.#bthomeRuntimeTimers.set(key, timer);
    }

    private logBTHomeRuntimeEvent(
        key: string,
        runtimeEvent: BTHomeRuntimeEvent
    ) {
        const config = this.config[key];
        const controls = Array.isArray(config?.meta?.controls)
            ? config.meta.controls
            : [];
        const summary = formatBTHomeEventSummary(
            runtimeEvent.event,
            runtimeEvent.idx,
            controls,
            runtimeEvent.channel
        );

        logger.info(
            'BTHome event shellyID=%s component=%s addr=%s summary="%s" ts=%s',
            this.shellyID,
            key,
            config?.addr ?? 'n/a',
            summary,
            runtimeEvent.ts ?? 'n/a'
        );
    }

    private clearBTHomeRuntimeEvent(key: string) {
        this.#bthomeRuntimeEvents.delete(key);
        const timer = this.#bthomeRuntimeTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.#bthomeRuntimeTimers.delete(key);
        }
    }

    public async addBTHomeDeviceManual(
        mac: string,
        name?: string,
        productName?: string,
        modelId?: string
    ): Promise<void> {
        if (!mac) {
            return Promise.reject('Missing MAC address');
        }

        const cached = this.#bthomeDiscovery.get(mac);
        const cachedIdentity = resolveBluDeviceInfo(
            modelId ?? cached?.modelId,
            cached?.modelNumericId
        );
        const config: Record<string, any> = {addr: mac};
        const resolvedLocalName = cached?.localName;
        const resolvedProductName =
            productName ??
            cached?.productName ??
            (cachedIdentity.productName !== 'BLE Device'
                ? cachedIdentity.productName
                : undefined);
        const resolvedName =
            name?.trim() ||
            firstNonEmptyString(resolvedProductName, resolvedLocalName);
        if (resolvedName) {
            config.name = resolvedName;
        }

        // Store product name in meta so it's persisted on the device
        const meta: Record<string, any> = {ui: {view: 'regular'}};
        const resolvedModelId = modelId ?? cachedIdentity.modelId;
        const resolvedNumericModelId =
            cached?.modelNumericId ?? cachedIdentity.modelNumericId;

        if (resolvedProductName) meta.productName = resolvedProductName;
        if (resolvedModelId) meta.modelId = resolvedModelId;
        if (typeof resolvedNumericModelId === 'number') {
            meta.modelNumericId = resolvedNumericModelId;
        }
        if (resolvedLocalName) meta.localName = resolvedLocalName;
        if (cachedIdentity.isRemote) meta.isRemote = true;
        if (Object.keys(meta).length > 1) config.meta = meta;

        const freeId = pickFreeReservedBTHomeId(this.config);
        if (freeId == null) {
            return Promise.reject('No free BTHome ID available (200–299)');
        }

        return this.sendRPC('BTHome.AddDevice', {config, id: freeId});
    }

    /**
     * Pair a BLE sensor and auto-register all its non-device-level sensor
     * components in one backend-driven flow. Frontend makes a single RPC;
     * backend owns every step:
     *   1. Add the BTHome device (BTHome.AddDevice — existing addBTHomeDeviceManual)
     *   2. Wait for the bthomedevice:N component to appear (component_added flow)
     *   3. Wait for the device's first broadcast (last_updated_ts populated) —
     *      GetKnownObjects returns [] until the device has broadcast at least once
     *   4. For each non-device-level obj_id, add a bthomesensor:N component
     *
     * Polling here reads real device state (last_updated_ts) — not a guess.
     * Returns counts so the frontend can report without inventing anything.
     */
    public async pairBTHomeDeviceFully(
        mac: string,
        productName?: string,
        modelId?: string,
        options: {broadcastTimeoutMs?: number} = {}
    ): Promise<{
        alreadyPaired: boolean;
        bthomeDeviceId: number;
        sensorsAdded: number;
        sensorsTotal: number;
        broadcastReceived: boolean;
    }> {
        const broadcastTimeoutMs =
            options.broadcastTimeoutMs ?? tuning.bthome.pairBroadcastTimeoutMs;

        // Idempotent: -106 means already paired. Skip the add but still run
        // sensor fill-in against the existing bthomedevice:N — lets a re-pair
        // finish off a previous partial pair without inventing a new device.
        let alreadyPaired = false;
        try {
            await this.addBTHomeDeviceManual(
                mac,
                undefined,
                productName,
                modelId
            );
        } catch (err: any) {
            if (err?.code !== -106) throw err;
            alreadyPaired = true;
        }

        const bthomeKey = await this.#waitForBTHomeDeviceKey(
            mac,
            tuning.bthome.pairKeyTimeoutMs
        );
        if (!bthomeKey) {
            throw new Error(
                `Paired ${mac} but bthomedevice component did not appear`
            );
        }
        const bthomeId = this.config[bthomeKey]?.id;
        if (typeof bthomeId !== 'number') {
            throw new Error(`bthomedevice ${bthomeKey} has no numeric id`);
        }

        // Already-paired devices are known to work — no point waiting for
        // another broadcast (PIR / door sensors at rest may never broadcast
        // within the 20s window). Fresh pairs must wait so GetKnownObjects
        // returns a populated list.
        const broadcastReceived = alreadyPaired
            ? true
            : await this.#waitForFirstBroadcast(bthomeKey, broadcastTimeoutMs);

        const resp = await this.sendRPC('BTHomeDevice.GetKnownObjects', {
            id: bthomeId
        });
        const objects = Array.isArray(resp?.objects) ? resp.objects : [];
        const candidates = objects.filter(
            (obj: any) =>
                typeof obj?.obj_id === 'number' &&
                typeof obj?.idx === 'number' &&
                obj.idx >= 0 &&
                !isBTHomeDeviceLevelObjectId(obj.obj_id)
        );

        let sensorsAdded = 0;
        for (const obj of candidates) {
            try {
                await this.addBTHomeSensor(
                    obj.obj_id,
                    mac,
                    obj.obj_id,
                    obj.idx
                );
                sensorsAdded++;
            } catch (err) {
                // Already configured or device rejected — continue with the
                // rest. Backend logs; caller gets counts, not invented errors.
                logger.info(
                    'auto-add bthomesensor skipped for %s obj_id=%d idx=%d: %s',
                    mac,
                    obj.obj_id,
                    obj.idx,
                    err instanceof Error ? err.message : String(err)
                );
            }
        }

        return {
            alreadyPaired,
            bthomeDeviceId: bthomeId,
            sensorsAdded,
            sensorsTotal: candidates.length,
            broadcastReceived
        };
    }

    /** Poll local config until a bthomedevice:N appears for the given addr
     *  (populated by component_added → fetchComponent), or timeout. */
    async #waitForBTHomeDeviceKey(
        addr: string,
        timeoutMs: number
    ): Promise<string | null> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const key = this.findParentBTHomeDeviceKey(addr);
            if (key) return key;
            await new Promise((resolve) =>
                setTimeout(resolve, tuning.bthome.pairKeyPollMs)
            );
        }
        return this.findParentBTHomeDeviceKey(addr);
    }

    /** Poll bthomedevice:N status.last_updated_ts — set only by real device
     *  broadcasts. Returns true if a broadcast arrived before timeout. */
    async #waitForFirstBroadcast(
        bthomeKey: string,
        timeoutMs: number
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        const initialTs = this.status[bthomeKey]?.last_updated_ts;
        while (Date.now() < deadline) {
            const ts = this.status[bthomeKey]?.last_updated_ts;
            if (typeof ts === 'number' && ts > 0 && ts !== initialTs) {
                return true;
            }
            await new Promise((resolve) =>
                setTimeout(resolve, tuning.bthome.pairBroadcastPollMs)
            );
        }
        return false;
    }

    public removeBTHomeDevice(id: number): Promise<void> {
        if (typeof id !== 'number') {
            return Promise.reject('Missing BTHome device ID');
        }
        return this.sendRPC('BTHome.DeleteDevice', {id});
    }

    public removeBTHomeSensor(id: number): Promise<void> {
        if (typeof id !== 'number') {
            return Promise.reject('Missing BTHome sensor ID');
        }
        return this.sendRPC('BTHome.DeleteSensor', {id});
    }

    public getBTHomeObjectInfos(objIds: number[]): Promise<{
        objects: Array<{
            obj_id: number;
            obj_name: string;
            type: string;
            unit: string;
        }>;
        offset: number;
        count: number;
        total: number;
    }> {
        return this.sendRPC('BTHome.GetObjectInfos', {obj_ids: objIds});
    }

    private findEntity(key: string): entity_t | undefined {
        const {type, id} = parseComponentKey(key);

        return this.entities.find(
            (entity) =>
                entity.type === type &&
                (!('id' in entity.properties) || entity.properties.id === id)
        );
    }

    public async addBTHomeSensor(
        id: number,
        addr: string,
        obj_id: number,
        idx: number,
        name?: string,
        meta?: Record<string, any>
    ): Promise<void> {
        if (isBTHomeDeviceLevelObjectId(obj_id)) {
            return Promise.reject(
                `Object ${obj_id} is represented as device-level state and cannot be added as a standalone sensor`
            );
        }

        const existingSensor = findConfiguredBTHomeSensor(
            this.config,
            addr,
            obj_id,
            idx
        );
        if (existingSensor) {
            return Promise.reject(
                `Resource '${existingSensor.key}' already exists!`
            );
        }

        const sensorId = pickBTHomeSensorComponentId(this.config, id);
        if (sensorId == null) {
            return Promise.reject(
                'No free BTHomeSensor ID available (200–299)'
            );
        }

        const config: any = {
            addr,
            obj_id,
            obj_idx: idx // note: must be "obj_idx", not "idx"
        };
        if (name?.trim()) config.name = name.trim();
        if (meta != null) config.meta = meta;

        try {
            await this.sendRPC('BTHome.AddSensor', {config, id: sensorId});
        } catch (error) {
            if (isAlreadyExistsError(error)) {
                await this.syncBTHomeComponentsFromGatewaySafely();
                const syncedSensor = findConfiguredBTHomeSensor(
                    this.config,
                    addr,
                    obj_id,
                    idx
                );
                if (syncedSensor) {
                    return;
                }
            }

            throw error;
        }
    }

    private async syncSingleBTHomeDeviceMetaSafely(
        key: string
    ): Promise<boolean> {
        try {
            return await this.syncSingleBTHomeDeviceMeta(key);
        } catch (error) {
            logger.debug(
                'BTHome metadata sync failed for %s: %s',
                key,
                error instanceof Error ? error.message : String(error)
            );
            return false;
        }
    }

    private async syncBTHomeComponentsFromGatewaySafely(): Promise<void> {
        try {
            await this.syncBTHomeComponentsFromGateway();
        } catch (error) {
            logger.debug(
                'BTHome gateway component sync failed: %s',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * One-time enrichment: resolve BLE device product names from model_id
     * and persist them on the device config. Runs once after connect.
     * After this, every bthomedevice:N has meta.productName — no runtime lookups needed.
     */
    async enrichBTHomeDeviceMeta(): Promise<void> {
        for (const key of Object.keys(this.config)) {
            if (!key.startsWith('bthomedevice:')) continue;
            const changed = await this.syncSingleBTHomeDeviceMeta(key).catch(
                () => false
            );
            if (changed) {
                this.refreshBTHomeDeviceEntity(key);
            }
        }
        this.syncAllBTHomeOverviews();
    }

    override destroy(options?: {skipDeleteEvent?: boolean}): void {
        for (const timer of this.#bthomeRuntimeTimers.values()) {
            clearTimeout(timer);
        }
        this.#bthomeRuntimeTimers.clear();
        this.#clearBTHomeLearningPoll();
        this.#bthomeLearning = null;
        if (this.#persistTimer) {
            clearTimeout(this.#persistTimer);
            this.#persistTimer = undefined;
            this.#persistState();
        }
        if (!options?.skipDeleteEvent) {
            ShellyEvents.emitShellyDeleted(this);
        }
        super.destroy(options);
    }
}

const SWITCH_CONSUMPTION_KEYS = ['current', 'apower', 'voltage'];
export function findMessageReason(key: string, value: Record<string, any>) {
    const separatorIndex = key.indexOf(':');
    const core = separatorIndex > -1 ? key.slice(0, separatorIndex) : key;
    const valueKeys = Object.keys(value);

    // A metered switch update carries output + apower/voltage/current AND
    // aenergy together. Label it by the meaningful change, not aenergy —
    // otherwise the dashboard's aenergy deny drops the whole event and live
    // power never updates.
    if (key.startsWith('switch')) {
        if (valueKeys.includes('output')) {
            return `${core}:output`;
        }
        if (
            valueKeys.find((entry) => SWITCH_CONSUMPTION_KEYS.includes(entry))
        ) {
            return `${core}:consumption`;
        }
    }

    if (valueKeys.includes('aenergy')) {
        return `${core}:aenergy`;
    }

    return `${core}:generic`;
}

const ENDS_WITH_NUMBER = /:\d+$/;
export function parseComponentKey(key: string): {type: string; id?: number} {
    const type = key.replace(ENDS_WITH_NUMBER, '');
    const id = Number.parseInt(key.replace(`${type}:`, ''), 10);

    return {
        type,
        ...(Number.isFinite(id) ? {id} : {})
    };
}

function resolveModelStringFromMeta(options: {
    existingModelId?: string;
    discoveredModelId?: string;
    numericModelId?: number;
}): string | undefined {
    if (
        typeof options.existingModelId === 'string' &&
        BLU_DEVICES[options.existingModelId]
    ) {
        return options.existingModelId;
    }
    if (
        typeof options.discoveredModelId === 'string' &&
        BLU_DEVICES[options.discoveredModelId]
    ) {
        return options.discoveredModelId;
    }
    return resolveBluDeviceInfo(undefined, options.numericModelId).modelId;
}

function isAutoGeneratedBTHomeDeviceName(options: {
    name?: string;
    addr?: string;
    componentId?: number;
    autoGeneratedLabels?: Array<string | undefined>;
}): boolean {
    const name = firstNonEmptyString(options.name);
    if (!name) return true;

    const normalizedName = name.toLowerCase();
    if (normalizedName === 'ble device') return true;

    if (
        typeof options.componentId === 'number' &&
        normalizedName === `ble device ${options.componentId}`.toLowerCase()
    ) {
        return true;
    }

    const addr = firstNonEmptyString(options.addr)?.toLowerCase();
    if (
        addr &&
        (normalizedName === addr || normalizedName === `unknown - ${addr}`)
    ) {
        return true;
    }

    return (options.autoGeneratedLabels ?? [])
        .map((value) => firstNonEmptyString(value)?.toLowerCase())
        .some((value) => value === normalizedName);
}

function getErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'message' in error) {
        const message = (error as {message?: unknown}).message;
        if (typeof message === 'string') {
            return message;
        }
    }

    return String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
    return getErrorMessage(error).toLowerCase().includes('already exists');
}

function isBTHomeDynamicComponentKey(key: string): boolean {
    return (
        key.startsWith('bthomedevice:') ||
        key.startsWith('bthomesensor:') ||
        key.startsWith('bthomecontrol:') ||
        key.startsWith('blutrv:')
    );
}

function omitBTHomeRuntimeFields(
    value: Record<string, any>
): Record<string, any> {
    const {
        overview: _overview,
        last_event: _lastEvent,
        last_event_idx: _lastEventIdx,
        last_event_ts: _lastEventTs,
        ...persistedValue
    } = value;

    return persistedValue;
}

// displayValue is derived and rebuilt on load — never persist it (like overview).
function omitBTHomeSensorRuntimeFields(
    value: Record<string, any>
): Record<string, any> {
    const {displayValue: _displayValue, ...persistedValue} = value;
    return persistedValue;
}

// Strip derived runtime fields (bthomedevice overview/last_event, bthomesensor
// displayValue) — rebuilt on load, never stored.
function stripBTHomeRuntimeFields(
    key: string,
    value: Record<string, any>
): Record<string, any> {
    if (key.startsWith('bthomedevice:')) return omitBTHomeRuntimeFields(value);
    if (key.startsWith('bthomesensor:')) {
        return omitBTHomeSensorRuntimeFields(value);
    }
    return value;
}

function stripPersistedBTHomeRuntimeStatus(status: Record<string, any>) {
    for (const [key, value] of Object.entries(status)) {
        if (!value || typeof value !== 'object') continue;
        status[key] = stripBTHomeRuntimeFields(
            key,
            value as Record<string, any>
        );
    }
}

export function buildPersistableDeviceSnapshot(
    device: ShellyDeviceExternal
): ShellyDeviceExternal {
    const status: Record<string, any> = {};

    for (const [key, value] of Object.entries(device.status ?? {})) {
        status[key] =
            value && typeof value === 'object'
                ? stripBTHomeRuntimeFields(key, value as Record<string, any>)
                : value;
    }

    return {
        ...device,
        status
    };
}
