import {describe, expect, it} from 'vitest';
import {averageByTag, countVoltageEvents, deltaLabel, hourlyProfile, roleKwh} from '@/components/dashboard/energy/energyLive.helpers';

describe('countVoltageEvents', () => {
    it('counts buckets with min under 207 or max over 253, once each', () => {
        const items = [
            {bucket: 'a', tag: 'min_voltage', value: 205}, // under → event
            {bucket: 'a', tag: 'max_voltage', value: 240},
            {bucket: 'b', tag: 'min_voltage', value: 230},
            {bucket: 'b', tag: 'max_voltage', value: 258}, // over → event
            {bucket: 'c', tag: 'min_voltage', value: 230},
            {bucket: 'c', tag: 'max_voltage', value: 240} // in band
        ];
        expect(countVoltageEvents(items)).toBe(2);
    });
    it('returns 0 for no items', () => {
        expect(countVoltageEvents([])).toBe(0);
    });
});

describe('averageByTag', () => {
    it('averages each tag and leaves flow null', () => {
        const items = [
            {tag: 'temperature', value: 20},
            {tag: 'temperature', value: 22},
            {tag: 'humidity', value: 50}
        ];
        expect(averageByTag(items)).toEqual({temp: 21, humidity: 50, luminance: null, flow: null});
    });
});

describe('hourlyProfile', () => {
    it('sums matching days per hour and divides by the day count', () => {
        const raw = [
            {day: 1, hour: 8, value: 10},
            {day: 2, hour: 8, value: 6},
            {day: 6, hour: 8, value: 4} // weekend, excluded
        ];
        const p = hourlyProfile(raw, (d) => d >= 1 && d <= 5, 2);
        expect(p[8]).toBe(8); // (10+6)/2
        expect(p[0]).toBe(0);
    });
    it('returns the raw sums when the day count is zero', () => {
        expect(hourlyProfile([{day: 1, hour: 0, value: 5}], () => true, 0)[0]).toBe(5);
    });
});

describe('roleKwh', () => {
    it('returns the role value or 0 when missing', () => {
        const groups = [{key: 'battery', value: 12}, {key: 'pv', value: 30}];
        expect(roleKwh(groups, 'battery')).toBe(12);
        expect(roleKwh(groups, 'ev_charge')).toBe(0);
        expect(roleKwh(undefined, 'pv')).toBe(0);
    });
});

describe('deltaLabel', () => {
    it('formats a signed percent, empty without a baseline', () => {
        expect(deltaLabel(110, 100)).toBe('+10%');
        expect(deltaLabel(90, 100)).toBe('-10%');
        expect(deltaLabel(50, 0)).toBe('');
        expect(deltaLabel(50, undefined)).toBe('');
    });
});
