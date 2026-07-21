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
const NONE: Metric = {value: '—', unit: ''};

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

/** Join a metric into one display string ("120 W"); bare value when unitless
 *  (power factor) or absent. */
export function metricText(m: Metric): string {
    return m.unit ? `${m.value} ${m.unit}` : m.value;
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
    if (status.aprt_power !== undefined)
        out.push({
            label: 'Apparent',
            value: metricText(formatApparentPower(status.aprt_power))
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

/** Cumulative active energy as kWh string (3 decimal places) for the energy
 *  dashboards, which need finer precision than a device card. Reads Wh from
 *  PM1's status.aenergy.total or EM1's emdata.total_act_energy. */
export function formatKwh(totalWh: number | undefined): string | null {
    if (totalWh === undefined) return null;
    return (totalWh / 1000).toFixed(3);
}
