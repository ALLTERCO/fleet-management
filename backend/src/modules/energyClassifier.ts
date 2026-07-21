// Canonical energy/power classifier. One function maps any incoming
// (component, field, value) into the storage primitive (tag, domain).
// Five-tier cascade documented at docs/architecture/energy-storage-reference.md
// section 5.1.
//   Tier 2 (native registry) — classify()
//   Tier 3 (BTHome spec)     — classifyBTHomeComponent()
//   Tier 4 (VC heuristic)    — classifyVirtualComponent()
//   Tiers 1 and 5 land in later PRs.

import {NON_COMPONENT_KEYS} from '../model/deviceStatusKeys';
import {
    AC_ACTIVE_POWER_COMPONENTS,
    AC_MIN_VOLTAGE_DEFAULT,
    CONSUMED_ENERGY_PATH,
    RETURNED_ENERGY_PATH,
    SINGLE_ACTIVE_POWER_FIELDS,
    SINGLE_CURRENT_FIELD,
    SINGLE_VOLTAGE_FIELD,
    TOTAL_ACTIVE_POWER_FIELD
} from '../types/api/componentPower';
import {lookupBTHomeEnergy} from './bthomeSpec';
import {classifyVcConfig} from './vcHeuristic';

// Tag names match what's currently written to device_em.stats by the
// legacy regex path — renaming requires a backfill migration of every
// existing row. Closed enum.
export type EnergyTag =
    | 'power'
    | 'apparent_power'
    | 'reactive_power'
    | 'voltage'
    | 'current'
    | 'frequency'
    | 'power_factor'
    | 'total_power'
    | 'total_apparent_power'
    | 'total_current'
    | 'neutral_current'
    | 'total_act_energy'
    | 'total_act_ret_energy'
    | 'percentage'
    | 'temperature_c'
    | 'temperature_f'
    | 'volume_l'
    | 'volume_m3'
    | 'volume_storage_l'
    | 'volume_flow_m3h'
    | 'thermal_energy_kwh'
    // Battery-monitor (bm) telemetry — all domain dc_battery. soc/soh are %,
    // cycles a count, charge_ah/discharge_ah cumulative Amp-hour counters.
    | 'soc'
    | 'soh'
    | 'cycles'
    | 'charge_ah'
    | 'discharge_ah';

export type EnergyDomain =
    | 'ac_mains'
    | 'dc_pv'
    | 'dc_battery'
    | 'dc_bus'
    | 'thermal'
    | 'gas'
    | 'unspecified';

export type ClassifierSource =
    | 'table'
    | 'native_registry'
    | 'bthome'
    | 'heuristic';

// Single source of truth for which tags are cumulative counters
// (stored as deltas). Adding a new delta tag to EnergyTag must
// also add it here, or override-tier classification will store
// the cumulative reading as an instantaneous value.
export const DELTA_TAGS: ReadonlySet<EnergyTag> = new Set([
    'total_act_energy',
    'total_act_ret_energy',
    'volume_l',
    'volume_m3',
    'thermal_energy_kwh',
    // bm charge/discharge are cumulative Amp-hour counters.
    'charge_ah',
    'discharge_ah'
]);

export interface ClassificationResult {
    tag: EnergyTag;
    domain: EnergyDomain;
    classifierSource: ClassifierSource;
    isDelta: boolean;
    phase: 'a' | 'b' | 'c' | 'z';
    // Set only when the classifier wants to override the channel
    // derived from the componentKey suffix. Tier 1 operator overrides
    // use it to remap (voltmeter:0 → logical channel 2); other tiers
    // leave it undefined and the wrapper parses componentKey.
    channel?: number;
    // Multiplier from device-emitted unit to storage unit. 1 means
    // pass-through — tier 2 is always 1; tier 3/4 may scale (kW → W).
    scale: number;
}

// Delta-ness is a property of the tag, derived from DELTA_TAGS — not stored
// per field, so there is one home for it.
interface FieldEntry {
    tag: EnergyTag;
}

interface ComponentEntry {
    domain: EnergyDomain;
    fields: Record<string, FieldEntry>;
    // Optional matcher for dynamic per-instance sub-keys whose index the static
    // `fields` map cannot enumerate (e.g. bm per-cell batteries.B<N>.*). Runs
    // only when the static lookup misses. Returns the tag + the channel to
    // stamp on the row (the cell index).
    dynamicField?: (baseField: string) => DynamicFieldMatch | null;
}

interface DynamicFieldMatch {
    tag: EnergyTag;
    channel: number;
}

// Field map for AC-mains PM/EM components — every component in
// AC_ACTIVE_POWER_COMPONENTS shares this shape. Field names come from the one
// home (componentPower.ts); only the apparent/pf/freq names, used nowhere else,
// stay literal here. PM1 emits aprtpower (no underscore); EM/EM1 emit aprt_power.
const [APOWER_FIELD, ACT_POWER_FIELD] = SINGLE_ACTIVE_POWER_FIELDS;
const AC_MAINS_FIELDS: Record<string, FieldEntry> = {
    [SINGLE_CURRENT_FIELD]: {tag: 'current'},
    [SINGLE_VOLTAGE_FIELD]: {tag: 'voltage'},
    [APOWER_FIELD]: {tag: 'power'},
    [ACT_POWER_FIELD]: {tag: 'power'},
    aprt_power: {tag: 'apparent_power'},
    aprtpower: {tag: 'apparent_power'},
    pf: {tag: 'power_factor'},
    freq: {tag: 'frequency'},
    [TOTAL_ACTIVE_POWER_FIELD]: {tag: 'total_power'},
    total_aprt_power: {tag: 'total_apparent_power'},
    total_current: {tag: 'total_current'},
    n_current: {tag: 'neutral_current'},
    [CONSUMED_ENERGY_PATH]: {tag: 'total_act_energy'},
    [RETURNED_ENERGY_PATH]: {tag: 'total_act_ret_energy'}
};

// Voltmeter emits a bare numeric voltage with no inherent domain — could
// be AC line on a Pro CB or DC analog on a Pill running a script.
// Stored with domain=unspecified so dashboards filtering ac_mains don't
// accidentally mix it in; operator declares the real domain in PR 5.
const VOLTMETER_FIELDS: Record<string, FieldEntry> = {
    voltage: {tag: 'voltage'}
};

// Battery monitor (PowerTrack 500) — DC by identity, no freq/apower. Its power
// field is `power` (W); voltage is the pack total (<=70 V). energy_ch/disch are
// cumulative Amp-hour counters (charge_ah/discharge_ah delta tags) — stored in
// their native Ah, never folded into the Wh energy total. soc/soh are %, cycles
// a count. remaining_time and errors are not energy quantities and stay unmapped.
const BM_FIELDS: Record<string, FieldEntry> = {
    power: {tag: 'power'},
    voltage: {tag: 'voltage'},
    current: {tag: 'current'},
    soc: {tag: 'soc'},
    soh: {tag: 'soh'},
    cycles: {tag: 'cycles'},
    'energy_ch.total': {tag: 'charge_ah'},
    'energy_disch.total': {tag: 'discharge_ah'}
};

// Per-cell readings from BM.GetStatus `batteries: {B1: {voltage, tC}, ...}`
// flatten to bm:0.batteries.B<N>.(voltage|tC). Cell keys are dynamic (B1..BN),
// so match a pattern and carry the cell index in the row channel.
const BM_CELL_PATTERN = /^batteries\.B(\d+)\.(voltage|tC)$/;
const BM_CELL_TAGS: Readonly<Record<string, EnergyTag>> = {
    voltage: 'voltage',
    tC: 'temperature_c'
};

function matchBmCell(baseField: string): DynamicFieldMatch | null {
    const m = BM_CELL_PATTERN.exec(baseField);
    if (!m) return null;
    return {tag: BM_CELL_TAGS[m[2]], channel: Number.parseInt(m[1], 10)};
}

const COMPONENT_REGISTRY: Record<string, ComponentEntry> = {
    // Every AC-mains power component shares one shape — derived from the one
    // home (AC_ACTIVE_POWER_COMPONENTS) so a new metered component type is
    // added in a single place. Voltmeter is voltage-only, its own domain.
    ...Object.fromEntries(
        AC_ACTIVE_POWER_COMPONENTS.map((prefix): [string, ComponentEntry] => [
            prefix,
            {domain: 'ac_mains', fields: AC_MAINS_FIELDS}
        ])
    ),
    voltmeter: {domain: 'unspecified', fields: VOLTMETER_FIELDS},
    bm: {
        domain: 'dc_battery',
        fields: BM_FIELDS,
        dynamicField: matchBmCell
    }
};

// Components whose domain is decided from the reading, not fixed. em/em1 are
// dedicated grid meters (always AC); voltmeter can read a raw PV string so it
// stays operator-set; bm is DC. Everything else that meters power can be AC
// (mains switch/dimmer/bulb) or DC (LED strip, Pro RGBWW PM, a DC-fed 1PM).
const DOMAIN_DETECTION_COMPONENTS: ReadonlySet<string> = new Set(
    AC_ACTIVE_POWER_COMPONENTS.filter((c) => c !== 'em' && c !== 'em1')
);

// The component's own latest freq (Hz) and voltage (V), from merged status so a
// partial frame that omits them still resolves.
export interface DomainSignals {
    freq?: number;
    voltage?: number;
}

// AC vs DC from the reading. Frequency is the only sure signal — DC has none at
// any voltage. No freq + a low voltage = DC; mains-level/absent voltage keeps
// the AC default. High-voltage DC (PV) rides voltmeter, not these components.
export function detectElectricalDomain(input: {
    signals: DomainSignals;
    defaultDomain: EnergyDomain;
    acMinVoltage: number;
}): EnergyDomain {
    const {freq, voltage} = input.signals;
    if (typeof freq === 'number' && freq > 0) return 'ac_mains';
    if (typeof voltage === 'number' && voltage < input.acMinVoltage) {
        return 'dc_bus';
    }
    return input.defaultDomain;
}

// True when a component's domain is read-derived (so capture resolves signals).
export function componentUsesDomainDetection(componentKey: string): boolean {
    const type = extractComponentType(componentKey);
    return type !== null && DOMAIN_DETECTION_COMPONENTS.has(type);
}

// A dc_* domain on a point reporting a real AC frequency is physically
// impossible — DC does not alternate at any voltage — so it is almost certainly
// a misclassification worth flagging for review.
export function domainContradictsSignals(
    domain: string,
    signals: DomainSignals
): boolean {
    return (
        domain.startsWith('dc_') &&
        typeof signals.freq === 'number' &&
        signals.freq > 0
    );
}

export interface ClassifyInput {
    componentKey: string;
    fieldName: string;
    // Present only for DOMAIN_DETECTION_COMPONENTS; absent → registry default.
    signals?: DomainSignals;
    acMinVoltage?: number;
}

// Tier 1 — operator override. Highest priority; bypasses everything
// else. Caller (energyCapture) passes the resolved override or null;
// this function is the canonical adapter into ClassificationResult so
// every tier returns the same shape.
export function classifyFromOverride(
    override: {tag: string; domain: string; channel: number},
    fieldName: string
): ClassificationResult {
    const {phase, baseField: _} = extractPhasePrefix(fieldName);
    return {
        tag: override.tag as ClassificationResult['tag'],
        domain: override.domain as ClassificationResult['domain'],
        classifierSource: 'table',
        // Operator overrides are stored as the final tag; delta-ness
        // is a property of the tag, looked up in the canonical
        // DELTA_TAGS set so adding a new delta tag updates one place.
        isDelta: DELTA_TAGS.has(override.tag as ClassificationResult['tag']),
        phase,
        channel: override.channel,
        scale: 1
    };
}

export function classify(input: ClassifyInput): ClassificationResult | null {
    const componentType = extractComponentType(input.componentKey);
    if (!componentType) return null;
    if (NON_COMPONENT_KEYS.has(componentType)) return null;

    const entry = COMPONENT_REGISTRY[componentType];
    if (!entry) return null;

    const {phase, baseField} = extractPhasePrefix(input.fieldName);
    const fieldEntry = entry.fields[baseField];
    if (fieldEntry) {
        return {
            tag: fieldEntry.tag,
            domain: resolveDomain(componentType, entry.domain, input),
            classifierSource: 'native_registry',
            isDelta: DELTA_TAGS.has(fieldEntry.tag),
            phase,
            scale: 1
        };
    }

    // Dynamic per-instance sub-keys (bm per-cell) carry the index in the row
    // channel — the static field map can't enumerate them.
    const dynamic = entry.dynamicField?.(baseField);
    if (dynamic) {
        return {
            tag: dynamic.tag,
            domain: resolveDomain(componentType, entry.domain, input),
            classifierSource: 'native_registry',
            isDelta: DELTA_TAGS.has(dynamic.tag),
            phase,
            channel: dynamic.channel,
            scale: 1
        };
    }

    return null;
}

// Registry domain for fixed components; read-derived (AC/DC) for the rest.
function resolveDomain(
    componentType: string,
    defaultDomain: EnergyDomain,
    input: ClassifyInput
): EnergyDomain {
    if (!DOMAIN_DETECTION_COMPONENTS.has(componentType) || !input.signals) {
        return defaultDomain;
    }
    return detectElectricalDomain({
        signals: input.signals,
        defaultDomain,
        acMinVoltage: input.acMinVoltage ?? AC_MIN_VOLTAGE_DEFAULT
    });
}

// Tier 3 — BTHome spec table. config is the bthomesensor:N entry from
// Shelly.GetConfig (carries the BTHome obj_id this sensor represents).
export function classifyBTHomeComponent(
    config: {obj_id?: unknown; idx?: unknown} | null | undefined
): ClassificationResult | null {
    if (!config || typeof config.obj_id !== 'number') return null;
    const spec = lookupBTHomeEnergy(config.obj_id);
    if (!spec) return null;
    // Second instance (idx >= 1) of an energy object is the returned reading
    // (BLU MCB sends obj 0x4D twice: consumed then returned).
    const idx = typeof config.idx === 'number' ? config.idx : 0;
    const tag = spec.retTag && idx >= 1 ? spec.retTag : spec.tag;
    return {
        tag,
        domain: spec.domain,
        classifierSource: 'bthome',
        isDelta: spec.isDelta,
        phase: 'z',
        scale: spec.scale
    };
}

// Tier 4 — virtual-component heuristic. config is the number:N /
// boolean:N / enum:N / text:N entry from Shelly.GetConfig; we read
// .name (free-text operator hint) and .meta.ui.unit (script-author
// hint).
export function classifyVirtualComponent(
    config: {name?: unknown; meta?: {ui?: {unit?: unknown}}} | null | undefined
): ClassificationResult | null {
    if (!config) return null;
    const name = typeof config.name === 'string' ? config.name : undefined;
    const unit =
        typeof config.meta?.ui?.unit === 'string'
            ? config.meta.ui.unit
            : undefined;
    const result = classifyVcConfig({name, unit});
    if (!result) return null;
    return {
        tag: result.tag,
        domain: result.domain,
        classifierSource: 'heuristic',
        isDelta: result.isDelta,
        phase: 'z',
        scale: result.scale
    };
}

export function extractComponentType(componentKey: string): string | null {
    const colon = componentKey.indexOf(':');
    if (colon <= 0) return null;
    return componentKey.slice(0, colon);
}

// One home for the (component type -> config-dependent classifier) mapping.
// Tier 3/4 components carry their meaning in config, not the field name, so
// they classify only the `value` field. Capture and the measurement-point
// enumerator both dispatch through here so the set never drifts.
export const CONFIG_DEPENDENT_CLASSIFIERS: Readonly<
    Record<string, (cfg: unknown) => ClassificationResult | null>
> = {
    bthomesensor: (cfg) => classifyBTHomeComponent(cfg as {obj_id?: unknown}),
    number: (cfg) =>
        classifyVirtualComponent(
            cfg as {name?: unknown; meta?: {ui?: {unit?: unknown}}}
        ),
    boolean: (cfg) =>
        classifyVirtualComponent(
            cfg as {name?: unknown; meta?: {ui?: {unit?: unknown}}}
        ),
    enum: (cfg) =>
        classifyVirtualComponent(
            cfg as {name?: unknown; meta?: {ui?: {unit?: unknown}}}
        ),
    text: (cfg) =>
        classifyVirtualComponent(
            cfg as {name?: unknown; meta?: {ui?: {unit?: unknown}}}
        )
};

// Returns the config-dependent classifier for a component, or null when the
// (componentKey, fieldName) pair isn't eligible for that tier. Tier 3/4 only
// classify the `value` field of bthomesensor/number/boolean/enum/text.
export function pickConfigClassifier(
    componentKey: string,
    fieldName: string
): ((cfg: unknown) => ClassificationResult | null) | null {
    if (fieldName !== 'value') return null;
    const componentType = extractComponentType(componentKey);
    if (!componentType) return null;
    return CONFIG_DEPENDENT_CLASSIFIERS[componentType] ?? null;
}

// Classify one observed (componentKey, fieldName) from a device snapshot:
// native tier first, then the config-dependent tier (BTHome / virtual) for
// `value` fields when the component config is supplied. Operator overrides
// are deliberately NOT applied here — the enumerator shows auto facts; a
// caller that wants effective overrides injects them on top.
export function classifyObservedField(input: {
    componentKey: string;
    fieldName: string;
    config?: unknown;
}): ClassificationResult | null {
    const native = classify({
        componentKey: input.componentKey,
        fieldName: input.fieldName
    });
    if (native) return native;
    const classifierFn = pickConfigClassifier(
        input.componentKey,
        input.fieldName
    );
    if (!classifierFn || input.config == null) return null;
    return classifierFn(input.config);
}

function extractPhasePrefix(fieldName: string): {
    phase: 'a' | 'b' | 'c' | 'z';
    baseField: string;
} {
    // Per-phase fields look like a_voltage / b_act_power / c_pf.
    if (fieldName.length >= 2 && fieldName[1] === '_') {
        const prefix = fieldName[0];
        if (prefix === 'a' || prefix === 'b' || prefix === 'c') {
            return {phase: prefix, baseField: fieldName.slice(2)};
        }
    }
    return {phase: 'z', baseField: fieldName};
}
