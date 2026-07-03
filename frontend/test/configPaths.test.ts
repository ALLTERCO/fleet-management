import {describe, expect, it} from 'vitest';
import {
    getNestedValue,
    isVarRef,
    nestConfig,
    setNestedValue
} from '@/helpers/configPaths';

describe('isVarRef — env template reference detector', () => {
    it('accepts ${VAR_NAME} so the form renders it read-only', () => {
        expect(isVarRef('${FLEET_MANAGER_WEBSOCKET}/shelly')).toBe(true);
    });

    it('rejects a plain string because regular values are editable', () => {
        expect(isVarRef('plain value')).toBe(false);
    });

    it('rejects an empty string so empty fields are not flagged', () => {
        expect(isVarRef('')).toBe(false);
    });

    it('rejects non-string values because only strings can carry ${} syntax', () => {
        expect(isVarRef(42)).toBe(false);
        expect(isVarRef(null)).toBe(false);
        expect(isVarRef(undefined)).toBe(false);
    });
});

describe('getNestedValue — dot-path traversal with safe fallback', () => {
    it('returns the leaf value for a real path so the form can read existing values', () => {
        expect(getNestedValue({ws: {enable: true}}, 'ws.enable')).toBe(true);
    });

    it('returns undefined when an intermediate key is missing instead of throwing', () => {
        expect(getNestedValue({ws: {}}, 'ws.enable')).toBeUndefined();
    });

    it('returns undefined when traversing into a non-object instead of throwing', () => {
        expect(getNestedValue({ws: true}, 'ws.enable')).toBeUndefined();
    });

    it('returns the top-level value for a single-segment path', () => {
        expect(getNestedValue({name: 'My'}, 'name')).toBe('My');
    });
});

describe('setNestedValue — mutates in place + creates intermediates', () => {
    it('sets a value at a flat path', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, {path: 'name', value: 'x'});
        expect(obj.name).toBe('x');
    });

    it('creates intermediate objects along the path so a new ws.enable lands cleanly', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, {path: 'ws.enable', value: true});
        expect(obj.ws).toEqual({enable: true});
    });

    it('preserves siblings of the modified key', () => {
        const obj: Record<string, unknown> = {ws: {server: 's', enable: false}};
        setNestedValue(obj, {path: 'ws.enable', value: true});
        expect(obj.ws).toEqual({server: 's', enable: true});
    });

    it('overwrites a primitive intermediate so the path still resolves', () => {
        const obj: Record<string, unknown> = {ws: 'wrong'};
        setNestedValue(obj, {path: 'ws.enable', value: true});
        expect(obj.ws).toEqual({enable: true});
    });
});

describe('nestConfig — flat dot-keyed object to nested', () => {
    it('expands a single dotted key into a nested object', () => {
        expect(nestConfig({'ws.enable': true})).toEqual({ws: {enable: true}});
    });

    it('merges multiple flat keys under a shared root', () => {
        const out = nestConfig({
            'ws.enable': true,
            'ws.server': 'x',
            'wifi.sta.ssid': 'home'
        });
        expect(out).toEqual({
            ws: {enable: true, server: 'x'},
            wifi: {sta: {ssid: 'home'}}
        });
    });

    it('passes a top-level key through unchanged', () => {
        expect(nestConfig({name: 'My'})).toEqual({name: 'My'});
    });

    it('returns an empty object for empty input', () => {
        expect(nestConfig({})).toEqual({});
    });
});
