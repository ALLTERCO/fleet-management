// Pinia store for GeoNames reference data exposed via Location.ListCountries
// and Location.ListRegions. The backend caches these in-process, but each
// page mount triggering its own RPC is wasteful — cache once per session.

import {defineStore} from 'pinia';
import {ref} from 'vue';
import {
    listCountries,
    listRegions,
    type PlaceCountry,
    type PlaceRegion
} from '@/helpers/placeSearch';

export const usePlacesStore = defineStore('places', () => {
    const countries = ref<PlaceCountry[] | null>(null);
    const regionsByCountry = ref<Record<string, PlaceRegion[]>>({});

    let countriesPromise: Promise<PlaceCountry[]> | null = null;
    const regionsPromise = new Map<string, Promise<PlaceRegion[]>>();

    async function ensureCountries(): Promise<PlaceCountry[]> {
        if (countries.value !== null) return countries.value;
        if (countriesPromise) return countriesPromise;
        countriesPromise = fetchCountriesOnce();
        try {
            return await countriesPromise;
        } finally {
            countriesPromise = null;
        }
    }

    async function fetchCountriesOnce(): Promise<PlaceCountry[]> {
        const rows = await listCountries();
        countries.value = rows;
        return rows;
    }

    async function ensureRegions(countryCode: string): Promise<PlaceRegion[]> {
        const cc = countryCode.toUpperCase();
        const cached = regionsByCountry.value[cc];
        if (cached) return cached;
        const inflight = regionsPromise.get(cc);
        if (inflight) return inflight;
        const p = fetchRegionsOnce(cc);
        regionsPromise.set(cc, p);
        try {
            return await p;
        } finally {
            regionsPromise.delete(cc);
        }
    }

    async function fetchRegionsOnce(cc: string): Promise<PlaceRegion[]> {
        const rows = await listRegions(cc);
        regionsByCountry.value = {...regionsByCountry.value, [cc]: rows};
        return rows;
    }

    function findCountry(iso2: string): PlaceCountry | null {
        const all = countries.value;
        if (!all) return null;
        const up = iso2.toUpperCase();
        return all.find((c) => c.iso2 === up) ?? null;
    }

    function resetForTests(): void {
        countries.value = null;
        regionsByCountry.value = {};
        countriesPromise = null;
        regionsPromise.clear();
    }

    return {
        countries,
        regionsByCountry,
        ensureCountries,
        ensureRegions,
        findCountry,
        resetForTests
    };
});
