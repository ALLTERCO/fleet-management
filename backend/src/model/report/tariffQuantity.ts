import type {EnergyCommodity} from '../../types/api/energy';
import type {TariffBilledUnit, TariffSpec} from '../../types/api/tariff';

export interface TariffQuantityMetric {
    commodity: EnergyCommodity;
    billedUnit: TariffBilledUnit;
    consumptionTag: string;
    returnedTag: string | null;
    storedUnitsPerBilledUnit: number;
    requiresConversion?: 'gas';
}

const QUANTITY_METRICS: readonly TariffQuantityMetric[] = [
    {
        commodity: 'electricity',
        billedUnit: 'kWh',
        consumptionTag: 'total_act_energy',
        returnedTag: 'total_act_ret_energy',
        storedUnitsPerBilledUnit: 1_000
    },
    {
        commodity: 'water',
        billedUnit: 'm3',
        consumptionTag: 'volume_m3',
        returnedTag: null,
        storedUnitsPerBilledUnit: 1
    },
    {
        commodity: 'water',
        billedUnit: 'l',
        consumptionTag: 'volume_l',
        returnedTag: null,
        storedUnitsPerBilledUnit: 1
    },
    {
        commodity: 'gas',
        billedUnit: 'm3',
        consumptionTag: 'volume_m3',
        returnedTag: 'volume_returned_m3',
        storedUnitsPerBilledUnit: 1
    },
    ...(['kWh', 'therm', 'MMBtu', 'GJ'] as const).map((billedUnit) => ({
        commodity: 'gas' as const,
        billedUnit,
        consumptionTag: 'volume_m3',
        returnedTag: 'volume_returned_m3',
        storedUnitsPerBilledUnit: 1,
        requiresConversion: 'gas' as const
    })),
    {
        commodity: 'heat',
        billedUnit: 'kWh',
        consumptionTag: 'thermal_energy_kwh',
        returnedTag: null,
        storedUnitsPerBilledUnit: 1
    }
];

export function tariffCommodity(
    tariff: Pick<TariffSpec, 'commodity'>
): EnergyCommodity {
    return tariff.commodity ?? 'electricity';
}

export function tariffBilledUnit(
    tariff: Pick<TariffSpec, 'billedUnit'>
): TariffBilledUnit {
    return tariff.billedUnit ?? 'kWh';
}

export function tariffQuantityMetric(
    tariff: Pick<TariffSpec, 'commodity' | 'billedUnit'>
): TariffQuantityMetric | null {
    return quantityMetric(tariffCommodity(tariff), tariffBilledUnit(tariff));
}

export function quantityMetric(
    commodity: EnergyCommodity,
    billedUnit: TariffBilledUnit
): TariffQuantityMetric | null {
    return (
        QUANTITY_METRICS.find(
            (metric) =>
                metric.commodity === commodity &&
                metric.billedUnit === billedUnit
        ) ?? null
    );
}

export function defaultBilledUnit(
    commodity: EnergyCommodity
): TariffBilledUnit {
    return commodity === 'water' || commodity === 'gas' ? 'm3' : 'kWh';
}

export function quantityMetricForTags(
    commodity: EnergyCommodity,
    tags: readonly string[]
): TariffQuantityMetric | null {
    const matches = QUANTITY_METRICS.filter(
        (metric) =>
            metric.commodity === commodity &&
            !metric.requiresConversion &&
            tags.includes(metric.consumptionTag)
    );
    return matches.length === 1 ? matches[0] : null;
}

export function storedQuantityToBilled(
    storedValue: number,
    metric: Pick<TariffQuantityMetric, 'storedUnitsPerBilledUnit'>
): number {
    if ('requiresConversion' in metric && metric.requiresConversion) {
        throw new Error(
            `${metric.requiresConversion} quantity requires a conversion profile`
        );
    }
    return storedValue / metric.storedUnitsPerBilledUnit;
}

/**
 * The metric actually stored for a billed metric. Gas billed in energy units is
 * metered as volume, so reads and coverage probes both have to ask for the raw
 * quantity, never the billed one.
 */
export function rawQuantityMetric(
    metric: TariffQuantityMetric
): TariffQuantityMetric | null {
    return metric.requiresConversion ? quantityMetric('gas', 'm3') : metric;
}

export function tagsForQuantityMetric(metric: TariffQuantityMetric): string[] {
    return metric.returnedTag
        ? [metric.consumptionTag, metric.returnedTag]
        : [metric.consumptionTag];
}
