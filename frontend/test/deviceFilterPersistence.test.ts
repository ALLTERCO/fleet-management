import {describe, expect, it} from 'vitest';
import {
    decodeDeviceFilterState,
    parseDeviceFilterState,
    parseDeviceSortMode,
    resolveLegacyGroupId
} from '@/helpers/deviceFilterPersistence';

describe('device filter persistence', () => {
    it('salvages valid current values while rejecting malformed field types', () => {
        const state = decodeDeviceFilterState({
            nameFilter: {unexpected: true},
            sortMode: 'not-a-sort',
            statusFilter: ['true', false, 'bogus'],
            typeFilter: ['Plus1PM', 17, '', 'Plus1PM'],
            groupFilter: '12',
            tagFilter: ['7', 'bad', 8, null],
            sourceFilter: ['physical', 'bogus', 'virtual'],
            locationFilter: {id: 9}
        });

        expect(state).toEqual({
            nameFilter: '',
            sortMode: 'online-az',
            statusFilter: ['true'],
            typeFilter: ['Plus1PM'],
            groupFilter: ['12'],
            tagFilter: ['7', '8'],
            sourceFilter: ['physical', 'virtual'],
            locationFilter: [],
            legacyGroupName: null
        });
    });

    it('migrates the v1.80 scalar preferences that still have current meaning', () => {
        const state = decodeDeviceFilterState({
            type: 'Plus1PM',
            group: 'Boiler room',
            online: false,
            nameFilter: 'pump',
            sortMode: 'za'
        });

        expect(state).toEqual({
            nameFilter: 'pump',
            sortMode: 'za',
            statusFilter: ['false'],
            typeFilter: ['Plus1PM'],
            groupFilter: [],
            tagFilter: [],
            sourceFilter: [],
            locationFilter: [],
            legacyGroupName: 'Boiler room'
        });
        expect(
            resolveLegacyGroupId('Boiler room', [
                {id: 4, name: 'Office'},
                {id: 9, name: 'Boiler room'}
            ])
        ).toBe('9');
    });

    it('treats legacy all-values as no active filter', () => {
        const state = decodeDeviceFilterState({
            type: 'All devices',
            group: 'All groups',
            online: null
        });

        expect(state.typeFilter).toEqual([]);
        expect(state.groupFilter).toEqual([]);
        expect(state.statusFilter).toEqual([]);
        expect(state.legacyGroupName).toBeNull();
    });

    it('normalizes persisted numeric ids and drops invalid ids', () => {
        const state = decodeDeviceFilterState({
            groupFilter: [1, '2', 0, -3, '4.5', 'NaN'],
            tagFilter: '6',
            locationFilter: [7, '0008']
        });

        expect(state.groupFilter).toEqual(['1', '2']);
        expect(state.tagFilter).toEqual(['6']);
        expect(state.locationFilter).toEqual(['7', '8']);
    });

    it('falls back safely for corrupt JSON and invalid sort values', () => {
        expect(parseDeviceFilterState('{not-json').sortMode).toBe('online-az');
        expect(parseDeviceSortMode('offline-first')).toBe('offline-first');
        expect(parseDeviceSortMode('random')).toBeNull();
        expect(parseDeviceSortMode(['az'])).toBeNull();
    });

    it('lets current-schema fields override legacy fields even when empty', () => {
        const state = decodeDeviceFilterState({
            statusFilter: [],
            typeFilter: [],
            groupFilter: [],
            online: true,
            type: 'Old model',
            group: 'Old group'
        });

        expect(state.statusFilter).toEqual([]);
        expect(state.typeFilter).toEqual([]);
        expect(state.groupFilter).toEqual([]);
        expect(state.legacyGroupName).toBeNull();
    });
});
