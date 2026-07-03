import {describe, expect, it} from 'vitest';
import {
    DEVICE_TYPES,
    type DeviceType,
    deviceTypeOf,
    filterByDeviceType,
    holdsSelectedClass
} from '@/helpers/deviceTypeFilter';

describe('deviceTypeOf', () => {
    it('maps shelly source to physical', () => {
        expect(deviceTypeOf('shelly')).toBe('physical');
    });

    it('passes bluetooth and virtual through unchanged', () => {
        expect(deviceTypeOf('bluetooth')).toBe('bluetooth');
        expect(deviceTypeOf('virtual')).toBe('virtual');
    });

    it('treats a missing or unknown source as physical', () => {
        expect(deviceTypeOf(undefined)).toBe('physical');
        expect(deviceTypeOf(null)).toBe('physical');
        expect(deviceTypeOf('something-else')).toBe('physical');
    });
});

describe('filterByDeviceType', () => {
    const items = [
        {name: 'A', type: 'physical' as DeviceType},
        {name: 'B', type: 'bluetooth' as DeviceType},
        {name: 'C', type: 'virtual' as DeviceType}
    ];

    it('returns the input unchanged when nothing is selected', () => {
        const out = filterByDeviceType(items, (i) => i.type, new Set());
        expect(out).toBe(items);
    });

    it('returns the input unchanged when every type is selected', () => {
        const out = filterByDeviceType(
            items,
            (i) => i.type,
            new Set(DEVICE_TYPES)
        );
        expect(out).toBe(items);
    });

    it('keeps only the selected types', () => {
        const out = filterByDeviceType(
            items,
            (i) => i.type,
            new Set<DeviceType>(['bluetooth', 'virtual'])
        );
        expect(out.map((i) => i.name)).toEqual(['B', 'C']);
    });
});

describe('holdsSelectedClass', () => {
    it('matches everything when nothing or all is selected', () => {
        expect(holdsSelectedClass(['bluetooth'], new Set())).toBe(true);
        expect(holdsSelectedClass(['shelly'], new Set(DEVICE_TYPES))).toBe(
            true
        );
    });

    it('is true when any source falls in the selected classes', () => {
        const sel = new Set<DeviceType>(['virtual']);
        expect(holdsSelectedClass(['shelly', 'virtual'], sel)).toBe(true);
    });

    it('is false when no source falls in the selected classes', () => {
        const sel = new Set<DeviceType>(['virtual']);
        expect(holdsSelectedClass(['shelly', 'bluetooth'], sel)).toBe(false);
    });

    it('treats an unknown source as physical', () => {
        const sel = new Set<DeviceType>(['physical']);
        expect(holdsSelectedClass([undefined, null], sel)).toBe(true);
    });

    it('is false for an empty container under an active filter', () => {
        expect(holdsSelectedClass([], new Set<DeviceType>(['virtual']))).toBe(
            false
        );
    });
});
