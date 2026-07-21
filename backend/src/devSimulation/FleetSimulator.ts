import {
    ShellySimulatorClient,
    type SimulatorLogger
} from './ShellySimulatorClient';
import type {ExpandedDeviceProfile} from './types';

export interface FleetSimulatorOptions {
    wsUrl: string;
    profiles: readonly ExpandedDeviceProfile[];
    logger?: SimulatorLogger;
}

export class FleetSimulator {
    readonly #clients: ShellySimulatorClient[];

    constructor(options: FleetSimulatorOptions) {
        this.#clients = options.profiles.map(
            (profile) =>
                new ShellySimulatorClient({
                    wsUrl: options.wsUrl,
                    profile,
                    logger: options.logger
                })
        );
    }

    get deviceIDs(): string[] {
        return this.#clients.map((client) => client.shellyID);
    }

    start(): void {
        for (const client of this.#clients) client.start();
    }

    async close(): Promise<void> {
        await Promise.all(this.#clients.map((client) => client.close()));
    }
}
