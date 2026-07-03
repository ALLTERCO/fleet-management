// Single source of currency codes + symbols, shared by the backend report
// engine and the frontend (via the @api/* alias). Top-10 most-traded
// currencies (BIS); symbols disambiguated where the glyph collides.
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
    USD: '$',
    EUR: '€',
    JPY: '¥',
    GBP: '£',
    CNY: 'CN¥',
    AUD: 'A$',
    CAD: 'CA$',
    CHF: 'CHF',
    HKD: 'HK$',
    SGD: 'S$'
};

export const CURRENCIES: readonly string[] = Object.keys(CURRENCY_SYMBOLS);

// Symbol for a code; falls back to the code itself, or EUR when unset.
export function currencySymbol(code: string | null | undefined): string {
    if (!code) return CURRENCY_SYMBOLS.EUR;
    return CURRENCY_SYMBOLS[code] ?? code;
}
