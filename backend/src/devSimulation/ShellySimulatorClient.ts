import WebSocket from 'ws';
import {SimulatedShellyDevice} from './SimulatedShellyDevice';
import type {ExpandedDeviceProfile, SimulatorRpcRequest} from './types';

const DEFAULT_RECONNECT_BASE_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_RECONNECT_JITTER = 0.2;
const DEFAULT_STABLE_CONNECTION_MS = 30_000;
const CLOSE_TIMEOUT_MS = 1_000;
const DEFAULT_BLU_TICK_MS = 5_000;
const DEFAULT_TELEMETRY_TICK_MS = 15_000;

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

export interface ShellySimulatorClientOptions {
    wsUrl: string;
    profile: ExpandedDeviceProfile;
    reconnect?: ReconnectOptions;
    logger?: SimulatorLogger;
    random?: () => number;
    bluTickMs?: number;
    telemetryTickMs?: number;
}

const consoleLogger: SimulatorLogger = {
    info: (message) => console.info(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message)
};

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
    readonly #random: () => number;
    readonly #reconnectBaseMs: number;
    readonly #reconnectMaxMs: number;
    readonly #reconnectJitter: number;
    readonly #stableConnectionMs: number;
    readonly #bluTickMs: number;
    readonly #telemetryTickMs: number;
    #socket: WebSocket | null = null;
    #reconnectTimer: NodeJS.Timeout | null = null;
    #stableTimer: NodeJS.Timeout | null = null;
    #bluTimer: NodeJS.Timeout | null = null;
    #telemetryTimer: NodeJS.Timeout | null = null;
    #reconnectAttempt = 0;
    #stopped = true;

    constructor(options: ShellySimulatorClientOptions) {
        this.#device = new SimulatedShellyDevice(options.profile);
        this.#wsUrl = options.wsUrl;
        this.#logger = options.logger ?? consoleLogger;
        this.#random = options.random ?? Math.random;
        this.#reconnectBaseMs =
            options.reconnect?.baseMs ?? DEFAULT_RECONNECT_BASE_MS;
        this.#reconnectMaxMs =
            options.reconnect?.maxMs ?? DEFAULT_RECONNECT_MAX_MS;
        this.#reconnectJitter =
            options.reconnect?.jitter ?? DEFAULT_RECONNECT_JITTER;
        this.#stableConnectionMs =
            options.reconnect?.stableMs ?? DEFAULT_STABLE_CONNECTION_MS;
        this.#bluTickMs = options.bluTickMs ?? DEFAULT_BLU_TICK_MS;
        this.#telemetryTickMs =
            options.telemetryTickMs ?? DEFAULT_TELEMETRY_TICK_MS;
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
        if (this.#bluTimer) clearInterval(this.#bluTimer);
        if (this.#telemetryTimer) clearInterval(this.#telemetryTimer);
        this.#reconnectTimer = null;
        this.#stableTimer = null;
        this.#bluTimer = null;
        this.#telemetryTimer = null;
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
        this.#telemetryTimer = setInterval(() => {
            const status = this.#device.telemetryNotification();
            if (status) this.#send(socket, status);
        }, this.#telemetryTickMs);
        this.#telemetryTimer.unref();
        if (this.#device.hasBluetoothComponents) {
            this.#bluTimer = setInterval(() => {
                const event = this.#device.bluetoothEventNotification();
                if (event) this.#send(socket, event);
                const status = this.#device.bluetoothHeartbeatNotification();
                if (status) this.#send(socket, status);
            }, this.#bluTickMs);
            this.#bluTimer.unref();
        }
        this.#logger.info(`${this.shellyID} connected`);
    }

    #onMessage(socket: WebSocket, raw: WebSocket.RawData): void {
        if (socket !== this.#socket || this.#stopped) return;
        const request = this.#parseRequest(raw);
        if (!request) return;
        const result = this.#device.handleRequest(request);
        this.#send(socket, result.response);
        for (const notification of result.notifications) {
            this.#send(socket, notification);
        }
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
        if (this.#bluTimer) clearInterval(this.#bluTimer);
        if (this.#telemetryTimer) clearInterval(this.#telemetryTimer);
        this.#stableTimer = null;
        this.#bluTimer = null;
        this.#telemetryTimer = null;
        if (this.#stopped) return;
        const delay = this.#nextReconnectDelay();
        this.#logger.warn(`${this.shellyID} reconnecting in ${delay}ms`);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            this.#connect();
        }, delay);
    }

    #nextReconnectDelay(): number {
        const exponential = Math.min(
            this.#reconnectMaxMs,
            this.#reconnectBaseMs * 2 ** this.#reconnectAttempt
        );
        this.#reconnectAttempt++;
        const jitter = exponential * this.#reconnectJitter * this.#random();
        return Math.min(this.#reconnectMaxMs, Math.round(exponential + jitter));
    }
}
