import {describe, expect, it} from 'vitest';
import {formatRoundedNumber} from '../src/helpers/numberDisplay';

describe('rounded number display', () => {
    it('normalizes signed zero after rounding', () => {
        expect(formatRoundedNumber(-0, 1)).toBe('0.0');
        expect(formatRoundedNumber(-0.04, 1)).toBe('0.0');
        expect(formatRoundedNumber(-0.001, 2)).toBe('0.00');
    });

    it('preserves meaningful signed values and required decimals', () => {
        expect(formatRoundedNumber(-0.06, 1)).toBe('-0.1');
        expect(formatRoundedNumber(-1.25, 1)).toBe('-1.3');
        expect(formatRoundedNumber(0, 2)).toBe('0.00');
        expect(formatRoundedNumber(1.25, 2)).toBe('1.25');
    });
});
