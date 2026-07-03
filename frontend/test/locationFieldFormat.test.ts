/** One test per exported field-format helper. Each assertion targets a
 *  single, specific behaviour so a regression points at the rule it broke. */

import {describe, expect, it} from 'vitest';
import {
    type ContactValue,
    formatAddress,
    formatCount,
    formatGeo,
    formatRange,
    joinNonEmpty,
    readContact,
    readInt,
    readNumber,
    readString
} from '@/helpers/location-field-format';

describe('readString — usable string only', () => {
    it('returns the raw string when it has at least one character', () => {
        expect(readString('Sofia')).toBe('Sofia');
    });

    it('rejects the empty string because empty is not usable for display', () => {
        expect(readString('')).toBeNull();
    });

    it('rejects non-string inputs so callers can short-circuit safely', () => {
        expect(readString(42)).toBeNull();
        expect(readString(null)).toBeNull();
        expect(readString(undefined)).toBeNull();
        expect(readString({})).toBeNull();
    });
});

describe('readInt — integer only', () => {
    it('returns the integer when input is a whole number', () => {
        expect(readInt(7)).toBe(7);
    });

    it('rejects floats because callers expect integer semantics (floor, year, count)', () => {
        expect(readInt(7.5)).toBeNull();
    });

    it('rejects NaN even though typeof NaN is number', () => {
        expect(readInt(Number.NaN)).toBeNull();
    });
});

describe('readNumber — finite number only', () => {
    it('returns the value when it is a finite number', () => {
        expect(readNumber(3.14)).toBe(3.14);
    });

    it('rejects Infinity so format helpers never print an unbounded value', () => {
        expect(readNumber(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('rejects NaN to keep downstream toFixed() calls safe', () => {
        expect(readNumber(Number.NaN)).toBeNull();
    });
});

describe('formatCount — locale-formatted integer', () => {
    it('drops fractional digits even when given a float', () => {
        expect(formatCount(1234.56)).not.toMatch(/\./);
    });

    it('includes a thousands separator for legibility', () => {
        expect(formatCount(1000)).toMatch(/[, ]/);
    });
});

describe('formatGeo — "lat, lng" or null', () => {
    it('formats both coordinates to four decimal places', () => {
        expect(formatGeo({lat: 42.69876, lng: 23.32111})).toBe(
            '42.6988, 23.3211'
        );
    });

    it('returns null when either coord is missing so the caller can hide the row', () => {
        expect(formatGeo({lat: 42.7})).toBeNull();
        expect(formatGeo({lng: 23.3})).toBeNull();
    });

    it('returns null when given a non-object (an array would fool typeof object)', () => {
        expect(formatGeo([42.7, 23.3])).toBeNull();
        expect(formatGeo('42.7, 23.3')).toBeNull();
    });
});

describe('formatAddress — comma-joined single line', () => {
    it('joins streetName+streetNumber, postal+city, region, countryCode in order', () => {
        const address = {
            streetName: 'Vitosha Blvd',
            streetNumber: '1',
            postalCode: '1000',
            city: 'Sofia',
            region: 'Sofia City',
            countryCode: 'BG'
        };
        expect(formatAddress(address)).toBe(
            'Vitosha Blvd 1, 1000 Sofia, Sofia City, BG'
        );
    });

    it('omits empty parts instead of leaving dangling commas', () => {
        const address = {
            streetName: 'Vitosha',
            streetNumber: '1',
            city: 'Sofia'
        };
        expect(formatAddress(address)).toBe('Vitosha 1, Sofia');
    });

    it('returns null when every part is missing so the caller can skip the section', () => {
        expect(formatAddress({})).toBeNull();
        expect(formatAddress(null)).toBeNull();
    });
});

describe('readContact — validated ContactValue', () => {
    it('builds a contact when at minimum a name is provided', () => {
        const result = readContact({name: 'Anna'});
        expect(result).not.toBeNull();
        expect((result as ContactValue).name).toBe('Anna');
    });

    it('rejects a contact entry without a name because it has no identity to display', () => {
        expect(readContact({email: 'a@b.com'})).toBeNull();
    });

    it('preserves afterHours as a strict boolean — truthy strings do not slip through', () => {
        const result = readContact({name: 'Anna', afterHours: 'yes'});
        expect((result as ContactValue).afterHours).toBe(false);
    });
});

describe('formatRange — temperature/humidity windows', () => {
    it('renders the full range when both bounds are set', () => {
        expect(formatRange({min: 20, max: 24, unit: '°C'})).toBe('20–24 °C');
    });

    it('renders the min as ≥ when only the lower bound is set', () => {
        expect(formatRange({min: 20, max: null, unit: '°C'})).toBe('≥ 20 °C');
    });

    it('renders the max as ≤ when only the upper bound is set', () => {
        expect(formatRange({min: null, max: 24, unit: '°C'})).toBe('≤ 24 °C');
    });

    it('falls back to em-dash when neither bound is set', () => {
        expect(formatRange({min: null, max: null, unit: '°C'})).toBe('—');
    });
});

describe('joinNonEmpty — separator-joined string', () => {
    it('joins only the non-empty parts with the given separator', () => {
        expect(joinNonEmpty(' ', ['1000', null, 'Sofia'])).toBe('1000 Sofia');
    });

    it('returns null when every part is empty so callers can skip the result', () => {
        expect(joinNonEmpty(' ', [null, null])).toBeNull();
    });
});
