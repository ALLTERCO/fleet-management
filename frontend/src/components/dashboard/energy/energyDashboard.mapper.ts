// Single producer of the EnergyDashboardData contract from the live energy layer.
// Pure + typed so it is unit-testable and there is exactly one place that maps
// energy.query / energy.current / settings → the dashboard's presentational shape.
//
// Honesty over fabrication: fields the live layer genuinely does not expose yet
// (per-utility, tenant allocation, EN 50160, anomalies) are returned empty, which
// the component renders as a real "nothing here" state — never a placeholder number.
import type {TariffTaxSpec} from '@api/tariff';
import {currencyFractionDigits} from '@api/_currency';
import type {
    AlertRow,
    BreakdownRow,
    DeviceRow,
    EnergyDashboardData,
    EnergyPoint,
    MeterRow,
    PhaseLine,
    UtilityRow
} from './energyDashboard.types';
import {
    compareRecordedBill,
    type RecordedBillLookup
} from './billReconciliation';
import {calculateTariffTaxes} from './tariffTaxes';

/** A bucketed series point as produced by energy.query on the frontend. */
interface TimePoint {
    bucket: string;
    value: number;
}

/** A scoped device/meter row as produced by [id].vue's deviceListRows. */
interface ScopedRow {
    id: number;
    name: string;
    online: boolean;
    consumption: number;
    power: number;
    share: number;
}

/** Everything the mapper needs, grouped so the call site passes one idea. */
export interface EnergyDashboardInputs {
    rangeLabel: string;
    deviceCount: number;
    onlineCount: number;
    currency: string;
    currencyCode: string | null;
    tariffConfigured: boolean;
    tariffMessage: string | null;
    hasGroups: boolean;
    hasKinds: boolean;
    hasSolar: boolean;
    totalConsumptionKwh: number;
    totalCost: number | null;
    // End-of-period cost from energy.projection; null when the backend had
    // nothing to project from.
    projectedCost: number | null;
    projectionObservedDays: number;
    /** The same projection as a kWh range, e.g. "290 to 310"; null with no band. */
    projectionRangeKwh: string | null;
    totalReturnedKwh: number;
    rangeDays: number;
    // Prior mirror-window totals for period-over-period deltas; null = no baseline.
    priorConsumptionKwh: number | null;
    priorCost: number | null;
    consumption: TimePoint[];
    returned: TimePoint[];
    /** Authoritative tariff-engine day/night costs. */
    dayCost: number;
    nightCost: number;
    demandCharge: number;
    standingCharge: number;
    /** Credit for exported energy; null without an explicit export tariff. */
    exportCredit: number | null;
    /** Import energy cost minus the export credit; null unless both are authoritative. */
    netEnergyCost: number | null;
    taxes: readonly TariffTaxSpec[];
    additionalChargesComplete: boolean;
    additionalChargesMessage: string | null;
    recordedBill: RecordedBillLookup;
    avgVoltage: number | null;
    avgPowerFactor: number | null;
    avgFrequency: number | null;
    peakKw: number;
    livePowerKw: number;
    powerSeriesKw: TimePoint[];
    phases: PhaseLine[];
    // Instantaneous min/max across live devices → measurement range strings.
    voltageMin: number | null;
    voltageMax: number | null;
    pfMin: number | null;
    pfMax: number | null;
    freqMin: number | null;
    freqMax: number | null;
    // Count of time buckets with voltage outside the EN 50160 ±10 % band.
    voltageEventCount: number;
    consumers: ScopedRow[];
    locations: {name: string; totalKwh: number}[];
    meters: MeterRow[];
    hourly: number[];
    co2LocationKg: number;
    co2BudgetKg: number | null;
    // Market-based (green-tariff / REC) grid factor in g CO₂e/kWh; null = no green contract.
    emissionFactorMbm: number | null;
    // Measured PV generation (kWh) from generation-role meters; 0 when no PV.
    pvGenerationKwh: number;
    pvMode: string;
    // Battery-role energy (kWh) for the period; hasBattery gates the card.
    hasBattery: boolean;
    batteryChargedKwh: number;
    batteryDischargedKwh: number;
    // EV-charger role energy (kWh); hasEv gates the card.
    hasEv: boolean;
    evDeliveredKwh: number;
    // Hourly kWh profile split by weekday vs weekend (24 values each).
    hourlyWeekday: number[];
    hourlyWeekend: number[];
    // Per-group cost allocation rows (label + "kWh · cost" value).
    tenants: BreakdownRow[];
    // Live breakdowns from energy.query groupBy (empty when nothing is classified).
    byKind: BreakdownRow[];
    utility: UtilityRow[];
    weekdayKwh: number;
    weekendKwh: number;
    weekdayDays: number;
    weekendDays: number;
}

const HOURS = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Map a bucketed series to x-labelled points using the hour of each bucket. */
function toHourPoints(values: number[]): EnergyPoint[] {
    return values.map((value, i) => ({label: HOURS(i), value}));
}

/** Map a bucketed series to day-labelled points ('Jun 1' …) from ISO buckets. */
function toDayPoints(series: TimePoint[]): EnergyPoint[] {
    return series.map((p) => {
        const d = new Date(p.bucket);
        return {
            label: `${d.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})} ${d.getUTCDate()}`,
            value: p.value
        };
    });
}

/** Load-duration curve: the power series sorted high→low (real, no fabrication). */
function loadDuration(powerKw: TimePoint[]): EnergyPoint[] {
    return [...powerKw]
        .map((p) => p.value)
        .sort((a, b) => b - a)
        .map((value, i) => ({label: `${i}`, value}));
}

/** Voltage passes when the average sits inside the EN 50160 ±10 % window. */
function voltagePasses(avgV: number | null): boolean {
    if (avgV === null) return true;
    return avgV >= 207 && avgV <= 253;
}

/** Phantom-load floor: the fleet's smallest per-bucket power, drawn continuously
 *  over the period (mirrors the report's always-on math at fleet grain). */
function alwaysOn(
    powerKw: TimePoint[],
    rangeDays: number
): {watts: number; kwh: number} {
    if (!powerKw.length || rangeDays <= 0) return {watts: 0, kwh: 0};
    const minKw = Math.min(...powerKw.map((p) => p.value));
    const watts = minKw > 0 ? minKw * 1000 : 0;
    return {watts, kwh: (watts * rangeDays * 24) / 1000};
}

/** Apparent (kVAh) and reactive (kVARh) energy from active energy and average
 *  power factor: kVAh = kWh / PF, kVARh = √(kVAh² − kWh²). Same as the report. */
function reactiveApparent(
    activeKwh: number,
    pf: number | null
): {apparent: number; reactive: number} {
    if (pf === null || pf <= 0) return {apparent: 0, reactive: 0};
    const apparent = activeKwh / Math.min(pf, 1);
    const reactive = Math.sqrt(
        Math.max(0, apparent * apparent - activeKwh * activeKwh)
    );
    return {apparent, reactive};
}

/** Worst-leg deviation from the 3-phase average power — the report's imbalance %. */
function phaseStats(phases: PhaseLine[]): {
    imbalancePct: number;
    worst: string;
} {
    if (phases.length < 2) return {imbalancePct: 0, worst: ''};
    const avg = phases.reduce((sum, p) => sum + p.watts, 0) / phases.length;
    if (avg <= 0) return {imbalancePct: 0, worst: ''};
    let worstDev = 0;
    let worst = '';
    for (const p of phases) {
        const dev = Math.abs(p.watts - avg) / avg;
        if (dev > worstDev) {
            worstDev = dev;
            worst = p.name;
        }
    }
    return {imbalancePct: worstDev * 100, worst};
}

/** PV energy balance — matches the report's computePvEnergy exactly.
 *  house = grid + generation − exported; balcony mode never exports. */
function pvBalance(
    gridImport: number,
    generation: number,
    exported: number,
    mode: string
) {
    const grid = Math.max(0, gridImport);
    const gen = Math.max(0, generation);
    const exp = mode === 'balcony' ? 0 : Math.max(0, exported);
    const self = Math.max(0, gen - exp);
    const house = Math.max(0, grid + gen - exp);
    return {
        generation: gen,
        selfConsumed: self,
        exported: exp,
        gridImport: grid,
        house,
        selfConsumptionPct: gen > 0 ? (self / gen) * 100 : 0,
        selfSufficiencyPct: house > 0 ? (self / house) * 100 : 0
    };
}

/** "min–max unit" range string, empty when either bound is unknown. */
function rangeStr(
    min: number | null,
    max: number | null,
    unit: string,
    dp: number
): string {
    if (
        min === null ||
        max === null ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
    )
        return '';
    return `${min.toFixed(dp)}–${max.toFixed(dp)}${unit}`;
}

const round2 = (n: number) =>
    Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;

/** Naive forward line: three days continued at the recent daily average.
 *  Deliberately simple (the backend's projection math is unreliable) and shown
 *  dashed/"estimated" so it never reads as measured. */
function forwardProjection(
    consumption: TimePoint[],
    dailyAvg: number
): EnergyPoint[] {
    if (consumption.length < 2 || dailyAvg <= 0) return [];
    const last = new Date(consumption[consumption.length - 1].bucket);
    if (Number.isNaN(last.getTime())) return [];
    const pts: EnergyPoint[] = [];
    for (let i = 1; i <= 3; i++) {
        const d = new Date(last);
        d.setUTCDate(d.getUTCDate() + i);
        pts.push({
            label: `${d.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})} ${d.getUTCDate()}`,
            value: round2(dailyAvg)
        });
    }
    return pts;
}

/** Signed % change vs a prior value; null when there is no usable baseline.
 *  Divides by |prior| so the sign stays meaningful for export-heavy periods. */
function deltaPct(current: number, prior: number | null): number | null {
    if (prior === null || !Number.isFinite(prior) || prior === 0) return null;
    return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
}

const ALERT_RED = '#FF453A';
const ALERT_AMBER = '#FF9F0A';
const ALERT_BLUE = '#0A84FF';

/** Detected issues in the window — only from signals the live layer exposes. */
function buildAnomalies(
    input: EnergyDashboardInputs,
    imbalancePct: number,
    worst: string,
    overshootPct: number
): AlertRow[] {
    const rows: AlertRow[] = [];
    if (input.avgVoltage !== null && input.avgVoltage < 210)
        rows.push({
            color: ALERT_RED,
            icon: 'v',
            title: 'Low supply voltage',
            body: `Fleet average ${round2(input.avgVoltage)} V is under the 210 V floor.`,
            pill: 'Voltage',
            pillClass: 'p-bad'
        });
    if (input.avgVoltage !== null && input.avgVoltage > 250)
        rows.push({
            color: ALERT_RED,
            icon: 'v',
            title: 'High supply voltage',
            body: `Fleet average ${round2(input.avgVoltage)} V is over the 250 V ceiling.`,
            pill: 'Voltage',
            pillClass: 'p-bad'
        });
    if (imbalancePct > 20)
        rows.push({
            color: ALERT_AMBER,
            icon: 'ph',
            title: 'Phase imbalance',
            body: `Leg ${worst} is ${round2(imbalancePct)}% off the 3-phase average.`,
            pill: 'Phases',
            pillClass: 'p-warn'
        });
    const top = [...input.consumers].sort((a, b) => b.share - a.share)[0];
    if (top && top.share > 40)
        rows.push({
            color: ALERT_AMBER,
            icon: 'hi',
            title: 'One load dominates',
            body: `${top.name} draws ${round2(top.share)}% of fleet energy.`,
            pill: 'Load',
            pillClass: 'p-warn'
        });
    if (overshootPct > 0)
        rows.push({
            color: ALERT_AMBER,
            icon: 'co',
            title: 'Over carbon budget',
            body: `Emissions are ${round2(overshootPct)}% over the budget for this period.`,
            pill: 'Carbon',
            pillClass: 'p-warn'
        });
    return rows;
}

/** Ranked actions the user can take — only from live-derivable signals. */
function buildRecommendations(input: EnergyDashboardInputs): AlertRow[] {
    const rows: AlertRow[] = [];
    const offlinePct =
        input.deviceCount > 0
            ? ((input.deviceCount - input.onlineCount) / input.deviceCount) *
              100
            : 0;
    if (offlinePct > 10)
        rows.push({
            color: ALERT_AMBER,
            icon: 'off',
            title: 'Reconnect offline devices',
            body: `${round2(offlinePct)}% of devices are offline — their energy is missing from totals.`,
            pill: 'Medium',
            pillClass: 'p-warn'
        });
    if (
        input.avgVoltage !== null &&
        (input.avgVoltage < 210 || input.avgVoltage > 250)
    )
        rows.push({
            color: ALERT_RED,
            icon: 'v',
            title: 'Check the service connection',
            body: 'Supply voltage is outside the safe band across the fleet.',
            pill: 'High',
            pillClass: 'p-bad'
        });
    if (!input.tariffConfigured)
        rows.push({
            color: ALERT_BLUE,
            icon: 'co',
            title: 'Add a tariff',
            body: 'Set your rates so cost, projection and bill figures appear.',
            pill: 'Setup',
            pillClass: 'p-ok'
        });
    return rows;
}

function mapConsumers(rows: ScopedRow[]): DeviceRow[] {
    return rows.map((r) => ({
        name: r.name,
        meta: '',
        kwh: Math.round(r.consumption),
        cost: 0,
        sharePct: Math.round(r.share),
        liveW: Math.round(r.power),
        deltaLabel: '',
        deltaKind: 'ok'
    }));
}

function mapLocations(
    locations: {name: string; totalKwh: number}[]
): BreakdownRow[] {
    return locations.map((l) => ({
        label: l.name,
        value: `${Math.round(l.totalKwh).toLocaleString('en-US')} kWh`
    }));
}

/** Assemble the full dashboard contract from live inputs. One place, one shape. */
export function buildEnergyDashboardData(
    input: EnergyDashboardInputs
): EnergyDashboardData {
    const cost = input.tariffConfigured ? input.totalCost : null;
    const dayCost = input.dayCost;
    const nightCost = input.nightCost;
    const touTotal = dayCost + nightCost;
    const r2 = (n: number) =>
        Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; // max 2 dp, never NaN
    const money = (n: number) =>
        Number.isFinite(n)
            ? +n.toFixed(currencyFractionDigits(input.currencyCode))
            : 0;
    // Volts / amps read as instrument values; 1 dp matches DashPhaseTable.
    const r1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
    // Share of devices online right now. This is uptime, not data quality —
    // real bucket coverage is a report-side measure (report/dataQuality.ts).
    const devicesOnlinePct =
        input.deviceCount > 0
            ? r2((input.onlineCount / input.deviceCount) * 100)
            : 0;
    const base = alwaysOn(input.powerSeriesKw, input.rangeDays);
    const pq = reactiveApparent(
        input.totalConsumptionKwh,
        input.avgPowerFactor
    );
    const carbonUsedPct = input.co2BudgetKg
        ? (input.co2LocationKg / input.co2BudgetKg) * 100
        : 0;
    const marketKg =
        input.emissionFactorMbm != null
            ? (input.totalConsumptionKwh * input.emissionFactorMbm) / 1000
            : 0;
    const phase = phaseStats(input.phases);
    const gridImportKwh = Math.max(
        0,
        input.totalConsumptionKwh - input.totalReturnedKwh
    );
    const pv = pvBalance(
        gridImportKwh,
        input.pvGenerationKwh,
        input.totalReturnedKwh,
        input.pvMode
    );
    // Kept null on the wire so the card can say unavailable; the sums below
    // still need a number, and an unpriced leg contributes nothing to them.
    const energyCost = cost ?? 0;
    const demandCost = input.demandCharge;
    const standingCost = input.standingCharge;
    const billSubtotal = energyCost + demandCost + standingCost;
    const calculatedTaxes = calculateTariffTaxes(
        input.taxes ?? [],
        {
            energy: energyCost,
            demand: demandCost,
            standing: standingCost
        },
        input.currencyCode
    );
    const billTotal = input.additionalChargesComplete
        ? billSubtotal + calculatedTaxes.exclusiveTotal
        : null;
    const billReconciliation = compareRecordedBill(
        input.recordedBill,
        billTotal,
        input.currencyCode
    );
    // Live-flow diagram values as average kW over the period (a real energy balance).
    const hours = input.rangeDays > 0 ? input.rangeDays * 24 : 1;
    const flow = {
        solar: r2(input.pvGenerationKwh / hours),
        grid: r2(gridImportKwh / hours),
        home: r2(input.totalConsumptionKwh / hours),
        battery: r2(
            (input.batteryDischargedKwh - input.batteryChargedKwh) / hours
        ),
        ev: r2(input.evDeliveredKwh / hours)
    };
    // A scope can contain different TOU tariffs. The aggregate pricing summary
    // proves actual day/night cost, but cannot support a counterfactual shift
    // rate without repricing each channel, so keep the opportunity unavailable.
    const shiftKwh = 0;
    const shiftSave = 0;
    // EV cost/CO₂ from delivered energy; sessions/avg aren't exposed by the live layer.
    const co2FactorKgPerKwh =
        input.totalConsumptionKwh > 0
            ? input.co2LocationKg / input.totalConsumptionKwh
            : 0;
    const effRate =
        input.tariffConfigured &&
        input.totalConsumptionKwh > 0 &&
        input.totalCost !== null
            ? input.totalCost / input.totalConsumptionKwh
            : 0;

    return {
        meta: {
            rangeLabel: input.rangeLabel,
            rangeHours: Math.max(0, input.rangeDays * 24),
            deviceCount: input.deviceCount,
            onlineCount: input.onlineCount,
            currency: input.currency,
            currencyFractionDigits: currencyFractionDigits(input.currencyCode)
        },
        config: {
            tariff: input.tariffConfigured,
            tariffMessage: input.tariffMessage,
            groups: input.hasGroups,
            kinds: input.hasKinds || input.byKind.length > 0,
            solar: input.hasSolar
        },
        overview: {
            consumptionKwh: Math.round(input.totalConsumptionKwh),
            costValue: cost,
            projectedValue: input.tariffConfigured ? input.projectedCost : null,
            projectedRangeKwh: input.tariffConfigured
                ? input.projectionRangeKwh
                : null,
            // A missing projection is a state to show, not a blank to hide.
            projectedPending:
                input.tariffConfigured && input.projectedCost === null
                    ? {observedDays: input.projectionObservedDays}
                    : null,
            dailyAvgKwh: r2(
                input.rangeDays > 0
                    ? input.totalConsumptionKwh / input.rangeDays
                    : 0
            ),
            alwaysOnKwh: r2(base.kwh),
            voltagePass: voltagePasses(input.avgVoltage),
            voltageAvgV: r2(input.avgVoltage ?? 0),
            devicesOnlinePct,
            consumptionDeltaPct: deltaPct(
                input.totalConsumptionKwh,
                input.priorConsumptionKwh
            ),
            costDeltaPct: input.tariffConfigured
                ? deltaPct(input.totalCost ?? 0, input.priorCost)
                : null,
            bill: {
                energy: cost === null ? null : money(energyCost),
                demandKw: r2(input.peakKw),
                demand: money(demandCost),
                standing: money(standingCost),
                taxes: calculatedTaxes.items.map((tax) => ({
                    code: tax.code,
                    label: `${tax.name} · ${tax.ratePct}%${
                        tax.exempt
                            ? ' · exempt'
                            : tax.calculation === 'inclusive'
                              ? ' · included'
                              : ''
                    }`,
                    amount: money(tax.amount)
                })),
                total: billTotal == null ? null : money(billTotal),
                exportCredit:
                    input.exportCredit === null
                        ? null
                        : money(input.exportCredit),
                netCost:
                    input.netEnergyCost === null
                        ? null
                        : money(input.netEnergyCost),
                complete: input.additionalChargesComplete,
                message: input.additionalChargesMessage,
                reconciliation: billReconciliation
            },
            tou: {
                energy: r2(touTotal),
                shiftKwh: r2(shiftKwh),
                shiftSave: r2(shiftSave),
                dayPct: r2(touTotal > 0 ? (dayCost / touTotal) * 100 : 0),
                nightPct: r2(touTotal > 0 ? (nightCost / touTotal) * 100 : 0),
                dayCost: r2(dayCost),
                nightCost: r2(nightCost)
            },
            consumption: toDayPoints(input.consumption),
            returned: toDayPoints(input.returned),
            projection: forwardProjection(
                input.consumption,
                input.rangeDays > 0
                    ? input.totalConsumptionKwh / input.rangeDays
                    : 0
            )
        },
        power: {
            liveKw: r2(input.livePowerKw),
            liveNote:
                input.onlineCount > 0 ? `${input.onlineCount} online` : '',
            peakKw: r2(input.peakKw),
            billedKw: r2(input.peakKw),
            loadFactor: r2(
                input.peakKw > 0 && input.rangeDays > 0
                    ? input.totalConsumptionKwh /
                          (input.peakKw * 24 * input.rangeDays)
                    : 0
            ),
            apparentKvah: r2(pq.apparent),
            reactiveKvarh: r2(pq.reactive),
            en50160Events: Math.max(0, Math.round(input.voltageEventCount)),
            frequencyHz: r2(input.avgFrequency ?? 0),
            frequencyRange: rangeStr(input.freqMin, input.freqMax, ' Hz', 2),
            powerFactor: r2(input.avgPowerFactor ?? 0),
            powerFactorRange: rangeStr(input.pfMin, input.pfMax, '', 2),
            voltageAvgV: r2(input.avgVoltage ?? 0),
            voltageRange: rangeStr(input.voltageMin, input.voltageMax, ' V', 1),
            phases: input.phases.map((p) => ({
                ...p,
                watts: Math.round(p.watts),
                volts: r1(p.volts),
                amps: r1(p.amps)
            })),
            phaseImbalancePct: r2(phase.imbalancePct),
            phaseWorst: phase.worst,
            live: input.powerSeriesKw.map((p) => ({
                label: p.bucket,
                value: r2(p.value)
            }))
        },
        energy: {
            rhythmWeekday: toHourPoints(
                input.hourlyWeekday.length ? input.hourlyWeekday : input.hourly
            ),
            rhythmWeekend: toHourPoints(input.hourlyWeekend),
            peakHourLabel: input.hourly.length
                ? HOURS(input.hourly.indexOf(Math.max(...input.hourly)))
                : '',
            utility: input.utility,
            weekdayKwh: Math.round(input.weekdayKwh),
            weekendKwh: Math.round(input.weekendKwh),
            weekdayPerDay: r2(
                input.weekdayDays ? input.weekdayKwh / input.weekdayDays : 0
            ),
            weekendPerDay: r2(
                input.weekendDays ? input.weekendKwh / input.weekendDays : 0
            ),
            loadDuration: loadDuration(input.powerSeriesKw),
            alwaysOnW: Math.round(base.watts),
            hourly: toHourPoints(input.hourly)
        },
        devices: {
            shareTotalKwh: Math.round(input.totalConsumptionKwh),
            consumers: mapConsumers(input.consumers),
            byLocation: mapLocations(input.locations),
            byKind: input.byKind,
            tenants: input.tenants,
            meters: input.meters
        },
        solar: {
            flow,
            generatedToday: Math.round(pv.generation),
            selfConsumed: Math.round(pv.selfConsumed),
            exported: Math.round(pv.exported),
            imported: Math.round(pv.gridImport),
            pv: {
                generation: r2(pv.generation),
                selfConsumed: r2(pv.selfConsumed),
                exported: r2(pv.exported),
                gridImport: r2(pv.gridImport),
                house: r2(pv.house),
                selfConsumptionPct: r2(pv.selfConsumptionPct),
                selfSufficiencyPct: r2(pv.selfSufficiencyPct)
            },
            battery: input.hasBattery
                ? {
                      charged: r2(input.batteryChargedKwh),
                      discharged: r2(input.batteryDischargedKwh),
                      roundTripPct:
                          input.batteryChargedKwh > 0
                              ? r2(
                                    (input.batteryDischargedKwh /
                                        input.batteryChargedKwh) *
                                        100
                                )
                              : 0,
                      losses: r2(
                          Math.max(
                              0,
                              input.batteryChargedKwh -
                                  input.batteryDischargedKwh
                          )
                      )
                  }
                : null,
            ev: input.hasEv
                ? {
                      delivered: r2(input.evDeliveredKwh),
                      sessions: 0,
                      avgPerSession: 0,
                      cost: r2(input.evDeliveredKwh * effRate),
                      co2Avoided: r2(input.evDeliveredKwh * co2FactorKgPerKwh)
                  }
                : null
        },
        carbon: {
            locationBasedKg: Math.round(input.co2LocationKg),
            marketBasedKg: Math.round(marketKg),
            equivalentKm: Math.round(input.co2LocationKg / 0.192),
            budgetKg: input.co2BudgetKg ?? 0,
            projectedKg: Math.round(input.co2LocationKg),
            usedPct: r2(carbonUsedPct),
            overshootPct: r2(Math.max(0, carbonUsedPct - 100)),
            anomalies: buildAnomalies(
                input,
                phase.imbalancePct,
                phase.worst,
                Math.max(0, carbonUsedPct - 100)
            ),
            recommendations: buildRecommendations(input)
        }
    };
}
