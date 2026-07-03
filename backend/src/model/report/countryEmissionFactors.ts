// ISO-3166 alpha-2 → g CO₂e/kWh (LBM, Ember Climate 2023). Used as UI defaults.

export interface CountryEmissionFactor {
    readonly code: string;
    readonly name: string;
    readonly gPerKWh: number;
}

const TABLE: Readonly<Record<string, CountryEmissionFactor>> = {
    AT: {code: 'AT', name: 'Austria', gPerKWh: 85},
    AU: {code: 'AU', name: 'Australia', gPerKWh: 510},
    BE: {code: 'BE', name: 'Belgium', gPerKWh: 140},
    BG: {code: 'BG', name: 'Bulgaria', gPerKWh: 410},
    BR: {code: 'BR', name: 'Brazil', gPerKWh: 80},
    CA: {code: 'CA', name: 'Canada', gPerKWh: 130},
    CH: {code: 'CH', name: 'Switzerland', gPerKWh: 30},
    CN: {code: 'CN', name: 'China', gPerKWh: 580},
    CZ: {code: 'CZ', name: 'Czechia', gPerKWh: 410},
    DE: {code: 'DE', name: 'Germany', gPerKWh: 340},
    DK: {code: 'DK', name: 'Denmark', gPerKWh: 140},
    EE: {code: 'EE', name: 'Estonia', gPerKWh: 440},
    ES: {code: 'ES', name: 'Spain', gPerKWh: 135},
    FI: {code: 'FI', name: 'Finland', gPerKWh: 75},
    FR: {code: 'FR', name: 'France', gPerKWh: 50},
    GB: {code: 'GB', name: 'United Kingdom', gPerKWh: 180},
    GR: {code: 'GR', name: 'Greece', gPerKWh: 330},
    HR: {code: 'HR', name: 'Croatia', gPerKWh: 180},
    HU: {code: 'HU', name: 'Hungary', gPerKWh: 190},
    IE: {code: 'IE', name: 'Ireland', gPerKWh: 250},
    IN: {code: 'IN', name: 'India', gPerKWh: 720},
    IT: {code: 'IT', name: 'Italy', gPerKWh: 210},
    JP: {code: 'JP', name: 'Japan', gPerKWh: 420},
    KR: {code: 'KR', name: 'South Korea', gPerKWh: 440},
    LT: {code: 'LT', name: 'Lithuania', gPerKWh: 150},
    LV: {code: 'LV', name: 'Latvia', gPerKWh: 95},
    MX: {code: 'MX', name: 'Mexico', gPerKWh: 410},
    NL: {code: 'NL', name: 'Netherlands', gPerKWh: 270},
    NO: {code: 'NO', name: 'Norway', gPerKWh: 25},
    NZ: {code: 'NZ', name: 'New Zealand', gPerKWh: 100},
    PL: {code: 'PL', name: 'Poland', gPerKWh: 635},
    PT: {code: 'PT', name: 'Portugal', gPerKWh: 140},
    RO: {code: 'RO', name: 'Romania', gPerKWh: 250},
    RS: {code: 'RS', name: 'Serbia', gPerKWh: 690},
    SE: {code: 'SE', name: 'Sweden', gPerKWh: 25},
    SI: {code: 'SI', name: 'Slovenia', gPerKWh: 220},
    SK: {code: 'SK', name: 'Slovakia', gPerKWh: 95},
    TR: {code: 'TR', name: 'Turkey', gPerKWh: 430},
    UA: {code: 'UA', name: 'Ukraine', gPerKWh: 250},
    US: {code: 'US', name: 'United States', gPerKWh: 370},
    ZA: {code: 'ZA', name: 'South Africa', gPerKWh: 870}
};

export function lookupCountryEmissionFactor(
    code: string
): CountryEmissionFactor | null {
    if (!code) return null;
    return TABLE[code.toUpperCase()] ?? null;
}

export function listCountryEmissionFactors(): readonly CountryEmissionFactor[] {
    return Object.values(TABLE).sort((a, b) => a.name.localeCompare(b.name));
}
