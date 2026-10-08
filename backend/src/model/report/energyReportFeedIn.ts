import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import {defaultTariffRepository} from '../../modules/repositories/TariffRepository';
import RpcError from '../../rpc/RpcError';
import {
    currencyFractionDigits,
    currencySymbol,
    roundCurrencyAmount
} from '../../types/api/_currency';
import type {Energy15minCostRow} from './energyCostEngine';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import {
    assertReturnedQuantityCoverage,
    buildEnergyCostRows
} from './energyReportCost';
import {
    buildPerPointPricingPlan,
    type LivePriceReader,
    type TariffReader
} from './energyReportTariffPoints';
import {
    type TariffQuantityMetric,
    tagsForQuantityMetric,
    tariffQuantityMetric
} from './tariffQuantity';

export interface EnergyReportFeedInPricing {
    status: 'priced' | 'unconfigured';
    returnedUnits: number;
    unpricedReturnedUnits: number;
    credit: number | null;
    currency: string | null;
    tariffIds: number[];
}

export interface ReadEnergyReportFeedInRequest {
    orgId: string;
    repo: Pick<EnergyRepository, 'queryEnergy15minByChannel'>;
    internalIds: readonly number[];
    deviceMap: Map<number, string>;
    from: Date;
    to: Date;
    quantityMetric: TariffQuantityMetric;
    electricalSource?: string;
    importCurrency: string;
    tariffRepo?: TariffReader;
    liveRepo?: LivePriceReader;
    /** Raw direction-tag rows used to prove metering coverage. */
    sourceRows?: Awaited<
        ReturnType<EnergyRepository['queryEnergy15minByChannel']>
    >;
    /** Conversion-backed gas rows, already expressed in the billed unit. */
    preparedRows?: readonly Energy15minCostRow[];
}

/** Resolve persisted sell/export assignments independently from buy/import. */
export async function readEnergyReportFeedInPricing(
    request: ReadEnergyReportFeedInRequest
): Promise<EnergyReportFeedInPricing | null> {
    const rawRows =
        request.sourceRows ??
        (await request.repo.queryEnergy15minByChannel({
            internalIds: request.internalIds,
            from: request.from,
            to: request.to,
            tags: tagsForQuantityMetric(request.quantityMetric),
            commodity: request.quantityMetric.commodity,
            electricalSource: request.electricalSource
        }));
    const rows = request.preparedRows
        ? [...request.preparedRows]
        : buildEnergyCostRows(rawRows, request.quantityMetric);
    const returnedUnits = rows.reduce((sum, row) => sum + row.returnedUnits, 0);

    const points = [
        ...new Map(
            rows.map((row) => {
                const point = {
                    deviceExternalId: request.deviceMap.get(row.device) ?? '',
                    channel: row.channel,
                    commodity: request.quantityMetric.commodity,
                    direction: 'export' as const
                };
                return [`${point.deviceExternalId}|${point.channel}`, point];
            })
        ).values()
    ].filter((point) => point.deviceExternalId !== '');
    const tariffRepo = request.tariffRepo ?? (await defaultTariffRepository());
    const plan = await buildPerPointPricingPlan({
        orgId: request.orgId,
        deviceMap: request.deviceMap,
        defaultTariff: null,
        from: request.from,
        to: request.to,
        rate: {
            tariffMode: 'single',
            tariff: 0,
            dayRate: 0,
            nightRate: 0,
            dayStartHour: 7,
            dayEndHour: 23,
            timezone: null
        },
        tariffRepo,
        liveRepo: request.liveRepo,
        strictAssignments: true,
        points,
        rows,
        quantityMetric: request.quantityMetric
    });
    // Import cost and export credit are displayed and netted in one report
    // quantity. Never let the gas resolver's raw-m3 conversion allowance turn
    // an m3 row into a kWh/therm/MMBtu/GJ credit without conversion.
    for (const row of rows) {
        const tariff = plan.resolve(row).tariff;
        if (!tariff) continue;
        const exportMetric = tariffQuantityMetric(tariff);
        if (exportMetric?.billedUnit !== request.quantityMetric.billedUnit) {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    `Import pricing uses billed unit ${request.quantityMetric.billedUnit} while export pricing uses ` +
                    `${exportMetric?.billedUnit ?? 'an unsupported unit'}. Fleet does not relabel or net unlike quantities.`,
                field: 'tariff.assignment.direction'
            });
        }
    }
    if (request.quantityMetric.commodity === 'gas' && plan.hasAssignments) {
        assertReturnedQuantityCoverage(
            rawRows,
            request.from,
            request.quantityMetric,
            rows
                .filter((row) => plan.resolve(row).tariff !== null)
                .map((row) => ({device: row.device, channel: row.channel}))
        );
    }
    if (returnedUnits <= 1e-12) return null;

    let credit = 0;
    let unpricedReturnedUnits = 0;
    const currencies = new Set<string>();
    const tariffIds = new Set<number>();
    for (const row of rows) {
        if (row.returnedUnits <= 0) continue;
        const resolution = plan.resolve(row);
        if (!resolution.tariff || !resolution.pricing) {
            unpricedReturnedUnits += row.returnedUnits;
            continue;
        }
        if (resolution.tariff.kind === 'block') {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    'A stepped (block) tariff prices consumption blocks and cannot price exported energy.',
                field: 'tariff.assignment.direction'
            });
        }
        currencies.add(resolution.tariff.currency);
        if (typeof resolution.tariff.id === 'number') {
            tariffIds.add(resolution.tariff.id);
        }
        credit += row.returnedUnits * resolution.pricing.price;
    }
    if (unpricedReturnedUnits > 1e-12 || !plan.hasAssignments) {
        return {
            status: 'unconfigured',
            returnedUnits,
            unpricedReturnedUnits,
            credit: null,
            currency: null,
            tariffIds: []
        };
    }
    if (currencies.size !== 1) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Export assignments use ${currencies.size} currencies; Fleet does not invent an exchange rate.`,
            field: 'tariff.assignment.direction'
        });
    }
    const currency = currencies.values().next().value!;
    if (currency !== request.importCurrency) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Import pricing uses ${request.importCurrency} while export pricing uses ${currency}. ` +
                'Fleet does not calculate a net value across currencies.',
            field: 'tariff.assignment.direction'
        });
    }
    return {
        status: 'priced',
        returnedUnits,
        unpricedReturnedUnits: 0,
        credit: roundCurrencyAmount(credit, currency),
        currency,
        tariffIds: [...tariffIds].sort((left, right) => left - right)
    };
}

export function appendEnergyReportFeedInSection(input: {
    rows: EnergyReportRow[];
    pricing: EnergyReportFeedInPricing | null;
    importEnergyCost: number;
    billedUnit: string;
}): void {
    if (!input.pricing) return;
    input.rows.push(energyRow({section: 'FEED-IN / EXPORTED ENERGY'}));
    if (
        input.pricing.status !== 'priced' ||
        input.pricing.credit === null ||
        input.pricing.currency === null
    ) {
        input.rows.push(
            energyRow({
                device: 'Feed-in credit unavailable',
                returned_kwh: +input.pricing.returnedUnits.toFixed(3),
                notes: 'Returned energy is recorded, but no persisted export tariff assignment covers every returned interval. No credit or net cost is invented.'
            })
        );
        input.rows.push({...energyRowBlank()});
        return;
    }
    const digits = currencyFractionDigits(input.pricing.currency);
    const symbol = currencySymbol(input.pricing.currency);
    const credit = input.pricing.credit;
    input.rows.push(
        energyRow({
            device: 'Feed-in credit',
            returned_kwh: +input.pricing.returnedUnits.toFixed(3),
            cost: `-${symbol}${credit.toFixed(digits)}`,
            notes:
                `Persisted export tariff assignment(s): ${input.pricing.tariffIds.join(', ')} · ` +
                `${input.billedUnit} sell/export pricing; never inferred from the import tariff`
        })
    );
    input.rows.push(
        energyRow({
            device: 'Net metered energy charge',
            cost: `${symbol}${roundCurrencyAmount(
                input.importEnergyCost - credit,
                input.pricing.currency
            ).toFixed(digits)}`,
            notes: 'Import energy charge minus feed-in credit. Standing, demand and tax charges are shown separately.'
        })
    );
    input.rows.push({...energyRowBlank()});
}
