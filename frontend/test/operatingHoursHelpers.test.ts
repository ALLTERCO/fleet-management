// One focused test per exported transform/answer in operating-hours.ts.
// Naming intentionally describes the rule, not the function symbol — a
// regression points at the broken behaviour, not the call site.

import {describe, expect, it} from 'vitest';
import {
    clear247,
    closeDay,
    copyPreviousDayHours,
    DEFAULT_CLOSE_TIME,
    DEFAULT_OPEN_TIME,
    dayHoursErrorMessage,
    isDayClosed,
    isOvernightShift,
    isValidTime,
    type OperatingHoursValue,
    openDayWithDefaults,
    previousDay,
    readCloseTime,
    readDayHours,
    readOpenTime,
    setDayTime,
    setOpen247,
    timeToMinutes
} from '@/helpers/operating-hours';

describe('isDayClosed — closed only when explicitly null', () => {
    it('reports unset days as not closed because the user has not decided yet', () => {
        expect(isDayClosed({}, 'mon')).toBe(false);
    });

    it('reports explicitly nulled days as closed because that is the closed marker', () => {
        const v: OperatingHoursValue = {days: {mon: null}};
        expect(isDayClosed(v, 'mon')).toBe(true);
    });

    it('reports days with hours as not closed because hours imply the day is open', () => {
        const v: OperatingHoursValue = {
            days: {mon: {open: '08:00', close: '16:00'}}
        };
        expect(isDayClosed(v, 'mon')).toBe(false);
    });
});

describe('default time fallback — widget needs a stable starting value', () => {
    it('returns the open-time default when the day has no hours yet', () => {
        expect(readOpenTime({}, 'tue')).toBe(DEFAULT_OPEN_TIME);
    });

    it('returns the close-time default when the day has no hours yet', () => {
        expect(readCloseTime({}, 'tue')).toBe(DEFAULT_CLOSE_TIME);
    });

    it('returns the stored open time when the day already has hours', () => {
        const v: OperatingHoursValue = {
            days: {wed: {open: '07:30', close: '15:30'}}
        };
        expect(readOpenTime(v, 'wed')).toBe('07:30');
    });
});

describe('setOpen247 — flips the entire week to always-open', () => {
    it('produces a 24/7 value with no per-day entries because they would conflict', () => {
        expect(setOpen247()).toEqual({twentyFourSeven: true});
    });
});

describe('clear247 — leaves 24/7 mode with an empty week', () => {
    it('removes the flag and gives a fresh empty days object so per-day editing can begin', () => {
        expect(clear247()).toEqual({days: {}});
    });
});

describe('setDayTime — edits one day without touching the rest', () => {
    it('updates the open time for the requested day only', () => {
        const before: OperatingHoursValue = {
            days: {
                mon: {open: '09:00', close: '17:00'},
                tue: {open: '08:00', close: '16:00'}
            }
        };
        const after = setDayTime(before, {
            day: 'mon',
            field: 'open',
            time: '06:30'
        });
        expect(after.days?.mon).toEqual({open: '06:30', close: '17:00'});
        expect(after.days?.tue).toEqual({open: '08:00', close: '16:00'});
    });

    it('seeds defaults when editing a previously-unset day so the close time still exists', () => {
        const after = setDayTime(
            {},
            {day: 'fri', field: 'open', time: '10:00'}
        );
        expect(after.days?.fri).toEqual({
            open: '10:00',
            close: DEFAULT_CLOSE_TIME
        });
    });

    it('drops twentyFourSeven because any per-day edit means the user moved off 24/7', () => {
        const before: OperatingHoursValue = {twentyFourSeven: true};
        const after = setDayTime(before, {
            day: 'mon',
            field: 'open',
            time: '09:00'
        });
        expect(after.twentyFourSeven).toBeUndefined();
    });
});

describe('closeDay — marker for "explicitly closed today"', () => {
    it('writes null for the day so isDayClosed can distinguish it from unset', () => {
        const after = closeDay({}, 'sat');
        expect(after.days?.sat).toBeNull();
    });

    it('preserves other days when closing one', () => {
        const before: OperatingHoursValue = {
            days: {mon: {open: '09:00', close: '17:00'}}
        };
        const after = closeDay(before, 'sun');
        expect(after.days?.mon).toEqual({open: '09:00', close: '17:00'});
        expect(after.days?.sun).toBeNull();
    });
});

describe('openDayWithDefaults — reverses an explicit close', () => {
    it('replaces null with the default working window so the day shows times again', () => {
        const before: OperatingHoursValue = {days: {wed: null}};
        const after = openDayWithDefaults(before, 'wed');
        expect(after.days?.wed).toEqual({
            open: DEFAULT_OPEN_TIME,
            close: DEFAULT_CLOSE_TIME
        });
    });
});

describe('previousDay — week navigation', () => {
    it('returns null at Monday because there is no day before it in the displayed week', () => {
        expect(previousDay('mon')).toBeNull();
    });

    it('returns the prior weekday for a midweek day so copy-down can find a source', () => {
        expect(previousDay('thu')).toBe('wed');
    });
});

describe('copyPreviousDayHours — propagate yesterday onto today', () => {
    it("copies the previous day's hours when they exist so users can fill a workweek quickly", () => {
        const before: OperatingHoursValue = {
            days: {mon: {open: '08:00', close: '16:00'}}
        };
        const after = copyPreviousDayHours(before, 'tue');
        expect(after.days?.tue).toEqual({open: '08:00', close: '16:00'});
    });

    it('returns the value unchanged when the previous day is closed because there is nothing meaningful to copy', () => {
        const before: OperatingHoursValue = {days: {mon: null}};
        const after = copyPreviousDayHours(before, 'tue');
        expect(after).toEqual(before);
    });

    it('returns the value unchanged at Monday because there is no source day', () => {
        const before: OperatingHoursValue = {
            days: {sun: {open: '08:00', close: '16:00'}}
        };
        const after = copyPreviousDayHours(before, 'mon');
        expect(after).toEqual(before);
    });
});

describe('readDayHours — raw lookup tells caller "set / closed / unset"', () => {
    it('returns undefined for an unset day so caller can distinguish from explicit closed', () => {
        expect(readDayHours({}, 'mon')).toBeUndefined();
    });

    it('returns null for an explicitly closed day so caller can render the closed UI', () => {
        expect(readDayHours({days: {mon: null}}, 'mon')).toBeNull();
    });

    it('returns the hours object for an open day so caller can show open/close fields', () => {
        const v: OperatingHoursValue = {
            days: {mon: {open: '09:00', close: '17:00'}}
        };
        expect(readDayHours(v, 'mon')).toEqual({open: '09:00', close: '17:00'});
    });
});

describe('isValidTime — HH:MM 24-hour format guard', () => {
    it('accepts a valid time so the form can store it', () => {
        expect(isValidTime('09:30')).toBe(true);
    });

    it('accepts midnight because 00:00 is a real time of day', () => {
        expect(isValidTime('00:00')).toBe(true);
    });

    it('accepts the last minute of the day because 23:59 is still valid', () => {
        expect(isValidTime('23:59')).toBe(true);
    });

    it('rejects 24:00 because the next day starts at 00:00, not 24:00', () => {
        expect(isValidTime('24:00')).toBe(false);
    });

    it('rejects partial input because the form needs both hour and minute', () => {
        expect(isValidTime('9')).toBe(false);
        expect(isValidTime('09:')).toBe(false);
    });
});

describe('timeToMinutes — convert HH:MM into total minutes', () => {
    it('returns zero at midnight so comparisons line up cleanly', () => {
        expect(timeToMinutes('00:00')).toBe(0);
    });

    it('returns 570 for 09:30 so day-window math is straightforward', () => {
        expect(timeToMinutes('09:30')).toBe(570);
    });

    it('returns null for an invalid time so callers must handle it explicitly', () => {
        expect(timeToMinutes('25:00')).toBeNull();
    });
});

describe('dayHoursErrorMessage — per-day window validation', () => {
    it('passes a normal 09-17 day because both ends are valid and distinct', () => {
        expect(dayHoursErrorMessage({open: '09:00', close: '17:00'})).toBe('');
    });

    it('flags same-time open/close because a zero-length window is meaningless', () => {
        const msg = dayHoursErrorMessage({open: '10:00', close: '10:00'});
        expect(msg).toContain('same time');
    });

    it('accepts close-before-open because overnight schedules span midnight', () => {
        // 22:00 → 02:00 is a valid bar/club schedule, not an error
        expect(dayHoursErrorMessage({open: '22:00', close: '02:00'})).toBe('');
    });

    it('flags an invalid open time so the user knows what to fix', () => {
        const msg = dayHoursErrorMessage({open: 'bogus', close: '17:00'});
        expect(msg).toContain('Open');
    });

    it('flags an invalid close time when open is fine', () => {
        const msg = dayHoursErrorMessage({open: '09:00', close: 'bogus'});
        expect(msg).toContain('Close');
    });
});

describe('isOvernightShift — detect close-before-open windows', () => {
    it('returns true when close is before open because the window wraps midnight', () => {
        expect(isOvernightShift({open: '22:00', close: '02:00'})).toBe(true);
    });

    it('returns false when close is after open because it is a same-day window', () => {
        expect(isOvernightShift({open: '09:00', close: '17:00'})).toBe(false);
    });

    it('returns false when either time is invalid because we cannot tell', () => {
        expect(isOvernightShift({open: 'bad', close: '02:00'})).toBe(false);
    });
});
