import {createHash, type Hash} from 'node:crypto';
import {
    DEFAULT_POWER_FACTOR,
    NOMINAL_VOLTAGE_V,
    powerTriangle
} from './electrical';
import {
    AUSSIE_MAIN_METER_SLOT,
    AUSSIE_SOLAR_SLOT,
    aussieLoadW,
    aussieMainMeterPhaseW,
    aussieSlot,
    aussieSolarW,
    aussieStoreIndex,
    berlinDeviceIndex,
    berlinPlugW,
    berlinVoltageV,
    OASIS_PV_ID_PREFIX,
    oasisSolarW,
    type SimulationScenario,
    unitSeedFromMac
} from './scenarios';
import {buildTelemetryPatch, virtualRoles, waterVolumeAtM3} from './telemetry';
import type {ExpandedDeviceProfile, JsonObject} from './types';

const PHASES = ['a', 'b', 'c'] as const;

export interface SimulatedEnergyRow {
    externalId: string;
    ts: number;
    channel: number;
    phase: string;
    tag: string;
    /** Water rides the energy pipeline but is not electrical, and the live
     *  capture stores it as `unspecified` (modules/energyClassifier.ts). */
    domain: 'ac_mains' | 'unspecified';
    value: number;
}

export interface EnergyHistoryManifest {
    rows: number;
    firstTs: number | null;
    lastTs: number | null;
    importedWh: number;
    returnedWh: number;
    sha256: string;
}

export class EnergyHistoryManifestBuilder {
    readonly #hash: Hash = createHash('sha256');
    #rows = 0;
    #firstTs: number | null = null;
    #lastTs: number | null = null;
    #importedWh = 0;
    #returnedWh = 0;

    add(row: SimulatedEnergyRow): void {
        const tsv = energyRowTsv(row);
        this.#hash.update(`${tsv}\n`);
        this.#rows++;
        this.#firstTs ??= row.ts;
        this.#lastTs = row.ts;
        if (row.tag === 'total_act_energy') this.#importedWh += row.value;
        if (row.tag === 'total_act_ret_energy') this.#returnedWh += row.value;
    }

    finish(): EnergyHistoryManifest {
        return {
            rows: this.#rows,
            firstTs: this.#firstTs,
            lastTs: this.#lastTs,
            importedWh: Number(this.#importedWh.toFixed(4)),
            returnedWh: Number(this.#returnedWh.toFixed(4)),
            sha256: this.#hash.digest('hex')
        };
    }
}

function objectValue(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonObject)
        : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function channelFromKey(key: string): number {
    const channel = Number(key.split(':')[1] ?? 0);
    return Number.isSafeInteger(channel) ? channel : 0;
}

function meterKeys(status: Readonly<Record<string, JsonObject>>): string[] {
    const keys = Object.keys(status);
    const em = keys.filter((key) => /^em:\d+$/.test(key));
    if (em.length > 0) return em;
    const em1 = keys.filter((key) => /^em1:\d+$/.test(key));
    if (em1.length > 0) return em1;
    return keys.filter((key) => {
        if (!/^(pm1|switch|light):\d+$/.test(key)) return false;
        return numberValue(status[key]?.apower) !== undefined;
    });
}

function appendMetrics(input: {
    rows: SimulatedEnergyRow[];
    profile: ExpandedDeviceProfile;
    ts: number;
    channel: number;
    phase: string;
    power: number | undefined;
    voltage: number | undefined;
    current: number | undefined;
    periodSeconds: number;
}): void {
    const metrics = [
        ['power', input.power],
        ['voltage', input.voltage],
        ['current', input.current],
        [
            input.power !== undefined && input.power < 0
                ? 'total_act_ret_energy'
                : 'total_act_energy',
            input.power === undefined
                ? undefined
                : (Math.abs(input.power) * input.periodSeconds) / 3600
        ]
    ] as const;
    for (const [tag, value] of metrics) {
        if (value === undefined) continue;
        input.rows.push({
            externalId: input.profile.shellyID,
            ts: input.ts,
            channel: input.channel,
            phase: input.phase,
            tag,
            domain: 'ac_mains',
            value: Number(value.toFixed(4))
        });
    }
}

export function energyRowsAt(input: {
    profile: ExpandedDeviceProfile;
    ts: number;
    periodSeconds: number;
}): SimulatedEnergyRow[] {
    const patch = buildTelemetryPatch({
        baseline: input.profile.status,
        status: input.profile.status,
        elapsedSeconds: input.periodSeconds,
        nowMs: input.ts * 1000,
        fixture: input.profile.fixture,
        premises: input.profile.premises
    });
    const rows: SimulatedEnergyRow[] = [];
    for (const key of meterKeys(input.profile.status)) {
        const namespace = key.split(':')[0];
        const channel = channelFromKey(key);
        const status = objectValue(patch[key]) ?? input.profile.status[key];
        if (namespace === 'em') {
            for (const phase of PHASES) {
                appendMetrics({
                    rows,
                    profile: input.profile,
                    ts: input.ts,
                    channel,
                    phase,
                    power: numberValue(status?.[`${phase}_act_power`]),
                    voltage: numberValue(status?.[`${phase}_voltage`]),
                    current: numberValue(status?.[`${phase}_current`]),
                    periodSeconds: input.periodSeconds
                });
            }
            continue;
        }
        appendMetrics({
            rows,
            profile: input.profile,
            ts: input.ts,
            channel,
            phase: 'z',
            power: numberValue(
                status?.[namespace === 'em1' ? 'act_power' : 'apower']
            ),
            voltage: numberValue(status?.voltage),
            current: numberValue(status?.current),
            periodSeconds: input.periodSeconds
        });
    }
    return rows;
}

function scenarioVoltage(
    rows: readonly SimulatedEnergyRow[],
    channel: number,
    phase: string
): number {
    const row = rows.find(
        (candidate) =>
            candidate.tag === 'voltage' &&
            candidate.channel === channel &&
            candidate.phase === phase
    );
    return row?.value ?? NOMINAL_VOLTAGE_V;
}

/** One metered reading expanded into the four rows the seeder ingests. The set
 *  closes on itself — Wh is the emitted W integrated over the sample period —
 *  so a reader can check the energy against the power it came from. */
function scenarioMeterRows(input: {
    externalId: string;
    ts: number;
    periodSeconds: number;
    channel: number;
    phase: string;
    watts: number;
    voltage: number;
    energyTag: 'total_act_energy' | 'total_act_ret_energy';
}): SimulatedEnergyRow[] {
    const reading = powerTriangle({
        actPower: input.watts,
        voltage: input.voltage,
        powerFactor: DEFAULT_POWER_FACTOR
    });
    const row = (tag: string, value: number): SimulatedEnergyRow => ({
        externalId: input.externalId,
        ts: input.ts,
        channel: input.channel,
        phase: input.phase,
        tag,
        domain: 'ac_mains',
        value: Number(value.toFixed(4))
    });
    return [
        row('power', reading.actPower),
        row('voltage', input.voltage),
        row('current', reading.current),
        row(
            input.energyTag,
            (Math.abs(reading.actPower) * input.periodSeconds) / 3600
        )
    ];
}

/** History for one Aussie Grocers device, taken from the store model rather
 *  than from a factor applied to the device's own baseline. The main meter is
 *  therefore the arithmetic sum of its store's submeters at every sample, not
 *  an independent series that happens to look plausible. */
function aussieScenarioRows(input: {
    profile: ExpandedDeviceProfile;
    deviceIndex: number;
    ts: number;
    periodSeconds: number;
    generic: readonly SimulatedEnergyRow[];
}): SimulatedEnergyRow[] {
    const slot = aussieSlot(input.deviceIndex);
    const storeIndex = aussieStoreIndex(input.deviceIndex);
    const common = {
        externalId: input.profile.shellyID,
        ts: input.ts,
        periodSeconds: input.periodSeconds,
        channel: 0
    };

    if (slot === AUSSIE_MAIN_METER_SLOT) {
        const phaseWatts = aussieMainMeterPhaseW(storeIndex, input.ts);
        return PHASES.flatMap((phase, index) =>
            scenarioMeterRows({
                ...common,
                phase,
                watts: phaseWatts[index],
                voltage: scenarioVoltage(input.generic, 0, phase),
                energyTag: 'total_act_energy'
            })
        );
    }

    if (slot === AUSSIE_SOLAR_SLOT) {
        // Generation only, on the array's own CT: negative power is energy
        // leaving the inverter. At night it is exactly zero, never a trickle,
        // and it is never tagged as consumption.
        return scenarioMeterRows({
            ...common,
            phase: 'z',
            watts: -aussieSolarW(storeIndex, input.ts),
            voltage: scenarioVoltage(input.generic, 0, 'z'),
            energyTag: 'total_act_ret_energy'
        });
    }

    const watts = aussieLoadW(slot, storeIndex, input.ts);
    if (watts === 0) return [];
    return scenarioMeterRows({
        ...common,
        phase: 'z',
        watts,
        voltage: scenarioVoltage(input.generic, 0, 'z'),
        energyTag: 'total_act_energy'
    });
}

/** History for one Berlin vending plug. The bucket is the MEAN power over the
 *  period that ends at `ts`, taken from the same duty-cycle model the live tick
 *  reads, so a machine's seeded past and its connected present are one series
 *  rather than two that happen to look alike. The plug is keyed by its own MAC
 *  ordinal, so selecting part of the fleet cannot relabel a machine. */
function berlinScenarioRows(input: {
    profile: ExpandedDeviceProfile;
    ts: number;
    periodSeconds: number;
}): SimulatedEnergyRow[] {
    const deviceIndex = berlinDeviceIndex(input.profile.mac);
    return scenarioMeterRows({
        externalId: input.profile.shellyID,
        ts: input.ts,
        periodSeconds: input.periodSeconds,
        channel: 0,
        phase: 'z',
        watts: berlinPlugW({
            deviceIndex,
            fromTs: input.ts - input.periodSeconds,
            toTs: input.ts
        }),
        voltage: berlinVoltageV({deviceIndex, ts: input.ts}),
        energyTag: 'total_act_energy'
    });
}

/** History for one Oasis device. Only the PV meters read differently from a
 *  generic device: their series is generation, so it is negative power tagged
 *  as returned energy, and it comes from the same `oasisSolarW` the live
 *  telemetry uses — one array, not a seeded one and a live one that disagree. */
function oasisScenarioRows(input: {
    profile: ExpandedDeviceProfile;
    ts: number;
    periodSeconds: number;
    generic: readonly SimulatedEnergyRow[];
}): SimulatedEnergyRow[] {
    if (!input.profile.shellyID.startsWith(`${OASIS_PV_ID_PREFIX}-`)) {
        return [...input.generic];
    }
    const unitSeed = unitSeedFromMac(input.profile.mac);
    if (unitSeed === undefined) {
        throw new Error(
            `Oasis PV meter ${input.profile.shellyID} has no ordinal in its MAC`
        );
    }
    return scenarioMeterRows({
        externalId: input.profile.shellyID,
        ts: input.ts,
        periodSeconds: input.periodSeconds,
        channel: 0,
        phase: 'z',
        watts: -oasisSolarW({unitSeed, ts: input.ts}),
        voltage: scenarioVoltage(input.generic, 0, 'z'),
        energyTag: 'total_act_ret_energy'
    });
}

// ── Water: the villa's own meter ─────────────────────────────────────────
//
// The valve is a counter, but a counter is not what gets stored: the live path
// ages every cumulative reading into the amount it advanced
// (modules/energyCapture.ts positiveDelta), so device_em.stats holds
// consumption per interval. Seeding the running total instead put the meter
// READING into every bucket, and the page then reported 94,809 m3 used today.
//
// The volume comes from the same model the live tick integrates, so the seeded
// past and the running present describe one meter.

/** The valve's own component channel, from the role the profile declares. */
function waterChannel(roles: Readonly<Record<string, string>>): number | null {
    const key = Object.keys(roles).find(
        (candidate) => roles[candidate] === 'water_consumption'
    );
    if (!key) return null;
    const channel = Number(key.split(':')[1]);
    return Number.isSafeInteger(channel) ? channel : null;
}

/** Cumulative volume rows for one water meter across the window. */
function* waterCounterRows(input: {
    profile: ExpandedDeviceProfile;
    fromTs: number;
    toTs: number;
    periodSeconds: number;
}): Generator<SimulatedEnergyRow> {
    const roles = virtualRoles(input.profile.config);
    const channel = waterChannel(roles);
    if (channel === null) return;

    for (
        let ts = input.fromTs + input.periodSeconds;
        ts <= input.toTs;
        ts += input.periodSeconds
    ) {
        const used =
            waterVolumeAtM3(ts) - waterVolumeAtM3(ts - input.periodSeconds);
        if (used <= 0) continue;
        yield {
            externalId: input.profile.shellyID,
            ts,
            channel,
            phase: 'z',
            tag: 'volume_m3',
            domain: 'unspecified',
            value: Number(used.toFixed(6))
        };
    }
}

export function* energyHistoryRows(input: {
    profiles: readonly ExpandedDeviceProfile[];
    fromTs: number;
    toTs: number;
    periodSeconds: number;
    scenario?: SimulationScenario;
}): Generator<SimulatedEnergyRow> {
    for (let ts = input.fromTs; ts <= input.toTs; ts += input.periodSeconds) {
        for (const [index, profile] of input.profiles.entries()) {
            const rows = energyRowsAt({
                profile,
                ts,
                periodSeconds: input.periodSeconds
            });
            if (input.scenario === 'aussie-grocers') {
                yield* aussieScenarioRows({
                    profile,
                    deviceIndex: index,
                    ts,
                    periodSeconds: input.periodSeconds,
                    generic: rows
                });
                continue;
            }
            if (input.scenario === 'berlin-vending') {
                yield* berlinScenarioRows({
                    profile,
                    ts,
                    periodSeconds: input.periodSeconds
                });
                continue;
            }
            if (input.scenario === 'oasis') {
                yield* oasisScenarioRows({
                    profile,
                    ts,
                    periodSeconds: input.periodSeconds,
                    generic: rows
                });
                continue;
            }
            yield* rows;
        }
    }
    // The water meter is its own series: not a shaped copy of an electrical
    // reading, so it is generated once for the whole window rather than per
    // sample above.
    for (const profile of input.profiles) {
        yield* waterCounterRows({
            profile,
            fromTs: input.fromTs,
            toTs: input.toTs,
            periodSeconds: input.periodSeconds
        });
    }
}

export function energyRowTsv(row: SimulatedEnergyRow): string {
    return [
        row.externalId,
        row.ts,
        row.channel,
        row.phase,
        row.tag,
        row.domain,
        row.value
    ].join('\t');
}
