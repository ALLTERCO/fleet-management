import type {JsonObject} from './types';

const LOAD_PERIOD_MS = 10 * 60 * 1000;
const CLIMATE_PERIOD_MS = 30 * 60 * 1000;

export interface TelemetryTick {
    baseline: Readonly<Record<string, JsonObject>>;
    status: Readonly<Record<string, JsonObject>>;
    elapsedSeconds: number;
    nowMs: number;
}

function objectValue(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonObject)
        : undefined;
}

function finite(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function rounded(value: number, digits = 2): number {
    return Number(value.toFixed(digits));
}

function wave(nowMs: number, periodMs: number, offset = 0): number {
    return Math.sin((nowMs / periodMs) * Math.PI * 2 + offset);
}

function varied(
    base: unknown,
    amount: number,
    phase: number
): number | undefined {
    const value = finite(base);
    return value === undefined ? undefined : rounded(value + amount * phase);
}

function setNumber(
    target: JsonObject,
    key: string,
    value: number | undefined
): void {
    if (value !== undefined) target[key] = value;
}

function incrementEnergy(
    current: unknown,
    power: number | undefined,
    elapsedSeconds: number,
    direction: 'import' | 'export' = 'import'
): number | undefined {
    const total = finite(current);
    if (total === undefined || power === undefined) return undefined;
    const directedPower =
        direction === 'import' ? Math.max(0, power) : Math.max(0, -power);
    return rounded(total + (directedPower * elapsedSeconds) / 3600, 3);
}

function powerPatch(input: {
    baseline: JsonObject;
    current: JsonObject;
    elapsedSeconds: number;
    loadWave: number;
}): JsonObject {
    const patch: JsonObject = {};
    const output = input.current.output !== false;
    const basePower = finite(input.baseline.apower);
    const power =
        basePower === undefined
            ? undefined
            : output
              ? rounded(Math.max(0, basePower * (1 + input.loadWave * 0.12)))
              : 0;
    const voltage = varied(input.baseline.voltage, 1.4, input.loadWave);
    setNumber(patch, 'apower', power);
    setNumber(patch, 'voltage', voltage);
    if (finite(input.baseline.current) !== undefined && power !== undefined) {
        setNumber(patch, 'current', rounded(power / (voltage ?? 230), 3));
    }

    const currentEnergy = objectValue(input.current.aenergy);
    if (currentEnergy) {
        const total = incrementEnergy(
            currentEnergy.total,
            power,
            input.elapsedSeconds
        );
        if (total !== undefined) {
            const minuteEnergy = rounded((Math.max(0, power ?? 0) * 1000) / 60);
            const byMinute = Array.isArray(currentEnergy.by_minute)
                ? [...currentEnergy.by_minute.slice(-2), minuteEnergy]
                : [minuteEnergy];
            patch.aenergy = {...currentEnergy, total, by_minute: byMinute};
        }
    }
    return patch;
}

function em1Patch(
    baseline: JsonObject,
    loadWave: number,
    exportsEnergy: boolean
): JsonObject {
    const patch: JsonObject = {};
    const power = finite(baseline.act_power);
    const variedPower =
        power === undefined
            ? undefined
            : rounded(
                  (exportsEnergy ? -1 : 1) *
                      Math.max(0, power * (1 + loadWave * 0.15))
              );
    const voltage = varied(baseline.voltage, 1.5, loadWave);
    setNumber(patch, 'act_power', variedPower);
    setNumber(
        patch,
        'aprt_power',
        varied(finite(baseline.aprt_power) ?? variedPower, 30, loadWave)
    );
    setNumber(patch, 'voltage', voltage);
    if (finite(baseline.current) !== undefined && variedPower !== undefined) {
        setNumber(patch, 'current', rounded(variedPower / (voltage ?? 230), 3));
    }
    return patch;
}

function threePhasePatch(baseline: JsonObject, nowMs: number): JsonObject {
    const patch: JsonObject = {};
    let totalPower = 0;
    let totalCurrent = 0;
    let foundPhase = false;
    for (const [index, phase] of ['a', 'b', 'c'].entries()) {
        const phaseWave = wave(nowMs, LOAD_PERIOD_MS, index * (Math.PI / 4));
        const basePower = finite(baseline[`${phase}_act_power`]);
        const power =
            basePower === undefined
                ? undefined
                : rounded(Math.max(0, basePower * (1 + phaseWave * 0.12)));
        const voltage = varied(baseline[`${phase}_voltage`], 1.2, phaseWave);
        if (power === undefined) continue;
        const current = rounded(power / (voltage ?? 230), 3);
        patch[`${phase}_act_power`] = power;
        if (voltage !== undefined) patch[`${phase}_voltage`] = voltage;
        patch[`${phase}_current`] = current;
        totalPower += power;
        totalCurrent += current;
        foundPhase = true;
    }
    if (foundPhase) {
        patch.total_act_power = rounded(totalPower);
        patch.total_current = rounded(totalCurrent, 3);
    }
    return patch;
}

function emDataPatch(input: {
    current: JsonObject;
    powerStatus: JsonObject | undefined;
    elapsedSeconds: number;
}): JsonObject {
    const patch: JsonObject = {};
    const singlePower = finite(input.powerStatus?.act_power);
    setNumber(
        patch,
        'total_act_energy',
        incrementEnergy(
            input.current.total_act_energy,
            singlePower,
            input.elapsedSeconds
        )
    );
    setNumber(
        patch,
        'total_act_ret_energy',
        incrementEnergy(
            input.current.total_act_ret_energy,
            singlePower,
            input.elapsedSeconds,
            'export'
        )
    );
    let phaseTotal = 0;
    let hasPhaseTotal = false;
    for (const phase of ['a', 'b', 'c']) {
        const total = incrementEnergy(
            input.current[`${phase}_total_act_energy`],
            finite(input.powerStatus?.[`${phase}_act_power`]),
            input.elapsedSeconds
        );
        setNumber(patch, `${phase}_total_act_energy`, total);
        if (total !== undefined) {
            phaseTotal += total;
            hasPhaseTotal = true;
        }
    }
    if (hasPhaseTotal) patch.total_act = rounded(phaseTotal, 3);
    return patch;
}

function climatePatch(
    namespace: string,
    baseline: JsonObject,
    climateWave: number
): JsonObject {
    const patch: JsonObject = {};
    if (namespace === 'temperature') {
        const tC = varied(baseline.tC, 1.8, climateWave);
        setNumber(patch, 'tC', tC);
        if (tC !== undefined) patch.tF = rounded((tC * 9) / 5 + 32);
    }
    if (namespace === 'humidity') {
        setNumber(patch, 'rh', varied(baseline.rh, 6, climateWave));
    }
    return patch;
}

export function buildTelemetryPatch(input: TelemetryTick): JsonObject {
    const patch: JsonObject = {};
    const loadWave = wave(input.nowMs, LOAD_PERIOD_MS);
    const climateWave = wave(input.nowMs, CLIMATE_PERIOD_MS, Math.PI / 3);

    for (const [key, current] of Object.entries(input.status)) {
        const baseline = input.baseline[key];
        if (!baseline) continue;
        const namespace = key.split(':', 1)[0];
        let componentPatch: JsonObject = {};
        if (['switch', 'light', 'pm1', 'cover'].includes(namespace)) {
            componentPatch = powerPatch({
                baseline,
                current,
                elapsedSeconds: input.elapsedSeconds,
                loadWave
            });
        } else if (namespace === 'em1') {
            const id = key.split(':')[1] ?? '0';
            const energy = input.status[`em1data:${id}`];
            componentPatch = em1Patch(
                baseline,
                loadWave,
                (finite(energy?.total_act_ret_energy) ?? 0) > 0
            );
        } else if (namespace === 'em') {
            componentPatch = threePhasePatch(baseline, input.nowMs);
        } else if (namespace === 'em1data' || namespace === 'emdata') {
            const id = key.split(':')[1] ?? '0';
            const powerKey = `${namespace === 'emdata' ? 'em' : 'em1'}:${id}`;
            componentPatch = emDataPatch({
                current,
                powerStatus:
                    objectValue(patch[powerKey]) ?? input.status[powerKey],
                elapsedSeconds: input.elapsedSeconds
            });
        } else if (namespace === 'temperature' || namespace === 'humidity') {
            componentPatch = climatePatch(namespace, baseline, climateWave);
        } else if (namespace === 'voltmeter') {
            setNumber(
                componentPatch,
                'voltage',
                varied(baseline.voltage, 1.3, loadWave)
            );
        }
        if (Object.keys(componentPatch).length > 0) patch[key] = componentPatch;
    }
    return patch;
}
