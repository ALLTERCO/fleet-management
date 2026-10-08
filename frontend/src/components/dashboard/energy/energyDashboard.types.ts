// Single source of truth for the energy dashboard's presentational contract.
// The producer (buildEnergyDashboardData, fed by the energy.query / energy.current
// / report layer) and the consumer (EnergyVoltaine.vue) both depend on THIS type,
// so the data shape is defined exactly once. Values are already in display units;
// all currency formatting is the component's job (it owns `meta.currency`).

/** One time-series sample, x-labelled, value in display units (kWh / kW / …). */
export interface EnergyPoint {
    /** x-axis label for this bucket, e.g. 'Jun 1' or '18:00'. */
    label: string;
    /** Value in display units. */
    value: number;
}

/** Which configuration is present — drives cold-start nudges vs real cards. */
interface EnergyConfigFlags {
    /** A tariff is configured — gates the cost / bill / TOU cards. */
    tariff: boolean;
    /** Why authoritative stored-tariff pricing is unavailable. */
    tariffMessage: string | null;
    /** At least one group or location exists — gates the by-location breakdown. */
    groups: boolean;
    /** At least one device carries an appliance kind — gates the by-kind breakdown. */
    kinds: boolean;
    /** A solar / battery / EV meter role exists — gates the Solar tab. */
    solar: boolean;
}

interface EnergyBill {
    /** Null when no tariff priced the energy. A zero would read as free. */
    energy: number | null;
    demandKw: number;
    demand: number;
    standing: number;
    taxes: {code: string; label: string; amount: number}[];
    /** Null when fixed/demand/tax rules cannot be aggregated honestly. */
    total: number | null;
    /** Credit for exported energy; null without an explicit export tariff. */
    exportCredit: number | null;
    /** Import energy cost minus the export credit; null unless both are authoritative. */
    netCost: number | null;
    complete: boolean;
    message: string | null;
    reconciliation:
        | {status: 'loading' | 'unavailable'; message: string}
        | {
              status: 'ready';
              recorded: number;
              shadow: number;
              varianceAbs: number;
              variancePct: number | null;
              direction: 'over' | 'under' | 'match';
              coverageWarning: string;
          };
}

interface EnergyTou {
    energy: number;
    shiftKwh: number;
    shiftSave: number;
    dayPct: number;
    nightPct: number;
    dayCost: number;
    nightCost: number;
}

interface OverviewData {
    consumptionKwh: number;
    /** Total cost for the period; null when no tariff is configured. */
    costValue: number | null;
    /** End-of-period cost; null when the backend had nothing to project from. */
    projectedValue: number | null;
    /** The same projection as a kWh range, so a thin one does not read as firm. */
    projectedRangeKwh: string | null;
    /** What the projection is still waiting for; null when one is shown. */
    projectedPending: {observedDays: number} | null;
    dailyAvgKwh: number;
    alwaysOnKwh: number;
    voltagePass: boolean;
    voltageAvgV: number;
    /** Share of devices online right now — uptime, not bucket coverage. */
    devicesOnlinePct: number;
    /** Consumption / cost change vs the mirror prior window; null = no baseline. */
    consumptionDeltaPct: number | null;
    costDeltaPct: number | null;
    bill: EnergyBill;
    tou: EnergyTou;
    /** Main chart: daily consumption, returned energy, and forward projection. */
    consumption: EnergyPoint[];
    returned: EnergyPoint[];
    projection: EnergyPoint[];
}

export interface PhaseLine {
    name: string;
    watts: number;
    volts: number;
    amps: number;
    /** Bar fill 0–100, relative to the busiest phase. */
    pct: number;
}

interface PowerData {
    liveKw: number;
    liveNote: string;
    peakKw: number;
    billedKw: number;
    loadFactor: number;
    apparentKvah: number;
    reactiveKvarh: number;
    en50160Events: number;
    frequencyHz: number;
    frequencyRange: string;
    powerFactor: number;
    powerFactorRange: string;
    voltageAvgV: number;
    voltageRange: string;
    phases: PhaseLine[];
    phaseImbalancePct: number;
    phaseWorst: string;
    /** Live power sparkline series (kW). */
    live: EnergyPoint[];
}

export interface UtilityRow {
    name: string;
    label: string;
}

interface EnergyPatternsData {
    /** Daily rhythm: average kW by hour, weekday vs weekend. */
    rhythmWeekday: EnergyPoint[];
    rhythmWeekend: EnergyPoint[];
    peakHourLabel: string;
    utility: UtilityRow[];
    weekdayKwh: number;
    weekendKwh: number;
    weekdayPerDay: number;
    weekendPerDay: number;
    /** Load-duration curve (kW sorted descending) and the always-on floor. */
    loadDuration: EnergyPoint[];
    alwaysOnW: number;
    /** Usage profile: average kWh by hour of day. */
    hourly: EnergyPoint[];
}

export interface DeviceRow {
    name: string;
    meta: string;
    kwh: number;
    cost: number;
    sharePct: number;
    liveW: number;
    deltaLabel: string;
    /** 'up' worsening, 'down'/'ok' improving, 'bad' large jump. */
    deltaKind: 'up' | 'down' | 'ok' | 'bad';
}

export interface BreakdownRow {
    label: string;
    value: string;
    /** Indent level for tree rows (0 or 1). */
    indent?: number;
    muted?: boolean;
}

export interface MeterRow {
    meter: string;
    role: string;
    live: string;
    energy: string;
    cost: string;
    delta: string;
    quality: string;
    status: string;
    online: boolean;
}

interface DevicesData {
    shareTotalKwh: number;
    consumers: DeviceRow[];
    byLocation: BreakdownRow[];
    byKind: BreakdownRow[];
    tenants: BreakdownRow[];
    meters: MeterRow[];
}

interface SolarData {
    flow: {
        solar: number;
        grid: number;
        home: number;
        battery: number;
        ev: number;
    };
    generatedToday: number;
    selfConsumed: number;
    exported: number;
    imported: number;
    pv: {
        generation: number;
        selfConsumed: number;
        exported: number;
        gridImport: number;
        house: number;
        selfConsumptionPct: number;
        selfSufficiencyPct: number;
    };
    battery: {
        charged: number;
        discharged: number;
        roundTripPct: number;
        losses: number;
    } | null;
    ev: {
        delivered: number;
        sessions: number;
        avgPerSession: number;
        cost: number;
        co2Avoided: number;
    } | null;
}

export interface AlertRow {
    color: string;
    icon: string;
    title: string;
    body: string;
    pill: string;
    pillClass: string;
}

interface CarbonData {
    locationBasedKg: number;
    marketBasedKg: number;
    equivalentKm: number;
    budgetKg: number;
    projectedKg: number;
    usedPct: number;
    overshootPct: number;
    anomalies: AlertRow[];
    recommendations: AlertRow[];
}

export interface EnergyDashboardData {
    meta: {
        rangeLabel: string;
        rangeHours: number;
        deviceCount: number;
        onlineCount: number;
        currency: string;
        currencyFractionDigits?: number;
    };
    config: EnergyConfigFlags;
    overview: OverviewData;
    power: PowerData;
    energy: EnergyPatternsData;
    devices: DevicesData;
    solar: SolarData;
    carbon: CarbonData;
}
