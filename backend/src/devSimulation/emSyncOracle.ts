import {createHash, type Hash} from 'node:crypto';
import type {SimulatedShellyDevice} from './SimulatedShellyDevice';

export interface SimulatedEmDataBlock {
    keys: string[];
    data: {ts: number; period: number; values: number[][]}[];
    nextTs: number | undefined;
}

export interface EmHistoryOracle {
    blocks: number;
    records: number;
    firstTs: number | null;
    lastTs: number | null;
    importedWh: number;
    returnedWh: number;
    storedImportedWh: number;
    storedReturnedWh: number;
    sha256: string;
}

export class EmHistoryOracleBuilder {
    readonly #hash: Hash = createHash('sha256');
    #blocks = 0;
    #records = 0;
    #firstTs: number | null = null;
    #lastTs: number | null = null;
    #importedWh = 0;
    #returnedWh = 0;
    #storedImportedWh = 0;
    #storedReturnedWh = 0;

    add(block: SimulatedEmDataBlock): void {
        this.#hash.update(`${JSON.stringify(block)}\n`);
        this.#blocks++;
        const imported = energyIndexes(block.keys, 'total_act_energy');
        const returned = energyIndexes(block.keys, 'total_act_ret_energy');
        for (const data of block.data) {
            for (let row = 0; row < data.values.length; row++) {
                const ts = data.ts + row * data.period;
                this.#firstTs ??= ts;
                this.#lastTs = ts;
                this.#records++;
                for (const index of imported) {
                    const value = data.values[row][index] ?? 0;
                    this.#importedWh += value;
                    this.#storedImportedWh += Math.fround(value);
                }
                for (const index of returned) {
                    const value = data.values[row][index] ?? 0;
                    this.#returnedWh += value;
                    this.#storedReturnedWh += Math.fround(value);
                }
            }
        }
    }

    finish(): EmHistoryOracle {
        return {
            blocks: this.#blocks,
            records: this.#records,
            firstTs: this.#firstTs,
            lastTs: this.#lastTs,
            importedWh: Number(this.#importedWh.toFixed(6)),
            returnedWh: Number(this.#returnedWh.toFixed(6)),
            storedImportedWh: Number(this.#storedImportedWh.toFixed(9)),
            storedReturnedWh: Number(this.#storedReturnedWh.toFixed(9)),
            sha256: this.#hash.digest('hex')
        };
    }
}

function energyIndexes(keys: readonly string[], field: string): number[] {
    return keys.flatMap((key, index) =>
        key === field || key.endsWith(`_${field}`) ? [index] : []
    );
}

export function readSimulatedEmHistory(input: {
    simulator: SimulatedShellyDevice;
    method?: 'EMData.GetData' | 'EM1Data.GetData';
    channel?: number;
    fromTs: number;
    endTs?: number;
}): {blocks: SimulatedEmDataBlock[]; oracle: EmHistoryOracle} {
    const blocks: SimulatedEmDataBlock[] = [];
    const oracle = new EmHistoryOracleBuilder();
    let cursor = input.fromTs;
    for (;;) {
        const response = input.simulator.handleRequest({
            id: blocks.length + 1,
            method: input.method ?? 'EM1Data.GetData',
            params: {
                id: input.channel ?? 0,
                ts: cursor,
                ...(input.endTs === undefined ? {} : {end_ts: input.endTs})
            }
        }).response.result as {
            keys: string[];
            data: {ts: number; period: number; values: number[][]}[];
            next_record_ts?: number;
        };
        const block = {
            keys: response.keys,
            data: response.data,
            nextTs: response.next_record_ts
        };
        blocks.push(block);
        oracle.add(block);
        if (response.next_record_ts === undefined) break;
        cursor = response.next_record_ts;
    }
    return {blocks, oracle: oracle.finish()};
}

export interface MixedFleetEnergyOracle {
    devices: number;
    newDevices: number;
    syncedDevices: number;
    records: number;
    importedWh: number;
    returnedWh: number;
    storedImportedWh: number;
    storedReturnedWh: number;
    blocks: number;
}

export function combineEmHistoryOracles(
    parts: readonly EmHistoryOracle[]
): EmHistoryOracle {
    const hashes = createHash('sha256');
    for (const part of parts) hashes.update(`${part.sha256}\n`);
    return {
        blocks: parts.reduce((sum, part) => sum + part.blocks, 0),
        records: parts.reduce((sum, part) => sum + part.records, 0),
        firstTs: parts.find((part) => part.firstTs !== null)?.firstTs ?? null,
        lastTs:
            [...parts].reverse().find((part) => part.lastTs !== null)?.lastTs ??
            null,
        importedWh: Number(
            parts.reduce((sum, part) => sum + part.importedWh, 0).toFixed(6)
        ),
        returnedWh: Number(
            parts.reduce((sum, part) => sum + part.returnedWh, 0).toFixed(6)
        ),
        storedImportedWh: Number(
            parts
                .reduce((sum, part) => sum + part.storedImportedWh, 0)
                .toFixed(9)
        ),
        storedReturnedWh: Number(
            parts
                .reduce((sum, part) => sum + part.storedReturnedWh, 0)
                .toFixed(9)
        ),
        sha256: hashes.digest('hex')
    };
}

export function mixedFleetEnergyOracle(input: {
    devices: number;
    newDevices: number;
    newDevice: EmHistoryOracle;
    syncedDevice: EmHistoryOracle;
}): MixedFleetEnergyOracle {
    const newDevices = input.newDevices;
    if (
        !Number.isSafeInteger(newDevices) ||
        newDevices < 0 ||
        newDevices > input.devices
    ) {
        throw new RangeError('newDevices must be within the fleet');
    }
    const syncedDevices = input.devices - newDevices;
    return {
        devices: input.devices,
        newDevices,
        syncedDevices,
        records:
            newDevices * input.newDevice.records +
            syncedDevices * input.syncedDevice.records,
        importedWh: Number(
            (
                newDevices * input.newDevice.importedWh +
                syncedDevices * input.syncedDevice.importedWh
            ).toFixed(6)
        ),
        returnedWh: Number(
            (
                newDevices * input.newDevice.returnedWh +
                syncedDevices * input.syncedDevice.returnedWh
            ).toFixed(6)
        ),
        storedImportedWh: Number(
            (
                newDevices * input.newDevice.storedImportedWh +
                syncedDevices * input.syncedDevice.storedImportedWh
            ).toFixed(9)
        ),
        storedReturnedWh: Number(
            (
                newDevices * input.newDevice.storedReturnedWh +
                syncedDevices * input.syncedDevice.storedReturnedWh
            ).toFixed(9)
        ),
        blocks:
            newDevices * input.newDevice.blocks +
            syncedDevices * input.syncedDevice.blocks
    };
}
