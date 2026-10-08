import WebSocket from 'ws';
import {
    bluetoothSimulationTickMs,
    SimulatedShellyDevice
} from './SimulatedShellyDevice';
import type {ExpandedDeviceProfile, SimulatorRpcRequest} from './types';

const DEFAULT_RECONNECT_BASE_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_RECONNECT_JITTER = 0.2;
const DEFAULT_STABLE_CONNECTION_MS = 30_000;
const CLOSE_TIMEOUT_MS = 1_000;
export const DEFAULT_BLU_TICK_MS = 60_000;
export const DEFAULT_TELEMETRY_TICK_MS = 30_000;
// Meters save a record per minute and push it right after the minute ends.
const RECORD_PUSH_INTERVAL_MS = 60_000;
const RECORD_PUSH_PHASE_MS = 1_000;

export interface SimulatorLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface ReconnectOptions {
    baseMs?: number;
    maxMs?: number;
    jitter?: number;
    stableMs?: number;
}

export interface SimulatorReconnectDelayOptions {
    baseMs: number;
    maxMs: number;
    attempt: number;
    jitter: number;
    random: number;
    spreadMs: number;
}

export interface ShellySimulatorClientOptions {
    wsUrl: string;
    profile: ExpandedDeviceProfile;
    reconnect?: ReconnectOptions;
    logger?: SimulatorLogger;
    onRpcRequest?: (method: string) => void;
    random?: () => number;
    bluTickMs?: number;
    telemetryTickMs?: number;
    bluPhaseMs?: number;
    telemetryPhaseMs?: number;
    reconnectSpreadMs?: number;
    energyHistorySeconds?: number;
    bluBunched?: boolean;
    /** 0..1 share of per-minute EM record pushes not sent. */
    recordPushDropShare?: number;
}

const consoleLogger: SimulatorLogger = {
    info: (message) => console.info(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message)
};

export function nextSimulatorPhaseDelay(
    nowMs: number,
    intervalMs: number,
    phaseMs?: number
): number {
    if (phaseMs === undefined) return intervalMs;
    const remainder = ((nowMs % intervalMs) + intervalMs) % intervalMs;
    const delay = (phaseMs - remainder + intervalMs) % intervalMs;
    return delay === 0 ? intervalMs : delay;
}

export function simulatorReconnectDelay(
    options: SimulatorReconnectDelayOptions
): number {
    const exponential = Math.min(
        options.maxMs,
        options.baseMs * 2 ** options.attempt
    );
    const jitter = exponential * options.jitter * options.random;
    return Math.round(exponential + jitter) + options.spreadMs;
}

function isRpcRequest(value: unknown): value is SimulatorRpcRequest {
    if (!value || typeof value !== 'object') return false;
    const frame = value as Record<string, unknown>;
    return (
        (typeof frame.id === 'number' || typeof frame.id === 'string') &&
        typeof frame.method === 'string' &&
        (frame.params === undefined ||
            frame.params === null ||
            (typeof frame.params === 'object' && !Array.isArray(frame.params)))
    );
}

export class ShellySimulatorClient {
    readonly #device: SimulatedShellyDevice;
    readonly #wsUrl: string;
    readonly #logger: SimulatorLogger;
    readonly #onRpcRequest?: (method: string) => void;
    readonly #random: () => number;
    readonly #reconnectBaseMs: number;
    readonly #reconnectMaxMs: number;
    readonly #reconnectJitter: number;
    readonly #stableConnectionMs: number;
    readonly #bluTickMs: number;
    readonly #telemetryTickMs: number;
    readonly #bluPhaseMs: number | undefined;
    readonly #telemetryPhaseMs: number | undefined;
    readonly #reconnectSpreadMs: number;
    #socket: WebSocket | null = null;
    #reconnectTimer: NodeJS.Timeout | null = null;
    #stableTimer: NodeJS.Timeout | null = null;
    #bluTimer: NodeJS.Timeout | null = null;
    #telemetryTimer: NodeJS.Timeout | null = null;
    #recordPushTimer: NodeJS.Timeout | null = null;
    #reconnectAttempt = 0;
    #offlineUntilMs = 0;
    #stopped = true;

    constructor(options: ShellySimulatorClientOptions) {
        this.#device = new SimulatedShellyDevice(options.profile, {
            energyHistorySeconds: options.energyHistorySeconds,
            bluBunched: options.bluBunched,
            recordPushDropShare: options.recordPushDropShare
        });
        this.#wsUrl = options.wsUrl;
        this.#logger = options.logger ?? consoleLogger;
        this.#onRpcRequest = options.onRpcRequest;
        this.#random = options.random ?? Math.random;
        this.#reconnectBaseMs =
            options.reconnect?.baseMs ?? DEFAULT_RECONNECT_BASE_MS;
        this.#reconnectMaxMs =
            options.reconnect?.maxMs ?? DEFAULT_RECONNECT_MAX_MS;
        this.#reconnectJitter =
            options.reconnect?.jitter ?? DEFAULT_RECONNECT_JITTER;
        this.#stableConnectionMs =
            options.reconnect?.stableMs ?? DEFAULT_STABLE_CONNECTION_MS;
        this.#bluTickMs =
            options.bluTickMs ??
            bluetoothSimulationTickMs(options.profile) ??
            DEFAULT_BLU_TICK_MS;
        this.#telemetryTickMs =
            options.telemetryTickMs ?? DEFAULT_TELEMETRY_TICK_MS;
        this.#bluPhaseMs = options.bluPhaseMs;
        this.#telemetryPhaseMs = options.telemetryPhaseMs;
        this.#reconnectSpreadMs = options.reconnectSpreadMs ?? 0;
        this.#validateOptions();
    }

    get shellyID(): string {
        return this.#device.shellyID;
    }

    start(): void {
        if (!this.#stopped) return;
        this.#stopped = false;
        this.#connect();
    }

    async close(): Promise<void> {
        this.#stopped = true;
        if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
        if (this.#stableTimer) clearTimeout(this.#stableTimer);
        if (this.#bluTimer) clearTimeout(this.#bluTimer);
        if (this.#telemetryTimer) clearTimeout(this.#telemetryTimer);
        if (this.#recordPushTimer) clearTimeout(this.#recordPushTimer);
        this.#reconnectTimer = null;
        this.#stableTimer = null;
        this.#bluTimer = null;
        this.#telemetryTimer = null;
        this.#recordPushTimer = null;
        const socket = this.#socket;
        this.#socket = null;
        if (!socket || socket.readyState === WebSocket.CLOSED) return;

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(
                () => socket.terminate(),
                CLOSE_TIMEOUT_MS
            );
            socket.once('close', () => {
                clearTimeout(timeout);
                resolve();
            });
            socket.close();
        });
    }

    #validateOptions(): void {
        const url = new URL(this.#wsUrl);
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
            throw new Error('simulator URL must use ws: or wss:');
        }
        if (this.#reconnectBaseMs < 0 || this.#reconnectMaxMs < 0) {
            throw new Error('reconnect delays must be non-negative');
        }
        if (this.#reconnectBaseMs > this.#reconnectMaxMs) {
            throw new Error('reconnect base must not exceed max');
        }
        if (this.#reconnectJitter < 0 || this.#reconnectJitter > 1) {
            throw new Error('reconnect jitter must be between 0 and 1');
        }
        if (this.#stableConnectionMs < 0) {
            throw new Error('stable connection time must be non-negative');
        }
        if (!Number.isFinite(this.#bluTickMs) || this.#bluTickMs <= 0) {
            throw new Error('BLU tick time must be positive');
        }
        if (
            !Number.isFinite(this.#telemetryTickMs) ||
            this.#telemetryTickMs <= 0
        ) {
            throw new Error('telemetry tick time must be positive');
        }
        this.#validatePhase(this.#bluPhaseMs, this.#bluTickMs, 'BLU');
        this.#validatePhase(
            this.#telemetryPhaseMs,
            this.#telemetryTickMs,
            'telemetry'
        );
        if (
            !Number.isSafeInteger(this.#reconnectSpreadMs) ||
            this.#reconnectSpreadMs < 0
        ) {
            throw new Error('reconnect spread must be a non-negative integer');
        }
    }

    #validatePhase(
        phaseMs: number | undefined,
        intervalMs: number,
        label: string
    ): void {
        if (
            phaseMs !== undefined &&
            (!Number.isSafeInteger(phaseMs) ||
                phaseMs < 0 ||
                phaseMs >= intervalMs)
        ) {
            throw new Error(
                `${label} phase must be an integer within its interval`
            );
        }
    }

    #connect(): void {
        if (this.#stopped) return;
        const socket = new WebSocket(this.#wsUrl);
        this.#socket = socket;
        socket.on('open', () => this.#onOpen(socket));
        socket.on('message', (raw) => this.#onMessage(socket, raw));
        socket.on('error', (error) => {
            this.#logger.warn(
                `${this.shellyID} socket error: ${error.message}`
            );
        });
        socket.on('close', () => this.#onClose(socket));
    }

    #onOpen(socket: WebSocket): void {
        if (socket !== this.#socket || this.#stopped) return;
        this.#stableTimer = setTimeout(() => {
            this.#stableTimer = null;
            this.#reconnectAttempt = 0;
        }, this.#stableConnectionMs);
        this.#send(socket, this.#device.initialNotification());
        this.#telemetryTimer = this.#scheduleRecurring(
            socket,
            this.#telemetryPhaseMs,
            this.#telemetryTickMs,
            () => {
                const status = this.#device.telemetryNotification();
                if (status) this.#send(socket, status);
            },
            (timer) => {
                this.#telemetryTimer = timer;
            }
        );
        if (this.#device.hasRecordComponents) {
            this.#recordPushTimer = this.#scheduleRecurring(
                socket,
                RECORD_PUSH_PHASE_MS,
                RECORD_PUSH_INTERVAL_MS,
                () => {
                    const push = this.#device.recordPushNotification();
                    if (push) this.#send(socket, push);
                },
                (timer) => {
                    this.#recordPushTimer = timer;
                }
            );
        }
        if (this.#device.hasBluetoothComponents) {
            this.#bluTimer = this.#scheduleRecurring(
                socket,
                this.#bluPhaseMs,
                this.#bluTickMs,
                () => {
                    const event = this.#device.bluetoothEventNotification();
                    if (event) this.#send(socket, event);
                    const status =
                        this.#device.bluetoothHeartbeatNotification();
                    if (status) this.#send(socket, status);
                },
                (timer) => {
                    this.#bluTimer = timer;
                }
            );
        }
        this.#logger.info(`${this.shellyID} connected`);
    }

    #scheduleRecurring(
        socket: WebSocket,
        phaseMs: number | undefined,
        intervalMs: number,
        send: () => void,
        setTimer: (timer: NodeJS.Timeout) => void
    ): NodeJS.Timeout {
        const timer = setTimeout(
            () => {
                if (socket !== this.#socket || this.#stopped) return;
                send();
                setTimer(
                    this.#scheduleRecurring(
                        socket,
                        phaseMs,
                        intervalMs,
                        send,
                        setTimer
                    )
                );
            },
            nextSimulatorPhaseDelay(Date.now(), intervalMs, phaseMs)
        );
        timer.unref();
        return timer;
    }

    #onMessage(socket: WebSocket, raw: WebSocket.RawData): void {
        if (socket !== this.#socket || this.#stopped) return;
        const request = this.#parseRequest(raw);
        if (!request) return;
        this.#onRpcRequest?.(request.method);
        const result = this.#device.handleRequest(request);
        this.#send(socket, result.response);
        for (const notification of result.notifications) {
            this.#send(socket, notification);
        }
        const holdSeconds = this.#device.takeDisconnectRequest();
        if (holdSeconds !== null) this.#holdOffline(socket, holdSeconds);
    }

    // Sim.Disconnect: drop the link and stay away for the asked time, so a
    // live run can watch "device offline" fire and then resolve.
    #holdOffline(socket: WebSocket, seconds: number): void {
        this.#offlineUntilMs = Date.now() + seconds * 1000;
        this.#logger.warn(`${this.shellyID} going offline for ${seconds}s`);
        socket.close();
    }

    #parseRequest(raw: WebSocket.RawData): SimulatorRpcRequest | null {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw.toString());
        } catch (error) {
            this.#logger.error(
                `${this.shellyID} received invalid JSON: ${String(error)}`
            );
            return null;
        }
        if (!isRpcRequest(parsed)) {
            this.#logger.error(
                `${this.shellyID} received an invalid RPC frame`
            );
            return null;
        }
        return parsed;
    }

    #send(socket: WebSocket, frame: unknown): void {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(frame));
    }

    #onClose(socket: WebSocket): void {
        if (socket !== this.#socket) return;
        this.#socket = null;
        if (this.#stableTimer) clearTimeout(this.#stableTimer);
        if (this.#bluTimer) clearTimeout(this.#bluTimer);
        if (this.#telemetryTimer) clearTimeout(this.#telemetryTimer);
        if (this.#recordPushTimer) clearTimeout(this.#recordPushTimer);
        this.#stableTimer = null;
        this.#bluTimer = null;
        this.#telemetryTimer = null;
        this.#recordPushTimer = null;
        if (this.#stopped) return;
        const delay = Math.max(
            this.#nextReconnectDelay(),
            this.#offlineUntilMs - Date.now()
        );
        this.#logger.warn(`${this.shellyID} reconnecting in ${delay}ms`);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            this.#connect();
        }, delay);
    }

    #nextReconnectDelay(): number {
        const delay = simulatorReconnectDelay({
            baseMs: this.#reconnectBaseMs,
            maxMs: this.#reconnectMaxMs,
            attempt: this.#reconnectAttempt,
            jitter: this.#reconnectJitter,
            random: this.#random(),
            spreadMs: this.#reconnectSpreadMs
        });
        this.#reconnectAttempt++;
        return delay;
    }
}
