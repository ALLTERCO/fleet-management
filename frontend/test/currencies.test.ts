import {describe, expect, it} from 'vitest';
import {
    CURRENCIES,
    CURRENCY_SYMBOLS,
    currencySymbol
} from '@/helpers/currencies';

describe('currencies', () => {
    it('lists the top-10 currencies and drops BGN', () => {
        expect(CURRENCIES).toEqual([
            'USD',
            'EUR',
            'JPY',
            'GBP',
            'CNY',
            'AUD',
            'CAD',
            'CHF',
            'HKD',
            'SGD'
        ]);
        expect(CURRENCIES).not.toContain('BGN');
        expect(CURRENCIES).toHaveLength(10);
    });

    it('every code has a symbol', () => {
        for (const c of CURRENCIES) expect(CURRENCY_SYMBOLS[c]).toBeTruthy();
    });

    it('currencySymbol falls back to the code, or EUR when unset', () => {
        expect(currencySymbol('USD')).toBe('$');
        expect(currencySymbol('BGN')).toBe('BGN'); // removed → shows the code
        expect(currencySymbol(null)).toBe('€');
        expect(currencySymbol(undefined)).toBe('€');
    });
});
