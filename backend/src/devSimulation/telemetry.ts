import {
    DEFAULT_POWER_FACTOR,
    driftFrequency,
    driftPowerFactor,
    EM_PHASES,
    impliedPowerFactor,
    lightingPower,
    NOMINAL_VOLTAGE_V,
    neutralCurrent,
    type PhasorReading,
    powerTriangle,
    ratedLightingPower,
    round
} from './electrical';
import {
    aisleMotionActive,
    berlinMachineReading,
    caseDoorOpen,
    DOOR_CLOSED,
    DOOR_OPEN,
    dockDoorOpen,
    irrigationZoneRun,
    leakActive,
    MOTION_CLEAR,
    MOTION_DETECTED,
    oasisSolarW,
    refrigerationReading,
    smokeAlarmActive,
    unitSeedFromMac
} from './scenarios';
import type {
    ColdChainFitment,
    JsonObject,
    PremisesFitment,
    SolarArrayFitment
} from './types';

/** The load wave the valve rides. Exported with `waterFlowRate` so a replay
 *  can rebuild the same wave from an absolute timestamp. */
export const LOAD_PERIOD_MS = 10 * 60 * 1000;
const CLIMATE_PERIOD_MS = 30 * 60 * 1000;
/** Frequency drifts on its own cycle, not with the load. */
const GRID_PERIOD_MS = 4 * 60 * 1000;
const SECONDS_PER_MINUTE = 60;
/** Shelly keeps the last three complete minutes in `aenergy.by_minute`. */
const ENERGY_MINUTES = 3;

export interface TelemetryTick {
    baseline: Readonly<Record<string, JsonObject>>;
    status: Readonly<Record<string, JsonObject>>;
    elapsedSeconds: number;
    nowMs: number;
    /** Cold-chain hardware the deployment wired to this device, when it has
     *  any. Absent on every stock device, which is what keeps thermostatic
     *  behaviour out of the default fleet. */
    fixture?: ColdChainFitment;
    /** Occupancy, access and fire sensors the deployment drives on this device.
     *  Absent on every stock device for the same reason: a catalog Plus Smoke
     *  must not start alarming just because it is simulated. */
    premises?: PremisesFitment;
    /** Declared role per virtual component key, e.g. {'number:200':
     *  'flow_rate'}. XT1 devices say what a component MEANS in config
     *  `_attrs.role`; without it the engine would have to guess from ids,
     *  which is how a flow reading and its own total end up disagreeing. */
    roles?: Readonly<Record<string, string>>;
    /** The array this meter is clamped on, when a scenario fitted one. */
    solar?: SolarArrayFitment;
}

/** Component key -> declared role, read off a profile's config. */
export function virtualRoles(
    config: Readonly<Record<string, JsonObject>>
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, component] of Object.entries(config)) {
        const attrs = objectValue(component?._attrs);
        const role = attrs?.role;
        if (typeof role === 'string' && role) out[key] = role;
    }
    return out;
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

export function wave(nowMs: number, periodMs: number, offset = 0): number {
    return Math.sin((nowMs / periodMs) * Math.PI * 2 + offset);
}

function varied(
    base: unknown,
    amount: number,
    phase: number
): number | undefined {
    const value = finite(base);
    return value === undefined ? undefined : round(value + amount * phase);
}

function setNumber(
    target: JsonObject,
    key: string,
    value: number | undefined
): void {
    if (value !== undefined) target[key] = value;
}

/** Only patch a field the baseline declares: a Light has no `pf`. */
function copyWhenDeclared(
    patch: JsonObject,
    baseline: JsonObject,
    key: string,
    value: number
): void {
    if (finite(baseline[key]) !== undefined) patch[key] = value;
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
    return round(total + (directedPower * elapsedSeconds) / 3600, 3);
}

/** `aenergy.by_minute` is in milliwatt-hours. */
function minuteEnergyMilliWattHours(power: number): number {
    return round((Math.abs(power) * 1000) / SECONDS_PER_MINUTE);
}

/** Newest first: element 0 is the minute preceding `minute_ts`. */
function rollMinuteWindow(previous: unknown, minuteEnergy: number): number[] {
    const history = Array.isArray(previous)
        ? (previous.filter((entry) => typeof entry === 'number') as number[])
        : [];
    return [minuteEnergy, ...history.slice(0, ENERGY_MINUTES - 1)];
}

function minuteStart(nowMs: number): number {
    return Math.floor(nowMs / 1000 / SECONDS_PER_MINUTE) * SECONDS_PER_MINUTE;
}

function energyPatch(input: {
    current: JsonObject;
    power: number;
    elapsedSeconds: number;
    nowMs: number;
}): JsonObject | undefined {
    const total = incrementEnergy(
        input.current.total,
        input.power,
        input.elapsedSeconds
    );
    if (total === undefined) return undefined;
    return {
        ...input.current,
        total,
        by_minute: rollMinuteWindow(
            input.current.by_minute,
            minuteEnergyMilliWattHours(input.power)
        ),
        minute_ts: minuteStart(input.nowMs)
    };
}

/** Reported `pf` when there is one, else the angle the baseline current implies. */
function channelPowerFactor(baseline: JsonObject, loadWave: number): number {
    const declared =
        finite(baseline.pf) ??
        impliedPowerFactor({
            actPower: finite(baseline.apower),
            voltage: finite(baseline.voltage),
            current: finite(baseline.current)
        }) ??
        DEFAULT_POWER_FACTOR;
    return driftPowerFactor(declared, loadWave);
}

/** Supply sag under load as a share of the rail, so one rule fits both a
 *  230 V mains channel and a 12 V LED rail. */
const VOLTAGE_SWING_SHARE = 0.006;

function driftVoltage(base: unknown, loadWave: number): number | undefined {
    const voltage = finite(base);
    if (voltage === undefined) return undefined;
    return round(voltage * (1 + loadWave * VOLTAGE_SWING_SHARE));
}

/** Case temperature follows the load; only patched where the baseline has one,
 *  since `temperature` is a "shown if applicable" field. */
function deviceTemperaturePatch(
    baseline: JsonObject,
    loadWave: number
): JsonObject | undefined {
    const declared = objectValue(baseline.temperature);
    if (!declared) return undefined;
    const tC = varied(declared.tC, 2.5, loadWave);
    if (tC === undefined) return undefined;
    return {tC, tF: round((tC * 9) / 5 + 32, 1)};
}

function powerPatch(input: {
    baseline: JsonObject;
    current: JsonObject;
    elapsedSeconds: number;
    loadWave: number;
    gridWave: number;
    nowMs: number;
    /** Watts a scenario models for this channel. Absent on every other device,
     *  which is what keeps the default fleet swinging around its baseline. */
    modelWatts?: number;
}): JsonObject {
    const patch: JsonObject = {};
    const voltage = varied(input.baseline.voltage, 1.4, input.loadWave);
    setNumber(patch, 'voltage', voltage);
    const temperature = deviceTemperaturePatch(input.baseline, input.loadWave);
    if (temperature) patch.temperature = temperature;

    const basePower = input.modelWatts ?? finite(input.baseline.apower);
    if (basePower === undefined) return patch;
    const energised = input.current.output !== false;
    const actPower =
        input.modelWatts ?? basePower * (1 + input.loadWave * 0.12);
    const reading = powerTriangle({
        actPower: energised ? Math.max(0, actPower) : 0,
        voltage: voltage ?? NOMINAL_VOLTAGE_V,
        powerFactor: channelPowerFactor(input.baseline, input.loadWave)
    });

    patch.apower = reading.actPower;
    copyWhenDeclared(patch, input.baseline, 'current', reading.current);
    copyWhenDeclared(patch, input.baseline, 'pf', reading.powerFactor);
    copyWhenDeclared(patch, input.baseline, 'aprtpower', reading.aprtPower);
    copyWhenDeclared(
        patch,
        input.baseline,
        'freq',
        driftFrequency(input.gridWave)
    );

    const currentEnergy = objectValue(input.current.aenergy);
    if (currentEnergy) {
        const aenergy = energyPatch({
            current: currentEnergy,
            power: reading.actPower,
            elapsedSeconds: input.elapsedSeconds,
            nowMs: input.nowMs
        });
        if (aenergy) patch.aenergy = aenergy;
    }
    return patch;
}

/** LED driver ripple on top of the level-derived draw. */
const LIGHTING_POWER_SWING = 0.03;

/** An LED channel's draw follows its own brightness, so this re-derives power
 *  from the live level instead of swinging the baseline. A bulb that reports
 *  no `apower` is not metered and gets no patch at all. */
function lightPatch(input: {
    baseline: JsonObject;
    current: JsonObject;
    elapsedSeconds: number;
    loadWave: number;
    nowMs: number;
}): JsonObject {
    const basePower = finite(input.baseline.apower);
    if (basePower === undefined) return {};

    const baseBrightness = finite(input.baseline.brightness);
    if (baseBrightness === undefined) {
        throw new Error('simulated light reports power but no brightness');
    }
    const ratedPower = ratedLightingPower({
        actPower: basePower,
        brightnessPercent: baseBrightness
    });
    const brightness = finite(input.current.brightness) ?? baseBrightness;
    const voltage = driftVoltage(input.baseline.voltage, input.loadWave);
    const energised = input.current.output !== false;
    const reading = powerTriangle({
        actPower: energised
            ? lightingPower({ratedPower, brightnessPercent: brightness}) *
              (1 + input.loadWave * LIGHTING_POWER_SWING)
            : 0,
        voltage: voltage ?? NOMINAL_VOLTAGE_V,
        // No `pf` on any light component; the baseline's own V and I carry it.
        powerFactor:
            impliedPowerFactor({
                actPower: basePower,
                voltage: finite(input.baseline.voltage),
                current: finite(input.baseline.current)
            }) ?? 1
    });

    const patch: JsonObject = {apower: reading.actPower};
    setNumber(patch, 'voltage', voltage);
    copyWhenDeclared(patch, input.baseline, 'current', reading.current);
    const temperature = deviceTemperaturePatch(input.baseline, input.loadWave);
    if (temperature) patch.temperature = temperature;

    const currentEnergy = objectValue(input.current.aenergy);
    if (currentEnergy) {
        const aenergy = energyPatch({
            current: currentEnergy,
            power: reading.actPower,
            elapsedSeconds: input.elapsedSeconds,
            nowMs: input.nowMs
        });
        if (aenergy) patch.aenergy = aenergy;
    }
    return patch;
}

function em1Patch(input: {
    baseline: JsonObject;
    loadWave: number;
    gridWave: number;
    exportsEnergy: boolean;
}): JsonObject {
    const patch: JsonObject = {};
    const voltage = varied(input.baseline.voltage, 1.5, input.loadWave);
    setNumber(patch, 'voltage', voltage);

    const basePower = finite(input.baseline.act_power);
    if (basePower === undefined) return patch;
    const magnitude = Math.abs(basePower) * (1 + input.loadWave * 0.15);
    const reading = powerTriangle({
        actPower: input.exportsEnergy ? -magnitude : magnitude,
        voltage: voltage ?? NOMINAL_VOLTAGE_V,
        powerFactor: driftPowerFactor(
            finite(input.baseline.pf) ?? DEFAULT_POWER_FACTOR,
            input.loadWave
        )
    });

    patch.act_power = reading.actPower;
    copyWhenDeclared(patch, input.baseline, 'aprt_power', reading.aprtPower);
    copyWhenDeclared(patch, input.baseline, 'pf', reading.powerFactor);
    copyWhenDeclared(patch, input.baseline, 'current', reading.current);
    copyWhenDeclared(
        patch,
        input.baseline,
        'freq',
        driftFrequency(input.gridWave)
    );
    return patch;
}

function threePhasePatch(baseline: JsonObject, nowMs: number): JsonObject {
    const patch: JsonObject = {};
    const readings: PhasorReading[] = [];
    for (const [index, phase] of EM_PHASES.entries()) {
        const basePower = finite(baseline[`${phase}_act_power`]);
        if (basePower === undefined) continue;
        const phaseWave = wave(nowMs, LOAD_PERIOD_MS, index * (Math.PI / 4));
        const voltage =
            varied(baseline[`${phase}_voltage`], 1.2, phaseWave) ??
            NOMINAL_VOLTAGE_V;
        const reading = powerTriangle({
            actPower: basePower * (1 + phaseWave * 0.12),
            voltage,
            powerFactor: driftPowerFactor(
                finite(baseline[`${phase}_pf`]) ?? DEFAULT_POWER_FACTOR,
                phaseWave
            )
        });
        patch[`${phase}_act_power`] = reading.actPower;
        patch[`${phase}_voltage`] = voltage;
        patch[`${phase}_current`] = reading.current;
        patch[`${phase}_aprt_power`] = reading.aprtPower;
        patch[`${phase}_pf`] = reading.powerFactor;
        patch[`${phase}_freq`] = driftFrequency(
            wave(nowMs, GRID_PERIOD_MS, index)
        );
        readings.push(reading);
    }
    if (readings.length === 0) return patch;

    patch.total_act_power = round(
        readings.reduce((sum, reading) => sum + reading.actPower, 0)
    );
    patch.total_aprt_power = round(
        readings.reduce((sum, reading) => sum + reading.aprtPower, 0)
    );
    patch.total_current = round(
        readings.reduce((sum, reading) => sum + reading.current, 0),
        3
    );
    if (readings.length === EM_PHASES.length) {
        patch.n_current = neutralCurrent(readings);
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

    const totals = {act: 0, ret: 0};
    const seen = {act: false, ret: false};
    for (const phase of EM_PHASES) {
        const phasePower = finite(input.powerStatus?.[`${phase}_act_power`]);
        const act = incrementEnergy(
            input.current[`${phase}_total_act_energy`],
            phasePower,
            input.elapsedSeconds
        );
        setNumber(patch, `${phase}_total_act_energy`, act);
        if (act !== undefined) {
            totals.act += act;
            seen.act = true;
        }
        const ret = incrementEnergy(
            input.current[`${phase}_total_act_ret_energy`],
            phasePower,
            input.elapsedSeconds,
            'export'
        );
        setNumber(patch, `${phase}_total_act_ret_energy`, ret);
        if (ret !== undefined) {
            totals.ret += ret;
            seen.ret = true;
        }
    }
    if (seen.act) patch.total_act = round(totals.act, 3);
    if (seen.ret) patch.total_act_ret = round(totals.ret, 3);
    return patch;
}

/** Humidity swing shrinks as a space gets damper: air near saturation cannot
 *  move far, dry air moves with the day. */
const HUMIDITY_SWING_RH = 6;
const HUMIDITY_DRY_RH = 40;
const HUMIDITY_DAMP_RH = 80;

function humiditySwing(baseRh: number): number {
    const damp = Math.min(
        1,
        Math.max(
            0,
            (baseRh - HUMIDITY_DRY_RH) / (HUMIDITY_DAMP_RH - HUMIDITY_DRY_RH)
        )
    );
    return HUMIDITY_SWING_RH * (1 - damp);
}

const TEMPERATURE_SWING_C = 1.8;

/** Where a climate reading has drifted to at `nowMs`. Exported because seeded
 *  sensor history has to draw the same wave the live tick draws. */
export function climateDriftAt(
    tag: 'temperature' | 'humidity',
    base: number,
    nowMs: number
): number {
    const climateWave = wave(nowMs, CLIMATE_PERIOD_MS, Math.PI / 3);
    const swing =
        tag === 'temperature' ? TEMPERATURE_SWING_C : humiditySwing(base);
    return round(base + swing * climateWave);
}

function climatePatch(
    namespace: string,
    baseline: JsonObject,
    nowMs: number
): JsonObject {
    const patch: JsonObject = {};
    if (namespace === 'temperature') {
        const base = finite(baseline.tC);
        const tC =
            base === undefined
                ? undefined
                : climateDriftAt('temperature', base, nowMs);
        setNumber(patch, 'tC', tC);
        if (tC !== undefined) patch.tF = round((tC * 9) / 5 + 32);
    }
    if (namespace === 'humidity') {
        const base = finite(baseline.rh);
        setNumber(
            patch,
            'rh',
            base === undefined
                ? undefined
                : climateDriftAt('humidity', base, nowMs)
        );
    }
    return patch;
}

function deviceUnitSeed(
    baseline: Readonly<Record<string, JsonObject>>
): number | undefined {
    const mac = objectValue(baseline.sys)?.mac;
    return typeof mac === 'string' ? unitSeedFromMac(mac) : undefined;
}

/** A thermostatically controlled fixture does not wander with the room: it
 *  holds a setpoint and breaks that hold only to defrost or because it has
 *  failed. The fitment carries the setpoint and the scenario carries the
 *  schedule, so the tick and the seeded fleet describe one fixture.
 *
 *  A BTHome sensor reports one `value` in the object's own unit, and the BLU
 *  H&T's temperature object (0x45) is already °C. A native Temperature
 *  component reports °C and °F, so both shapes are covered. */
function refrigerationPatch(input: {
    fixture: ColdChainFitment;
    unitSeed: number;
    ts: number;
}): JsonObject {
    const reading = refrigerationReading({
        setpointC: input.fixture.setpointC,
        unitSeed: input.unitSeed,
        ts: input.ts
    });
    if (input.fixture.probeComponent.startsWith('temperature:')) {
        return {tC: reading.tC, tF: round((reading.tC * 9) / 5 + 32, 1)};
    }
    return {[input.fixture.probeField]: reading.tC, last_updated_ts: input.ts};
}

/** A meter's running total, advanced from the CURRENT reading, never the
 *  baseline: a total that resets every tick is not a total, and Fleet Manager
 *  books the difference between readings. Water only, and only when the device
 *  already reports the counter shape — every other object component is left
 *  exactly as the profile declared it. */
/** A villa's water: the valve is shut most of the time and runs hard when it
 *  is open, so flow is a duty cycle rather than a trickle. Peak is the rate the
 *  Neo valve profile declares (m3/min).
 *
 *  The duty cycle is set so a villa lands inside DEWA's FIRST water band
 *  (0-27 m3/month, about 0.9 m3/day — PRODUCT.md §9). A demo fleet that sits in
 *  the top band would price every villa at the dearest rate and make the water
 *  cost card teach the wrong thing. Measured, not guessed: see the duty-cycle
 *  assertion in the simulator tests.
 *
 *  PRODUCT.md gives no per-villa consumption figure, so the LEVEL is the
 *  simulator's own demo assumption; the BAND it has to land in is not. */
const WATER_PEAK_M3_PER_MIN = 0.012;
const WATER_OPEN_ABOVE = 0.98;

/** Replay step. The valve opens for narrow spells on the load wave, so a
 *  coarser step would walk straight over them and read a meter that never
 *  moved. */
const WATER_STEP_SECONDS = 15;
const WATER_WAVE_PERIOD_SECONDS = LOAD_PERIOD_MS / 1000;

/** Volume passed over `seconds` from the start of a wave period. */
function waterVolumeOverM3(seconds: number): number {
    let total = 0;
    for (let s = 0; s < seconds; s += WATER_STEP_SECONDS) {
        const flow = waterFlowRate(wave(s * 1000, LOAD_PERIOD_MS));
        total += (flow * WATER_STEP_SECONDS) / SECONDS_PER_MINUTE;
    }
    return total;
}

/** Volume through one whole wave period, integrated once at load. */
const WATER_VOLUME_PER_PERIOD_M3 = waterVolumeOverM3(WATER_WAVE_PERIOD_SECONDS);

/**
 * What the meter reads at `ts`, as an absolute total.
 *
 * A function of the timestamp alone, never of where a replay started. The
 * seeded history is written in daily batches, and a total that began at zero in
 * each batch dropped every midnight — which a counter can only mean as a meter
 * reset, once per day for the whole window.
 */
export function waterVolumeAtM3(ts: number): number {
    const periods = Math.floor(ts / WATER_WAVE_PERIOD_SECONDS);
    const offset = ts - periods * WATER_WAVE_PERIOD_SECONDS;
    return periods * WATER_VOLUME_PER_PERIOD_M3 + waterVolumeOverM3(offset);
}

/** Is the valve open this tick, and at what rate (m3/min)? Exported so the
 *  seeded history replays this exact model rather than a second one. */
export function waterFlowRate(loadWave: number): number {
    if (loadWave < WATER_OPEN_ABOVE) return 0;
    // Ramp from just-open to full over the top of the wave, so the meter does
    // not step from nothing to peak in one tick.
    const openness = (loadWave - WATER_OPEN_ABOVE) / (1 - WATER_OPEN_ABOVE);
    return round(WATER_PEAK_M3_PER_MIN * openness, 6);
}

/**
 * The irrigation controller, driven by the same run model the seed schedules
 * against. Each zone's boolean follows whether it is watering now, and
 * `zones_status` carries the start time the Water page reads, so the zone
 * timeline shows a real run rather than a permanent "did not run".
 */
function irrigationPatch(input: {
    status: Readonly<Record<string, JsonObject>>;
    roles: Readonly<Record<string, string>>;
    ts: number;
}): Record<string, JsonObject> {
    const zoneKeys = Object.keys(input.roles)
        .filter((key) => /^zone\d+$/.test(input.roles[key] ?? ''))
        .sort();
    if (!zoneKeys.length) return {};
    const out: Record<string, JsonObject> = {};
    const zonesStatus: JsonObject = {};
    for (const key of zoneKeys) {
        const role = input.roles[key];
        const zone = Number(role.slice('zone'.length));
        const run = irrigationZoneRun({zone, ts: input.ts});
        out[key] = {value: run.running, last_updated_ts: input.ts};
        zonesStatus[role] = {
            duration: 8,
            started_at: run.startedAt,
            source: 'schedule'
        };
    }
    const statusKey = Object.keys(input.roles).find(
        (key) => input.roles[key] === 'zones_status'
    );
    if (statusKey) {
        out[statusKey] = {value: zonesStatus, last_updated_ts: input.ts};
    }
    return out;
}

/**
 * The Neo valve, modelled as one device rather than as unrelated components.
 *
 * Flow is the reading; the total is its integral over the tick that actually
 * elapsed. That is the whole point: a meter whose total disagrees with its own
 * flow is not a meter, and an earlier version of this had them 13x apart.
 *
 * Driven by declared roles, never by component ids, so a profile that renumbers
 * its components keeps working and no other device is touched.
 */
function waterValvePatch(input: {
    status: Readonly<Record<string, JsonObject>>;
    roles: Readonly<Record<string, string>>;
    elapsedSeconds: number;
    loadWave: number;
    ts: number;
}): Record<string, JsonObject> {
    const keyFor = (role: string): string | undefined =>
        Object.keys(input.roles).find((k) => input.roles[k] === role);
    const flowKey = keyFor('flow_rate');
    const counterKey = keyFor('water_consumption');
    if (!flowKey || !counterKey) return {};

    const counterComponent = objectValue(input.status[counterKey]);
    const value = counterComponent
        ? objectValue(counterComponent.value)
        : undefined;
    const counter = value ? objectValue(value.counter) : undefined;
    const total = counter ? finite(counter.total) : undefined;
    if (total === undefined) return {};

    const flow = waterFlowRate(input.loadWave);
    // Six decimals: a tick is worth a fraction of a litre, and rounding to the
    // stored precision here would erase every increment forever.
    const litres = (flow * input.elapsedSeconds) / SECONDS_PER_MINUTE;
    const next = round(total + litres, 6);
    return {
        [flowKey]: {value: flow, last_updated_ts: input.ts},
        [counterKey]: {
            value: {counter: {total: next}},
            last_updated_ts: input.ts
        }
    };
}

/** The array's meter this tick. Generation reads negative: the energy arrives
 *  from the roof rather than being drawn. Spare CTs stay at zero. */
function solarArrayPatch(input: {
    solar: SolarArrayFitment;
    status: Readonly<Record<string, JsonObject>>;
    ts: number;
}): JsonObject {
    const patch: JsonObject = {};
    const watts = -oasisSolarW({unitSeed: input.solar.unitSeed, ts: input.ts});
    const write = (key: string, actPower: number): void => {
        const current = objectValue(input.status[key]);
        if (!current) return;
        const voltage = finite(current.voltage) ?? NOMINAL_VOLTAGE_V;
        const reading = powerTriangle({
            actPower,
            voltage,
            powerFactor: finite(current.pf) ?? DEFAULT_POWER_FACTOR
        });
        patch[key] = {
            ...current,
            act_power: reading.actPower,
            current: reading.current,
            voltage
        };
    };
    write(input.solar.generationComponent, watts);
    for (const key of input.solar.spareComponents) write(key, 0);
    return patch;
}

export function buildTelemetryPatch(input: TelemetryTick): JsonObject {
    const patch: JsonObject = {};
    const loadWave = wave(input.nowMs, LOAD_PERIOD_MS);
    const gridWave = wave(input.nowMs, GRID_PERIOD_MS);
    const ts = Math.floor(input.nowMs / 1000);
    const unitSeed = deviceUnitSeed(input.baseline);
    // A fitted fixture only behaves like one when the device also has a serial
    // position to phase its defrost and fault schedule against. The premises
    // sensors are on the same footing: every one of their schedules is phased
    // off that seed.
    const fixture = unitSeed === undefined ? undefined : input.fixture;
    const premises = unitSeed === undefined ? undefined : input.premises;
    // A vending plug answers the model its seeded history came from, so its
    // socket, its cabinet probe and its door all continue that series rather
    // than drifting around whatever the profile happened to declare.
    const vending = berlinMachineReading({
        fixture,
        unitSeed,
        ts,
        periodSeconds: Math.max(1, input.elapsedSeconds)
    });

    // One device-level model, not a per-component guess: the valve's flow and
    // its total have to be produced together or they drift apart.
    if (input.roles) {
        const water = waterValvePatch({
            status: input.status,
            roles: input.roles,
            elapsedSeconds: input.elapsedSeconds,
            loadWave,
            ts
        });
        for (const [key, value] of Object.entries(water)) patch[key] = value;
        const zones = irrigationPatch({
            status: input.status,
            roles: input.roles,
            ts
        });
        for (const [key, value] of Object.entries(zones)) patch[key] = value;
    }

    for (const [key, current] of Object.entries(input.status)) {
        const baseline = input.baseline[key];
        if (!baseline) continue;
        const namespace = key.split(':', 1)[0];
        let componentPatch: JsonObject = {};
        if (
            fixture &&
            unitSeed !== undefined &&
            key === fixture.probeComponent
        ) {
            componentPatch = vending
                ? {[fixture.probeField]: vending.probeC, last_updated_ts: ts}
                : refrigerationPatch({fixture, unitSeed, ts});
        } else if (
            fixture &&
            unitSeed !== undefined &&
            key === fixture.doorComponent
        ) {
            // Only the BLU sensor the install put on the case door is a case
            // door; every other relayed sensor keeps its own behaviour.
            const open =
                vending?.doorOpen ??
                caseDoorOpen({
                    unitSeed,
                    setpointC: fixture.setpointC,
                    ts
                });
            componentPatch = {
                [fixture.doorField ?? 'value']: open ? DOOR_OPEN : DOOR_CLOSED,
                last_updated_ts: ts
            };
        } else if (vending && key === vending.humidityComponent) {
            componentPatch = {
                [fixture?.probeField ?? 'value']: vending.humidityRh,
                last_updated_ts: ts
            };
        } else if (vending && Object.hasOwn(vending.childBattery, key)) {
            // A cell that never moves is the one thing a battery never does.
            componentPatch = {
                battery: vending.childBattery[key],
                last_updated_ts: ts
            };
        } else if (
            premises &&
            unitSeed !== undefined &&
            key === premises.motionComponent
        ) {
            componentPatch = {
                value: aisleMotionActive({unitSeed, ts})
                    ? MOTION_DETECTED
                    : MOTION_CLEAR,
                last_updated_ts: ts
            };
        } else if (
            premises &&
            unitSeed !== undefined &&
            key === premises.contactComponent
        ) {
            componentPatch = {state: dockDoorOpen({unitSeed, ts})};
        } else if (
            premises &&
            unitSeed !== undefined &&
            key === premises.smokeComponent
        ) {
            componentPatch = {alarm: smokeAlarmActive({unitSeed, ts})};
        } else if (['switch', 'pm1', 'cover'].includes(namespace)) {
            componentPatch = powerPatch({
                baseline,
                current,
                elapsedSeconds: input.elapsedSeconds,
                loadWave,
                gridWave,
                nowMs: input.nowMs,
                modelWatts: vending?.watts
            });
        } else if (
            ['light', 'rgb', 'rgbw', 'cct', 'rgbcct'].includes(namespace)
        ) {
            componentPatch = lightPatch({
                baseline,
                current,
                elapsedSeconds: input.elapsedSeconds,
                loadWave,
                nowMs: input.nowMs
            });
        } else if (namespace === 'em1') {
            const id = key.split(':')[1] ?? '0';
            const energy = input.status[`em1data:${id}`];
            componentPatch = em1Patch({
                baseline,
                loadWave,
                gridWave,
                exportsEnergy: (finite(energy?.total_act_ret_energy) ?? 0) > 0
            });
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
            componentPatch = climatePatch(namespace, baseline, input.nowMs);
        } else if (namespace === 'flood' && unitSeed !== undefined) {
            componentPatch = {alarm: leakActive({unitSeed, ts})};
        } else if (namespace === 'voltmeter') {
            setNumber(
                componentPatch,
                'voltage',
                varied(baseline.voltage, 1.3, loadWave)
            );
        }
        if (Object.keys(componentPatch).length > 0) patch[key] = componentPatch;
    }

    // Last word on its own meter. The generic drift above wanders a baseline,
    // which on an array would report output at midnight.
    if (input.solar) {
        const solar = solarArrayPatch({
            solar: input.solar,
            status: input.status,
            ts
        });
        for (const [key, value] of Object.entries(solar)) patch[key] = value;
    }
    return patch;
}
