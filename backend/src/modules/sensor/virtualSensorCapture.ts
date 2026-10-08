// Classifies a Shelly X / XT1 virtual component reading into a stored sensor
// reading, or rejects it.
//
// Virtual components are generic: the device maker picks the role name, the
// unit and whether the value is readable or writable. That freedom is why a
// producer string must never reach device_sensor.numeric_15min, whose `kind`
// column is VARCHAR(24), is part of the unique key, and is a compression
// segment on a hypertable with no retention policy. A role longer than the
// column aborts the whole coalesced insert; a role admitted once is in the
// chunk layout forever.
//
// So this module is deliberately a closed door. A reading is stored only when
// every one of these holds:
//   - the component is a virtual number, and the leaf is its own `value`
//   - the role maps to a kind in CANONICAL_KINDS below
//   - the component is read-only, so it is a measurement and not a setpoint
//   - the role's declared unit converts to the kind's canonical unit
// Anything else is left in device.status, where it is visible for 24 hours and
// costs no cardinality, and is reported so the vocabulary can grow on purpose.

import {isVirtualComponentKey} from '../../config/shelly.dataTypes';
import type {EventRow, NumericRow} from '../sensorCapture';

/** Canonical unit per stored kind. One unit per kind, always. */
export const CANONICAL_KINDS: Readonly<Record<string, string>> = {
    temperature: '°C',
    humidity: '%',
    // Water carries its own kinds rather than sharing `temperature` and
    // `pressure` with the air ones. The medium is part of a reading's identity,
    // the way OBIS puts it in value group A: 6180 hPa of mains water and 1013
    // hPa of atmosphere are not the same measurement, and a comfort report that
    // averages pipe temperature into room temperature is simply wrong.
    water_temperature: '°C',
    water_pressure: 'hPa',
    flow: 'm³/h',
    pressure: 'hPa',
    illuminance: 'lx',
    moisture: '%'
};

// Longest key must stay inside device_sensor.numeric_15min.kind VARCHAR(24).
const MAX_KIND_LENGTH = 24;

/**
 * Roles this build understands, and the kind each one is stored as. Free text
 * on the wire, so an unlisted role is never guessed: guessing produces a
 * confident wrong label, and a wrong label cannot be separated back out once a
 * 15-minute bucket has merged it.
 *
 */
interface RoleDefinition {
    /** Storage identity, including the medium. Water and air do not share one. */
    kind: string;
    /**
     * Physical quantity, which is what decides unit conversion. Water pressure
     * and air pressure are stored apart but convert identically, so the two
     * concerns are named separately instead of one standing in for the other.
     */
    quantity: 'temperature' | 'pressure' | 'flow' | 'humidity' | 'moisture';
    /**
     * Unit the device REPORTS this role in, fixed by the role contract.
     *
     * Deliberately not read from the Service config. `temp_unit`, `pressure_unit`
     * and `volume_unit` there are display preferences for the app and the alarm
     * thresholds, not the wire unit: the captured valve reports pressure against
     * a declared 0..1350 range, which is the documented kPa range, while its
     * pressure_unit says PSI. Trusting that field converted a real 89.6 kPa into
     * 6180 hPa. The role is the contract, so the role carries the unit.
     */
    unit: string;
    /** Optional canonical Operations history tag for this same reading. */
    operationalTag?: 'volume_flow_m3h';
}

const KNOWN_ROLES: Readonly<Record<string, RoleDefinition>> = {
    water_temperature: {
        kind: 'water_temperature',
        quantity: 'temperature',
        unit: 'c'
    },
    water_pressure: {
        kind: 'water_pressure',
        quantity: 'pressure',
        unit: 'kpa'
    },
    // Reported per minute against a declared 0..0.075 range.
    flow_rate: {
        kind: 'flow',
        quantity: 'flow',
        unit: 'm3',
        operationalTag: 'volume_flow_m3h'
    },
    current_temperature: {
        kind: 'temperature',
        quantity: 'temperature',
        unit: 'c'
    },
    current_humidity: {kind: 'humidity', quantity: 'humidity', unit: '%'},
    soil_moisture: {kind: 'moisture', quantity: 'moisture', unit: '%'}
};

/**
 * Multiplicative conversions into each kind's canonical unit. Temperature is
 * absent on purpose: Fahrenheit needs an offset, so it is handled separately
 * rather than bent into a factor.
 */
const UNIT_FACTORS: Readonly<Record<string, Readonly<Record<string, number>>>> =
    {
        pressure: {kpa: 10, hpa: 1, mbar: 1, bar: 1000, psi: 68.9476},
        // Flow arrives per minute, so each factor is "that volume per minute,
        // expressed in m³/h".
        flow: {
            m3: 60,
            'm³': 60,
            l: 0.06,
            lit: 0.06,
            liter: 0.06,
            litre: 0.06,
            gal: 0.2271247,
            gallon: 0.2271247
        },
        humidity: {'%': 1, pct: 1},
        moisture: {'%': 1, pct: 1},
        illuminance: {lx: 1, lux: 1}
    };

const CELSIUS_UNITS = new Set(['c', '°c', 'celsius']);
const FAHRENHEIT_UNITS = new Set(['f', '°f', 'fahrenheit']);

export interface VirtualComponentReading {
    /** Component key as it arrives on the wire, e.g. `number:201`. */
    componentKey: string;
    /** Leaf inside the component, e.g. `value`. */
    field: string;
    /** Role declared in the device config `_attrs` block. */
    role: string | undefined;
    /** Access declared in the device config, e.g. `cr` or `crw`. */
    access: string | undefined;
    value: number;
}

export interface ClassifiedVirtualReading {
    kind: string;
    /** Virtual component id, used as the sensor channel. */
    channel: number;
    /** Value converted into the kind's canonical unit. */
    value: number;
    operationalTag?: 'volume_flow_m3h';
}

/** Why a reading was not stored. Reported so the vocabulary grows on purpose. */
export type VirtualRejectReason =
    | 'not_virtual_number'
    | 'not_value_leaf'
    | 'writable'
    | 'unknown_role'
    | 'unknown_unit';

export type VirtualClassification =
    | {stored: true; reading: ClassifiedVirtualReading}
    | {stored: false; reason: VirtualRejectReason; role: string | undefined};

/**
 * A component the device lets anyone write is a setpoint or a control, not a
 * measurement. Storing a target next to a reading of the same kind lets a
 * 22 °C setpoint be averaged into room temperature, and the 15-minute bucket
 * merges them beyond recovery.
 */
function isReadOnly(access: string | undefined): boolean {
    return typeof access === 'string' && !access.includes('w');
}

function componentIdOf(componentKey: string): number | null {
    const id = Number(componentKey.slice(componentKey.indexOf(':') + 1));
    return Number.isInteger(id) ? id : null;
}

function convertTemperature(value: number, unit: string): number | null {
    if (CELSIUS_UNITS.has(unit)) return value;
    if (FAHRENHEIT_UNITS.has(unit)) return ((value - 32) * 5) / 9;
    return null;
}

function convert(
    quantity: RoleDefinition['quantity'],
    value: number,
    unit: string
): number | null {
    if (quantity === 'temperature') return convertTemperature(value, unit);
    const factor = UNIT_FACTORS[quantity]?.[unit];
    return factor === undefined ? null : value * factor;
}

export function classifyVirtualComponent(
    input: VirtualComponentReading
): VirtualClassification {
    const reject = (reason: VirtualRejectReason): VirtualClassification => ({
        stored: false,
        reason,
        role: input.role
    });

    if (!isVirtualComponentKey(input.componentKey)) {
        return reject('not_virtual_number');
    }
    if (!input.componentKey.startsWith('number:')) {
        return reject('not_virtual_number');
    }
    // Only the component's own scalar. `source` is bookkeeping, and a nested
    // path belongs to an object component with its own definition.
    if (input.field !== 'value') return reject('not_value_leaf');
    if (!isReadOnly(input.access)) return reject('writable');

    const definition = input.role ? KNOWN_ROLES[input.role] : undefined;
    if (!definition) return reject('unknown_role');

    const channel = componentIdOf(input.componentKey);
    if (channel === null) return reject('not_virtual_number');

    const value = convert(definition.quantity, input.value, definition.unit);
    if (value === null) return reject('unknown_unit');
    return {
        stored: true,
        reading: {
            kind: definition.kind,
            channel,
            value,
            ...(definition.operationalTag
                ? {operationalTag: definition.operationalTag}
                : {})
        }
    };
}

/** One persisted status field, as the status batch carries it. */
export interface VirtualStatusEntry {
    deviceListId: number;
    /** Flattened key, e.g. `number:201.value`. */
    field: string;
    value: unknown;
    /** Prior value of the same field, needed to age a cumulative counter. */
    previousValue?: unknown;
    /** Reading time in epoch seconds. */
    ts: number;
}

/** What the device config says about one virtual component. */
export interface VirtualComponentConfig {
    role?: string;
    access?: string;
    unit?: string;
    /** Every role the same device declares. Disambiguates a generic role. */
    siblingRoles?: readonly string[];
}

/**
 * Looks up a component's declared meaning. Injected rather than imported so the
 * mapping below stays pure and testable without a live device.
 */
export type VirtualConfigResolver = (
    deviceListId: number,
    componentKey: string
) => VirtualComponentConfig | undefined;

/** A cumulative meter reading, ready for the energy pipeline. */
export interface VirtualCounterRow {
    deviceId: number;
    tag: 'volume_l' | 'volume_m3';
    channel: number;
    ts: number;
    /** Running total, in the tag's unit. The caller ages it into a delta. */
    total: number;
    previousTotal: number | undefined;
}

export interface VirtualCaptureResult {
    rows: NumericRow[];
    events: EventRow[];
    counters: VirtualCounterRow[];
    operationalMetrics: VirtualOperationalMetricRow[];
    /** Counts per reason, so an unlisted role is visible instead of silent. */
    rejected: Map<VirtualRejectReason, number>;
}

export interface VirtualOperationalMetricRow {
    deviceId: number;
    tag: 'volume_flow_m3h';
    channel: number;
    ts: number;
    value: number;
}

function splitField(
    field: string
): {componentKey: string; leaf: string} | null {
    const dot = field.indexOf('.');
    if (dot <= 0 || dot === field.length - 1) return null;
    return {
        componentKey: field.slice(0, dot),
        leaf: field.slice(dot + 1)
    };
}

/**
 * Turns persisted status fields into sensor rows. Only readings that clear
 * `classifyVirtualComponent` become rows; everything else is counted so the
 * known-role list can grow from evidence rather than guesswork.
 */
export function virtualNumericRows(
    entries: readonly VirtualStatusEntry[],
    resolve: VirtualConfigResolver
): VirtualCaptureResult {
    const rows: NumericRow[] = [];
    const events: EventRow[] = [];
    const counters: VirtualCounterRow[] = [];
    const operationalMetrics: VirtualOperationalMetricRow[] = [];
    const rejected = new Map<VirtualRejectReason, number>();
    const note = (reason: VirtualRejectReason) =>
        rejected.set(reason, (rejected.get(reason) ?? 0) + 1);

    for (const entry of entries) {
        const split = splitField(entry.field);
        if (!split || !isVirtualComponentKey(split.componentKey)) continue;
        const config = resolve(entry.deviceListId, split.componentKey);
        const shared = {
            componentKey: split.componentKey,
            field: split.leaf,
            role: config?.role
        };

        if (typeof entry.value === 'boolean') {
            const state = classifyVirtualBoolean({
                ...shared,
                siblingRoles: config?.siblingRoles ?? [],
                value: entry.value
            });
            if (state.stored) {
                events.push({
                    device: entry.deviceListId,
                    source: 'virtual',
                    kind: state.kind,
                    channel: state.channel,
                    ts: entry.ts,
                    state: state.state
                });
            }
            continue;
        }

        if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
            continue;
        }

        const counter = classifyVirtualCounter({...shared, value: entry.value});
        if (counter.stored) {
            counters.push({
                deviceId: entry.deviceListId,
                tag: counter.tag,
                channel: counter.channel,
                ts: entry.ts,
                total: counter.value,
                previousTotal:
                    typeof entry.previousValue === 'number'
                        ? entry.previousValue
                        : undefined
            });
            continue;
        }

        const result = classifyVirtualComponent({
            ...shared,
            access: config?.access,
            value: entry.value
        });
        if (!result.stored) {
            note(result.reason);
            continue;
        }
        rows.push({
            device: entry.deviceListId,
            source: 'virtual',
            kind: result.reading.kind,
            channel: result.reading.channel,
            ts: entry.ts,
            val: result.reading.value
        });
        if (result.reading.operationalTag) {
            operationalMetrics.push({
                deviceId: entry.deviceListId,
                tag: result.reading.operationalTag,
                channel: result.reading.channel,
                ts: entry.ts,
                value: result.reading.value
            });
        }
    }
    return {rows, events, counters, operationalMetrics, rejected};
}

// ── Discrete state: valve open/close ──
//
// A boolean role is only recorded when this build can say what it means. `state`
// alone cannot: it is a valve on one device and a fan enable on the next. So it
// is resolved from the device's OWN declared roles. A device that also exposes
// water_consumption or flow_rate is a water valve, and that is evidence the
// device published, not a guess about its name.

const WATER_EVIDENCE_ROLES = [
    'water_consumption',
    'flow_rate',
    'water_pressure'
];

/** Event kinds this build stores, all inside events.kind VARCHAR(24). */
export const CANONICAL_EVENT_KINDS = ['valve'] as const;

/** `zone0`, `zone3` — one watering circuit on an irrigation controller. */
const ZONE_ROLE = /^zone\d+$/;

export interface VirtualBooleanReading {
    componentKey: string;
    field: string;
    role: string | undefined;
    /** Every role the same device declares, used to disambiguate `state`. */
    siblingRoles: readonly string[];
    value: boolean;
}

export type VirtualEventClassification =
    | {stored: true; kind: string; channel: number; state: number}
    | {stored: false; reason: VirtualRejectReason; role: string | undefined};

export function classifyVirtualBoolean(
    input: VirtualBooleanReading
): VirtualEventClassification {
    const reject = (
        reason: VirtualRejectReason
    ): VirtualEventClassification => ({
        stored: false,
        reason,
        role: input.role
    });
    if (!input.componentKey.startsWith('boolean:')) {
        return reject('not_virtual_number');
    }
    if (!isVirtualComponentKey(input.componentKey)) {
        return reject('not_virtual_number');
    }
    if (input.field !== 'value') return reject('not_value_leaf');
    // A zone IS a valve, and says so. That is stronger evidence than the
    // generic `state` inference below, which has to look at sibling roles to
    // decide whether a boolean is about water at all. An irrigation controller
    // carries no flow meter of its own — the meter is on the mains — so
    // without this its runs were never recorded, and every zone read "did not
    // run" however faithfully it had watered.
    const isZone = input.role !== undefined && ZONE_ROLE.test(input.role);
    if (!isZone) {
        if (input.role !== 'state') return reject('unknown_role');
        const isWaterDevice = input.siblingRoles.some((role) =>
            WATER_EVIDENCE_ROLES.includes(role)
        );
        if (!isWaterDevice) return reject('unknown_role');
    }
    const channel = componentIdOf(input.componentKey);
    if (channel === null) return reject('not_virtual_number');
    // A valve is writable by design. Unlike an averaged reading, a discrete
    // state change carries no risk of contaminating an aggregate, so being
    // commandable is not a reason to drop it.
    return {stored: true, kind: 'valve', channel, state: input.value ? 1 : 0};
}

// ── Cumulative volume: the water meter ──
//
// A running total that the device can reset. That is the shape the energy
// pipeline already solves, and `volume_l` / `volume_m3` are already tags it
// treats as cumulative, so the meter belongs there rather than in a rollup that
// averages. The tag is chosen from the declared role and the service's volume
// unit, which is stronger evidence than name-matching a component label.

// The meter reports cubic metres, fixed by the role contract. volume_unit on the
// service is a display preference, so it is not consulted: reading it here would
// scale a total against an unscaled previous total and book a phantom delta.
const WATER_COUNTER_TAG = 'volume_m3' as const;

/** Leaf inside the water meter's object component holding the running total. */
const WATER_COUNTER_LEAF = 'value.counter.total';

export interface VirtualCounterReading {
    componentKey: string;
    field: string;
    role: string | undefined;
    value: number;
}

export type VirtualCounterClassification =
    | {
          stored: true;
          tag: 'volume_l' | 'volume_m3';
          channel: number;
          value: number;
      }
    | {stored: false; reason: VirtualRejectReason; role: string | undefined};

export function classifyVirtualCounter(
    input: VirtualCounterReading
): VirtualCounterClassification {
    const reject = (
        reason: VirtualRejectReason
    ): VirtualCounterClassification => ({
        stored: false,
        reason,
        role: input.role
    });
    if (!input.componentKey.startsWith('object:')) {
        return reject('not_virtual_number');
    }
    if (!isVirtualComponentKey(input.componentKey)) {
        return reject('not_virtual_number');
    }
    if (input.field !== WATER_COUNTER_LEAF) return reject('not_value_leaf');
    if (input.role !== 'water_consumption') return reject('unknown_role');
    const channel = componentIdOf(input.componentKey);
    if (channel === null) return reject('not_virtual_number');
    return {stored: true, tag: WATER_COUNTER_TAG, channel, value: input.value};
}

/** Guard so a vocabulary edit can never outgrow the storage column. */
export function assertKindsFitStorage(): void {
    for (const kind of CANONICAL_EVENT_KINDS) {
        if (kind.length > MAX_KIND_LENGTH) {
            throw new Error(
                `event kind '${kind}' exceeds device_sensor.events.kind VARCHAR(${MAX_KIND_LENGTH})`
            );
        }
    }
    for (const kind of Object.keys(CANONICAL_KINDS)) {
        if (kind.length > MAX_KIND_LENGTH) {
            throw new Error(
                `sensor kind '${kind}' exceeds device_sensor.numeric_15min.kind VARCHAR(${MAX_KIND_LENGTH})`
            );
        }
    }
}
