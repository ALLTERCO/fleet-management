// Local place search against geo.* (GeoNames). Owns SQL + ranking only.

import type {
    CountryEntry,
    GeocodeCandidate,
    RegionEntry
} from '../../types/api/location';
import * as Observability from '../Observability';
import {queryRows} from '../PostgresProvider';

// Trigram floor narrows the index lookup; confidence floor gates fallback.
export const LOCAL_TRIGRAM_FLOOR = 0.3;
export const LOCAL_CONFIDENCE_MIN = 0.5;

interface PlaceRow {
    kind: 'country' | 'admin' | 'city';
    geonameid: number | null;
    name: string;
    asciiname: string;
    country_code: string;
    country_name: string;
    admin_code: string | null;
    admin_name: string | null;
    lat: number;
    lng: number;
    timezone: string | null;
    weight: string;
    score: number;
}

export interface LocalSearchOptions {
    query: string;
    biasCountryCode?: string | null;
    limit?: number;
}

export async function searchPlacesLocal(
    opts: LocalSearchOptions
): Promise<GeocodeCandidate[]> {
    const limit = opts.limit ?? 5;
    const rows = await queryRows<PlaceRow>(
        `WITH scored AS (
             SELECT p.kind, p.geonameid, p.name, p.asciiname,
                    p.country_code, p.admin_code, p.lat, p.lng,
                    p.timezone, p.weight,
                    similarity(p.asciiname, $1)
                    + CASE WHEN p.asciiname ILIKE $1 || '%' THEN 0.5 ELSE 0 END
                    AS score
               FROM geo.places p
              WHERE similarity(p.asciiname, $1) > $4
                AND ($2::char(2) IS NULL OR p.country_code = $2)
         )
         SELECT s.kind, s.geonameid, s.name, s.asciiname,
                s.country_code, cn.name AS country_name,
                s.admin_code, a1.name AS admin_name,
                s.lat, s.lng, s.timezone, s.weight, s.score
           FROM scored s
           JOIN geo.countries cn ON cn.iso2 = s.country_code
           LEFT JOIN geo.admin a1 ON a1.code = s.admin_code
          ORDER BY s.score + log(GREATEST(s.weight, 1)) / 20 DESC
          LIMIT $3`,
        [opts.query, opts.biasCountryCode ?? null, limit, LOCAL_TRIGRAM_FLOOR]
    );
    return rows.map(toCandidate);
}

function toCandidate(row: PlaceRow): GeocodeCandidate {
    const out: GeocodeCandidate = {
        kind: row.kind,
        name: row.name,
        asciiname: row.asciiname,
        countryCode: row.country_code,
        countryName: row.country_name,
        lat: row.lat,
        lng: row.lng,
        weight: Number(row.weight),
        score: row.score
    };
    if (row.geonameid !== null) out.geonameid = row.geonameid;
    if (row.admin_code !== null) out.adminCode = row.admin_code;
    if (row.admin_name !== null) out.adminName = row.admin_name;
    if (row.timezone !== null) out.timezone = row.timezone;
    return out;
}

// Reference data refreshes per deploy; cache it in-process.
let countriesCache: CountryEntry[] | null = null;
let regionsByCountry: Map<string, RegionEntry[]> | null = null;

interface CountryRow {
    iso2: string;
    iso3: string;
    name: string;
    continent: string;
    capital: string | null;
    lat: number | null;
    lng: number | null;
}

interface RegionRow {
    code: string;
    country_code: string;
    name: string;
    lat: number;
    lng: number;
}

export async function loadCountries(): Promise<CountryEntry[]> {
    const rows = await queryRows<CountryRow>(
        `SELECT iso2, iso3, name, continent, capital, lat, lng
           FROM geo.countries
          ORDER BY name`
    );
    return rows.map((r) => {
        const out: CountryEntry = {
            iso2: r.iso2,
            iso3: r.iso3,
            name: r.name,
            continent: r.continent
        };
        if (r.capital !== null) out.capital = r.capital;
        if (r.lat !== null) out.lat = r.lat;
        if (r.lng !== null) out.lng = r.lng;
        return out;
    });
}

export async function loadRegionsByCountry(): Promise<
    Map<string, RegionEntry[]>
> {
    const rows = await queryRows<RegionRow>(
        `SELECT code, country_code, name, lat, lng
           FROM geo.admin
          ORDER BY country_code, name`
    );
    const grouped = new Map<string, RegionEntry[]>();
    for (const r of rows) {
        const entry: RegionEntry = {
            code: r.code,
            countryCode: r.country_code,
            name: r.name,
            lat: r.lat,
            lng: r.lng
        };
        const list = grouped.get(r.country_code) ?? [];
        list.push(entry);
        grouped.set(r.country_code, list);
    }
    return grouped;
}

// null when not yet primed; caller decides whether to lazy-load.
export function cachedCountries(): CountryEntry[] | null {
    return countriesCache;
}

export function cachedRegionsFor(countryCode: string): RegionEntry[] | null {
    return regionsByCountry?.get(countryCode.toUpperCase()) ?? null;
}

export async function primeGeoCaches(): Promise<void> {
    const [countries, regions] = await Promise.all([
        loadCountries(),
        loadRegionsByCountry()
    ]);
    countriesCache = countries;
    regionsByCountry = regions;
}

export function resetGeoCachesForTests(): void {
    countriesCache = null;
    regionsByCountry = null;
}

Observability.registerModule('geo', {
    stats: () => ({
        countriesCached: countriesCache?.length ?? 0,
        regionCountries: regionsByCountry?.size ?? 0,
        primed: countriesCache !== null && regionsByCountry !== null ? 1 : 0
    }),
    topology: {
        role: 'external',
        cluster: 'services',
        zone: 'external_systems',
        downstreams: ['dbPool'],
        label: 'Geocoding',
        description: 'Country/region lookup',
        route: '/monitoring/services'
    }
});
