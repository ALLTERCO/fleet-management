// Pin the device-logo tiering + once-per-tab negative cache.
//
// Models we bundle locally resolve to the same-origin /images/devices URL
// first (no CDN round-trip, no 404 probe); models we do not bundle fall back
// to the cloud CDN. Either way the negative cache (`KNOWN_BAD_IMAGE_URLS`)
// makes a failing tier fire at most once per (model, tier) per tab — a page
// with N cards of the same model no longer produces N repeated 404s. This
// test pins that getLogoFromModel / getLogoFallback / getLogoFromShellyID all
// skip tiers already marked bad and fall through to the generic logo once.

import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
    GENERIC_LOGO,
    getLogoFallback,
    getLogoFromModel,
    getLogoFromShellyID
} from '@/helpers/device';

beforeEach(async () => {
    sessionStorage.clear();
    vi.resetModules();
});

describe('getLogoFromModel (local → cloud → generic with negative cache)', () => {
    // SNSW-001P16EU is in the bundle manifest → served locally first.
    it('returns the bundled local URL on first request', () => {
        const url = getLogoFromModel('SNSW-001P16EU');
        expect(url).toBe('/images/devices/SNSW-001P16EU.png');
    });

    it('falls through to the cloud URL once the local URL is marked bad', async () => {
        const mod = await import('@/helpers/device');
        mod.markBadImageUrl('/images/devices/SNSW-001P16EU.png');
        expect(mod.getLogoFromModel('SNSW-001P16EU')).toBe(
            'https://control.shelly.cloud/images/device_images/SNSW-001P16EU.png'
        );
    });

    it('falls through to GENERIC_LOGO when both tiers are bad', async () => {
        const mod = await import('@/helpers/device');
        mod.markBadImageUrl('/images/devices/SNSW-001P16EU.png');
        mod.markBadImageUrl(
            'https://control.shelly.cloud/images/device_images/SNSW-001P16EU.png'
        );
        expect(mod.getLogoFromModel('SNSW-001P16EU')).toBe(mod.GENERIC_LOGO);
    });

    // Synthetic/e2e model: not bundled → cloud CDN first, then local, generic.
    it('serves the cloud CDN first for a model we do not bundle', () => {
        expect(getLogoFromModel('ZZZ-999SYNTH')).toBe(
            'https://control.shelly.cloud/images/device_images/ZZZ-999SYNTH.png'
        );
    });

    it('returns GENERIC_LOGO when model is missing or the placeholder S3MX-0A', () => {
        expect(getLogoFromModel()).toBe(GENERIC_LOGO);
        expect(getLogoFromModel('S3MX-0A')).toBe(GENERIC_LOGO);
    });
});

describe('getLogoFallback', () => {
    it('returns the local URL when not yet marked bad', () => {
        expect(getLogoFallback('SNSW-001P16EU')).toBe(
            '/images/devices/SNSW-001P16EU.png'
        );
    });

    it('returns GENERIC_LOGO once the local URL is marked bad', async () => {
        const mod = await import('@/helpers/device');
        mod.markBadImageUrl('/images/devices/SNSW-001P16EU.png');
        expect(mod.getLogoFallback('SNSW-001P16EU')).toBe(mod.GENERIC_LOGO);
    });
});

describe('getLogoFromShellyID', () => {
    it('maps known prefix to the model image', () => {
        expect(getLogoFromShellyID('shellyplus1pm-abcdef')).toBe(
            '/images/devices/SPSW-001PE16EU.png'
        );
    });

    it('returns the generic shelly_logo.png for an unknown prefix', () => {
        // e.g. `e2e_water_heater-xxx` — the deployed-failure case
        expect(getLogoFromShellyID('e2e_water_heater-xxx')).toBe(
            '/images/branding/shelly_logo.png'
        );
    });

    it('falls through to /shelly_logo.png if the mapped local URL is bad', async () => {
        const mod = await import('@/helpers/device');
        mod.markBadImageUrl('/images/devices/SPSW-001PE16EU.png');
        expect(mod.getLogoFromShellyID('shellyplus1pm-abcdef')).toBe(
            '/images/branding/shelly_logo.png'
        );
    });
});

describe('markBadImageUrl is the single chokepoint', () => {
    it('subsequent resolutions for the same model skip the bad URL — no repeat 404', async () => {
        const mod = await import('@/helpers/device');
        const local = '/images/devices/SNSW-001P16EU.png';
        const cloud =
            'https://control.shelly.cloud/images/device_images/SNSW-001P16EU.png';

        // First mount: bundled local URL chosen.
        expect(mod.getLogoFromModel('SNSW-001P16EU')).toBe(local);

        // onerror handler marks it bad once.
        mod.markBadImageUrl(local);

        // Every subsequent mount for the same model goes straight to the
        // next tier — the local fetch never repeats.
        for (let i = 0; i < 50; i++) {
            expect(mod.getLogoFromModel('SNSW-001P16EU')).toBe(cloud);
        }
    });
});
