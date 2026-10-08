import {createHash} from 'node:crypto';
import {
    BLU_TRV_MODEL_ID,
    bluHeartbeatFloorSec,
    bthomeObjectInfos
} from '../config/BTHomeData';
import {EM_DEVICE_HISTORY_SECONDS} from '../config/energy';
import {
    DEFAULT_POWER_FACTOR,
    EM_PHASES,
    NOMINAL_VOLTAGE_V,
    round
} from './electrical';
import {oasisPrecipitationMm, soilMoisturePct} from './scenarios';
import {buildTelemetryPatch, virtualRoles} from './telemetry';
import type {
    ExpandedDeviceProfile,
    JsonObject,
    SimulatorComponent,
    SimulatorNotification,
    SimulatorRpcRequest,
    SimulatorRpcResponse,
    SimulatorRpcResult
} from './types';

const INVALID_ARGUMENT = -103;
const METHOD_NOT_FOUND = -104;
const COMPONENT_PAGE_SIZE = 10;
export const EM_DATA_PERIOD_SECONDS = 60;
export const BLU_STATE_CHANGE_MAX_INTERVAL_MS = 60_000;
// Real Shelly EM meters keep 60 days of 1-minute records on-device.
export const EM_DATA_RETENTION_SECONDS = EM_DEVICE_HISTORY_SECONDS;
// One GetData call is chunked when the response is large. This caps the records
// per call so a backlogged device forces the FM catch-up loop to iterate, the
// same as real firmware. 240 = 4 hours of 1-minute records.
export const EM_DATA_MAX_RECORDS_PER_CALL = 240;

// Per-phase fields a real Pro 3EM returns from EMData.GetData, in order.
// Source: shelly-api-docs EMData.GetData (16 per phase + 3 neutral currents =
// 51 keys). Note there is NO `{p}_total_current` — real firmware exposes
// max/min/avg current only.
const EM_PHASE_FIELDS = [
    'total_act_energy',
    'fund_act_energy',
    'total_act_ret_energy',
    'fund_act_ret_energy',
    'lag_react_energy',
    'lead_react_energy',
    'max_act_power',
    'min_act_power',
    'max_aprt_power',
    'min_aprt_power',
    'max_voltage',
    'min_voltage',
    'avg_voltage',
    'max_current',
    'min_current',
    'avg_current'
] as const;
const EM_NEUTRAL_FIELDS = [
    'n_max_current',
    'n_min_current',
    'n_avg_current'
] as const;
// Fields EM1Data.GetData returns for a single-phase meter, in order.
// Source: shelly-api-docs EM1Data.GetData (14 keys).
const EM1_DATA_FIELDS = [
    'total_act_energy',
    'total_act_ret_energy',
    'lag_react_energy',
    'lead_react_energy',
    'max_act_power',
    'min_act_power',
    'max_aprt_power',
    'min_aprt_power',
    'max_voltage',
    'min_voltage',
    'avg_voltage',
    'max_current',
    'min_current',
    'avg_current'
] as const;
// RGBCCT.Set carries `mode`; it is state, not just config.
const SET_STATE_FIELDS = [
    'brightness',
    'rgb',
    'white',
    'temp',
    'ct',
    'mode',
    'target_C',
    'value'
] as const;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bluetoothModel(
    identityKey: string,
    config: JsonObject
): string | undefined {
    if (identityKey.startsWith('blutrv:')) {
        return typeof config.model === 'string'
            ? config.model
            : BLU_TRV_MODEL_ID;
    }
    const meta = isObject(config.meta) ? config.meta : {};
    return typeof meta.modelId === 'string' ? meta.modelId : undefined;
}

// The catalog cadence drives each gateway; slow state changes are checked every minute.
export function bluetoothSimulationTickMs(
    profile: ExpandedDeviceProfile
): number | null {
    let intervalMs: number | null = null;
    for (const [key, config] of Object.entries(profile.config)) {
        if (!key.startsWith('bthomedevice:') && !key.startsWith('blutrv:')) {
            continue;
        }
        const cadenceSec = bluHeartbeatFloorSec(
            bluetoothModel(key, config) ?? ''
        );
        const candidateMs = Math.min(
            cadenceSec === null
                ? BLU_STATE_CHANGE_MAX_INTERVAL_MS
                : cadenceSec * 1000,
            BLU_STATE_CHANGE_MAX_INTERVAL_MS
        );
        intervalMs =
            intervalMs === null
                ? candidateMs
                : Math.min(intervalMs, candidateMs);
    }
    return intervalMs;
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

// Live-run controls. They reach the device through Fleet Manager's Device.Call
// relay like any RPC, so a harness needs no side channel into the simulator.
const INJECTION_METHODS = ['Sim.SetStatus', 'Sim.Disconnect'] as const;

function mergeObject(target: JsonObject, patch: JsonObject): void {
    for (const [key, value] of Object.entries(patch)) {
        if (isObject(value) && isObject(target[key])) {
            mergeObject(target[key] as JsonObject, value);
            continue;
        }
        target[key] = clone(value);
    }
}

// GetData keys of a meter data component, in the documented order.
function recordKeys(namespace: string): string[] {
    return namespace === 'emdata'
        ? [
              ...EM_PHASES.flatMap((phase) =>
                  EM_PHASE_FIELDS.map((field) => `${phase}_${field}`)
              ),
              ...EM_NEUTRAL_FIELDS
          ]
        : [...EM1_DATA_FIELDS];
}

function namespaceFromMethod(method: string): string {
    return method.slice(0, method.indexOf('.')).toLowerCase();
}

function componentKey(method: string, params: JsonObject): string {
    const namespace = namespaceFromMethod(method);
    return typeof params.id === 'number'
        ? `${namespace}:${params.id}`
        : namespace;
}

function responseFor(input: {
    deviceID: string;
    request: SimulatorRpcRequest;
    result: unknown;
}): SimulatorRpcResponse {
    return {
        id: input.request.id,
        src: input.deviceID,
        ...(input.request.src ? {dst: input.request.src} : {}),
        result: input.result
    };
}

function errorFor(input: {
    deviceID: string;
    request: SimulatorRpcRequest;
    code: number;
    message: string;
}): SimulatorRpcResponse {
    return {
        id: input.request.id,
        src: input.deviceID,
        ...(input.request.src ? {dst: input.request.src} : {}),
        error: {code: input.code, message: input.message}
    };
}

// Household and small-commercial loads run inside this power factor band.
const RECORD_PF_MIN = 0.8;
const RECORD_PF_MAX = 0.98;

// The profile's own pf is the configured one; records never drift off it.
function recordPowerFactor(configured: unknown): number {
    const pf = typeof configured === 'number' ? configured : NaN;
    const value = Number.isFinite(pf) && pf > 0 ? pf : DEFAULT_POWER_FACTOR;
    return Math.min(RECORD_PF_MAX, Math.max(RECORD_PF_MIN, value));
}

// Every third channel or phase runs leading (capacitive); the rest lag.
function isLeadingChannel(index: number): boolean {
    return index % 3 === 2;
}

type RequestHandler = (request: SimulatorRpcRequest) => SimulatorRpcResult;

export class SimulatedShellyDevice {
    readonly #profile: ExpandedDeviceProfile;
    readonly #telemetryBaseline: Record<string, JsonObject>;
    readonly #methods: Map<string, string>;
    readonly #shellyHandlers: ReadonlyMap<string, RequestHandler>;
    readonly #systemHandlers: ReadonlyMap<string, RequestHandler>;
    readonly #componentHandlers: ReadonlyMap<string, RequestHandler>;
    readonly #schedules = new Map<number, JsonObject>();
    readonly #webhooks = new Map<number, JsonObject>();
    readonly #bluEventAt = new Map<string, number>();
    readonly #bluHeartbeatAt = new Map<string, number>();
    #nextScheduleId = 1;
    #nextWebhookId = 1;
    #lastTelemetryAtMs: number | undefined;
    #pinned = new Map<string, Set<string>>();
    #disconnectSeconds: number | null = null;
    // How far back this meter holds 1-minute records. Real hardware keeps 60
    // days; tests shorten it to bound the backlog they have to drain.
    readonly #energyHistorySeconds: number;
    readonly #nowMs: () => number;
    readonly #bluBunched: boolean;
    // Share of minute record pushes left unsent, as real meters miss some.
    readonly #recordPushDropShare: number;
    readonly #random: () => number;
    #lastPushedRecordTs: number | undefined;

    constructor(
        profile: ExpandedDeviceProfile,
        options: {
            energyHistorySeconds?: number;
            nowMs?: () => number;
            /** Every BLU child due on the same tick: a stress shape, not a real fleet. */
            bluBunched?: boolean;
            /** 0..1 share of per-minute record pushes not sent. */
            recordPushDropShare?: number;
            random?: () => number;
        } = {}
    ) {
        this.#energyHistorySeconds =
            options.energyHistorySeconds ?? EM_DATA_RETENTION_SECONDS;
        this.#nowMs = options.nowMs ?? Date.now;
        this.#bluBunched = options.bluBunched ?? false;
        this.#recordPushDropShare = options.recordPushDropShare ?? 0;
        if (
            !(this.#recordPushDropShare >= 0 && this.#recordPushDropShare <= 1)
        ) {
            throw new Error('record push drop share must be between 0 and 1');
        }
        this.#random = options.random ?? Math.random;
        this.#profile = clone(profile);
        this.#telemetryBaseline = clone(profile.status);
        this.#methods = new Map(
            profile.methods.map((method) => [method.toLowerCase(), method])
        );
        // Fault injection is answered but never advertised: Shelly.ListMethods
        // stays what the real firmware would say.
        for (const method of INJECTION_METHODS) {
            this.#methods.set(method.toLowerCase(), method);
        }
        this.#shellyHandlers = new Map<string, RequestHandler>([
            [
                'Shelly.GetDeviceInfo',
                (request) =>
                    this.#success(request, {result: this.#deviceInfo()})
            ],
            [
                'Shelly.GetStatus',
                (request) =>
                    this.#success(request, {
                        result: clone(this.#profile.status)
                    })
            ],
            [
                'Shelly.GetConfig',
                (request) =>
                    this.#success(request, {
                        result: clone(this.#profile.config)
                    })
            ],
            [
                'Shelly.ListMethods',
                (request) =>
                    this.#success(request, {
                        result: {methods: [...this.#profile.methods]}
                    })
            ],
            ['Shelly.ListProfiles', (request) => this.#listProfiles(request)],
            ['Shelly.SetProfile', (request) => this.#setProfile(request)],
            ['Shelly.GetComponents', (request) => this.#getComponents(request)],
            ['Sim.SetStatus', (request) => this.#injectStatus(request)],
            ['Sim.Disconnect', (request) => this.#requestDisconnect(request)]
        ]);
        this.#systemHandlers = new Map<string, RequestHandler>([
            ['Schedule.List', (request) => this.#listSchedules(request)],
            ['Schedule.Create', (request) => this.#createSchedule(request)],
            ['Schedule.Update', (request) => this.#updateSchedule(request)],
            ['Schedule.Delete', (request) => this.#deleteSchedule(request)],
            [
                'Schedule.DeleteAll',
                (request) => this.#deleteAllSchedules(request)
            ],
            ['Webhook.List', (request) => this.#listWebhooks(request)],
            [
                'Webhook.ListSupported',
                (request) => this.#listSupportedWebhooks(request)
            ],
            [
                'Webhook.ListAllSupported',
                (request) => this.#listAllSupportedWebhooks(request)
            ],
            ['Webhook.Create', (request) => this.#createWebhook(request)],
            ['Webhook.Update', (request) => this.#updateWebhook(request)],
            ['Webhook.Delete', (request) => this.#deleteWebhook(request)],
            [
                'Webhook.DeleteAll',
                (request) => this.#deleteAllWebhooks(request)
            ],
            [
                'BTHome.DeleteDevice',
                (request) => this.#deleteBTHomeDevice(request)
            ]
        ]);
        this.#componentHandlers = new Map<string, RequestHandler>([
            ['GetStatus', (request) => this.#getStatus(request)],
            ['GetConfig', (request) => this.#getConfig(request)],
            ['GetData', (request) => this.#getEnergyData(request)],
            ['SetConfig', (request) => this.#setConfig(request)],
            ['Set', (request) => this.#setState(request)],
            ['Trigger', (request) => this.#triggerButton(request)],
            ['Toggle', (request) => this.#toggle(request)],
            ['Open', (request) => this.#moveCover(request, 100)],
            ['Close', (request) => this.#moveCover(request, 0)],
            ['Stop', (request) => this.#stopCover(request)],
            ['GoToPosition', (request) => this.#goToCoverPosition(request)],
            ['Mute', (request) => this.#muteAlarm(request)],
            ['Call', (request) => this.#callBluTrv(request)],
            ['CheckForUpdates', (request) => this.#checkBluTrvUpdates(request)],
            [
                'UpdateFirmware',
                (request) => this.#updateBluTrvFirmware(request)
            ],
            ['Delete', (request) => this.#deleteBluTrv(request)]
        ]);
    }

    get shellyID(): string {
        return this.#profile.shellyID;
    }

    get profile(): ExpandedDeviceProfile {
        return clone(this.#profile);
    }

    // A real device keeps metering while disconnected, so a reconnect catches up the gap.
    initialNotification(nowMs = Date.now()): SimulatorNotification {
        const hasRunBefore = this.#lastTelemetryAtMs !== undefined;
        if (hasRunBefore) this.#advanceTelemetry(nowMs);
        this.#lastTelemetryAtMs = nowMs;
        this.#stampBluetoothStatus(nowMs);
        return {
            method: this.#profile.initialNotificationMethod,
            src: this.shellyID,
            params: clone(this.#profile.status)
        };
    }

    telemetryNotification(nowMs = Date.now()): SimulatorNotification | null {
        const patch = this.#advanceTelemetry(nowMs);
        if (Object.keys(patch).length === 0) return null;
        return this.#statusNotification({ts: nowMs / 1000, ...patch});
    }

    // One physics step shared by the live tick and the reconnect catch-up.
    #advanceTelemetry(nowMs: number): JsonObject {
        const previousAtMs = this.#lastTelemetryAtMs ?? nowMs;
        const elapsedSeconds = Math.max(0, (nowMs - previousAtMs) / 1000);
        this.#lastTelemetryAtMs = Math.max(previousAtMs, nowMs);
        const patch = buildTelemetryPatch({
            baseline: this.#telemetryBaseline,
            status: this.#profile.status,
            elapsedSeconds,
            nowMs,
            fixture: this.#profile.fixture,
            premises: this.#profile.premises,
            solar: this.#profile.solar,
            roles: virtualRoles(this.#profile.config)
        });
        this.#dropPinned(patch);
        if (Object.keys(patch).length > 0)
            mergeObject(this.#profile.status, patch);
        return patch;
    }

    get hasRecordComponents(): boolean {
        return this.#recordComponents().length > 0;
    }

    // The meter pushes each record when it saves it: once per completed
    // minute, values in GetData key order, no keys. Dropped pushes stay
    // available through GetData.
    recordPushNotification(
        nowMs = this.#nowMs()
    ): SimulatorNotification | null {
        const period = EM_DATA_PERIOD_SECONDS;
        const nowS = nowMs / 1000;
        const minuteTs = Math.floor(nowS / period) * period - period;
        if (
            this.#lastPushedRecordTs !== undefined &&
            minuteTs <= this.#lastPushedRecordTs
        ) {
            return null;
        }
        this.#lastPushedRecordTs = minuteTs;
        const events = this.#recordComponents()
            .filter(() => this.#random() >= this.#recordPushDropShare)
            .map(({component, namespace, id}) => ({
                component,
                id,
                event: 'data',
                ts: nowS,
                data: [
                    {
                        ts: minuteTs,
                        period,
                        values: [this.#recordRow(namespace, id)]
                    }
                ]
            }));
        if (events.length === 0) return null;
        return {
            method: 'NotifyEvent',
            src: this.shellyID,
            params: {ts: nowS, events}
        };
    }

    #recordComponents(): Array<{
        component: string;
        namespace: string;
        id: number;
    }> {
        return Object.keys(this.#profile.status).flatMap((component) => {
            const match = /^(emdata|em1data):(\d+)$/.exec(component);
            return match
                ? [{component, namespace: match[1], id: Number(match[2])}]
                : [];
        });
    }

    /** Seconds a Sim.Disconnect asked for, once; null when none is pending. */
    takeDisconnectRequest(): number | null {
        const seconds = this.#disconnectSeconds;
        this.#disconnectSeconds = null;
        return seconds;
    }

    // An injected reading is pinned: the physics keeps moving every other
    // field, but never overwrites what the operator forced.
    #dropPinned(patch: JsonObject): void {
        for (const [key, fields] of this.#pinned) {
            const component = patch[key];
            if (!isObject(component)) continue;
            for (const field of fields) delete component[field];
            if (Object.keys(component).length === 0) delete patch[key];
        }
    }

    #injectStatus(request: SimulatorRpcRequest): SimulatorRpcResult {
        const patch = request.params?.patch;
        if (!isObject(patch)) throw new Error('patch must be an object');
        const applied: string[] = [];
        for (const [key, fields] of Object.entries(patch)) {
            if (!isObject(fields)) {
                throw new Error(`${key} must be an object of fields`);
            }
            const status = this.#requireStatus(key);
            mergeObject(status, fields);
            const pinned = this.#pinned.get(key) ?? new Set<string>();
            for (const field of Object.keys(fields)) pinned.add(field);
            this.#pinned.set(key, pinned);
            applied.push(key);
        }
        return this.#success(request, {
            result: {applied},
            notifications: [this.#statusNotification(clone(patch))]
        });
    }

    // Unpair a BLU device: the device and every sensor that rides its address
    // leave config and status, and the gateway announces each removal the way
    // firmware does, so a listener drops them too.
    #deleteBTHomeDevice(request: SimulatorRpcRequest): SimulatorRpcResult {
        const id = request.params?.id;
        if (typeof id !== 'number') throw new Error('numeric id is required');
        const deviceKey = `bthomedevice:${id}`;
        const deviceConfig = this.#profile.config[deviceKey];
        if (!isObject(deviceConfig)) {
            throw new Error(`unknown component: ${deviceKey}`);
        }
        const addr = deviceConfig.addr;
        const removed = [
            deviceKey,
            ...Object.keys(this.#profile.config).filter((key) => {
                if (!key.startsWith('bthomesensor:')) return false;
                const sensor = this.#profile.config[key];
                return isObject(sensor) && sensor.addr === addr;
            })
        ];
        for (const key of removed) {
            delete this.#profile.config[key];
            delete this.#profile.status[key];
            delete this.#telemetryBaseline[key];
            this.#bluEventAt.delete(key);
            this.#bluHeartbeatAt.delete(key);
            this.#pinned.delete(key);
        }
        const ts = this.#nowMs() / 1000;
        return this.#success(request, {
            result: {},
            notifications: [
                {
                    method: 'NotifyEvent',
                    src: this.shellyID,
                    params: {
                        ts,
                        events: removed.map((target) => ({
                            component: 'sys',
                            event: 'component_removed',
                            target,
                            ts
                        }))
                    }
                }
            ]
        });
    }

    #requestDisconnect(request: SimulatorRpcRequest): SimulatorRpcResult {
        const seconds = request.params?.seconds;
        if (typeof seconds !== 'number' || !(seconds > 0)) {
            throw new Error('seconds must be a positive number');
        }
        this.#disconnectSeconds = seconds;
        return this.#success(request, {result: {seconds}});
    }

    get hasBluetoothComponents(): boolean {
        return Object.keys(this.#profile.config).some(
            (key) =>
                key.startsWith('bthomedevice:') || key.startsWith('blutrv:')
        );
    }

    bluetoothHeartbeatNotification(
        nowMs = Date.now()
    ): SimulatorNotification | null {
        const params: JsonObject = {};
        for (const [key, config] of Object.entries(this.#profile.config)) {
            if (
                !key.startsWith('bthomedevice:') &&
                !key.startsWith('blutrv:')
            ) {
                continue;
            }
            if (
                !this.#bluNotificationDue(
                    this.#bluHeartbeatAt,
                    key,
                    config,
                    nowMs
                )
            ) {
                continue;
            }
            this.#addBluetoothStatus(params, key, config, nowMs);
        }
        return Object.keys(params).length > 0
            ? this.#statusNotification(params)
            : null;
    }

    bluetoothEventNotification(
        nowMs = Date.now()
    ): SimulatorNotification | null {
        const events: JsonObject[] = [];
        const timestamp = nowMs / 1000;
        for (const [key, config] of Object.entries(this.#profile.config)) {
            if (!key.startsWith('bthomedevice:')) continue;
            if (
                !this.#bluNotificationDue(
                    this.#bluEventAt,
                    key,
                    config,
                    nowMs,
                    BLU_STATE_CHANGE_MAX_INTERVAL_MS / 1000
                )
            ) {
                continue;
            }
            const sensors = this.#bthomeEventSensors(config.addr, timestamp);
            if (Object.keys(sensors).length === 0) continue;
            events.push({
                component: key,
                event: 'sensor_update',
                ts: timestamp,
                sensors
            });
        }
        return events.length > 0
            ? {
                  method: 'NotifyEvent',
                  src: this.shellyID,
                  params: {ts: timestamp, events}
              }
            : null;
    }

    handleRequest(request: SimulatorRpcRequest): SimulatorRpcResult {
        const canonicalMethod = this.#methods.get(request.method.toLowerCase());
        if (!canonicalMethod) {
            return this.#error(request, {
                code: METHOD_NOT_FOUND,
                message: `method not found: ${request.method}`
            });
        }

        const normalized = {...request, method: canonicalMethod};
        try {
            return this.#dispatch(normalized);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'invalid arguments';
            return this.#error(normalized, {code: INVALID_ARGUMENT, message});
        }
    }

    #dispatch(request: SimulatorRpcRequest): SimulatorRpcResult {
        const handler =
            this.#shellyHandlers.get(request.method) ??
            this.#systemHandlers.get(request.method);
        return handler ? handler(request) : this.#dispatchComponent(request);
    }

    #dispatchComponent(request: SimulatorRpcRequest): SimulatorRpcResult {
        const operation = request.method.slice(request.method.indexOf('.') + 1);
        const handler = this.#componentHandlers.get(operation);
        if (!handler) throw new Error(`unsupported operation: ${operation}`);
        return handler(request);
    }

    #listProfiles(request: SimulatorRpcRequest): SimulatorRpcResult {
        return this.#success(request, {
            result: {profiles: clone(this.#profile.profiles ?? {})}
        });
    }

    #setProfile(request: SimulatorRpcRequest): SimulatorRpcResult {
        const name = request.params?.name;
        if (typeof name !== 'string' || !this.#profile.profiles?.[name]) {
            throw new Error('unknown profile');
        }
        return this.#success(request, {result: {}});
    }

    #listSchedules(request: SimulatorRpcRequest): SimulatorRpcResult {
        return this.#success(request, {
            result: {jobs: [...this.#schedules.values()].map(clone)}
        });
    }

    #createSchedule(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (
            typeof params.timespec !== 'string' ||
            !Array.isArray(params.calls)
        ) {
            throw new Error('timespec and calls are required');
        }
        const id = this.#nextScheduleId++;
        this.#schedules.set(id, {
            id,
            enable: params.enable ?? true,
            timespec: params.timespec,
            calls: clone(params.calls)
        });
        return this.#success(request, {result: {id}});
    }

    #updateSchedule(request: SimulatorRpcRequest): SimulatorRpcResult {
        this.#updateStored(this.#schedules, request.params ?? {});
        return this.#success(request, {result: {}});
    }

    #deleteSchedule(request: SimulatorRpcRequest): SimulatorRpcResult {
        this.#deleteStored(this.#schedules, request.params ?? {});
        return this.#success(request, {result: {}});
    }

    #deleteAllSchedules(request: SimulatorRpcRequest): SimulatorRpcResult {
        this.#schedules.clear();
        return this.#success(request, {result: {}});
    }

    #listWebhooks(request: SimulatorRpcRequest): SimulatorRpcResult {
        return this.#success(request, {
            result: {hooks: [...this.#webhooks.values()].map(clone)}
        });
    }

    #listSupportedWebhooks(request: SimulatorRpcRequest): SimulatorRpcResult {
        return this.#success(request, {
            result: {events: ['switch.on', 'switch.off', 'input.toggle']}
        });
    }

    #listAllSupportedWebhooks(
        request: SimulatorRpcRequest
    ): SimulatorRpcResult {
        const componentTypes = new Set(
            [
                ...Object.keys(this.#profile.config),
                ...Object.keys(this.#profile.status)
            ].map((key) => key.split(':')[0])
        );
        const types: Array<Record<string, JsonObject>> = [];
        if (componentTypes.has('switch')) {
            types.push({'switch.on': {attrs: []}}, {'switch.off': {attrs: []}});
        }
        if (componentTypes.has('input')) {
            types.push({'input.toggle': {attrs: []}});
        }
        if (componentTypes.has('bthomedevice')) {
            types.push({
                'bthomedevice.sensor_update': {
                    attrs: [
                        {
                            name: 'sensors',
                            type: 'object',
                            desc: 'Updated BTHome sensor statuses'
                        }
                    ]
                }
            });
        }
        return this.#success(request, {
            result: {
                types,
                offset: 0,
                total: types.length
            }
        });
    }

    #createWebhook(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (
            typeof params.cid !== 'number' ||
            typeof params.event !== 'string' ||
            !Array.isArray(params.urls)
        ) {
            throw new Error('cid, event, and urls are required');
        }
        const id = this.#nextWebhookId++;
        this.#webhooks.set(id, {...clone(params), id});
        return this.#success(request, {result: {id}});
    }

    #updateWebhook(request: SimulatorRpcRequest): SimulatorRpcResult {
        this.#updateStored(this.#webhooks, request.params ?? {});
        return this.#success(request, {result: {}});
    }

    #deleteWebhook(request: SimulatorRpcRequest): SimulatorRpcResult {
        this.#deleteStored(this.#webhooks, request.params ?? {});
        return this.#success(request, {result: {}});
    }

    #deleteAllWebhooks(request: SimulatorRpcRequest): SimulatorRpcResult {
        this.#webhooks.clear();
        return this.#success(request, {result: {}});
    }

    #updateStored(store: Map<number, JsonObject>, params: JsonObject): void {
        if (typeof params.id !== 'number') throw new Error('id is required');
        const current = store.get(params.id);
        if (!current) throw new Error(`unknown id: ${params.id}`);
        mergeObject(current, params);
    }

    #deleteStored(store: Map<number, JsonObject>, params: JsonObject): void {
        if (typeof params.id !== 'number') throw new Error('id is required');
        if (!store.delete(params.id))
            throw new Error(`unknown id: ${params.id}`);
    }

    #getComponents(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const offset = params.offset ?? 0;
        if (!Number.isSafeInteger(offset) || (offset as number) < 0) {
            throw new Error('offset must be a non-negative integer');
        }
        const components = this.#components();
        return this.#success(request, {
            result: {
                components: components.slice(
                    offset as number,
                    (offset as number) + COMPONENT_PAGE_SIZE
                ),
                cfg_rev: this.#configRevision(),
                offset,
                total: components.length
            }
        });
    }

    #getStatus(request: SimulatorRpcRequest): SimulatorRpcResult {
        const key = componentKey(request.method, request.params ?? {});
        return this.#success(request, {
            result: clone(this.#requireStatus(key))
        });
    }

    #getConfig(request: SimulatorRpcRequest): SimulatorRpcResult {
        const key = componentKey(request.method, request.params ?? {});
        return this.#success(request, {
            result: clone(this.#requireConfig(key))
        });
    }

    // Serve on-device meter history the way real firmware does: 1-minute
    // records from the requested cursor forward, chunked, with next_record_ts
    // pointing at the first record NOT returned (omitted once caught up). Each
    // record's energy is derived from the meter's own stated power, so the
    // series is self-consistent and a caller can compute the expected total
    // independently. Records are steady across the window — a constant load —
    // which keeps the drained total exact and hand-checkable.
    #getEnergyData(request: SimulatorRpcRequest): SimulatorRpcResult {
        const namespace = namespaceFromMethod(request.method);
        if (namespace !== 'emdata' && namespace !== 'em1data') {
            throw new Error(`unsupported operation: ${request.method}`);
        }
        const params = request.params ?? {};
        if (typeof params.id !== 'number' || typeof params.ts !== 'number') {
            throw new Error('numeric id and ts are required');
        }
        this.#requireStatus(`${namespace}:${params.id}`);

        const period = EM_DATA_PERIOD_SECONDS;
        const alignDown = (value: number) =>
            Math.floor(value / period) * period;
        const alignUp = (value: number) => Math.ceil(value / period) * period;
        const now = alignDown(this.#nowMs() / 1000);
        // The most recent COMPLETE minute; the current minute is still filling.
        const lastRecordTs = now - period;
        const firstRecordTs = alignUp(now - this.#energyHistorySeconds);
        const requestedEnd =
            typeof params.end_ts === 'number'
                ? alignDown(params.end_ts)
                : lastRecordTs;
        const end = Math.min(requestedEnd, lastRecordTs);
        const start = Math.max(alignUp(params.ts), firstRecordTs);

        const keys = recordKeys(namespace);

        if (start > end) {
            // Nothing in range — caught up. No next_record_ts, as real firmware.
            return this.#success(request, {result: {keys, data: []}});
        }

        const available = (end - start) / period + 1;
        const count = Math.min(EM_DATA_MAX_RECORDS_PER_CALL, available);
        const blockEnd = start + (count - 1) * period;
        const row = this.#recordRow(namespace, params.id);
        const values = Array.from({length: count}, () => [...row]);

        const result: JsonObject = {
            keys,
            data: [{ts: start, period, values}]
        };
        // More records remain past this block → point at the next one.
        if (blockEnd < end) result.next_record_ts = blockEnd + period;
        return this.#success(request, {result});
    }

    // One record of a meter channel, values in its GetData key order.
    #recordRow(namespace: string, id: number): number[] {
        const statusKey = namespace === 'emdata' ? `em:${id}` : `em1:${id}`;
        const meter = this.#requireStatus(statusKey);
        const baseline = this.#telemetryBaseline[statusKey] ?? {};
        return recordKeys(namespace).map((key) =>
            namespace === 'emdata'
                ? this.#triphaseEnergyValue(key, meter, baseline, id)
                : this.#monoEnergyValue(key, meter, baseline, id)
        );
    }

    // Active energy in one 1-minute record from the meter's stated power (Wh).
    #recordEnergyWh(power: number): number {
        return round((Math.abs(power) * EM_DATA_PERIOD_SECONDS) / 3600, 3);
    }

    #triphaseEnergyValue(
        key: string,
        meter: JsonObject,
        baseline: JsonObject,
        id: number
    ): number {
        if (key.startsWith('n_')) {
            return numberOr(meter.n_current, 0);
        }
        const phase = key[0];
        const field = key.slice(2);
        const power = numberOr(meter[`${phase}_act_power`], 0);
        const voltage = numberOr(meter[`${phase}_voltage`], NOMINAL_VOLTAGE_V);
        const current = numberOr(meter[`${phase}_current`], 0);
        return this.#emFieldValue({
            field,
            power,
            voltage,
            current,
            powerFactor: recordPowerFactor(baseline[`${phase}_pf`]),
            leading: isLeadingChannel(id + EM_PHASES.indexOf(phase as 'a'))
        });
    }

    #monoEnergyValue(
        key: string,
        meter: JsonObject,
        baseline: JsonObject,
        id: number
    ): number {
        const power = numberOr(meter.act_power, 0);
        const voltage = numberOr(meter.voltage, NOMINAL_VOLTAGE_V);
        const current = numberOr(meter.current, 0);
        return this.#emFieldValue({
            field: key,
            power,
            voltage,
            current,
            powerFactor: recordPowerFactor(baseline.pf),
            leading: isLeadingChannel(id)
        });
    }

    // Shared per-field derivation for both meter shapes. Energy splits by sign:
    // consumed power fills *_act_energy, exported power fills *_act_ret_energy —
    // exactly how the report tells consumption from feed-in. Reactive energy
    // and apparent power follow the configured power factor (S = P / pf).
    #emFieldValue(input: {
        field: string;
        power: number;
        voltage: number;
        current: number;
        powerFactor: number;
        leading: boolean;
    }): number {
        const {field, power, voltage, current, powerFactor, leading} = input;
        const energyWh = this.#recordEnergyWh(power);
        const importing = power >= 0;
        const reactiveVarh = round(
            energyWh * Math.tan(Math.acos(powerFactor)),
            3
        );
        switch (field) {
            case 'total_act_energy':
            case 'fund_act_energy':
                return importing ? energyWh : 0;
            case 'total_act_ret_energy':
            case 'fund_act_ret_energy':
                return importing ? 0 : energyWh;
            case 'lag_react_energy':
                return leading ? 0 : reactiveVarh;
            case 'lead_react_energy':
                return leading ? reactiveVarh : 0;
            case 'max_act_power':
            case 'min_act_power':
                return round(power);
            case 'max_aprt_power':
            case 'min_aprt_power':
                return round(Math.abs(power) / powerFactor);
            case 'max_voltage':
                return round(voltage + 0.3, 1);
            case 'min_voltage':
                return round(voltage - 0.3, 1);
            case 'avg_voltage':
                return round(voltage, 1);
            case 'max_current':
                return round(current + 0.1, 3);
            case 'min_current':
                return round(Math.max(0, current - 0.1), 3);
            case 'avg_current':
                return round(current, 3);
            default:
                return 0;
        }
    }

    #setConfig(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (!isObject(params.config))
            throw new Error('config must be an object');
        const key = componentKey(request.method, params);
        mergeObject(this.#requireConfig(key), params.config);
        const cfgRev = this.#incrementConfigRevision();
        const ts = this.#nowMs() / 1000;
        // Firmware announces the change, and Fleet re-reads the component on it.
        return this.#success(request, {
            result: {restart_required: false},
            notifications: [
                this.#statusNotification({sys: {cfg_rev: cfgRev}}),
                {
                    method: 'NotifyEvent',
                    src: this.shellyID,
                    params: {
                        ts,
                        events: [
                            {
                                component: key,
                                event: 'config_changed',
                                restart_required: false,
                                ts,
                                cfg_rev: cfgRev
                            }
                        ]
                    }
                }
            ]
        });
    }

    // Firmware reports the configured device name here, so a rename shows up.
    #deviceInfo(): JsonObject {
        const info = clone(this.#profile.info);
        const sys = this.#profile.config.sys;
        const device = sys && isObject(sys.device) ? sys.device : undefined;
        if (typeof device?.name === 'string') info.name = device.name;
        return info;
    }

    #setState(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        const status = this.#requireStatus(key);
        const wasOn = Boolean(status.output);
        const delta = this.#stateDelta(params);
        mergeObject(status, delta);
        return this.#success(request, {
            result: {was_on: wasOn},
            notifications: [this.#statusNotification({[key]: delta})]
        });
    }

    #triggerButton(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        // A virtual button holds no persistent state, so it lives only in
        // config; requiring it keeps Trigger on an unknown id an error.
        this.#requireConfig(key);
        return this.#success(request, {result: {}});
    }

    #toggle(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        const status = this.#requireStatus(key);
        if (typeof status.output !== 'boolean') {
            throw new Error(`${key} has no output state`);
        }
        const output = !status.output;
        status.output = output;
        return this.#success(request, {
            result: {output},
            notifications: [this.#statusNotification({[key]: {output}})]
        });
    }

    #moveCover(
        request: SimulatorRpcRequest,
        position: 0 | 100
    ): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        const status = this.#requireStatus(key);
        const delta = {
            state: position === 100 ? 'open' : 'closed',
            current_pos: position,
            apower: 0
        };
        mergeObject(status, delta);
        return this.#success(request, {
            result: {},
            notifications: [this.#statusNotification({[key]: delta})]
        });
    }

    #stopCover(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        const status = this.#requireStatus(key);
        const delta = {state: 'stopped', apower: 0};
        mergeObject(status, delta);
        return this.#success(request, {
            result: {},
            notifications: [this.#statusNotification({[key]: delta})]
        });
    }

    #goToCoverPosition(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        const status = this.#requireStatus(key);
        const delta: JsonObject = {state: 'stopped', apower: 0};
        if (typeof params.pos === 'number') {
            if (params.pos < 0 || params.pos > 100)
                throw new Error('pos must be between 0 and 100');
            delta.current_pos = params.pos;
            delta.state =
                params.pos === 100
                    ? 'open'
                    : params.pos === 0
                      ? 'closed'
                      : 'stopped';
        }
        if (typeof params.slat_pos === 'number') {
            if (params.slat_pos < 0 || params.slat_pos > 100)
                throw new Error('slat_pos must be between 0 and 100');
            delta.slat_pos = params.slat_pos;
        }
        if (!('current_pos' in delta) && !('slat_pos' in delta)) {
            throw new Error('pos or slat_pos is required');
        }
        mergeObject(status, delta);
        return this.#success(request, {
            result: {},
            notifications: [this.#statusNotification({[key]: delta})]
        });
    }

    #muteAlarm(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        const key = componentKey(request.method, params);
        const status = this.#requireStatus(key);
        const delta = {mute: true};
        mergeObject(status, delta);
        return this.#success(request, {
            result: null,
            notifications: [this.#statusNotification({[key]: delta})]
        });
    }

    #callBluTrv(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (
            typeof params.id !== 'number' ||
            typeof params.method !== 'string'
        ) {
            throw new Error('id and method are required');
        }
        const key = `blutrv:${params.id}`;
        const status = this.#requireStatus(key);
        const remoteParams = isObject(params.params) ? params.params : {};
        const config = isObject(remoteParams.config) ? remoteParams.config : {};
        const delta: JsonObject = {};
        if (typeof config.target_C === 'number')
            delta.target_C = config.target_C;
        if (typeof remoteParams.target_C === 'number') {
            delta.target_C = remoteParams.target_C;
        }
        if (params.method.endsWith('SetBoost')) delta.boost = true;
        if (params.method.endsWith('ClearBoost')) delta.boost = false;
        if (Object.keys(delta).length > 0) mergeObject(status, delta);
        return this.#success(request, {
            result: {},
            notifications:
                Object.keys(delta).length > 0
                    ? [this.#statusNotification({[key]: delta})]
                    : []
        });
    }

    #checkBluTrvUpdates(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (typeof params.id !== 'number') throw new Error('id is required');
        this.#requireStatus(`blutrv:${params.id}`);
        return this.#success(request, {result: {}});
    }

    #updateBluTrvFirmware(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (typeof params.id !== 'number') throw new Error('id is required');
        this.#requireStatus(`blutrv:${params.id}`);
        return this.#success(request, {result: null});
    }

    #deleteBluTrv(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (typeof params.id !== 'number') throw new Error('id is required');
        this.#requireStatus(`blutrv:${params.id}`);
        return this.#success(request, {result: null});
    }

    #stateDelta(params: JsonObject): JsonObject {
        const delta: JsonObject = {};
        if (typeof params.on === 'boolean') delta.output = params.on;
        if (typeof params.output === 'boolean') delta.output = params.output;
        for (const field of SET_STATE_FIELDS) {
            if (field in params) delta[field] = clone(params[field]);
        }
        if (Object.keys(delta).length === 0)
            throw new Error('state value is required');
        return delta;
    }

    #requireStatus(key: string): JsonObject {
        const status = this.#profile.status[key];
        if (!status) throw new Error(`unknown status component: ${key}`);
        return status;
    }

    #requireConfig(key: string): JsonObject {
        const config = this.#profile.config[key];
        if (!config) throw new Error(`unknown config component: ${key}`);
        return config;
    }

    #components(): SimulatorComponent[] {
        const keys = new Set([
            ...Object.keys(this.#profile.config),
            ...Object.keys(this.#profile.status)
        ]);
        return [...keys].sort().map((key) => ({
            key,
            config: clone(this.#profile.config[key] ?? {}),
            status: clone(this.#profile.status[key] ?? {})
        }));
    }

    #stampBluetoothStatus(nowMs: number): void {
        for (const [key, config] of Object.entries(this.#profile.config)) {
            if (key.startsWith('bthomedevice:') || key.startsWith('blutrv:')) {
                this.#addBluetoothStatus({}, key, config, nowMs);
                this.#bluHeartbeatAt.set(key, nowMs);
            }
        }
    }

    #addBluetoothStatus(
        params: JsonObject,
        identityKey: string,
        identityConfig: JsonObject,
        nowMs: number
    ): void {
        const address = identityConfig.addr;
        const timestamp = Math.trunc(nowMs / 1000);
        for (const [key, config] of Object.entries(this.#profile.config)) {
            if (
                key !== identityKey &&
                (!key.startsWith('bthomesensor:') ||
                    typeof address !== 'string' ||
                    config.addr !== address)
            ) {
                continue;
            }
            const status = this.#profile.status[key];
            if (!status) continue;
            status.last_updated_ts = timestamp;
            if (key === identityKey && typeof status.packet_id === 'number') {
                status.packet_id += 1;
            }
            params[key] = clone(status);
        }
    }

    #bthomeEventSensors(address: unknown, timestamp: number): JsonObject {
        if (typeof address !== 'string') return {};
        const grouped = new Map<
            string,
            Array<{index: number; reading: JsonObject}>
        >();
        for (const [key, config] of Object.entries(this.#profile.config)) {
            if (!key.startsWith('bthomesensor:') || config.addr !== address) {
                continue;
            }
            const objectId = config.obj_id;
            const sensorId = config.id;
            const status = this.#profile.status[key];
            if (
                typeof objectId !== 'number' ||
                typeof sensorId !== 'number' ||
                !status ||
                status.value === undefined
            ) {
                continue;
            }
            status.value = this.#nextBTHomeValue(
                objectId,
                status.value,
                this.#telemetryBaseline[key]?.value,
                timestamp,
                sensorId
            );
            status.last_updated_ts = timestamp;
            const objectKey = String(objectId);
            const readings = grouped.get(objectKey) ?? [];
            readings.push({
                index: typeof config.idx === 'number' ? config.idx : 0,
                reading: {
                    id: sensorId,
                    value: clone(status.value),
                    last_updated_ts: timestamp
                }
            });
            grouped.set(objectKey, readings);
        }
        return Object.fromEntries(
            [...grouped].map(([objectId, readings]) => [
                objectId,
                readings
                    .sort((left, right) => left.index - right.index)
                    .map(({reading}) => reading)
            ])
        );
    }

    #nextBTHomeValue(
        objectId: number,
        value: unknown,
        baseline: unknown,
        timestamp: number,
        sensorId: number
    ): unknown {
        const info = bthomeObjectInfos[objectId];
        // Soil does not oscillate around a baseline, it wets when a zone
        // waters and dries for the rest of the day. A sine here would never
        // cross the skip threshold in a meaningful direction, so the Water
        // page could never answer "was this watering needed".
        if (info?.type === 'sensor' && info.name === 'moisture') {
            return soilMoisturePct({
                ts: timestamp,
                zone: Math.abs(sensorId) % 6
            });
        }
        if (info?.type === 'sensor' && info.name === 'precipitation') {
            return oasisPrecipitationMm({ts: timestamp});
        }
        if (info?.type === 'sensor' && typeof baseline === 'number') {
            const amplitudes: Readonly<Record<string, number>> = {
                temperature: 1.2,
                humidity: 4,
                pressure: 3,
                illuminance: 150,
                distance: 0.15,
                rotation: 12,
                voltage: 0.05
            };
            const amplitude = amplitudes[info.name];
            if (amplitude === undefined) return value;
            const next =
                baseline + Math.sin(timestamp / 300 + objectId) * amplitude;
            return Number(next.toFixed(info.name === 'illuminance' ? 0 : 2));
        }
        if (info?.type !== 'binary_sensor') return value;
        if (typeof value === 'boolean') return !value;
        if (value === 0) return 1;
        if (value === 1) return 0;
        return value;
    }

    #bluNotificationDue(
        lastSentAt: Map<string, number>,
        identityKey: string,
        config: JsonObject,
        nowMs: number,
        maximumCadenceSec?: number
    ): boolean {
        const documentedCadenceSec = bluHeartbeatFloorSec(
            bluetoothModel(identityKey, config) ?? ''
        );
        const cadenceSec =
            maximumCadenceSec === undefined
                ? documentedCadenceSec
                : Math.min(
                      documentedCadenceSec ?? maximumCadenceSec,
                      maximumCadenceSec
                  );
        let lastAt = lastSentAt.get(identityKey);
        if (lastAt === undefined && cadenceSec !== null && !this.#bluBunched) {
            // Real children advertise on their own clocks; start each at its own place in the cadence.
            lastAt = nowMs - this.#bluCadencePhaseMs(identityKey, cadenceSec);
            lastSentAt.set(identityKey, lastAt);
        }
        if (
            lastAt !== undefined &&
            (cadenceSec === null || nowMs - lastAt < cadenceSec * 1000)
        ) {
            return false;
        }
        lastSentAt.set(identityKey, nowMs);
        return true;
    }

    #bluCadencePhaseMs(identityKey: string, cadenceSec: number): number {
        const sample = createHash('sha256')
            .update(`${this.shellyID}\0${identityKey}`)
            .digest()
            .readUInt32BE(0);
        return sample % (cadenceSec * 1000);
    }

    #configRevision(): number {
        const cfgRev = this.#profile.status.sys?.cfg_rev;
        return typeof cfgRev === 'number' ? cfgRev : 0;
    }

    #incrementConfigRevision(): number {
        const cfgRev = this.#configRevision() + 1;
        const sysStatus = this.#requireStatus('sys');
        sysStatus.cfg_rev = cfgRev;
        return cfgRev;
    }

    #statusNotification(params: JsonObject): SimulatorNotification {
        return {method: 'NotifyStatus', src: this.shellyID, params};
    }

    #success(
        request: SimulatorRpcRequest,
        outcome: {result: unknown; notifications?: SimulatorNotification[]}
    ): SimulatorRpcResult {
        return {
            response: responseFor({
                deviceID: this.shellyID,
                request,
                result: outcome.result
            }),
            notifications: outcome.notifications ?? []
        };
    }

    #error(
        request: SimulatorRpcRequest,
        error: {code: number; message: string}
    ): SimulatorRpcResult {
        return {
            response: errorFor({
                deviceID: this.shellyID,
                request,
                code: error.code,
                message: error.message
            }),
            notifications: []
        };
    }
}
