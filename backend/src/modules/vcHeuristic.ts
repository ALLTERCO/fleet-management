// Tier 4 classifier — virtual components (number/boolean/enum/text)
// added by user scripts. Reads two operator-controlled hints from
// Shelly.GetConfig: meta.ui.unit and name. Unit picks the storage
// tag, name picks the domain via keyword regex.
//
// Worked examples for the real Allterco script library (Deye, Marstek,
// MarsRock, JK200, Victron) are in docs/architecture/
// energy-storage-reference.md section 5.4 — auto-classifies 28 of 31
// real virtual components with zero operator input.

import type {EnergyDomain, EnergyTag} from './energyClassifier';

export interface VcHeuristicInput {
    name: string | undefined;
    unit: string | undefined;
}

export interface VcHeuristicResult {
    tag: EnergyTag;
    domain: EnergyDomain;
    isDelta: boolean;
    scale: number;
}

// Unit string → storage tag + scale. Unrecognised units → null result
// (not an energy quantity). Scale converts the device-emitted unit to
// the canonical storage unit (e.g. kW → W = 1000).
const UNIT_TO_TAG: Readonly<
    Record<string, {tag: EnergyTag; isDelta: boolean; scale: number}>
> = {
    W: {tag: 'power', isDelta: false, scale: 1},
    kW: {tag: 'power', isDelta: false, scale: 1000},
    VA: {tag: 'apparent_power', isDelta: false, scale: 1},
    kVA: {tag: 'apparent_power', isDelta: false, scale: 1000},
    var: {tag: 'reactive_power', isDelta: false, scale: 1},
    kvar: {tag: 'reactive_power', isDelta: false, scale: 1000},
    V: {tag: 'voltage', isDelta: false, scale: 1},
    A: {tag: 'current', isDelta: false, scale: 1},
    mA: {tag: 'current', isDelta: false, scale: 0.001},
    Hz: {tag: 'frequency', isDelta: false, scale: 1},
    Wh: {tag: 'total_act_energy', isDelta: true, scale: 1},
    kWh: {tag: 'total_act_energy', isDelta: true, scale: 1000},
    L: {tag: 'volume_l', isDelta: true, scale: 1},
    l: {tag: 'volume_l', isDelta: true, scale: 1},
    mL: {tag: 'volume_l', isDelta: true, scale: 0.001},
    ml: {tag: 'volume_l', isDelta: true, scale: 0.001},
    m3: {tag: 'volume_m3', isDelta: true, scale: 1},
    'm³': {tag: 'volume_m3', isDelta: true, scale: 1},
    'm3/h': {tag: 'volume_flow_m3h', isDelta: false, scale: 1},
    'm³/h': {tag: 'volume_flow_m3h', isDelta: false, scale: 1},
    'm3/hr': {tag: 'volume_flow_m3h', isDelta: false, scale: 1},
    'm³/hr': {tag: 'volume_flow_m3h', isDelta: false, scale: 1},
    '%': {tag: 'percentage', isDelta: false, scale: 1},
    '°C': {tag: 'temperature_c', isDelta: false, scale: 1},
    '°F': {tag: 'temperature_f', isDelta: false, scale: 1}
};

// Battery health where the tag is in the name, not the unit (SoC/SoH share '%'
// with generic percentages; cycles has no unit). Always dc_battery.
const BATTERY_NAME_TAGS: ReadonlyArray<{re: RegExp; tag: EnergyTag}> = [
    {re: /state[\s_-]*of[\s_-]*charge|\bsoc\b/i, tag: 'soc'},
    {re: /state[\s_-]*of[\s_-]*health|\bsoh\b/i, tag: 'soh'},
    {re: /\bcycles\b|cycle[\s_-]*count/i, tag: 'cycles'}
];

// Ah cumulative counters. "Consumed Ah" is left out on purpose — it's a resetting
// gauge, not a monotonic total, so a delta tag would be garbage on reset.
function classifyAmpHours(name: string): VcHeuristicResult | null {
    if (/dischar/i.test(name)) return ampHourTag('discharge_ah');
    if (/charg/i.test(name)) return ampHourTag('charge_ah');
    return null;
}

function ampHourTag(tag: EnergyTag): VcHeuristicResult {
    return {tag, domain: 'dc_battery', isDelta: true, scale: 1};
}

// Battery telemetry the unit alone can't place. Runs before the unit path.
function classifyBatteryMetric(
    input: VcHeuristicInput
): VcHeuristicResult | null {
    const name = input.name;
    if (!name) return null;
    if (input.unit === 'Ah') {
        const ah = classifyAmpHours(name);
        if (ah) return ah;
    }
    for (const row of BATTERY_NAME_TAGS) {
        if (row.re.test(name)) {
            return {
                tag: row.tag,
                domain: 'dc_battery',
                isDelta: false,
                scale: 1
            };
        }
    }
    return null;
}

// Each row tested in order — first match wins. PV/solar comes before
// generic battery in case a script names a component "PV Battery
// Bank" (rare but real on hybrid inverters). No-match → unspecified
// so the operator must confirm via PR 5's UI.
const NAME_KEYWORDS: ReadonlyArray<{re: RegExp; domain: EnergyDomain}> = [
    {re: /pv|solar|panel|mppt|photovoltaic/i, domain: 'dc_pv'},
    {re: /batter|\bsoc\b|bms|bank|cell/i, domain: 'dc_battery'},
    {re: /grid|\bac\b|mains|\bl[123]\b/i, domain: 'ac_mains'},
    {re: /dc\s*bus|busbar/i, domain: 'dc_bus'},
    {
        re: /heat|thermal|district|hydronic|underfloor|boiler/i,
        domain: 'thermal'
    },
    // Gas vs water can't be read from a volume unit; the name is the only
    // signal. domain='gas' → fn_commodity_for maps it to commodity=gas.
    {
        re: /\bgas\b|methane|\bch4\b|propane|butane|\blpg\b|\blng\b/i,
        domain: 'gas'
    }
];

export function classifyVcConfig(
    input: VcHeuristicInput
): VcHeuristicResult | null {
    // Name-driven battery health first — the unit path would mislabel % and drop
    // cycles/Ah.
    const battery = classifyBatteryMetric(input);
    if (battery) return battery;
    if (!input.unit) return null;
    const mapping = UNIT_TO_TAG[input.unit];
    if (!mapping) return null;
    if (
        mapping.tag === 'total_act_energy' &&
        inferDomain(input.name) === 'thermal'
    ) {
        return {
            tag: 'thermal_energy_kwh',
            domain: 'thermal',
            isDelta: mapping.isDelta,
            scale: input.unit === 'Wh' ? 0.001 : 1
        };
    }
    if (mapping.tag === 'volume_l' && isStorageVolume(input.name)) {
        return {
            tag: 'volume_storage_l',
            domain: 'unspecified',
            isDelta: false,
            scale: mapping.scale
        };
    }
    return {
        tag: mapping.tag,
        domain: inferDomain(input.name),
        isDelta: mapping.isDelta,
        scale: mapping.scale
    };
}

function isStorageVolume(name: string | undefined): boolean {
    return /tank|storage|cistern|reservoir/i.test(name ?? '');
}

function inferDomain(name: string | undefined): EnergyDomain {
    if (!name) return 'unspecified';
    for (const row of NAME_KEYWORDS) {
        if (row.re.test(name)) return row.domain;
    }
    return 'unspecified';
}
