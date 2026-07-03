// REGRESSION: bugs we explicitly fixed. Each it() names the prior bug
// so a future refactor that resurrects it fails here immediately.
import {describe, expect, it} from 'vitest';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';

function device(overrides: Record<string, unknown>) {
    return {
        id: 1,
        shellyID: 'x',
        status: {},
        settings: {},
        info: {},
        online: true,
        sleeping: false,
        loading: false,
        selected: false,
        entities: [],
        capabilities: {},
        meta: {},
        methods: [],
        ...overrides
    } as never;
}

describe('regression: 87307dc0 magic-string app check', () => {
    it('does NOT classify by info.app text alone — uses device.source', () => {
        // Reproduces the pre-fix behaviour: app=='Virtual Device' but no
        // source field — earlier code matched the magic string. Now the
        // resolver requires the structural source signal.
        const noSource = device({
            info: {app: 'Virtual Device', model: 'e2e_water_heater'}
        });
        const logo = resolveDeviceLogo(noSource);
        // Without source='virtual', it falls through to the CDN path
        // (which is wrong for synthetic devices but that's the renamed
        // string problem the structural signal solves at the boundary).
        expect(logo.kind).toBe('cdn');
    });
});

describe('regression: virtual device 404s on Shelly CDN', () => {
    it('virtual + visual.icon never asks for /images/devices/<typeKey>.png', () => {
        const logo = resolveDeviceLogo(
            device({
                source: 'virtual',
                info: {model: 'e2e_water_heater'},
                meta: {virtualDevice: {visual: {icon: 'fas fa-cube'}}}
            })
        );
        expect(logo.kind).toBe('icon');
    });

    it('virtual without visual still skips CDN — falls back to fa-cube', () => {
        const logo = resolveDeviceLogo(
            device({
                source: 'virtual',
                info: {model: 'invertor'}
            })
        );
        expect(logo).toEqual({kind: 'icon', faClass: 'fas fa-cube'});
    });
});

describe('regression: imageAssetId silently dropped', () => {
    it('uploaded image survives the resolver when no icon is set', () => {
        const logo = resolveDeviceLogo(
            device({
                source: 'virtual',
                info: {imageAssetId: 'asset-uuid-1'}
            })
        );
        expect(logo).toEqual({
            kind: 'image',
            src: '/api/assets/asset-uuid-1'
        });
    });
});
