/** Shared power-telemetry helpers. Single source of truth for how every
 *  device value is rounded and unit-labelled on cards and entity templates
 *  (Switch, Cover, Meter, Light, Bulb, Dimmer, RGBW). Devices report raw
 *  floats with unbounded precision; the display precision is decided here so
 *  every surface reads the same. */

/** A formatted reading split into number and unit so callers can render them
 *  together ("120 W") or style the unit smaller. */
export interface Metric {
    value: string;
    unit: string;
}

/** Placeholder when the reading is absent. */
const ABSENT = '—';
const NONE: Metric = {value: ABSENT, unit: ''};

/** True when the device actually reported the reading. Cards gate every stat
 *  cell on this — an absent reading renders nothing, never a dash or bare unit.
 *  Takes any stat shape with a `value` string, not just Metric. */
export function hasMetric(m: {value: string}): boolean {
    return m.value !== ABSENT && m.value !== '';
}

/** Drop every stat the device did not report, so a list of cells never carries
 *  a placeholder into the template. */
export function presentStats<T extends {value: string}>(
    stats: readonly T[]
): T[] {
    return stats.filter(hasMetric);
}

/** Whole number in the base unit below 1000, one decimal in the kilo unit at
 *  or above it. Sign is preserved (power/energy can be negative on feed-in). */
function scaleThousand(v: number, base: string, kilo: string): Metric {
    return Math.abs(v) >= 1000
        ? {value: (v / 1000).toFixed(1), unit: kilo}
        : {value: String(Math.round(v)), unit: base};
}

/** Active power: whole watts, 1-decimal kW once it reaches 1 kW. */
export function formatPower(watts?: number | null): Metric {
    return watts == null ? NONE : scaleThousand(watts, 'W', 'kW');
}

/** Apparent power: same scale rule as power, in VA / kVA. */
export function formatApparentPower(va?: number | null): Metric {
    return va == null ? NONE : scaleThousand(va, 'VA', 'kVA');
}

/** Side-by-side readings share one unit so near-equal phases stay comparable.
 *  Flipping at 1 kW would round a 962 W phase to "1.0 kW" and hide that. */
const GROUP_KILO_THRESHOLD = 10_000;

function scaleGroupThousand(
    values: readonly (number | null | undefined)[],
    base: string,
    kilo: string
): Metric[] {
    const peak = Math.max(
        0,
        ...values.filter((v) => v != null).map((v) => Math.abs(v))
    );
    const useKilo = peak >= GROUP_KILO_THRESHOLD;
    return values.map((v) => {
        if (v == null) return NONE;
        return useKilo
            ? {value: (v / 1000).toFixed(1), unit: kilo}
            : {value: String(Math.round(v)), unit: base};
    });
}

/** Active power for a group compared side by side; one unit for the group. */
export function formatPowerGroup(
    watts: readonly (number | null | undefined)[]
): Metric[] {
    return scaleGroupThousand(watts, 'W', 'kW');
}

/** Apparent power for a group compared side by side. */
export function formatApparentPowerGroup(
    va: readonly (number | null | undefined)[]
): Metric[] {
    return scaleGroupThousand(va, 'VA', 'kVA');
}

/** Current: two decimals — loads are often well below 1 A, the decimals are
 *  the information. */
export function formatCurrent(amps?: number | null): Metric {
    return amps == null ? NONE : {value: amps.toFixed(2), unit: 'A'};
}

/** Voltage: one decimal. */
export function formatVoltage(volts?: number | null): Metric {
    return volts == null ? NONE : {value: volts.toFixed(1), unit: 'V'};
}

/** Line frequency: one decimal. */
export function formatFrequency(hz?: number | null): Metric {
    return hz == null ? NONE : {value: hz.toFixed(1), unit: 'Hz'};
}

/** Power factor: two decimals, dimensionless. */
export function formatPowerFactor(pf?: number | null): Metric {
    return pf == null ? NONE : {value: pf.toFixed(2), unit: ''};
}

/** Temperature in Celsius: one decimal. */
export function formatTemperature(celsius?: number | null): Metric {
    return celsius == null ? NONE : {value: celsius.toFixed(1), unit: '°C'};
}

/** Cumulative energy from Watt-hours, auto-scaled so a small load stays
 *  readable and a large one never overflows: whole Wh below 1 kWh (a bulb
 *  reads "20 Wh", not "0.0 kWh"), 1-decimal kWh up to 1 MWh, then MWh. */
export function formatEnergy(wattHours?: number | null): Metric {
    if (wattHours == null) return NONE;
    const abs = Math.abs(wattHours);
    if (abs >= 1_000_000)
        return {value: (wattHours / 1_000_000).toFixed(1), unit: 'MWh'};
    if (abs >= 1000) return {value: (wattHours / 1000).toFixed(1), unit: 'kWh'};
    return {value: String(Math.round(wattHours)), unit: 'Wh'};
}

/** A value already in kWh (not Wh): whole number at or above 100, one decimal
 *  below. The one home for the kWh label that the dashboard energy widgets show. */
export function formatKilowattHours(kwh: number): Metric {
    return {value: kwh.toFixed(kwh >= 100 ? 0 : 1), unit: 'kWh'};
}

/** Join a metric into one display string ("120 W"); bare value when unitless
 *  (power factor) or absent. The degree sign reads as part of the number, so
 *  degree units bind tight ("45.2°C") — the form every other card uses. */
export function metricText(m: Metric): string {
    if (!m.unit) return m.value;
    return m.unit.startsWith('°')
        ? `${m.value}${m.unit}`
        : `${m.value} ${m.unit}`;
}

export interface PowerMetric {
    label: string;
    value: string;
}

/** Derive the canonical list of power readings from a Shelly status block.
 *  Order matters — first metric is treated as the hero in the template visual
 *  hierarchy. Values are rounded through the shared formatters above. */
export function buildPowerMetrics(
    status: Record<string, any> | undefined
): PowerMetric[] {
    if (!status) return [];
    const out: PowerMetric[] = [];
    const power = status.apower ?? status.act_power;
    if (power !== undefined)
        out.push({label: 'Power', value: metricText(formatPower(power))});
    // PM1 spells it `aprtpower`; EM1/Switch/Cover use `aprt_power`.
    const apparentPower = status.aprt_power ?? status.aprtpower;
    if (apparentPower !== undefined)
        out.push({
            label: 'Apparent',
            value: metricText(formatApparentPower(apparentPower))
        });
    if (status.voltage !== undefined)
        out.push({
            label: 'Voltage',
            value: metricText(formatVoltage(status.voltage))
        });
    if (status.current !== undefined)
        out.push({
            label: 'Current',
            value: metricText(formatCurrent(status.current))
        });
    if (status.pf !== undefined)
        out.push({
            label: 'PF',
            value: metricText(formatPowerFactor(status.pf))
        });
    if (status.freq !== undefined)
        out.push({
            label: 'Frequency',
            value: metricText(formatFrequency(status.freq))
        });
    if (status.temperature?.tC !== undefined)
        out.push({
            label: 'Internal',
            value: metricText(formatTemperature(status.temperature.tC))
        });
    return out;
}

/** `count_disabled` reports a switched-off Count LED, not a metering fault. */
const NON_FAULT_FLAGS = new Set(['count_disabled']);

const CONDITION_LABELS: Record<string, string> = {
    power_meter_failure: 'Power meter failure',
    ct_type_not_set: 'CT type not set',
    database_error: 'Database error',
    count_disabled: 'Count output disabled',
    undervoltage: 'Undervoltage',
    overvoltage: 'Overvoltage',
    undercurrent: 'Undercurrent',
    overcurrent: 'Overcurrent',
    underpower: 'Underpower',
    overpower: 'Overpower'
};

/** One wording for a meter condition code, so the card and the detail page
 *  never name the same fault differently. Unknown codes fall through readable —
 *  a condition a newer firmware invents is shown, never silently swallowed. */
export function meterConditionLabel(code: string): string {
    const known = CONDITION_LABELS[code];
    if (known) return known;
    const [kind, field] = code.split(':');
    const words =
        kind === 'out_of_range' && field
            ? `${field} out of range`
            : code.replace(/:/g, ' ');
    return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/_/g, ' ');
}

export function conditionCodes(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((c) => typeof c === 'string') : [];
}

/** Every condition a meter is currently reporting, as one printable list. The
 *  meter splits them across `errors` and `flags` and its data component keeps
 *  its own `errors`; `ct_type_not_set` appears in more than one, so dedupe. */
export function meterFaults(
    status?: Record<string, any> | null,
    dataStatus?: Record<string, any> | null
): string[] {
    const codes = new Set([
        ...conditionCodes(status?.errors),
        ...conditionCodes(dataStatus?.errors),
        ...conditionCodes(status?.flags).filter((f) => !NON_FAULT_FLAGS.has(f))
    ]);
    return [...codes].map(meterConditionLabel);
}

/** Cumulative active energy as kWh string (3 decimal places) for the energy
 *  dashboards, which need finer precision than a device card. Reads Wh from
 *  PM1's status.aenergy.total or EM1's emdata.total_act_energy. */
export function formatKwh(totalWh: number | undefined): string | null {
    if (totalWh === undefined) return null;
    return (totalWh / 1000).toFixed(3);
}
