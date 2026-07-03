/** Shared power-telemetry helpers. Single source of truth for the metric
 *  derivations every PM-capable entity template (Switch, Cover, Meter, Light,
 *  Bulb) used to redefine locally. */

export interface PowerMetric {
    label: string;
    value: string;
}

/** Derive the canonical list of power readings from a Shelly status block.
 *  Order matters — first metric is treated as the hero in the new template
 *  visual hierarchy. */
export function buildPowerMetrics(
    status: Record<string, any> | undefined
): PowerMetric[] {
    if (!status) return [];
    const out: PowerMetric[] = [];
    const power = status.apower ?? status.act_power;
    if (power !== undefined) out.push({label: 'Power', value: `${power} W`});
    if (status.aprt_power !== undefined)
        out.push({label: 'Apparent', value: `${status.aprt_power} VA`});
    if (status.voltage !== undefined)
        out.push({label: 'Voltage', value: `${status.voltage} V`});
    if (status.current !== undefined)
        out.push({label: 'Current', value: `${status.current} A`});
    if (status.pf !== undefined) out.push({label: 'PF', value: `${status.pf}`});
    if (status.freq !== undefined)
        out.push({label: 'Frequency', value: `${status.freq} Hz`});
    if (status.temperature?.tC !== undefined)
        out.push({label: 'Internal', value: `${status.temperature.tC} °C`});
    return out;
}

/** Cumulative active energy as kWh string (3 decimal places).
 *  Reads from either PM1's status.aenergy.total (mWh) or EM1's
 *  emdata.total_act_energy (Wh) — caller passes whichever it has. */
export function formatKwh(totalMilliWh: number | undefined): string | null {
    if (totalMilliWh === undefined) return null;
    return (totalMilliWh / 1000).toFixed(3);
}

/** Current as either "Xm" mA when below 1 A, or "X.XX" A otherwise. */
export function formatCurrent(val: number | undefined): string {
    if (val == null) return '—';
    return val < 1 ? `${(val * 1000).toFixed(0)}m` : val.toFixed(2);
}
