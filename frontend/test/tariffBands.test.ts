import {describe, expect, it} from 'vitest';
import {
    colorForTouWindow,
    dayNightBands,
    pickTouSchedule,
    tariffOverlayBands,
    touBands
} from '@/helpers/tariffBands';

const HOURLY_24 = Array.from(
    {length: 24},
    (_, i) => `${String(i).padStart(2, '0')}:00`
);

describe('dayNightBands', () => {
    it('returns empty when tariffMode is not day_night', () => {
        const bands = dayNightBands(HOURLY_24, {
            tariffMode: 'single',
            dayStart: '07:00',
            dayEnd: '22:00'
        });
        expect(bands).toEqual([]);
    });

    it('returns empty when dayStart or dayEnd is missing', () => {
        const bands = dayNightBands(HOURLY_24, {tariffMode: 'day_night'});
        expect(bands).toEqual([]);
    });

    it('returns empty for non-time-of-day buckets (e.g. dated)', () => {
        const bands = dayNightBands(['Jan 1', 'Jan 2'], {
            tariffMode: 'day_night',
            dayStart: '07:00',
            dayEnd: '22:00'
        });
        expect(bands).toEqual([]);
    });

    it('emits a peak band from dayStart through the last day bucket', () => {
        const bands = dayNightBands(HOURLY_24, {
            tariffMode: 'day_night',
            dayStart: '07:00',
            dayEnd: '22:00'
        });
        const peak = bands.find((b) => b.label === 'Peak');
        expect(peak?.fromBucket).toBe('07:00');
        expect(peak?.toBucket).toBe('21:00');
    });

    it('emits an off-peak band covering the rest', () => {
        const bands = dayNightBands(HOURLY_24, {
            tariffMode: 'day_night',
            dayStart: '07:00',
            dayEnd: '22:00'
        });
        const off = bands.find((b) => b.label === 'Off-peak');
        expect(off?.fromBucket).toBe('00:00');
        expect(off?.toBucket).toBe('23:00');
    });

    it('handles a 24h all-day-rate config without crashing', () => {
        const bands = dayNightBands(HOURLY_24, {
            tariffMode: 'day_night',
            dayStart: '00:00',
            dayEnd: '24:00'
        });
        expect(bands.find((b) => b.label === 'Peak')).toBeTruthy();
        expect(bands.find((b) => b.label === 'Off-peak')).toBeUndefined();
    });
});

describe('touBands', () => {
    it('returns empty when tariffMode is not tou', () => {
        const bands = touBands(HOURLY_24, {tariffMode: 'day_night'});
        expect(bands).toEqual([]);
    });

    it('returns empty when no tariffWindows are configured', () => {
        const bands = touBands(HOURLY_24, {
            tariffMode: 'tou',
            tariffWindows: null
        });
        expect(bands).toEqual([]);
    });

    it('emits one band per window aligned to the visible buckets', () => {
        const bands = touBands(
            HOURLY_24,
            {
                tariffMode: 'tou',
                tariffWindows: [
                    {from: '00:00', to: '07:00', rate: 0.08, label: 'Night'},
                    {from: '07:00', to: '23:00', rate: 0.2, label: 'Peak'},
                    {from: '23:00', to: '24:00', rate: 0.08, label: 'Late'}
                ]
            },
            new Date('2026-05-27T12:00:00') // Wednesday
        );
        expect(bands).toHaveLength(3);
        expect(bands[0]).toMatchObject({
            fromBucket: '00:00',
            toBucket: '06:00',
            label: 'Night'
        });
        expect(bands[1]).toMatchObject({
            fromBucket: '07:00',
            toBucket: '22:00',
            label: 'Peak'
        });
        expect(bands[2]).toMatchObject({
            fromBucket: '23:00',
            toBucket: '23:00',
            label: 'Late'
        });
    });

    it('splits midnight-wrapping windows into two bands', () => {
        const bands = touBands(
            HOURLY_24,
            {
                tariffMode: 'tou',
                tariffWindows: [
                    {from: '22:00', to: '06:00', rate: 0.08, label: 'Night'},
                    {from: '06:00', to: '22:00', rate: 0.2, label: 'Peak'}
                ]
            },
            new Date('2026-05-27T12:00:00')
        );
        const nightBands = bands.filter((b) => b.label === 'Night');
        expect(nightBands).toHaveLength(2);
        expect(nightBands[0]).toMatchObject({
            fromBucket: '22:00',
            toBucket: '23:00'
        });
        expect(nightBands[1]).toMatchObject({
            fromBucket: '00:00',
            toBucket: '05:00'
        });
    });

    it('returns empty for non-time-of-day buckets', () => {
        const bands = touBands(['Jan 1', 'Jan 2'], {
            tariffMode: 'tou',
            tariffWindows: [
                {from: '00:00', to: '24:00', rate: 0.1, label: 'Flat'}
            ]
        });
        expect(bands).toEqual([]);
    });
});

describe('pickTouSchedule', () => {
    const base = [{from: '00:00', to: '24:00', rate: 0.2, label: 'Weekday'}];
    const weekend = [{from: '00:00', to: '24:00', rate: 0.1, label: 'Weekend'}];

    it('returns base on weekdays when no override is configured', () => {
        const out = pickTouSchedule(
            {tariffMode: 'tou', tariffWindows: base},
            new Date('2026-05-27T12:00:00') // Wednesday
        );
        expect(out).toBe(base);
    });

    it('returns the override on Saturday', () => {
        const out = pickTouSchedule(
            {
                tariffMode: 'tou',
                tariffWindows: base,
                tariffWeekendOverride: weekend
            },
            new Date('2026-05-30T12:00:00') // Saturday
        );
        expect(out).toBe(weekend);
    });

    it('returns the override on Sunday', () => {
        const out = pickTouSchedule(
            {
                tariffMode: 'tou',
                tariffWindows: base,
                tariffWeekendOverride: weekend
            },
            new Date('2026-05-31T12:00:00') // Sunday
        );
        expect(out).toBe(weekend);
    });

    it('returns the override on a holiday weekday', () => {
        const out = pickTouSchedule(
            {
                tariffMode: 'tou',
                tariffWindows: base,
                tariffWeekendOverride: weekend,
                tariffHolidays: ['2026-12-25']
            },
            new Date('2026-12-25T12:00:00')
        );
        expect(out).toBe(weekend);
    });

    it('returns null when there is no base schedule', () => {
        const out = pickTouSchedule(
            {tariffMode: 'tou'},
            new Date('2026-05-27T12:00:00')
        );
        expect(out).toBeNull();
    });
});

describe('colorForTouWindow', () => {
    const schedule = [
        {from: '00:00', to: '07:00', rate: 0.08},
        {from: '07:00', to: '17:00', rate: 0.14},
        {from: '17:00', to: '21:00', rate: 0.22},
        {from: '21:00', to: '24:00', rate: 0.08}
    ];

    it('maps the highest-rate window to the warm peak tone', () => {
        const c = colorForTouWindow(schedule[2], schedule);
        expect(c).toMatch(/warning/);
    });

    it('maps the lowest-rate window to the cool off-peak tone', () => {
        const c = colorForTouWindow(schedule[0], schedule);
        expect(c).toMatch(/primary/);
    });

    it('maps mid-rate windows to the neutral tone', () => {
        const c = colorForTouWindow(schedule[1], schedule);
        expect(c).toMatch(/text-tertiary/);
    });

    it('falls back to the neutral tone when a window has no rate', () => {
        const c = colorForTouWindow({from: '00:00', to: '24:00'}, [
            {from: '00:00', to: '24:00'}
        ]);
        expect(c).toMatch(/text-tertiary/);
    });
});

describe('tariffOverlayBands', () => {
    it('dispatches to dayNightBands for day_night mode', () => {
        const bands = tariffOverlayBands(HOURLY_24, {
            tariffMode: 'day_night',
            dayStart: '07:00',
            dayEnd: '22:00'
        });
        expect(bands.some((b) => b.label === 'Peak')).toBe(true);
    });

    it('dispatches to touBands for tou mode', () => {
        const bands = tariffOverlayBands(
            HOURLY_24,
            {
                tariffMode: 'tou',
                tariffWindows: [
                    {from: '00:00', to: '12:00', rate: 0.1, label: 'AM'},
                    {from: '12:00', to: '24:00', rate: 0.2, label: 'PM'}
                ]
            },
            new Date('2026-05-27T12:00:00')
        );
        expect(bands.some((b) => b.label === 'AM')).toBe(true);
        expect(bands.some((b) => b.label === 'PM')).toBe(true);
    });

    it('returns empty for single-rate mode', () => {
        expect(tariffOverlayBands(HOURLY_24, {tariffMode: 'single'})).toEqual(
            []
        );
    });
});
