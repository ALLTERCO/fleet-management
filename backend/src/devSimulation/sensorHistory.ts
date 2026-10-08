import {createHash, type Hash} from 'node:crypto';
import {
    applyLiveSimulationScenario,
    type SimulationScenario
} from './scenarios';
import {buildTelemetryPatch, climateDriftAt, virtualRoles} from './telemetry';
import type {ExpandedDeviceProfile, JsonObject} from './types';

export type SensorTag = 'temperature' | 'humidity' | 'battery';

export interface SimulatedSensorRow {
    /** The BLU child's own external id, or the gateway's for a wired sensor. */
    externalId: string;
    /** Unix second the sample period starts on. */
    ts: number;
    component: string;
    tag: SensorTag;
    value: number;
}

export interface SensorHistoryManifest {
    rows: number;
    firstTs: number | null;
    lastTs: number | null;
    sha256: string;
}

export class SensorHistoryManifestBuilder {
    readonly #hash: Hash = createHash('sha256');
    #rows = 0;
    #firstTs: number | null = null;
    #lastTs: number | null = null;

    add(row: SimulatedSensorRow): void {
        this.#hash.update(`${sensorRowTsv(row)}\n`);
        this.#rows++;
        this.#firstTs ??= row.ts;
        this.#lastTs = row.ts;
    }

    finish(): SensorHistoryManifest {
        return {
            rows: this.#rows,
            firstTs: this.#firstTs,
            lastTs: this.#lastTs,
            sha256: this.#hash.digest('hex')
        };
    }
}

export function sensorRowTsv(row: SimulatedSensorRow): string {
    return [row.externalId, row.ts, row.component, row.tag, row.value].join(
        '\t'
    );
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

/** BTHome object ids that carry a temperature or a relative humidity. Both
 *  units appear in the catalog: 0x02/0x03 are the fine-grained pair, 0x45/0x2E
 *  the coarse one a BLU H&T broadcasts. */
const BTHOME_TEMPERATURE_OBJECT_IDS: ReadonlySet<number> = new Set([
    0x02, 0x45
]);
const BTHOME_HUMIDITY_OBJECT_IDS: ReadonlySet<number> = new Set([0x03, 0x2e]);

const BTHOME_SENSOR_FIELD = 'value';

/** One reading this fleet publishes every sample period. `nested` is the field
 *  inside `field`, which only a DevicePower battery needs. */
interface PlannedSensor {
    externalId: string;
    component: string;
    tag: SensorTag;
    field: string;
    nested?: string;
}

function bluExternalId(address: unknown): string | undefined {
    return typeof address === 'string'
        ? `blu_${address.replaceAll(':', '').toLowerCase()}`
        : undefined;
}

function componentId(key: string): number {
    const id = Number(key.split(':')[1] ?? 0);
    return Number.isSafeInteger(id) ? id : 0;
}

function sortedKeys(
    components: Readonly<Record<string, JsonObject>>,
    pattern: RegExp
): string[] {
    return Object.keys(components)
        .filter((key) => pattern.test(key))
        .sort((left, right) => componentId(left) - componentId(right));
}

/** Sensors a BLU child publishes, keyed to the child's own external id: the
 *  gateway relays them but does not own them, so a reading has to be filed
 *  under the sensor that took it. */
function bluChildSensors(profile: ExpandedDeviceProfile): PlannedSensor[] {
    const planned: PlannedSensor[] = [];
    for (const key of sortedKeys(profile.config, /^bthomedevice:\d+$/)) {
        const child = profile.config[key];
        const externalId = bluExternalId(child.addr);
        if (!externalId) continue;
        if (numberValue(profile.status[key]?.battery) !== undefined) {
            planned.push({
                externalId,
                component: key,
                tag: 'battery',
                field: 'battery'
            });
        }
        for (const sensorKey of sortedKeys(
            profile.config,
            /^bthomesensor:\d+$/
        )) {
            const sensor = profile.config[sensorKey];
            if (bluExternalId(sensor.addr) !== externalId) continue;
            const objectId = numberValue(sensor.obj_id);
            if (objectId === undefined) continue;
            const tag = BTHOME_TEMPERATURE_OBJECT_IDS.has(objectId)
                ? 'temperature'
                : BTHOME_HUMIDITY_OBJECT_IDS.has(objectId)
                  ? 'humidity'
                  : undefined;
            if (!tag) continue;
            planned.push({
                externalId,
                component: sensorKey,
                tag,
                field: BTHOME_SENSOR_FIELD
            });
        }
    }
    for (const key of sortedKeys(profile.config, /^blutrv:\d+$/)) {
        const externalId = bluExternalId(profile.config[key].addr);
        if (!externalId) continue;
        const status = profile.status[key] ?? {};
        if (numberValue(status.current_C) !== undefined) {
            planned.push({
                externalId,
                component: key,
                tag: 'temperature',
                field: 'current_C'
            });
        }
        if (numberValue(status.battery) !== undefined) {
            planned.push({
                externalId,
                component: key,
                tag: 'battery',
                field: 'battery'
            });
        }
    }
    return planned;
}

/** Sensors the device measures itself, filed under the device. */
function wiredSensors(profile: ExpandedDeviceProfile): PlannedSensor[] {
    const planned: PlannedSensor[] = [];
    const externalId = profile.shellyID;
    for (const key of sortedKeys(profile.status, /^temperature:\d+$/)) {
        planned.push({
            externalId,
            component: key,
            tag: 'temperature',
            field: 'tC'
        });
    }
    for (const key of sortedKeys(profile.status, /^humidity:\d+$/)) {
        planned.push({
            externalId,
            component: key,
            tag: 'humidity',
            field: 'rh'
        });
    }
    for (const key of sortedKeys(profile.status, /^devicepower:\d+$/)) {
        const battery = objectValue(profile.status[key]?.battery);
        if (numberValue(battery?.percent) === undefined) continue;
        planned.push({
            externalId,
            component: key,
            tag: 'battery',
            field: 'battery',
            nested: 'percent'
        });
    }
    return planned;
}

export function plannedSensors(
    profile: ExpandedDeviceProfile
): PlannedSensor[] {
    return [...wiredSensors(profile), ...bluChildSensors(profile)];
}

function readingOf(
    component: JsonObject | undefined,
    sensor: PlannedSensor
): number | undefined {
    if (!component) return undefined;
    const field = component[sensor.field];
    return sensor.nested === undefined
        ? numberValue(field)
        : numberValue(objectValue(field)?.[sensor.nested]);
}

/** Readings one device publishes at `ts`.
 *
 *  The live tick is asked first, so a sensor a scenario drives — a vending
 *  cabinet's probe, its humidity, its BLU batteries — is seeded from the very
 *  model the connected fleet reads, and the chart has no step at "now". A
 *  climate sensor the tick leaves alone would otherwise draw a flat line for
 *  weeks, so it gets the same drift wave a wired one gets. A battery is left
 *  where the device says it is: an untouched cell does not wander. */
export function sensorRowsAt(input: {
    profile: ExpandedDeviceProfile;
    sensors: readonly PlannedSensor[];
    ts: number;
    periodSeconds: number;
}): SimulatedSensorRow[] {
    const nowMs = input.ts * 1000;
    const patch = buildTelemetryPatch({
        baseline: input.profile.status,
        status: input.profile.status,
        elapsedSeconds: input.periodSeconds,
        nowMs,
        fixture: input.profile.fixture,
        premises: input.profile.premises,
        roles: virtualRoles(input.profile.config),
        solar: input.profile.solar
    });
    const rows: SimulatedSensorRow[] = [];
    for (const sensor of input.sensors) {
        const live = readingOf(objectValue(patch[sensor.component]), sensor);
        const value =
            live ?? readingOf(input.profile.status[sensor.component], sensor);
        if (value === undefined) continue;
        const drifted =
            live === undefined && sensor.tag !== 'battery'
                ? climateDriftAt(sensor.tag, value, nowMs)
                : value;
        rows.push({
            externalId: sensor.externalId,
            ts: input.ts,
            component: sensor.component,
            tag: sensor.tag,
            value: drifted
        });
    }
    return rows;
}

export function* sensorHistoryRows(input: {
    profiles: readonly ExpandedDeviceProfile[];
    fromTs: number;
    toTs: number;
    periodSeconds: number;
    scenario?: SimulationScenario;
}): Generator<SimulatedSensorRow> {
    // The plan is the fleet's wiring, which no sample can change: a device with
    // nothing to report is dropped once here rather than shaped at every step.
    const plans = input.profiles.map((profile) => plannedSensors(profile));
    const measuring = input.profiles.filter(
        (_, index) => plans[index].length > 0
    );
    const sensors = plans.filter((plan) => plan.length > 0);
    if (measuring.length === 0) return;

    for (let ts = input.fromTs; ts <= input.toTs; ts += input.periodSeconds) {
        const shaped = applyLiveSimulationScenario(
            measuring,
            input.scenario,
            ts * 1000
        );
        for (const [index, profile] of shaped.entries()) {
            yield* sensorRowsAt({
                profile,
                sensors: sensors[index],
                ts,
                periodSeconds: input.periodSeconds
            });
        }
    }
}
