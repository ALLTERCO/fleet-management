// Region-aware formatting for templates. See the FleetFormat doc comment in
// ./types for the boundary between region, currency and billing time zone —
// duplicated in docs/reference/separate-ui-host-sdk.md for anyone reading
// the guide instead of the source.
//
// A helper, not the raw tag: `amount` takes a required `currency` argument
// so a template cannot accidentally derive one from the region, and no
// function here ever reads a time zone off the region either. `date` writes on
// the caller's zone, else the organization's display clock, else UTC — a
// billing day still needs the tariff's own zone passed in.

import type {ExternalStore} from './external-store';
import {canonicalRegion, toMs} from './format-input';
import type {
    FleetFormat,
    FleetFormatDateOptions,
    FleetOrganizationProfile
} from './types';

/** A rendered timestamp must mean the same thing to everyone reading the same
 * fleet, so the browser's own zone is never the answer. */
const FALLBACK_TIME_ZONE = 'UTC';

function regionOf(
    profile: ExternalStore<FleetOrganizationProfile | null>
): string | undefined {
    return canonicalRegion(profile.getSnapshot()?.localeDefault);
}

// An organization zone Intl cannot resolve would otherwise throw on every
// date a template renders, so it is checked once and then remembered.
const zoneUsable = new Map<string, boolean>();

function usableZone(zone: string): boolean {
    const known = zoneUsable.get(zone);
    if (known !== undefined) return known;
    let ok = true;
    try {
        new Intl.DateTimeFormat(undefined, {timeZone: zone});
    } catch {
        ok = false;
    }
    zoneUsable.set(zone, ok);
    return ok;
}

const DEFAULT_DATE_STYLE: FleetFormatDateOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
};

/** A clock is not a style: naming only `timeZone` keeps the default date
 * shape, so rendering a billing day does not also change how it is written. */
function styleFor(
    options: FleetFormatDateOptions | undefined
): FleetFormatDateOptions {
    if (!options) return DEFAULT_DATE_STYLE;
    const named = Object.keys(options);
    return named.every((key) => key === 'timeZone')
        ? {...DEFAULT_DATE_STYLE, ...options}
        : options;
}

/** Caller's zone, else the organization's display clock, else UTC. */
function withTimeZone(
    profile: ExternalStore<FleetOrganizationProfile | null>,
    options: FleetFormatDateOptions | undefined
): FleetFormatDateOptions {
    const base = styleFor(options);
    if (base.timeZone) return base;
    const organization = profile.getSnapshot()?.timezoneDefault;
    return {
        ...base,
        timeZone:
            organization && usableZone(organization)
                ? organization
                : FALLBACK_TIME_ZONE
    };
}

// Retries once with the browser's own locale so a region Intl accepts as a
// tag but cannot actually render for this value still shows something,
// rather than breaking a template's render.
function withRegionFallback<T>(
    profile: ExternalStore<FleetOrganizationProfile | null>,
    run: (locale: string | undefined) => T
): T {
    try {
        return run(regionOf(profile));
    } catch {
        return run(undefined);
    }
}

/** Builds the `format` a mounted template reads off `TemplateRuntimeContext`.
 *  `profile` is read fresh on every call, so a region change while a
 *  template is mounted is picked up without re-creating this object. */
export function createFormat(
    profile: ExternalStore<FleetOrganizationProfile | null>
): FleetFormat {
    return {
        date(input, options) {
            const d = new Date(toMs(input));
            const resolved = withTimeZone(profile, options);
            return withRegionFallback(profile, (locale) =>
                new Intl.DateTimeFormat(locale, resolved).format(d)
            );
        },
        number(value, options) {
            return withRegionFallback(profile, (locale) =>
                value.toLocaleString(locale, options)
            );
        },
        amount(value, currency, options) {
            try {
                return withRegionFallback(profile, (locale) =>
                    value.toLocaleString(locale, {
                        style: 'currency',
                        currency,
                        ...options
                    })
                );
            } catch {
                // A currency code Intl cannot render (never expected from
                // Fleet's own validated tariff currency, but possible from a
                // caller passing something else) still shows a plain pair.
                const plain = withRegionFallback(profile, (locale) =>
                    value.toLocaleString(locale)
                );
                return `${plain} ${currency}`;
            }
        }
    };
}
