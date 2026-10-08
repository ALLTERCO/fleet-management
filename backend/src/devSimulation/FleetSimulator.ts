import {createHash} from 'node:crypto';
import {
    DEFAULT_BLU_TICK_MS,
    DEFAULT_TELEMETRY_TICK_MS,
    type ReconnectOptions,
    ShellySimulatorClient,
    type SimulatorLogger
} from './ShellySimulatorClient';
import {bluetoothSimulationTickMs} from './SimulatedShellyDevice';
import type {ExpandedDeviceProfile} from './types';

export interface FleetSimulatorOptions {
    wsUrl: string;
    profiles: readonly ExpandedDeviceProfile[];
    instanceSeed?: string;
    logger?: SimulatorLogger;
    /** How far back each meter claims to hold 1-minute records. Real hardware
     *  keeps 60 days and Fleet Manager back-fills all of it on first sync; a
     *  scenario that seeds its own shaped history shortens this so the two do
     *  not describe the same days differently. */
    energyHistorySeconds?: number;
    bluTickMs?: number;
    telemetryTickMs?: number;
    startupWindowMs?: number;
    reconnect?: ReconnectOptions;
    bluBunched?: boolean;
    /** 0..1 share of per-minute EM record pushes each meter leaves unsent. */
    recordPushDropShare?: number;
}

export type SimulatorStream = 'blu' | 'telemetry';

export const DEFAULT_SIMULATOR_STARTUP_WINDOW_MS = 10_000;
const SIMULATOR_STARTUP_SPACING_MS = 250;

export function simulatorStartupWindowMs(deviceCount: number): number {
    if (!Number.isSafeInteger(deviceCount) || deviceCount < 1) {
        throw new Error('simulator device count must be a positive integer');
    }
    return Math.max(
        DEFAULT_SIMULATOR_STARTUP_WINDOW_MS,
        deviceCount * SIMULATOR_STARTUP_SPACING_MS
    );
}

// Stable identities prevent correlated bursts while keeping schedules reproducible.
function stableOffset(key: string, range: number): number {
    if (!Number.isSafeInteger(range) || range < 1) {
        throw new Error('simulator schedule range must be a positive integer');
    }
    const sample = createHash('sha256').update(key).digest().readBigUInt64BE();
    return Number(sample % BigInt(range));
}

export function simulatorPhaseDelay(
    instanceSeed: string,
    deviceID: string,
    stream: SimulatorStream,
    intervalMs: number
): number {
    return stableOffset(`${instanceSeed}\0${deviceID}\0${stream}`, intervalMs);
}

export function simulatorStartupDelay(
    instanceSeed: string,
    deviceID: string,
    startupWindowMs: number
): number {
    if (startupWindowMs === 0) return 0;
    return stableOffset(
        `${instanceSeed}\0${deviceID}\0connection`,
        startupWindowMs
    );
}

export function simulatorStartupDelays(
    instanceSeed: string,
    deviceIDs: readonly string[],
    startupWindowMs: number
): number[] {
    if (!Number.isSafeInteger(startupWindowMs) || startupWindowMs < 0) {
        throw new Error(
            'simulator startup window must be a non-negative integer'
        );
    }
    if (startupWindowMs === 0) return deviceIDs.map(() => 0);
    const ranked = deviceIDs
        .map((deviceID, index) => ({
            deviceID,
            index,
            rankKey: createHash('sha256')
                .update(`${instanceSeed}\0${deviceID}\0connection-rank`)
                .digest('hex')
        }))
        .sort(
            (left, right) =>
                left.rankKey.localeCompare(right.rankKey) ||
                left.deviceID.localeCompare(right.deviceID)
        );
    const delays = new Array<number>(deviceIDs.length);
    for (const [rank, item] of ranked.entries()) {
        delays[item.index] = Math.floor(
            (rank * startupWindowMs) / deviceIDs.length
        );
    }
    return delays;
}

export function simulatorInstanceSeed(
    wsUrl: string,
    configuredClientID?: string
): string {
    const clientID = configuredClientID?.trim();
    if (clientID) return clientID;
    return new URL(wsUrl).host.toLowerCase();
}

export class FleetSimulator {
    readonly #clients: ShellySimulatorClient[];
    readonly #startupDelays: number[];
    readonly #startupTimers = new Set<NodeJS.Timeout>();
    #started = false;

    constructor(options: FleetSimulatorOptions) {
        const telemetryTickMs =
            options.telemetryTickMs ?? DEFAULT_TELEMETRY_TICK_MS;
        const startupWindowMs =
            options.startupWindowMs ??
            simulatorStartupWindowMs(options.profiles.length);
        if (!Number.isSafeInteger(startupWindowMs) || startupWindowMs < 0) {
            throw new Error(
                'simulator startup window must be a non-negative integer'
            );
        }
        const instanceSeed = simulatorInstanceSeed(
            options.wsUrl,
            options.instanceSeed
        );
        this.#startupDelays = simulatorStartupDelays(
            instanceSeed,
            options.profiles.map((profile) => profile.shellyID),
            startupWindowMs
        );
        this.#clients = options.profiles.map((profile, index) => {
            const bluTickMs =
                options.bluTickMs ??
                bluetoothSimulationTickMs(profile) ??
                DEFAULT_BLU_TICK_MS;
            return new ShellySimulatorClient({
                wsUrl: options.wsUrl,
                profile,
                logger: options.logger,
                energyHistorySeconds: options.energyHistorySeconds,
                recordPushDropShare: options.recordPushDropShare,
                bluTickMs,
                telemetryTickMs,
                bluPhaseMs: simulatorPhaseDelay(
                    instanceSeed,
                    profile.shellyID,
                    'blu',
                    bluTickMs
                ),
                telemetryPhaseMs: simulatorPhaseDelay(
                    instanceSeed,
                    profile.shellyID,
                    'telemetry',
                    telemetryTickMs
                ),
                reconnectSpreadMs: this.#startupDelays[index],
                reconnect: options.reconnect,
                bluBunched: options.bluBunched
            });
        });
    }

    get deviceIDs(): string[] {
        return this.#clients.map((client) => client.shellyID);
    }

    start(): void {
        if (this.#started) return;
        this.#started = true;
        for (const [index, client] of this.#clients.entries()) {
            const timer = setTimeout(() => {
                this.#startupTimers.delete(timer);
                if (this.#started) client.start();
            }, this.#startupDelays[index]);
            this.#startupTimers.add(timer);
        }
    }

    async close(): Promise<void> {
        this.#started = false;
        for (const timer of this.#startupTimers) clearTimeout(timer);
        this.#startupTimers.clear();
        await Promise.all(this.#clients.map((client) => client.close()));
    }
}
