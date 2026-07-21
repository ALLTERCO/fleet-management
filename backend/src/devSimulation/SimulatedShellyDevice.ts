import {
    BLU_TRV_MODEL_ID,
    bluHeartbeatFloorSec,
    bthomeObjectInfos
} from '../config/BTHomeData';
import {buildTelemetryPatch} from './telemetry';
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
const EM_DATA_PERIOD_SECONDS = 60;
const EM_DATA_WINDOW_SECONDS = 10 * EM_DATA_PERIOD_SECONDS;
const EM_DATA_FIELDS = [
    'total_act_energy',
    'total_act_ret_energy',
    'min_voltage',
    'max_voltage',
    'total_current',
    'min_current',
    'max_current'
] as const;
const EM_PHASES = ['a', 'b', 'c'] as const;
const EM1_DATA_FIELDS = [
    'total_act_energy',
    'total_act_ret_energy',
    'min_voltage',
    'max_voltage',
    'avg_voltage',
    'total_current',
    'min_current',
    'max_current',
    'avg_current',
    'max_act_power',
    'min_act_power'
] as const;
const SET_STATE_FIELDS = [
    'brightness',
    'rgb',
    'white',
    'temp',
    'ct',
    'target_C',
    'value'
] as const;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function mergeObject(target: JsonObject, patch: JsonObject): void {
    for (const [key, value] of Object.entries(patch)) {
        if (isObject(value) && isObject(target[key])) {
            mergeObject(target[key] as JsonObject, value);
            continue;
        }
        target[key] = clone(value);
    }
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

    constructor(profile: ExpandedDeviceProfile) {
        this.#profile = clone(profile);
        this.#telemetryBaseline = clone(profile.status);
        this.#methods = new Map(
            profile.methods.map((method) => [method.toLowerCase(), method])
        );
        this.#shellyHandlers = new Map<string, RequestHandler>([
            [
                'Shelly.GetDeviceInfo',
                (request) =>
                    this.#success(request, {result: clone(this.#profile.info)})
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
            ['Shelly.GetComponents', (request) => this.#getComponents(request)]
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
            ['Webhook.DeleteAll', (request) => this.#deleteAllWebhooks(request)]
        ]);
        this.#componentHandlers = new Map<string, RequestHandler>([
            ['GetStatus', (request) => this.#getStatus(request)],
            ['GetConfig', (request) => this.#getConfig(request)],
            ['GetData', (request) => this.#getEnergyData(request)],
            ['SetConfig', (request) => this.#setConfig(request)],
            ['Set', (request) => this.#setState(request)],
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

    initialNotification(): SimulatorNotification {
        const nowMs = Date.now();
        this.#lastTelemetryAtMs = nowMs;
        this.#stampBluetoothStatus(nowMs);
        return {
            method: this.#profile.initialNotificationMethod,
            src: this.shellyID,
            params: clone(this.#profile.status)
        };
    }

    telemetryNotification(nowMs = Date.now()): SimulatorNotification | null {
        const previousAtMs = this.#lastTelemetryAtMs ?? nowMs;
        const elapsedSeconds = Math.max(0, (nowMs - previousAtMs) / 1000);
        this.#lastTelemetryAtMs = Math.max(previousAtMs, nowMs);
        const patch = buildTelemetryPatch({
            baseline: this.#telemetryBaseline,
            status: this.#profile.status,
            elapsedSeconds,
            nowMs
        });
        if (Object.keys(patch).length === 0) return null;
        mergeObject(this.#profile.status, patch);
        return this.#statusNotification({ts: nowMs / 1000, ...patch});
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
                !this.#bluNotificationDue(this.#bluEventAt, key, config, nowMs)
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

        const now =
            Math.floor(Date.now() / 1000 / EM_DATA_PERIOD_SECONDS) *
            EM_DATA_PERIOD_SECONDS;
        const requestedEnd =
            typeof params.end_ts === 'number' ? params.end_ts : now;
        const end = Math.min(now, Math.floor(requestedEnd));
        const start = Math.max(
            Math.floor(params.ts),
            end - EM_DATA_WINDOW_SECONDS
        );
        const count = Math.max(
            0,
            Math.min(10, Math.floor((end - start) / EM_DATA_PERIOD_SECONDS) + 1)
        );
        const keys =
            namespace === 'emdata'
                ? EM_DATA_FIELDS.flatMap((field) =>
                      EM_PHASES.map((phase) => `${phase}_${field}`)
                  )
                : [...EM1_DATA_FIELDS];
        const values = Array.from({length: count}, (_, index) =>
            keys.map((key) =>
                namespace === 'emdata'
                    ? this.#energyValue(key, index)
                    : this.#singlePhaseEnergyValue(
                          key,
                          index,
                          params.id as number
                      )
            )
        );

        return this.#success(request, {
            result: {
                keys,
                data: count
                    ? [{ts: start, period: EM_DATA_PERIOD_SECONDS, values}]
                    : [],
                next_record_ts: now
            }
        });
    }

    #energyValue(key: string, index: number): number {
        const phaseIndex = EM_PHASES.indexOf(
            key[0] as (typeof EM_PHASES)[number]
        );
        if (key.endsWith('total_act_energy'))
            return 12 + phaseIndex + index * 0.8;
        if (key.endsWith('total_act_ret_energy')) return 0;
        if (key.endsWith('min_voltage')) return 228.5 + phaseIndex * 0.3;
        if (key.endsWith('max_voltage')) return 231.2 + phaseIndex * 0.3;
        if (key.endsWith('total_current')) return 3.8 + phaseIndex * 0.6;
        if (key.endsWith('min_current')) return 3.5 + phaseIndex * 0.6;
        return 4.1 + phaseIndex * 0.6;
    }

    #singlePhaseEnergyValue(
        key: string,
        index: number,
        channel: number
    ): number {
        const direction = channel === 1 ? -1 : 1;
        if (key === 'total_act_energy') return 8 + index * 0.6;
        if (key === 'total_act_ret_energy')
            return channel === 1 ? 6 + index * 0.5 : 0;
        if (key === 'min_voltage') return 228.7;
        if (key === 'max_voltage') return 231.4;
        if (key === 'avg_voltage') return 230.2;
        if (key === 'total_current') return 4.2 + index * 0.1;
        if (key === 'min_current') return 3.9;
        if (key === 'max_current') return 4.7;
        if (key === 'avg_current') return 4.3;
        if (key === 'max_act_power') return direction * 1080;
        return direction * 840;
    }

    #setConfig(request: SimulatorRpcRequest): SimulatorRpcResult {
        const params = request.params ?? {};
        if (!isObject(params.config))
            throw new Error('config must be an object');
        const key = componentKey(request.method, params);
        mergeObject(this.#requireConfig(key), params.config);
        const cfgRev = this.#incrementConfigRevision();
        return this.#success(request, {
            result: {restart_required: false},
            notifications: [this.#statusNotification({sys: {cfg_rev: cfgRev}})]
        });
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
                timestamp
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
        timestamp: number
    ): unknown {
        const info = bthomeObjectInfos[objectId];
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
        nowMs: number
    ): boolean {
        const cadenceSec = bluHeartbeatFloorSec(
            this.#bluModel(identityKey, config) ?? ''
        );
        const lastAt = lastSentAt.get(identityKey);
        if (
            lastAt !== undefined &&
            (cadenceSec === null || nowMs - lastAt < cadenceSec * 1000)
        ) {
            return false;
        }
        lastSentAt.set(identityKey, nowMs);
        return true;
    }

    #bluModel(identityKey: string, config: JsonObject): string | undefined {
        if (identityKey.startsWith('blutrv:')) {
            return typeof config.model === 'string'
                ? config.model
                : BLU_TRV_MODEL_ID;
        }
        const meta = isObject(config.meta) ? config.meta : {};
        return typeof meta.modelId === 'string' ? meta.modelId : undefined;
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
