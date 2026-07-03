/** Carbon footprint helper. Pure: kWh × g/kWh → kg CO₂e + relatable equivalents.
 *  Emission factor defaults to EU-mix marginal; callers override per-org. */

export interface CarbonInput {
    readonly kwh: number;
    readonly factorGPerKWh: number;
}

export interface CarbonResult {
    readonly kgCO2: number;
    readonly equivalents: {
        readonly kmDriven: number;
        readonly treesYear: number;
    };
}

// Sources: EPA passenger-car average 192 g CO₂/km; mature tree 21 kg CO₂/year.
const G_CO2_PER_KM_DRIVEN = 192;
const KG_CO2_ABSORBED_PER_TREE_PER_YEAR = 21;

export function computeCarbon({kwh, factorGPerKWh}: CarbonInput): CarbonResult {
    if (
        !Number.isFinite(kwh) ||
        kwh <= 0 ||
        !Number.isFinite(factorGPerKWh) ||
        factorGPerKWh <= 0
    ) {
        return {kgCO2: 0, equivalents: {kmDriven: 0, treesYear: 0}};
    }
    const grams = kwh * factorGPerKWh;
    const kgCO2 = +(grams / 1000).toFixed(2);
    const kmDriven = +(grams / G_CO2_PER_KM_DRIVEN).toFixed(0);
    const treesYear = +(kgCO2 / KG_CO2_ABSORBED_PER_TREE_PER_YEAR).toFixed(2);
    return {kgCO2, equivalents: {kmDriven, treesYear}};
}
