import {describe, expect, it, vi} from 'vitest';
import {listCountries, searchPlaces} from '@/helpers/placeSearch';

const sendRPC = vi.hoisted(() => vi.fn());
vi.mock('@/tools/websocket', () => ({sendRPC}));

describe('searchPlaces helper', () => {
    it('calls Location.SearchPlaces with the query + bias + limit', async () => {
        sendRPC.mockResolvedValueOnce({candidates: [], source: 'local-weak'});

        await searchPlaces({
            query: 'Sof',
            biasCountryCode: 'BG',
            limit: 7
        });

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Location.SearchPlaces',
            {query: 'Sof', biasCountryCode: 'BG', limit: 7}
        );
    });

    it('returns the server result unchanged', async () => {
        const fake = {
            candidates: [{kind: 'city', name: 'Sofia'}],
            source: 'local'
        };
        sendRPC.mockResolvedValueOnce(fake);

        const out = await searchPlaces({query: 'Sof'});
        expect(out).toEqual(fake);
    });
});

describe('listCountries helper', () => {
    it('returns the countries array from the RPC envelope', async () => {
        sendRPC.mockResolvedValueOnce({
            countries: [
                {iso2: 'BG', iso3: 'BGR', name: 'Bulgaria', continent: 'EU'}
            ]
        });

        const out = await listCountries();
        expect(out).toHaveLength(1);
        expect(out[0].iso2).toBe('BG');
    });

    it('returns an empty array when the server omits countries', async () => {
        sendRPC.mockResolvedValueOnce({});
        const out = await listCountries();
        expect(out).toEqual([]);
    });
});
