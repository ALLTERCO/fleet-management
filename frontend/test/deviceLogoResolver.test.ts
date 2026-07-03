// Backend-owned visuals (Phase 5.6) drive frontend logo rendering. The
// resolver picks one of: FA icon (cheap, themable), uploaded image, or
// the existing Shelly CDN model URL.
import {describe, expect, it} from 'vitest';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';
import type {shelly_device_t} from '@/types';

function fakeDevice(
    overrides: Partial<shelly_device_t> & {
        info?: Record<string, unknown>;
        meta?: Record<string, unknown>;
    }
): shelly_device_t {
    return {
        id: 1,
        shellyID: 'shelly-x',
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

describe('resolveDeviceLogo — backend-owned visual.icon wins', () => {
    it('returns icon kind with the backend-supplied FA class + accent', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'virtual',
                info: {model: 'e2e_water_heater'},
                meta: {
                    virtualDevice: {
                        visual: {
                            icon: 'fas fa-thermometer-half',
                            accent: 'temp'
                        }
                    }
                }
            })
        );
        expect(logo).toEqual({
            kind: 'icon',
            faClass: 'fas fa-thermometer-half',
            accent: 'temp'
        });
    });

    it('prefers icon over imageAssetId when both are set', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'virtual',
                info: {imageAssetId: '/uploads/virtual-images/x.png'},
                meta: {virtualDevice: {visual: {icon: 'fas fa-cube'}}}
            })
        );
        expect(logo.kind).toBe('icon');
    });
});

describe('resolveDeviceLogo — uploaded image fallback', () => {
    it('returns image kind for imageAssetId when visual.icon is absent', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
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

describe('resolveDeviceLogo — bundled product picture decoration', () => {
    it('renders visual.imageModel through the product image resolver', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'virtual',
                meta: {
                    virtualDevice: {
                        visual: {imageModel: 'SBDW-002C'}
                    }
                }
            })
        );
        expect(logo).toEqual({
            kind: 'image',
            src: '/images/devices/SBDW-002C.png'
        });
    });

    it('prefers uploaded image over bundled product picture when both exist', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'virtual',
                info: {imageAssetId: 'asset-uuid-1'},
                meta: {
                    virtualDevice: {
                        visual: {imageModel: 'SBDW-002C'}
                    }
                }
            })
        );
        expect(logo).toEqual({
            kind: 'image',
            src: '/api/assets/asset-uuid-1'
        });
    });
});

describe('resolveDeviceLogo — synthetic defaults when nothing is set', () => {
    it('virtual device with no decoration falls back to fa-cube', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'virtual',
                info: {model: 'e2e_water_heater'}
            })
        );
        expect(logo).toEqual({kind: 'icon', faClass: 'fas fa-cube'});
    });

    it('bluetooth device with no known model falls back to generic BLU image', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({source: 'bluetooth', info: {}})
        );
        expect(logo).toEqual({
            kind: 'image',
            src: '/images/devices/generic-blu-device.png'
        });
    });

    it('bluetooth device with a real model shows its product photo (like the card)', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({source: 'bluetooth', info: {model: 'SBDW-002C'}})
        );
        expect(logo.kind).toBe('cdn');
        if (logo.kind === 'cdn') expect(logo.src).toContain('SBDW-002C');
    });
});

describe('resolveDeviceLogo — model source per device family', () => {
    it('regular Shelly device: image from info.model', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({source: 'ws', info: {model: 'S3SW-001P16EU'}})
        );
        expect(logo.kind).toBe('cdn');
        if (logo.kind === 'cdn') expect(logo.src).toContain('S3SW-001P16EU');
    });

    it('modular Shelly X device: image from the jwt product code, not the base model', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'ws',
                info: {model: 'S3XX-BASE', jwt: {p: 'XMOD1'}}
            })
        );
        expect(logo.kind).toBe('cdn');
        if (logo.kind === 'cdn') expect(logo.src).toContain('XMOD1');
    });

    it('BLU device with a real model (model ≠ capability): product photo', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'bluetooth',
                info: {model: 'SBDW-002C', capability: 'sensor'},
                meta: {bluetoothDevice: {capability: 'sensor'}}
            })
        );
        expect(logo.kind).toBe('cdn');
        if (logo.kind === 'cdn') expect(logo.src).toContain('SBDW-002C');
    });

    it('BLU device with only a capability (info.model === capability): generic BLU image', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({
                source: 'bluetooth',
                info: {model: 'sensor', capability: 'sensor'},
                meta: {bluetoothDevice: {capability: 'sensor'}}
            })
        );
        expect(logo).toEqual({
            kind: 'image',
            src: '/images/devices/generic-blu-device.png'
        });
    });
});

describe('resolveDeviceLogo — physical Shelly devices keep the CDN path', () => {
    it('returns cdn kind for a real shelly model', () => {
        const logo = resolveDeviceLogo(
            fakeDevice({source: 'shelly', info: {model: 'SNSW-001P8EU'}})
        );
        expect(logo.kind).toBe('cdn');
        if (logo.kind === 'cdn') {
            expect(logo.src).toContain('SNSW-001P8EU.png');
        }
    });

    it('falls through to the generic placeholder when model is absent', () => {
        const logo = resolveDeviceLogo(fakeDevice({info: {}}));
        expect(logo.kind).toBe('image');
    });
});
