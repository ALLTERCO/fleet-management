import {describe, expect, it} from 'vitest';
import {resolveAssetSrc} from '@/helpers/deviceLogo';

describe('resolveAssetSrc', () => {
    it('builds /api/assets/{id} for a UUID', () => {
        expect(resolveAssetSrc('11111111-2222-4333-8444-555555555555')).toBe(
            '/api/assets/11111111-2222-4333-8444-555555555555'
        );
    });

    it('builds /api/assets/{id} unconditionally — no pass-through', () => {
        // Holder columns store UUIDs only; if any non-UUID slips through it
        // resolves to /api/assets/<garbage> and the backend returns 404.
        // That's the SoT design — broken renders surface bad data fast.
        expect(resolveAssetSrc('not-a-uuid')).toBe('/api/assets/not-a-uuid');
    });
});
