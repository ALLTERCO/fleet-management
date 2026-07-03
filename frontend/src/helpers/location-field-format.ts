/** Read + format helpers for free-form Location.kindFields values.
 *  Each function answers a question about a single raw value — no side
 *  effects, no DOM reads. Shared across every kind-tier Overview view so
 *  there's exactly one place that decides "what counts as a usable string"
 *  or "how does an address render". */

export interface ContactValue {
    readonly name: string;
    readonly role?: string;
    readonly email?: string;
    readonly phone?: string;
    readonly afterHours?: boolean;
}

export interface NumericRange {
    readonly min: number | null;
    readonly max: number | null;
    readonly unit: string;
}

/** Truthy non-empty string or null. */
export function readString(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    return raw.length > 0 ? raw : null;
}

/** Integer or null — rejects NaN, floats, non-numbers. */
export function readInt(raw: unknown): number | null {
    if (typeof raw !== 'number') return null;
    return Number.isInteger(raw) ? raw : null;
}

/** Finite number or null — rejects NaN, Infinity, non-numbers. */
export function readNumber(raw: unknown): number | null {
    if (typeof raw !== 'number') return null;
    return Number.isFinite(raw) ? raw : null;
}

/** Locale-formatted integer count, no fractional digits. */
export function formatCount(n: number): string {
    return new Intl.NumberFormat(undefined, {maximumFractionDigits: 0}).format(
        n
    );
}

/** "lat, lng" with 4 decimals, or null when either coord is missing. */
export function formatGeo(raw: unknown): string | null {
    const obj = readObject(raw);
    if (!obj) return null;
    const lat = readNumber(obj.lat);
    const lng = readNumber(obj.lng);
    if (lat === null || lng === null) return null;
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Single-line: "streetName streetNumber, postal city, region, country"
export function formatAddress(raw: unknown): string | null {
    const obj = readObject(raw);
    if (!obj) return null;
    const parts = [
        joinNonEmpty(' ', [
            readString(obj.streetName),
            readString(obj.streetNumber)
        ]),
        joinNonEmpty(' ', [readString(obj.postalCode), readString(obj.city)]),
        readString(obj.region),
        readString(obj.countryCode)
    ];
    const kept = parts.filter((v): v is string => !!v);
    return kept.length === 0 ? null : kept.join(', ');
}

/** Validated contact object — rejects entries that lack a name. */
export function readContact(raw: unknown): ContactValue | null {
    const obj = readObject(raw);
    if (!obj) return null;
    const name = readString(obj.name);
    if (!name) return null;
    return {
        name,
        role: readString(obj.role) ?? undefined,
        email: readString(obj.email) ?? undefined,
        phone: readString(obj.phone) ?? undefined,
        afterHours: obj.afterHours === true
    };
}

/** "20–24 °C", "≥ 20 °C", "≤ 24 °C", or "—" when both sides are absent. */
export function formatRange(range: NumericRange): string {
    if (range.min !== null && range.max !== null) {
        return `${range.min}–${range.max} ${range.unit}`;
    }
    if (range.min !== null) return `≥ ${range.min} ${range.unit}`;
    if (range.max !== null) return `≤ ${range.max} ${range.unit}`;
    return '—';
}

/** Join the non-empty entries with the given separator, or null if all empty. */
export function joinNonEmpty(
    sep: string,
    parts: ReadonlyArray<string | null>
): string | null {
    const kept = parts.filter((v): v is string => !!v);
    return kept.length === 0 ? null : kept.join(sep);
}

/** Plain non-null object or null — rejects arrays, primitives, null. */
function readObject(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    if (Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
}
