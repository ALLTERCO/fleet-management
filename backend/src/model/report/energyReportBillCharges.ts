// Non-energy bill lines from a stored tariff: demand charge (peak kW),
// standing charge (fixed per day/month), and configured taxes.

import {currencyFractionDigits} from '../../types/api/_currency';
import type {ApparentPowerMethod, TariffSpec} from '../../types/api/tariff';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import type {BillChargeSummary} from './energyReportBillChargeTypes';
import {dateInZone} from './localTimeInZone';
import {billingPeriodIndex} from './reportPeriod';
import {calculateTariffComponents} from './tariffComponents';
import {
    calculateTariffDemandCharges,
    completeTariffDemandPeriodKeys,
    type TariffDemandChargeResult,
    type TariffDemandSample
} from './tariffDemandCharges';
import {calculateTariffTaxes, effectiveTariffTaxes} from './tariffTaxes';

export interface BillChargesRequest {
    rows: EnergyReportRow[];
    tariff: TariffSpec | null;
    peakPowerW: number;
    periodDays: number;
    fromDate: Date;
    toDate: Date;
    energyCost: number;
    /** Consumption expressed in the tariff billed unit. */
    consumptionUnits?: number;
    currencySymbol: string;
    /** Complete stored 15-minute fleet demand buckets. */
    demandSamples?: readonly TariffDemandSample[];
}

export function structuredDemandResult(
    tariff: TariffSpec,
    samples: readonly TariffDemandSample[],
    chargeFrom?: Date,
    chargeTo?: Date
) {
    if (!tariff.demand) return null;
    return calculateTariffDemandCharges({
        demand: tariff.demand,
        effectiveFrom: tariff.effectiveFrom,
        effectiveTo: tariff.effectiveTo,
        timezone: tariff.timezone,
        billingDay: tariff.billingDay,
        samples,
        chargeFrom,
        chargeTo,
        completePeriodKeys: completeTariffDemandPeriodKeys({
            demand: tariff.demand,
            effectiveFrom: tariff.effectiveFrom,
            effectiveTo: tariff.effectiveTo,
            timezone: tariff.timezone,
            billingDay: tariff.billingDay,
            samples
        }),
        currencyFractionDigits: currencyFractionDigits(tariff.currency)
    });
}

/** One calculation shared by the printed bill and tenant chargeback. */
export function calculateBillChargeSummary(
    req: BillChargesRequest
): BillChargeSummary | null {
    const {tariff} = req;
    if (!tariff) return null;
    const billingMonths = countBillingMonths(
        req.fromDate,
        req.toDate,
        tariff.billingDay,
        tariff.timezone
    );
    // One structured calculation, read twice: the money and the determinant
    // behind it. A tariff without a demand contract falls back to the flat
    // per-kW-month rate, which needs no samples.
    const demandResult = tariff.demand
        ? structuredDemandResult(
              tariff,
              req.demandSamples ?? [],
              req.fromDate,
              req.toDate
          )
        : null;
    const demand =
        demandResult?.total ??
        demandCharge(tariff, req.peakPowerW, billingMonths);
    const standing = standingCharge(tariff, req.periodDays, billingMonths);
    const taxes = effectiveTariffTaxes(tariff);
    const fractionDigits = currencyFractionDigits(tariff.currency);
    const complete = demandResult?.complete !== false;
    const calculatedTaxes = calculateTariffTaxes(
        taxes,
        {energy: req.energyCost, demand, standing},
        fractionDigits
    );
    const components = calculateTariffComponents({
        components: tariff.components ?? [],
        consumptionUnits: req.consumptionUnits ?? 0,
        periodDays: req.periodDays,
        billingMonths,
        energy: req.energyCost,
        demand,
        standing,
        from: req.fromDate,
        to: req.toDate,
        fractionDigits,
        timezone: tariff.timezone
    });
    return {
        billingMonths,
        demand,
        demandResult,
        standing,
        taxes,
        fractionDigits,
        complete,
        components,
        total: complete
            ? roundCurrency(
                  req.energyCost +
                      demand +
                      standing +
                      calculatedTaxes.exclusiveTotal +
                      components.total,
                  fractionDigits
              )
            : null
    };
}

function roundCurrency(value: number, fractionDigits: number): number {
    return +value.toFixed(fractionDigits);
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
    billingMonths: number,
    demandSamples: readonly TariffDemandSample[] = [],
    chargeFrom?: Date,
    chargeTo?: Date
): number {
    // Structured demand contracts require timestamped samples in their
    // declared unit. This summary-only path has an instantaneous kW peak, so
    // it must never approximate kVA, interval windows, daily charges or
    // ratchets. The structured calculator handles those inputs explicitly.
    if (tariff.demand) {
        return structuredDemandResult(
            tariff,
            demandSamples,
            chargeFrom,
            chargeTo
        )!.total;
    }
    if (!tariff.demandRate || peakPowerW <= 0) return 0;
    return roundCurrency(
        (peakPowerW / 1000) * tariff.demandRate * billingMonths,
        currencyFractionDigits(tariff.currency)
    );
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
    return roundCurrency(
        tariff.standingCharge * units,
        currencyFractionDigits(tariff.currency)
    );
}

function chargeRow(
    label: string,
    amount: number,
    sym: string,
    fractionDigits: number
): EnergyReportRow {
    return energyRow({
        device: label,
        cost: `${sym}${amount.toFixed(fractionDigits)}`
    });
}

const APPARENT_POWER_METHOD_NOTES: Readonly<
    Record<ApparentPowerMethod, string>
> = {
    vectorial:
        'kVA measured vectorially: active and net reactive energy per meter phase or channel'
};

function demandMethodNote(result: TariffDemandChargeResult | null): string {
    const method = result?.apparentPowerMethod;
    return method ? APPARENT_POWER_METHOD_NOTES[method] : '';
}

// Appends BILL, demand/standing/tax, and BILL TOTAL rows when a tariff carries
// any of those charges. Inline-rate reports (no tariff) are unchanged.
export function appendBillChargesSection(
    req: BillChargesRequest
): BillChargeSummary | null {
    const summary = calculateBillChargeSummary(req);
    if (!summary) return null;
    const {demand, demandResult, standing, taxes, fractionDigits, components} =
        summary;
    if (
        demand === 0 &&
        standing === 0 &&
        taxes.length === 0 &&
        components.lines.length === 0 &&
        demandResult?.complete !== false
    ) {
        return summary;
    }

    const sym = req.currencySymbol;
    req.rows.push(chargeRow('BILL', 0, sym, fractionDigits));
    req.rows.push(chargeRow('Energy', req.energyCost, sym, fractionDigits));
    if (demand > 0)
        req.rows.push({
            ...chargeRow('Demand charge', demand, sym, fractionDigits),
            notes: demandMethodNote(demandResult)
        });
    if (demandResult && !demandResult.complete) {
        req.rows.push(
            energyRow({
                device: 'Demand charge unavailable',
                notes:
                    demandResult.reason ?? 'Demand peak history is incomplete.'
            })
        );
    }
    if (standing > 0)
        req.rows.push(
            chargeRow('Standing charge', standing, sym, fractionDigits)
        );
    if (demandResult?.complete === false) {
        req.rows.push({...energyRowBlank()});
        return summary;
    }
    const subtotal = roundCurrency(
        req.energyCost + demand + standing,
        fractionDigits
    );
    const calculatedTaxes = calculateTariffTaxes(
        taxes,
        {
            energy: req.energyCost,
            demand,
            standing
        },
        fractionDigits
    );
    for (const tax of calculatedTaxes.items) {
        const qualifier = tax.exempt
            ? ' (exempt)'
            : tax.calculation === 'inclusive'
              ? ' (included)'
              : '';
        req.rows.push(
            chargeRow(
                `${tax.name} ${tax.ratePct}%${qualifier}`,
                tax.amount,
                sym,
                fractionDigits
            )
        );
    }
    for (const line of components.lines) {
        req.rows.push(chargeRow(line.name, line.amount, sym, fractionDigits));
    }
    for (const [chargeClass, amount] of Object.entries(components.subtotals)) {
        req.rows.push(
            chargeRow(
                `${chargeClass.replaceAll('_', ' ')} subtotal`,
                amount,
                sym,
                fractionDigits
            )
        );
    }
    req.rows.push(
        chargeRow(
            'BILL TOTAL',
            roundCurrency(
                subtotal + calculatedTaxes.exclusiveTotal + components.total,
                fractionDigits
            ),
            sym,
            fractionDigits
        )
    );
    req.rows.push({...energyRowBlank()});
    return summary;
}
