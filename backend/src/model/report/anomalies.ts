// Pure anomaly detectors for the energy report. Each function does one thing.

export interface EnergyAnomaly {
    readonly type: string;
    readonly device: string;
    readonly description: string;
    readonly value: string;
    readonly threshold: string;
}

// Mutable shape; readonly intent expressed at consumer site via `ReadonlyMap<string, PhaseGroup>`.
export interface PhaseGroup {
    l1: number;
    l2: number;
    l3: number;
}

export interface AnomalyTopConsumer {
    readonly device: string;
    readonly shellyId: string;
    readonly cons: number;
}

export interface AnomalyInput {
    readonly tsRows: readonly Record<string, any>[];
    readonly phaseGroups: ReadonlyMap<string, PhaseGroup>;
    readonly topConsumers: readonly AnomalyTopConsumer[];
    readonly totalCons: number;
    readonly mainMeterSet: ReadonlySet<string>;
    readonly alwaysOnKWh: number;
    readonly priorAlwaysOnKWh: number | null;
    readonly carbonBudgetOvershootPct: number | null;
}

export const VOLTAGE_LOW_THRESHOLD = 210;
export const VOLTAGE_HIGH_THRESHOLD = 250;
export const PHASE_IMBALANCE_THRESHOLD_PCT = 20;
export const HIGH_CONSUMER_SHARE_PCT = 40;
export const ALWAYS_ON_SPIKE_THRESHOLD = 0.2;

export function detectEnergyAnomalies(input: AnomalyInput): EnergyAnomaly[] {
    return [
        ...detectVoltageExcursions(input.tsRows),
        ...detectPhaseImbalance(input.phaseGroups),
        ...detectHighConsumer(
            input.topConsumers,
            input.totalCons,
            input.mainMeterSet
        ),
        ...detectAlwaysOnSpike(input.alwaysOnKWh, input.priorAlwaysOnKWh),
        ...detectCarbonBudgetOvershoot(input.carbonBudgetOvershootPct)
    ];
}

export function detectCarbonBudgetOvershoot(
    overshootPct: number | null
): EnergyAnomaly[] {
    if (!Number.isFinite(overshootPct) || (overshootPct ?? 0) <= 0) return [];
    return [
        {
            type: 'carbon_budget_overshoot',
            device: 'Fleet',
            description: `Projected CO₂ exceeds budget by ${overshootPct}%`,
            value: `${overshootPct}%`,
            threshold: '0%'
        }
    ];
}

export function detectVoltageExcursions(
    tsRows: readonly Record<string, any>[]
): EnergyAnomaly[] {
    const worst = collectWorstVoltagePerDevice(tsRows);
    return [...worst.values()].map(formatVoltageAnomaly);
}

interface VoltageRecord {
    type: 'voltage_low' | 'voltage_high';
    device: string;
    value: number;
}

function collectWorstVoltagePerDevice(
    tsRows: readonly Record<string, any>[]
): Map<string, VoltageRecord> {
    const out = new Map<string, VoltageRecord>();
    for (const row of tsRows) {
        considerVoltageLow(row, out);
        considerVoltageHigh(row, out);
    }
    return out;
}

function considerVoltageLow(
    row: Record<string, any>,
    sink: Map<string, VoltageRecord>
): void {
    const v = row.voltage_min_v;
    if (typeof v !== 'number' || v >= VOLTAGE_LOW_THRESHOLD) return;
    const key = `voltage_low::${row.device}`;
    const existing = sink.get(key);
    if (!existing || v < existing.value) {
        sink.set(key, {type: 'voltage_low', device: row.device, value: v});
    }
}

function considerVoltageHigh(
    row: Record<string, any>,
    sink: Map<string, VoltageRecord>
): void {
    const v = row.voltage_max_v;
    if (typeof v !== 'number' || v <= VOLTAGE_HIGH_THRESHOLD) return;
    const key = `voltage_high::${row.device}`;
    const existing = sink.get(key);
    if (!existing || v > existing.value) {
        sink.set(key, {type: 'voltage_high', device: row.device, value: v});
    }
}

function formatVoltageAnomaly(a: VoltageRecord): EnergyAnomaly {
    const isLow = a.type === 'voltage_low';
    const threshold = isLow ? VOLTAGE_LOW_THRESHOLD : VOLTAGE_HIGH_THRESHOLD;
    const magnitudePct = Math.round(
        ((isLow ? threshold - a.value : a.value - threshold) / threshold) * 100
    );
    return {
        type: a.type,
        device: a.device,
        description: isLow
            ? `Voltage ${magnitudePct}% low (${a.value}V vs ${threshold}V floor)`
            : `Voltage ${magnitudePct}% high (${a.value}V vs ${threshold}V ceiling)`,
        value: `${a.value}V`,
        threshold: `${threshold}V`
    };
}

export function detectPhaseImbalance(
    phaseGroups: ReadonlyMap<string, PhaseGroup>
): EnergyAnomaly[] {
    const worst = collectWorstImbalancePerDevice(phaseGroups);
    return [...worst.values()].map((a) => ({
        type: 'phase_imbalance',
        device: a.device,
        description: `Phase imbalance ${a.pct}% (over ${PHASE_IMBALANCE_THRESHOLD_PCT}% threshold)`,
        value: `${a.pct}%`,
        threshold: `${PHASE_IMBALANCE_THRESHOLD_PCT}%`
    }));
}

function collectWorstImbalancePerDevice(
    phaseGroups: ReadonlyMap<string, PhaseGroup>
): Map<string, {device: string; pct: number}> {
    const out = new Map<string, {device: string; pct: number}>();
    for (const [key, group] of phaseGroups) {
        const pct = phaseImbalancePctForGroup(group);
        if (pct === null || pct <= PHASE_IMBALANCE_THRESHOLD_PCT) continue;
        const device = key.split('::')[1];
        const existing = out.get(device);
        if (!existing || pct > existing.pct) out.set(device, {device, pct});
    }
    return out;
}

function phaseImbalancePctForGroup(g: PhaseGroup): number | null {
    const powers = [g.l1, g.l2, g.l3].filter((p) => p > 0);
    if (powers.length < 2) return null;
    const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
    if (avg <= 0) return null;
    const maxDev = Math.max(...powers.map((p) => Math.abs(p - avg)));
    return Math.round((maxDev / avg) * 100);
}

export function detectHighConsumer(
    topConsumers: readonly AnomalyTopConsumer[],
    totalCons: number,
    mainMeterSet: ReadonlySet<string>
): EnergyAnomaly[] {
    if (topConsumers.length < 2 || totalCons <= 0) return [];
    const top = topConsumers[0];
    const share = Math.round((top.cons / totalCons) * 100);
    if (share <= HIGH_CONSUMER_SHARE_PCT) return [];
    if (mainMeterSet.has(top.shellyId)) return [];
    return [
        {
            type: 'high_consumer',
            device: top.device,
            description: `Accounts for ${share}% of total`,
            value: `${share}%`,
            threshold: `${HIGH_CONSUMER_SHARE_PCT}%`
        }
    ];
}

export function detectAlwaysOnSpike(
    alwaysOnKWh: number,
    priorAlwaysOnKWh: number | null
): EnergyAnomaly[] {
    if (priorAlwaysOnKWh === null || priorAlwaysOnKWh < 0) return [];
    if (alwaysOnKWh <= 0) return [];
    if (priorAlwaysOnKWh === 0) return [zeroBaselineAnomaly(alwaysOnKWh)];
    return wowDeltaAnomaly(alwaysOnKWh, priorAlwaysOnKWh);
}

// Prior=0 with current>0 = phantom load appeared. % is undefined, label kWh.
function zeroBaselineAnomaly(alwaysOnKWh: number): EnergyAnomaly {
    return {
        type: 'always_on_spike',
        device: 'Fleet',
        description: 'Standby load appeared (none in prior period)',
        value: `${alwaysOnKWh.toFixed(2)} kWh`,
        threshold: 'baseline 0'
    };
}

function wowDeltaAnomaly(
    alwaysOnKWh: number,
    priorAlwaysOnKWh: number
): EnergyAnomaly[] {
    const delta = (alwaysOnKWh - priorAlwaysOnKWh) / priorAlwaysOnKWh;
    if (delta <= ALWAYS_ON_SPIKE_THRESHOLD) return [];
    const pct = Math.round(delta * 100);
    return [
        {
            type: 'always_on_spike',
            device: 'Fleet',
            description: `Standby load up ${pct}% vs prior period`,
            value: `${alwaysOnKWh.toFixed(2)} kWh`,
            threshold: `${Math.round(ALWAYS_ON_SPIKE_THRESHOLD * 100)}%`
        }
    ];
}
