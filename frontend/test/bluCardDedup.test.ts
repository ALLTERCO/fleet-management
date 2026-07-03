// Dedup a gateway's BLU sensor card against its promoted device (same physical
// sensor, matched by BLE MAC). One card per sensor, sourced from the promoted
// device when it exists.

import {describe, expect, it} from 'vitest';
import {
    buildPromotedBluByMac,
    normalizeMac,
    promotedForAddr
} from '@/helpers/bluCardDedup';

describe('normalizeMac', () => {
    it('strips separators and lowercases', () => {
        expect(normalizeMac('AA:BB:CC:DD:EE:01')).toBe('aabbccddee01');
        expect(normalizeMac('aa-bb-cc-dd-ee-01')).toBe('aabbccddee01');
    });
    it('is empty for missing input', () => {
        expect(normalizeMac(undefined)).toBe('');
        expect(normalizeMac('')).toBe('');
    });
});

const bluDevice = (shellyID: string, stableId: string) =>
    ({
        shellyID,
        source: 'bluetooth',
        meta: {bluetoothDevice: {stableId}}
    }) as never;

describe('buildPromotedBluByMac', () => {
    it('keys promoted bluetooth devices by normalized MAC, ignoring others', () => {
        const map = buildPromotedBluByMac([
            bluDevice('blu-1', 'aabbccddee01'),
            {shellyID: 'shelly-9', source: 'shelly'} as never
        ]);
        expect(map.size).toBe(1);
        expect(map.get('aabbccddee01')).toMatchObject({shellyID: 'blu-1'});
    });
});

describe('promotedForAddr', () => {
    it('matches a gateway child addr to its promoted device', () => {
        const map = buildPromotedBluByMac([bluDevice('blu-1', 'aabbccddee01')]);
        expect(promotedForAddr('AA:BB:CC:DD:EE:01', map)).toMatchObject({
            shellyID: 'blu-1'
        });
        expect(promotedForAddr('00:00:00:00:00:00', map)).toBeUndefined();
    });

    it('matches by bleAddress when it differs from stableId (no double-show)', () => {
        const dev = {
            shellyID: 'blu-2',
            source: 'bluetooth',
            meta: {
                bluetoothDevice: {
                    stableId: 'ffffffffffff',
                    bleAddress: 'AA:BB:CC:DD:EE:02'
                }
            }
        } as never;
        const map = buildPromotedBluByMac([dev]);
        expect(promotedForAddr('AA:BB:CC:DD:EE:02', map)).toMatchObject({
            shellyID: 'blu-2'
        });
    });
});
