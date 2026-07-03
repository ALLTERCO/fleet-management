// Pure transforms for OperatingHoursGrid. Keep the component dumb; keep the
// math here so it has one home, one test per behaviour.

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
    open: string;
    close: string;
}

export interface OperatingHoursValue {
    twentyFourSeven?: boolean;
    days?: Partial<Record<DayKey, DayHours | null>>;
}

export const DAY_ORDER: ReadonlyArray<{key: DayKey; label: string}> = [
    {key: 'mon', label: 'Monday'},
    {key: 'tue', label: 'Tuesday'},
    {key: 'wed', label: 'Wednesday'},
    {key: 'thu', label: 'Thursday'},
    {key: 'fri', label: 'Friday'},
    {key: 'sat', label: 'Saturday'},
    {key: 'sun', label: 'Sunday'}
];

// Defaults exposed so the widget defaults are documentable + overridable.
export const DEFAULT_OPEN_TIME = '09:00';
export const DEFAULT_CLOSE_TIME = '17:00';

// Format: HH:MM in 24h. Anything else is rejected at validation time.
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Answer — does this string look like a valid HH:MM time?
export function isValidTime(value: string): boolean {
    return HHMM_PATTERN.test(value);
}

// Answer — convert HH:MM to total minutes from midnight, or null if invalid.
export function timeToMinutes(value: string): number | null {
    if (!isValidTime(value)) return null;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
}

// Answer — describe why a day's hours are invalid, or '' if fine.
// Same-time means zero-length window, also flagged. Overnight (close < open)
// is allowed: many sites close after midnight.
export function dayHoursErrorMessage(hours: DayHours): string {
    const open = timeToMinutes(hours.open);
    const close = timeToMinutes(hours.close);
    if (open == null) return 'Open time must be in HH:MM format.';
    if (close == null) return 'Close time must be in HH:MM format.';
    if (open === close) {
        return 'Open and close cannot be the same time — use 24/7 if always open.';
    }
    return '';
}

// Answer — is this an overnight schedule (close before open in the same row)?
// Useful for showing a "spans midnight" hint without flagging it as invalid.
export function isOvernightShift(hours: DayHours): boolean {
    const open = timeToMinutes(hours.open);
    const close = timeToMinutes(hours.close);
    if (open == null || close == null) return false;
    return close < open;
}

// Answer — read the hours for a day. Null means "explicitly closed";
// undefined means "not set yet".
export function readDayHours(
    value: OperatingHoursValue,
    day: DayKey
): DayHours | null | undefined {
    return value.days?.[day];
}

// Answer — true when the day was explicitly marked closed.
export function isDayClosed(value: OperatingHoursValue, day: DayKey): boolean {
    if (!value.days) return false;
    if (!Object.hasOwn(value.days, day)) return false;
    return value.days[day] === null;
}

// Answer — the open time to display for a day, falling back to the default.
export function readOpenTime(value: OperatingHoursValue, day: DayKey): string {
    return readDayHours(value, day)?.open ?? DEFAULT_OPEN_TIME;
}

// Answer — the close time to display for a day, falling back to the default.
export function readCloseTime(value: OperatingHoursValue, day: DayKey): string {
    return readDayHours(value, day)?.close ?? DEFAULT_CLOSE_TIME;
}

// Transform — switch the whole week into "24/7 always open" state.
export function setOpen247(): OperatingHoursValue {
    return {twentyFourSeven: true};
}

// Transform — switch out of "24/7" with a fresh empty week.
export function clear247(): OperatingHoursValue {
    return {days: {}};
}

// Transform — set a day's open OR close time, leaving the rest intact.
export function setDayTime(
    value: OperatingHoursValue,
    args: {day: DayKey; field: 'open' | 'close'; time: string}
): OperatingHoursValue {
    const {day, field, time} = args;
    const prev = readDayHours(value, day) ?? {
        open: DEFAULT_OPEN_TIME,
        close: DEFAULT_CLOSE_TIME
    };
    return withoutTwentyFour({
        ...value,
        days: {...(value.days ?? {}), [day]: {...prev, [field]: time}}
    });
}

// Transform — explicitly mark a day as closed.
export function closeDay(
    value: OperatingHoursValue,
    day: DayKey
): OperatingHoursValue {
    return withoutTwentyFour({
        ...value,
        days: {...(value.days ?? {}), [day]: null}
    });
}

// Transform — open a closed day back up using the default working window.
export function openDayWithDefaults(
    value: OperatingHoursValue,
    day: DayKey
): OperatingHoursValue {
    return withoutTwentyFour({
        ...value,
        days: {
            ...(value.days ?? {}),
            [day]: {
                open: readOpenTime(value, day),
                close: readCloseTime(value, day)
            }
        }
    });
}

// Answer — the previous day in the week, or null at Monday.
export function previousDay(day: DayKey): DayKey | null {
    const idx = DAY_ORDER.findIndex((d) => d.key === day);
    if (idx <= 0) return null;
    return DAY_ORDER[idx - 1].key;
}

// Transform — copy the previous day's hours onto `day`. No-op if the
// previous day is closed or unset.
export function copyPreviousDayHours(
    value: OperatingHoursValue,
    day: DayKey
): OperatingHoursValue {
    const prev = previousDay(day);
    if (!prev) return value;
    const source = readDayHours(value, prev);
    if (!source) return value;
    return withoutTwentyFour({
        ...value,
        days: {...(value.days ?? {}), [day]: {...source}}
    });
}

// Transform — strip the twentyFourSeven flag because any per-day edit
// implies the user moved off the always-open mode.
function withoutTwentyFour(v: OperatingHoursValue): OperatingHoursValue {
    if (!v.twentyFourSeven) return v;
    const {twentyFourSeven: _drop, ...rest} = v;
    return rest;
}
