// Canonical energy/power classifier. One function maps any incoming
// (component, field, value) into the storage primitive (tag, domain).
// Five-tier cascade documented at docs/architecture/energy-storage-reference.md
// section 5.1.
//   Tier 2 (native registry) — classify()
//   Tier 3 (BTHome spec)     — classifyBTHomeComponent()
//   Tier 4 (VC heuristic)    — classifyVirtualComponent()
//   Tiers 1 and 5 land in later PRs.

import {NON_COMPONENT_KEYS} from '../model/deviceStatusKeys';
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
    | 'thermal_energy_kwh';

export type EnergyDomain =
    | 'ac_mains'
    | 'dc_pv'
    | 'dc_battery'
    | 'dc_bus'
    | 'thermal'
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
    'thermal_energy_kwh'
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
}

// Field map for AC-mains PM/EM components — switch / pm1 / cover / em /
// em1 / light / rgb / rgbw / cct / rgbcct all share the same fields.
// PM1 emits aprtpower (no underscore); EM/EM1 emit aprt_power.
const AC_MAINS_FIELDS: Record<string, FieldEntry> = {
    current: {tag: 'current'},
    voltage: {tag: 'voltage'},
    apower: {tag: 'power'},
    act_power: {tag: 'power'},
    aprt_power: {tag: 'apparent_power'},
    aprtpower: {tag: 'apparent_power'},
    pf: {tag: 'power_factor'},
    freq: {tag: 'frequency'},
    total_act_power: {tag: 'total_power'},
    total_aprt_power: {tag: 'total_apparent_power'},
    total_current: {tag: 'total_current'},
    n_current: {tag: 'neutral_current'},
    'aenergy.total': {tag: 'total_act_energy'},
    'ret_aenergy.total': {tag: 'total_act_ret_energy'}
};

// Voltmeter emits a bare numeric voltage with no inherent domain — could
// be AC line on a Pro CB or DC analog on a Pill running a script.
// Stored with domain=unspecified so dashboards filtering ac_mains don't
// accidentally mix it in; operator declares the real domain in PR 5.
const VOLTMETER_FIELDS: Record<string, FieldEntry> = {
    voltage: {tag: 'voltage'}
};

const COMPONENT_REGISTRY: Record<string, ComponentEntry> = {
    switch: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    pm1: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    cover: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    em: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    em1: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    light: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    rgb: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    rgbw: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    cct: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    rgbcct: {domain: 'ac_mains', fields: AC_MAINS_FIELDS},
    voltmeter: {domain: 'unspecified', fields: VOLTMETER_FIELDS}
};

export interface ClassifyInput {
    componentKey: string;
    fieldName: string;
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
    if (!fieldEntry) return null;

    return {
        tag: fieldEntry.tag,
        domain: entry.domain,
        classifierSource: 'native_registry',
        isDelta: DELTA_TAGS.has(fieldEntry.tag),
        phase,
        scale: 1
    };
}

// Tier 3 — BTHome spec table. config is the bthomesensor:N entry from
// Shelly.GetConfig (carries the BTHome obj_id this sensor represents).
export function classifyBTHomeComponent(
    config: {obj_id?: unknown} | null | undefined
): ClassificationResult | null {
    if (!config || typeof config.obj_id !== 'number') return null;
    const spec = lookupBTHomeEnergy(config.obj_id);
    if (!spec) return null;
    return {
        tag: spec.tag,
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
