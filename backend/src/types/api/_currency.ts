// Single source of currency codes + symbols, shared by the backend report
// engine and the frontend (via the @api/* alias). The selectable code list is
// global (ICU/ISO 4217); these top-10 BIS symbol overrides disambiguate the
// most common glyph collisions, while every other currency falls back to code.
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

const FALLBACK_CURRENCIES = Object.freeze(Object.keys(CURRENCY_SYMBOLS));

/** Every ISO 4217 currency the current ICU runtime recognizes. */
export const CURRENCIES: readonly string[] = Object.freeze(
    typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('currency')
        : [...FALLBACK_CURRENCIES]
);

const CURRENCY_SET = new Set(CURRENCIES);

export function isSupportedCurrency(code: string): boolean {
    return CURRENCY_SET.has(code);
}

const FRACTION_DIGITS = new Map<string, number>();

/**
 * ISO 4217 minor-unit precision from ICU (JPY=0, USD=2, KWD=3). Invalid or
 * unavailable codes fall back to two digits so display never crashes; tariff
 * writes reject unsupported codes separately.
 */
export function currencyFractionDigits(
    code: string | null | undefined
): number {
    if (!code) return 2;
    const cached = FRACTION_DIGITS.get(code);
    if (cached !== undefined) return cached;
    try {
        const resolved = new Intl.NumberFormat('en', {
            style: 'currency',
            currency: code
        }).resolvedOptions().maximumFractionDigits;
        const digits = typeof resolved === 'number' ? resolved : 2;
        FRACTION_DIGITS.set(code, digits);
        return digits;
    } catch {
        return 2;
    }
}

/** Convert a currency amount to its integer ISO 4217 minor units. */
export function toCurrencyMinorUnits(
    amount: number,
    code: string | null | undefined
): number {
    return Math.round(amount * 10 ** currencyFractionDigits(code));
}

/** Convert integer ISO 4217 minor units back to a display amount. */
export function fromCurrencyMinorUnits(
    amount: number,
    code: string | null | undefined
): number {
    return amount / 10 ** currencyFractionDigits(code);
}

/** Round a currency amount to the precision defined by ISO 4217/ICU. */
export function roundCurrencyAmount(
    amount: number,
    code: string | null | undefined
): number {
    return fromCurrencyMinorUnits(toCurrencyMinorUnits(amount, code), code);
}

// Symbol for a code; falls back to the code itself, or EUR when unset.
export function currencySymbol(code: string | null | undefined): string {
    if (!code) return CURRENCY_SYMBOLS.EUR;
    return CURRENCY_SYMBOLS[code] ?? code;
}
