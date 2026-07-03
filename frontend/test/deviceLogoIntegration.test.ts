// INTEGRATION: resolver + accent guard cooperate to make the on-the-wire
// virtualdevice.Update payload safe — token keys only, no raw hex.
import {describe, expect, it} from 'vitest';
import {isAccentTokenKey} from '@/config/accentTokens';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';

function virtualDevice(visual: Record<string, unknown>) {
    return {
        id: 1,
        shellyID: 'vdev-1',
        source: 'virtual',
        status: {},
        settings: {},
        info: {model: 'water_heater'},
        online: true,
        sleeping: false,
        loading: false,
        selected: false,
        entities: [],
        capabilities: {},
        meta: {virtualDevice: {visual}},
        methods: []
    } as never;
}

describe('decoration round-trip', () => {
    it('a saved {icon, accent} pair flows back through the resolver intact', () => {
        const saved = {icon: 'fas fa-thermometer-half', accent: 'red'};
        const logo = resolveDeviceLogo(virtualDevice(saved));
        expect(logo).toEqual({
            kind: 'icon',
            faClass: saved.icon,
            accent: saved.accent
        });
        expect(isAccentTokenKey(saved.accent)).toBe(true);
    });

    it('rejects an accent stored as raw hex before it reaches the renderer', () => {
        const corrupted = {accent: '#ff00aa'};
        expect(isAccentTokenKey(corrupted.accent)).toBe(false);
    });

    it('icon and imageAssetId set together — resolver picks icon (cheaper render)', () => {
        const device = virtualDevice({icon: 'fas fa-cube'});
        (device as {info: {imageAssetId?: string}}).info.imageAssetId =
            '/uploads/virtual-images/x.png';
        const logo = resolveDeviceLogo(device);
        expect(logo.kind).toBe('icon');
    });
});
