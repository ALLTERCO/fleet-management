import {describe, expect, it} from 'vitest';
import {
    filterPinsByQuery,
    filterPinsByStatus,
    pinMatchesQuery,
    pinMatchesStatusFilter
} from '@/helpers/mapPinFilter';
import type {MapPin} from '@/types/map';

const PIN_ON: MapPin = {id: '1', lat: 0, lng: 0, status: 'on'};
const PIN_WARN: MapPin = {id: '2', lat: 0, lng: 0, status: 'warn'};
const PIN_OFF: MapPin = {id: '3', lat: 0, lng: 0, status: 'off'};
const PIN_BLANK: MapPin = {id: '4', lat: 0, lng: 0};

describe('pinMatchesStatusFilter', () => {
    it('accepts every pin under the all filter', () => {
        expect(pinMatchesStatusFilter(PIN_BLANK, 'all')).toBe(true);
        expect(pinMatchesStatusFilter(PIN_ON, 'all')).toBe(true);
    });
    it('admits only pins whose status equals the filter', () => {
        expect(pinMatchesStatusFilter(PIN_ON, 'on')).toBe(true);
        expect(pinMatchesStatusFilter(PIN_WARN, 'on')).toBe(false);
    });
    it('rejects pins without a status when the filter requires one', () => {
        expect(pinMatchesStatusFilter(PIN_BLANK, 'on')).toBe(false);
    });
});

describe('filterPinsByStatus', () => {
    it('preserves the input list for the all filter', () => {
        const pins = [PIN_ON, PIN_WARN, PIN_OFF];
        expect(filterPinsByStatus(pins, 'all')).toBe(pins);
    });
    it('returns only pins matching the requested status', () => {
        const pins = [PIN_ON, PIN_WARN, PIN_OFF, PIN_BLANK];
        expect(filterPinsByStatus(pins, 'warn')).toEqual([PIN_WARN]);
    });
});

describe('pinMatchesQuery', () => {
    it('accepts everything when the query is blank or whitespace-only', () => {
        const pin = {id: '1', lat: 0, lng: 0, label: 'HQ'};
        expect(pinMatchesQuery(pin, '')).toBe(true);
        expect(pinMatchesQuery(pin, '   ')).toBe(true);
    });
    it('matches case-insensitively against the pin label substring', () => {
        const pin = {id: '1', lat: 0, lng: 0, label: 'Sofia Office'};
        expect(pinMatchesQuery(pin, 'sof')).toBe(true);
        expect(pinMatchesQuery(pin, 'OFFICE')).toBe(true);
        expect(pinMatchesQuery(pin, 'munich')).toBe(false);
    });
    it('rejects pins without a label when the query is set', () => {
        const pin: MapPin = {id: '1', lat: 0, lng: 0};
        expect(pinMatchesQuery(pin, 'anything')).toBe(false);
    });
});

describe('filterPinsByQuery', () => {
    it('returns the input list for a blank query', () => {
        const pins = [PIN_ON];
        expect(filterPinsByQuery(pins, '')).toBe(pins);
    });
    it('narrows pins down to those whose label contains the query', () => {
        const pins: MapPin[] = [
            {id: '1', lat: 0, lng: 0, label: 'Sofia'},
            {id: '2', lat: 0, lng: 0, label: 'Munich'}
        ];
        expect(filterPinsByQuery(pins, 'sof')).toEqual([pins[0]]);
    });
});
