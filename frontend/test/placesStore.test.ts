import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePlacesStore} from '@/stores/places';

const sendRPC = vi.hoisted(() => vi.fn());
vi.mock('@/tools/websocket', () => ({sendRPC}));

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPC.mockReset();
});

describe('places store — countries', () => {
    it('fetches once and serves the cached array on the second call', async () => {
        sendRPC.mockResolvedValueOnce({
            countries: [
                {iso2: 'BG', iso3: 'BGR', name: 'Bulgaria', continent: 'EU'}
            ]
        });
        const store = usePlacesStore();

        const first = await store.ensureCountries();
        const second = await store.ensureCountries();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
        expect(first[0].iso2).toBe('BG');
    });

    it('coalesces concurrent calls into a single RPC', async () => {
        let resolve: ((v: {countries: unknown[]}) => void) | null = null;
        sendRPC.mockImplementationOnce(
            () =>
                new Promise((r) => {
                    resolve = r;
                })
        );
        const store = usePlacesStore();

        const a = store.ensureCountries();
        const b = store.ensureCountries();
        resolve?.({
            countries: [
                {
                    iso2: 'US',
                    iso3: 'USA',
                    name: 'United States',
                    continent: 'NA'
                }
            ]
        });
        await Promise.all([a, b]);

        expect(sendRPC).toHaveBeenCalledTimes(1);
    });

    it('findCountry returns null before the cache is primed', () => {
        const store = usePlacesStore();
        expect(store.findCountry('BG')).toBeNull();
    });

    it('findCountry is case-insensitive after prime', async () => {
        sendRPC.mockResolvedValueOnce({
            countries: [
                {iso2: 'BG', iso3: 'BGR', name: 'Bulgaria', continent: 'EU'}
            ]
        });
        const store = usePlacesStore();
        await store.ensureCountries();

        expect(store.findCountry('bg')?.name).toBe('Bulgaria');
    });
});

describe('places store — regions', () => {
    it('keys by uppercased country code and caches per-country', async () => {
        sendRPC.mockResolvedValueOnce({
            regions: [
                {
                    code: 'BG-23',
                    countryCode: 'BG',
                    name: 'Sofia-grad',
                    lat: 42.7,
                    lng: 23.3
                }
            ]
        });
        const store = usePlacesStore();

        const first = await store.ensureRegions('bg');
        const second = await store.ensureRegions('BG');

        expect(sendRPC).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
        expect(store.regionsByCountry.BG[0].name).toBe('Sofia-grad');
    });

    it('fetches separately for different countries', async () => {
        sendRPC.mockResolvedValueOnce({regions: [{code: 'BG-23'}]});
        sendRPC.mockResolvedValueOnce({regions: [{code: 'US-CA'}]});
        const store = usePlacesStore();

        await store.ensureRegions('BG');
        await store.ensureRegions('US');

        expect(sendRPC).toHaveBeenCalledTimes(2);
    });
});
