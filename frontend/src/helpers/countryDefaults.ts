/**
 * Country defaults: one country picked in Settings suggests how dates and
 * numbers are written, whether temperature reads C or F, whether the rest
 * reads metric or imperial, which day the week starts on, and a SUGGESTED
 * currency — the way Apple, Google, Microsoft and Slack all do it.
 *
 * Every value here is a starting point, never a lock. Three things this
 * module must never touch, kept out of it entirely:
 *   - The currency a tariff bills in. suggestedCurrency may prefill a new
 *     org's currencyDefault, or a new tariff's currency field (see
 *     TariffLibraryPanel.vue's `default-currency`) — never assign or
 *     overwrite a tariff's own currency.
 *   - The clock a billing period is counted on (a tariff's own timezone +
 *     billingDay). Nothing here reads or writes either.
 *   - A value the organization already has stored. Applying these defaults
 *     is a caller decision (see OrganizationSettings.vue): show what would
 *     change, and never silently overwrite a field someone already set.
 *
 * Sourcing, so it is never guesswork:
 *   - locale is always `en-<countryCode>` — this product's one language
 *     (English) plus the picked country, the same convention the Region
 *     field already uses.
 *   - weekStart prefers the running engine's own week-info table
 *     (`Intl.Locale.prototype.getWeekInfo`, CLDR-backed) when the engine
 *     implements it — verified present in the Node 26 / V8 engine this
 *     repo runs on. Support is uneven across browser engines, so
 *     COUNTRY_TABLE below also carries a fallback for every listed
 *     country, snapshotted from that same runtime on 2026-08-26 (the
 *     `weekStartFallback` on each row), not guessed.
 *   - temperatureUnit, measurementSystem and suggestedCurrency have no
 *     Intl API to query at all — ECMA-402 exposes calendar, collation,
 *     currency *formatting*, numbering system and time zone, never a
 *     region's chosen unit system or its circulating currency. Both come
 *     from COUNTRY_TABLE: the official unit system and the ISO 4217
 *     currency code for each listed country.
 *
 * A country not in COUNTRY_TABLE resolves to null. That is not an error —
 * callers must leave the rest of the screen fully working.
 */

export type TemperatureUnit = 'C' | 'F';
export type MeasurementSystem = 'metric' | 'imperial';
/** Date.prototype.getDay() convention: 0 = Sunday .. 6 = Saturday. */
export type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface CountryDefaults {
    readonly countryCode: string;
    /** `en-<countryCode>` — how dates and numbers are written. */
    readonly locale: string;
    readonly temperatureUnit: TemperatureUnit;
    readonly measurementSystem: MeasurementSystem;
    readonly weekStart: WeekStartDay;
    /** Whether weekStart came from the running engine's own CLDR data or
     *  from this module's fallback table — surfaced so a caller can be
     *  honest about it if it ever matters, never load-bearing on its own. */
    readonly weekStartSource: 'runtime' | 'table';
    /** ISO 4217 code. A SUGGESTION only — see the module doc. */
    readonly suggestedCurrency: string;
}

interface CountryDefaultsRow {
    readonly temperatureUnit: TemperatureUnit;
    readonly measurementSystem: MeasurementSystem;
    readonly weekStartFallback: WeekStartDay;
    readonly suggestedCurrency: string;
}

// The markets this product sells into. A row states three plain facts an
// encyclopedia would agree on (official unit system, ISO 4217 currency,
// CLDR week start) — never a guess. A country with no row resolves to
// null; that is the honest answer for a place this table does not cover,
// not a reason to invent one.
const COUNTRY_TABLE: Readonly<Record<string, CountryDefaultsRow>> = {
    US: {
        temperatureUnit: 'F',
        measurementSystem: 'imperial',
        weekStartFallback: 0,
        suggestedCurrency: 'USD'
    },
    GB: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'GBP'
    },
    CA: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'CAD'
    },
    AU: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'AUD'
    },
    NZ: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'NZD'
    },
    IE: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    DE: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    FR: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    IT: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    ES: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    PT: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'EUR'
    },
    NL: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    BE: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    AT: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    CH: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'CHF'
    },
    BG: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'BGN'
    },
    RO: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'RON'
    },
    GR: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    PL: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'PLN'
    },
    CZ: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'CZK'
    },
    SK: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    HU: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'HUF'
    },
    HR: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    SI: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    SE: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'SEK'
    },
    NO: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'NOK'
    },
    DK: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'DKK'
    },
    FI: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'EUR'
    },
    JP: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'JPY'
    },
    IN: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'INR'
    },
    ZA: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'ZAR'
    },
    BR: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'BRL'
    },
    MX: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'MXN'
    },
    AE: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'AED'
    },
    SA: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'SAR'
    },
    EG: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 6,
        suggestedCurrency: 'EGP'
    },
    IL: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'ILS'
    },
    CN: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'CNY'
    },
    KR: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 0,
        suggestedCurrency: 'KRW'
    },
    TR: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'TRY'
    },
    RU: {
        temperatureUnit: 'C',
        measurementSystem: 'metric',
        weekStartFallback: 1,
        suggestedCurrency: 'RUB'
    }
};

// TS's own lib types do not carry getWeekInfo yet (Baseline 2024, this
// project's lib target predates it) even though the engine implements it —
// see the module doc. A named, narrow extension states exactly the one
// method this file relies on, instead of widening to `any`.
interface LocaleWithWeekInfo extends Intl.Locale {
    getWeekInfo?: () => {firstDay: number};
}

// The runtime's own week-info table (CLDR), when the engine implements it.
// getWeekInfo is missing entirely on some engines — an optional call on a
// missing method resolves to undefined rather than throwing, so the only
// remaining failure mode is a locale the engine itself rejects.
function weekStartFromRuntime(locale: string): WeekStartDay | null {
    try {
        const info = (
            new Intl.Locale(locale) as LocaleWithWeekInfo
        ).getWeekInfo?.();
        if (!info) return null;
        // CLDR firstDay: 1 = Monday .. 7 = Sunday. This module (and the
        // rest of the app) uses Date#getDay()'s convention: 0 = Sunday ..
        // 6 = Saturday. 7 % 7 = 0, 1..6 pass through unchanged.
        return (info.firstDay % 7) as WeekStartDay;
    } catch {
        return null;
    }
}

/** Suggests format, unit and currency defaults for one country. Null for a
 *  country COUNTRY_TABLE has no facts for — the honest answer, never a
 *  guess, and never a reason for a caller to fail. */
export function resolveCountryDefaults(
    countryCode: string
): CountryDefaults | null {
    const code = countryCode.trim().toUpperCase();
    const row = COUNTRY_TABLE[code];
    if (!row) return null;

    const locale = `en-${code}`;
    const runtimeWeekStart = weekStartFromRuntime(locale);

    return {
        countryCode: code,
        locale,
        temperatureUnit: row.temperatureUnit,
        measurementSystem: row.measurementSystem,
        weekStart: runtimeWeekStart ?? row.weekStartFallback,
        weekStartSource: runtimeWeekStart === null ? 'table' : 'runtime',
        suggestedCurrency: row.suggestedCurrency
    };
}

/** Every country this module can suggest defaults for, named the way the
 *  rest of Settings names a region: live from the runtime's own region
 *  table (Intl.DisplayNames), not a second, driftable copy of the name. */
export function listKnownCountries(): ReadonlyArray<{
    code: string;
    name: string;
}> {
    const regionNames = new Intl.DisplayNames(['en'], {type: 'region'});
    return Object.keys(COUNTRY_TABLE)
        .map((code) => ({code, name: regionNames.of(code) ?? code}))
        .sort((a, b) => a.name.localeCompare(b.name));
}
