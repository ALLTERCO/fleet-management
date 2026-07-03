// Unit tests for the pure parsers used by GroupMetadataForm. They live
// outside the .vue file precisely so they're testable without a DOM
// harness — one test per behavior, one focus per test.

import {describe, expect, it} from 'vitest';
import {
    parseCsvArrayInput,
    parseNumericInput
} from '@/helpers/groupMetadataParse';

describe('parseNumericInput', () => {
    it('returns ok with the integer value for clean integer input', () => {
        expect(parseNumericInput('42', 'integer')).toEqual({
            ok: true,
            value: 42
        });
    });

    it('returns ok with the float value for clean number input', () => {
        expect(parseNumericInput('3.14', 'number')).toEqual({
            ok: true,
            value: 3.14
        });
    });

    it('rejects decimals when integer is expected (no silent truncation)', () => {
        expect(parseNumericInput('1.5', 'integer')).toEqual({
            ok: false,
            error: 'Integer required — no decimals.'
        });
    });

    it('rejects exponent notation when integer is expected', () => {
        expect(parseNumericInput('1e3', 'integer')).toEqual({
            ok: false,
            error: 'Integer required — no decimals.'
        });
    });

    it('rejects garbage as not-a-number for both kinds', () => {
        expect(parseNumericInput('abc', 'integer').ok).toBe(false);
        expect(parseNumericInput('abc', 'number').ok).toBe(false);
    });

    it('accepts exponent notation when number is expected', () => {
        expect(parseNumericInput('1e3', 'number')).toEqual({
            ok: true,
            value: 1000
        });
    });

    it('accepts negative integers', () => {
        expect(parseNumericInput('-5', 'integer')).toEqual({
            ok: true,
            value: -5
        });
    });

    it('returns ok with NaN-rejected error on empty input', () => {
        // Component layer special-cases '' to clear the field BEFORE
        // calling the parser. Pin behavior so the parser stays honest
        // about what an empty string actually is (not a number).
        expect(parseNumericInput('', 'integer').ok).toBe(false);
    });
});

describe('parseCsvArrayInput', () => {
    it('returns empty array for empty input (caller decides clear vs store)', () => {
        expect(parseCsvArrayInput('', 'integer')).toEqual({
            ok: true,
            value: []
        });
    });

    it('parses a comma-separated integer list', () => {
        expect(parseCsvArrayInput('1, 3, 5', 'integer')).toEqual({
            ok: true,
            value: [1, 3, 5]
        });
    });

    it('drops decimal items in an integer list (no silent truncation)', () => {
        expect(parseCsvArrayInput('1, 2.5, 3', 'integer')).toEqual({
            ok: true,
            value: [1, 3]
        });
    });

    it('parses a comma-separated number list including floats', () => {
        expect(parseCsvArrayInput('1, 2.5, 3', 'number')).toEqual({
            ok: true,
            value: [1, 2.5, 3]
        });
    });

    it('preserves strings as-is for string item type', () => {
        expect(parseCsvArrayInput('a, b, c', 'string')).toEqual({
            ok: true,
            value: ['a', 'b', 'c']
        });
    });

    it('drops empty segments from trailing commas / double commas', () => {
        expect(parseCsvArrayInput('a, , b,', 'string')).toEqual({
            ok: true,
            value: ['a', 'b']
        });
    });
});
