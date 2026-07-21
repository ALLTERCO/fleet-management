// Compute the shaded bands a consumption chart should display, given the
// dashboard's current tariff settings + the list of bucket labels actually
// rendered on the X axis. Pure — no DOM, no Date.now() usage that would
// confuse fixture tests.

export type TariffMode = 'single' | 'day_night' | 'tou';

export interface TouWindow {
    readonly from: string; // "HH:MM"
    readonly to: string; // "HH:MM"
    readonly rate?: number;
    readonly label?: string;
}

export interface TariffSettings {
    readonly tariffMode: TariffMode;
    readonly dayStart?: string; // "HH:MM"
    readonly dayEnd?: string; // "HH:MM"
    readonly tariffWindows?: readonly TouWindow[] | null;
    readonly tariffWeekendOverride?: readonly TouWindow[] | null;
    readonly tariffHolidays?: readonly string[] | null;
}

export interface TariffBand {
    readonly fromBucket: string;
    readonly toBucket: string;
    readonly color: string;
    readonly label?: string;
}

const PEAK_COLOR = 'rgba(var(--color-warning-rgb), 0.08)';
const OFF_PEAK_COLOR = 'rgba(var(--color-primary-rgb), 0.05)';

// TOU rate-tier palette. Bands are coloured by rank within the day —
// highest rate gets the warm "peak" tint, lowest the cool "off-peak"
// tint, anything in between gets a neutral mid tone. Keeps the visual
// language consistent with the day_night mode the user already learned.
const TOU_PEAK_COLOR = 'rgba(var(--color-warning-rgb), 0.10)';
const TOU_MID_COLOR = 'rgba(var(--color-text-tertiary-rgb), 0.06)';
const TOU_OFF_COLOR = 'rgba(var(--color-primary-rgb), 0.05)';

// Pick out the buckets that are "time-of-day" (HH:MM). The chart formats
// bucket strings differently for >24h windows (date strings), and a tariff
// overlay isn't meaningful there — return [] in that case.
function isTimeOfDayAxis(buckets: readonly string[]): boolean {
    if (buckets.length === 0) return false;
    return buckets.every((b) => /^\d{2}:\d{2}$/.test(b));
}

// Build one TariffBand spanning the supplied (already-filtered) buckets.
// Returns null when there's nothing to render so callers can spread/filter.
function bandFromBuckets(
    buckets: readonly string[],
    color: string,
    label: string
): TariffBand | null {
    if (buckets.length === 0) return null;
    return {
        fromBucket: buckets[0],
        toBucket: buckets[buckets.length - 1],
        color,
        label
    };
}

// Given dayStart="07:00" and dayEnd="22:00", return the contiguous slices
// of the axis that fall inside day-rate vs night-rate windows.
export function dayNightBands(
    buckets: readonly string[],
    settings: TariffSettings
): readonly TariffBand[] {
    if (settings.tariffMode !== 'day_night') return [];
    if (!settings.dayStart || !settings.dayEnd) return [];
    if (!isTimeOfDayAxis(buckets)) return [];

    const inDay = (b: string) =>
        b >= settings.dayStart! && b < settings.dayEnd!;
    const day = bandFromBuckets(buckets.filter(inDay), PEAK_COLOR, 'Peak');
    const night = bandFromBuckets(
        buckets.filter((b) => !inDay(b)),
        OFF_PEAK_COLOR,
        'Off-peak'
    );
    return [day, night].filter((b): b is TariffBand => b !== null);
}

// Resolve the active TOU schedule given the current settings + a
// reference date. Holidays + weekends fall through to the override when
// one is configured.
export function pickTouSchedule(
    settings: TariffSettings,
    now: Date
): readonly TouWindow[] | null {
    const base = settings.tariffWindows;
    const override = settings.tariffWeekendOverride;
    if (!base || base.length === 0) return null;
    if (!override || override.length === 0) return base;

    const iso = isoDate(now);
    if (settings.tariffHolidays?.includes(iso)) return override;

    const dow = now.getDay();
    if (dow === 0 || dow === 6) return override;
    return base;
}

// True when a local wall-clock hour falls in the day-rate window, handling a
// window that wraps past midnight (e.g. dayStart 22, dayEnd 6 → 22:00–06:00).
export function isDayRateHour(
    hour: number,
    dayStartH: number,
    dayEndH: number
): boolean {
    return dayStartH <= dayEndH
        ? hour >= dayStartH && hour < dayEndH
        : hour >= dayStartH || hour < dayEndH;
}

// Fraction of a 24h day inside the day-rate window (wrap-aware). Used to blend
// whole-day/month buckets that span both windows.
export function dayRateFraction(dayStartH: number, dayEndH: number): number {
    const dayHours =
        dayStartH <= dayEndH ? dayEndH - dayStartH : 24 - dayStartH + dayEndH;
    return Math.max(0, Math.min(24, dayHours)) / 24;
}

// Resolve the TOU rate active at a wall-clock time, using the schedule that
// applies on that date (weekend/holiday-aware). `hhmm` is the local "HH:MM" in
// the tariff zone; `when` selects weekday vs weekend/holiday. Returns null when
// no window covers the time so the caller can fall back to the flat rate.
export function resolveTouRate(
    settings: TariffSettings,
    when: Date,
    hhmm: string
): number | null {
    const schedule = pickTouSchedule(settings, when);
    if (!schedule) return null;
    for (const window of schedule) {
        if (typeof window.rate !== 'number') continue;
        for (const slice of expandWrap(window)) {
            if (hhmm >= slice.from && hhmm < slice.to) return window.rate;
        }
    }
    return null;
}

// Map a TOU window to a band-friendly color based on its rate rank
// (highest = peak warmth, lowest = off-peak coolness, middle = neutral).
// Callers without a rate get the neutral tone.
export function colorForTouWindow(
    window: TouWindow,
    schedule: readonly TouWindow[]
): string {
    const rates = schedule
        .map((w) => w.rate)
        .filter((r): r is number => typeof r === 'number');
    if (rates.length === 0 || typeof window.rate !== 'number')
        return TOU_MID_COLOR;
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    if (window.rate === max) return TOU_PEAK_COLOR;
    if (window.rate === min) return TOU_OFF_COLOR;
    return TOU_MID_COLOR;
}

// Project a TOU schedule onto the visible HH:MM axis. A window that
// wraps midnight (from="22:00", to="06:00") becomes two emitted bands.
// Buckets that don't fall inside any window are skipped; chart shading
// is purely additive.
export function touBands(
    buckets: readonly string[],
    settings: TariffSettings,
    now: Date = new Date()
): readonly TariffBand[] {
    if (settings.tariffMode !== 'tou') return [];
    if (!isTimeOfDayAxis(buckets)) return [];
    const schedule = pickTouSchedule(settings, now);
    if (!schedule) return [];

    return schedule.flatMap((window) =>
        bandsForTouWindow(window, schedule, buckets)
    );
}

// One TOU window → 1 or 2 bands (midnight-wrapping splits in two).
// Empty band candidates drop out so callers stay declarative.
function bandsForTouWindow(
    window: TouWindow,
    schedule: readonly TouWindow[],
    buckets: readonly string[]
): readonly TariffBand[] {
    const color = colorForTouWindow(window, schedule);
    return expandWrap(window)
        .map((slice) =>
            bandFromBuckets(
                buckets.filter((b) => b >= slice.from && b < slice.to),
                color,
                window.label ?? ''
            )
        )
        .filter((b): b is TariffBand => b !== null);
}

// Dispatch table per tariff mode — adding a new mode means one row,
// no edits in the entry point below.
type BandBuilder = (
    buckets: readonly string[],
    settings: TariffSettings,
    now: Date
) => readonly TariffBand[];

const BAND_BUILDERS: Record<TariffMode, BandBuilder> = {
    single: () => [],
    day_night: (buckets, settings) => dayNightBands(buckets, settings),
    tou: (buckets, settings, now) => touBands(buckets, settings, now)
};

// Single entry point — pick the right band set for the current tariff
// mode. Use this from chart pages so callers don't have to branch on
// mode themselves.
export function tariffOverlayBands(
    buckets: readonly string[],
    settings: TariffSettings,
    now: Date = new Date()
): readonly TariffBand[] {
    const build = BAND_BUILDERS[settings.tariffMode];
    return build ? build(buckets, settings, now) : [];
}

function expandWrap(window: TouWindow): readonly {from: string; to: string}[] {
    if (window.from < window.to) return [{from: window.from, to: window.to}];
    // Midnight-wrap: split into [from..24:00] + [00:00..to].
    return [
        {from: window.from, to: '24:00'},
        {from: '00:00', to: window.to}
    ];
}

function isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
