// Non-energy bill lines from a stored tariff: demand charge (peak kW),
// standing charge (fixed per day/month), and VAT on the subtotal.

import type {TariffSpec} from '../../types/api/tariff';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import {dateInZone, type LocalDate} from './localTimeInZone';

export interface BillChargesRequest {
    rows: EnergyReportRow[];
    tariff: TariffSpec | null;
    peakPowerW: number;
    periodDays: number;
    fromDate: Date;
    toDate: Date;
    energyCost: number;
    currencySymbol: string;
}

function round2(value: number): number {
    return +value.toFixed(2);
}

// Billing-period index for a local date: periods reset on billingDay, so a date
// before billingDay still belongs to the previous month's period.
function billingPeriodIndex(date: LocalDate, billingDay: number): number {
    const monthIndex = date.year * 12 + (date.month - 1);
    return date.day < billingDay ? monthIndex - 1 : monthIndex;
}

// Number of billing periods the [from, to) range touches, anchored on the
// tariff's billingDay (1-28) in its timezone. A monthly standing or
// per-kW-month demand charge applies once per period — a 45-day range crossing
// two anchors bills two, not Math.round(days/30).
export function countBillingMonths(
    from: Date,
    to: Date,
    billingDay: number,
    timezone: string | null = null
): number {
    if (to <= from) return 0;
    const lastInstant = new Date(to.getTime() - 1); // half-open [from, to)
    const firstIdx = billingPeriodIndex(dateInZone(from, timezone), billingDay);
    const lastIdx = billingPeriodIndex(
        dateInZone(lastInstant, timezone),
        billingDay
    );
    return lastIdx - firstIdx + 1;
}

// demandRate is per kW-month, so a multi-month range bills demand per period.
export function demandCharge(
    tariff: TariffSpec,
    peakPowerW: number,
    billingMonths: number
): number {
    if (!tariff.demandRate || peakPowerW <= 0) return 0;
    return round2((peakPowerW / 1000) * tariff.demandRate * billingMonths);
}

export function standingCharge(
    tariff: TariffSpec,
    periodDays: number,
    billingMonths: number
): number {
    if (!tariff.standingCharge) return 0;
    const units =
        tariff.standingChargePeriod === 'day'
            ? Math.ceil(periodDays)
            : billingMonths;
    return round2(tariff.standingCharge * units);
}

function chargeRow(
    label: string,
    amount: number,
    sym: string
): EnergyReportRow {
    return energyRow({device: label, cost: `${sym}${amount.toFixed(2)}`});
}

// Appends BILL, demand/standing/VAT, and BILL TOTAL rows when a tariff carries
// any of those charges. Inline-rate reports (no tariff) are unchanged.
export function appendBillChargesSection(req: BillChargesRequest): void {
    const {tariff} = req;
    if (!tariff) return;
    const billingMonths = countBillingMonths(
        req.fromDate,
        req.toDate,
        tariff.billingDay,
        tariff.timezone
    );
    const demand = demandCharge(tariff, req.peakPowerW, billingMonths);
    const standing = standingCharge(tariff, req.periodDays, billingMonths);
    const vatPct = tariff.vatPct ?? 0;
    if (demand === 0 && standing === 0 && vatPct === 0) return;

    const sym = req.currencySymbol;
    req.rows.push(chargeRow('BILL', 0, sym));
    req.rows.push(chargeRow('Energy', req.energyCost, sym));
    if (demand > 0) req.rows.push(chargeRow('Demand charge', demand, sym));
    if (standing > 0)
        req.rows.push(chargeRow('Standing charge', standing, sym));
    const subtotal = round2(req.energyCost + demand + standing);
    const vat = round2((subtotal * vatPct) / 100);
    if (vatPct > 0) {
        req.rows.push(chargeRow(`VAT ${vatPct}%`, vat, sym));
    }
    req.rows.push(chargeRow('BILL TOTAL', round2(subtotal + vat), sym));
    req.rows.push({...energyRowBlank()});
}
