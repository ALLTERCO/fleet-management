// Render a rule's machine config as a plain-English phrase. Used for the live
// "reads as" line in the builder and the human-readable config view elsewhere.
// Keep phrasing aligned with the quick-pick presets in helpers/rulePresets.ts.

import type {AlertRuleKind} from '@api/alert';
import {describeRuleKind} from '@/helpers/ruleKinds';

type Config = Record<string, unknown>;

const OPERATOR_WORD: Readonly<Record<string, string>> = {
    gt: 'above',
    gte: 'at or above',
    lt: 'below',
    lte: 'at or below',
    eq: 'equals',
    neq: 'is not'
};

// component|field|equals → phrase, for the common discrete states.
const STATE_PHRASE: Readonly<Record<string, string>> = {
    'switch:0|output|true': 'a relay turns on',
    'switch:0|output|false': 'a relay turns off',
    'cover:0|state|open': 'a cover opens',
    'cover:0|state|closed': 'a cover closes',
    'contact:0|state|open': 'a door opens',
    'contact:0|state|closed': 'a door closes',
    'input:0|state|true': 'an input turns on',
    'input:0|state|false': 'an input turns off',
    'sensor|motion|true': 'motion is detected',
    'sensor|presence|true': 'presence is detected',
    'sensor|occupancy|true': 'occupancy is detected',
    'sensor|tamper|true': 'tamper is detected',
    'sensor|vibration|true': 'vibration is detected',
    'sensor|sound|true': 'sound is detected'
};

// component|field → friendly noun + unit, for the common sensor metrics.
const METRIC: Readonly<Record<string, {noun: string; unit: string}>> = {
    'temperature:0|tC': {noun: 'temperature', unit: '°C'},
    'em:0|act_power': {noun: 'power', unit: 'W'},
    'pm1:0|apower': {noun: 'power', unit: 'W'},
    'humidity:0|rh': {noun: 'humidity', unit: '%'},
    'em1:0|voltage': {noun: 'voltage', unit: 'V'},
    'voltmeter:0|voltage': {noun: 'voltage', unit: 'V'},
    'pressure:0|pressure': {noun: 'pressure', unit: 'hPa'},
    'co2:0|co2': {noun: 'CO2', unit: 'ppm'},
    'tvoc:0|tvoc': {noun: 'TVOC', unit: 'ug/m3'}
};

const FIELD_METRIC: Readonly<Record<string, {noun: string; unit: string}>> = {
    tC: {noun: 'temperature', unit: '°C'},
    tF: {noun: 'temperature', unit: '°F'},
    rh: {noun: 'humidity', unit: '%'},
    lux: {noun: 'illuminance', unit: 'lx'},
    pressure: {noun: 'pressure', unit: 'hPa'},
    co2: {noun: 'CO2', unit: 'ppm'},
    tvoc: {noun: 'TVOC', unit: 'ug/m3'},
    voltage: {noun: 'voltage', unit: 'V'},
    V: {noun: 'voltage', unit: 'V'},
    current: {noun: 'current', unit: 'A'},
    act_power: {noun: 'power', unit: 'W'},
    apower: {noun: 'power', unit: 'W'},
    power: {noun: 'power', unit: 'W'},
    percent: {noun: 'battery', unit: '%'},
    battery_percent: {noun: 'battery', unit: '%'}
};

function stateSentence(config: Config): string | null {
    const {component, field, equals} = config;
    if (component == null || field == null) return null;
    const known = STATE_PHRASE[`${component}|${field}|${String(equals)}`];
    return known ?? `${component} ${field} = ${String(equals)}`;
}

function thresholdSentence(config: Config): string | null {
    const {component, field, operator, threshold} = config;
    const word = OPERATOR_WORD[String(operator)];
    if (word == null || threshold == null) return null;
    const metric = METRIC[`${component}|${field}`] ?? FIELD_METRIC[String(field)];
    if (metric)
        return `${metric.noun} goes ${word} ${threshold} ${metric.unit}`;
    return `${component} ${field} ${word} ${threshold}`;
}

function formatWindow(seconds: number): string {
    if (seconds % 86400 === 0) {
        const days = seconds / 86400;
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (seconds % 3600 === 0) {
        const hours = seconds / 3600;
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    if (seconds % 60 === 0) {
        const minutes = seconds / 60;
        return `${minutes} min`;
    }
    return `${seconds} sec`;
}

function energyConsumptionSentence(config: Config): string | null {
    const {windowSec, operator, thresholdKWh} = config;
    const word = OPERATOR_WORD[String(operator)];
    if (typeof windowSec !== 'number' || word == null) return null;
    if (typeof thresholdKWh !== 'number') return null;
    return `energy use over ${formatWindow(windowSec)} goes ${word} ${thresholdKWh} kWh`;
}

function batterySentence(config: Config): string | null {
    const pct = config.thresholdPct;
    return typeof pct === 'number' ? `battery drops below ${pct}%` : null;
}

const PHRASERS: Partial<Record<AlertRuleKind, (c: Config) => string | null>> = {
    component_state: stateSentence,
    component_threshold: thresholdSentence,
    energy_consumption_threshold: energyConsumptionSentence,
    battery_below: batterySentence
};

/** Answer: a plain-English description of what this rule fires on. Falls back
 *  to the kind's catalog label when the config can't be phrased. */
export function describeRuleConfig(
    kind: AlertRuleKind,
    config: Config
): string {
    return PHRASERS[kind]?.(config) ?? describeRuleKind(kind).label;
}
