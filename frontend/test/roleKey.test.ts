// Single source of truth for the backend's roleKey regex
// (`^[a-z][a-z0-9_]*$`). Both isValidRoleKey and normalizeRoleKey must
// stay aligned with backend/src/types/api/virtualdevice.ts —
// ROLE_KEY_SCHEMA. The regression: AddDeviceWizard sent unsanitised
// input, the backend rejected with `validation failed at
// bindings[0].roleKey`, the user saw it as a cryptic failure.

import {describe, expect, it} from 'vitest';
import {isValidRoleKey, normalizeRoleKey} from '@/helpers/roleKey';

describe('isValidRoleKey', () => {
    it('accepts a single lowercase letter', () => {
        expect(isValidRoleKey('a')).toBe(true);
    });

    it('accepts letters + digits + underscore starting with a letter', () => {
        expect(isValidRoleKey('temp_sensor_01')).toBe(true);
    });

    it('rejects empty', () => {
        expect(isValidRoleKey('')).toBe(false);
    });

    it('rejects values starting with a digit', () => {
        expect(isValidRoleKey('1foo')).toBe(false);
    });

    it('rejects values starting with an underscore', () => {
        expect(isValidRoleKey('_foo')).toBe(false);
    });

    it('rejects uppercase letters', () => {
        expect(isValidRoleKey('Foo')).toBe(false);
    });

    it('rejects spaces, dashes, dots', () => {
        expect(isValidRoleKey('foo bar')).toBe(false);
        expect(isValidRoleKey('foo-bar')).toBe(false);
        expect(isValidRoleKey('foo.bar')).toBe(false);
    });
});

describe('normalizeRoleKey', () => {
    it('lowercases', () => {
        expect(normalizeRoleKey('FOO')).toBe('foo');
    });

    it('replaces spaces with underscore', () => {
        expect(normalizeRoleKey('foo bar')).toBe('foo_bar');
    });

    it('replaces dashes/dots with underscore', () => {
        expect(normalizeRoleKey('foo-bar.baz')).toBe('foo_bar_baz');
    });

    it('strips leading digits and underscores', () => {
        expect(normalizeRoleKey('123foo')).toBe('foo');
        expect(normalizeRoleKey('___foo')).toBe('foo');
    });

    it('returns empty when nothing valid remains', () => {
        expect(normalizeRoleKey('___')).toBe('');
        expect(normalizeRoleKey('123')).toBe('');
        expect(normalizeRoleKey('!!!')).toBe('');
    });

    it('preserves trailing digits/underscores', () => {
        expect(normalizeRoleKey('Temp Sensor 01')).toBe('temp_sensor_01');
    });

    it('is idempotent on already-valid input', () => {
        expect(normalizeRoleKey('temp_sensor_01')).toBe('temp_sensor_01');
    });

    it('always produces output that satisfies isValidRoleKey, or empty', () => {
        const cases = [
            'FOO',
            'Foo Bar',
            '1foo',
            '_temp',
            'Temp Sensor 01',
            'foo-bar',
            'a',
            ''
        ];
        for (const c of cases) {
            const out = normalizeRoleKey(c);
            if (out === '') continue;
            expect(isValidRoleKey(out)).toBe(true);
        }
    });
});
