// REGRESSION: BLU devices now ALSO carry decoration (Phase 5.6 parity).
// resolveDeviceLogo must read meta.bluetoothDevice.visual the same way it
// reads meta.virtualDevice.visual.
import {describe, expect, it} from 'vitest';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';

function bluDevice(overrides: Record<string, unknown>) {
    return {
        id: 2,
        shellyID: 'blu_x',
        source: 'bluetooth',
        status: {},
        settings: {},
        info: {model: 'invertor'},
        online: false,
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

describe('resolveDeviceLogo — bluetooth visual', () => {
    it('picks meta.bluetoothDevice.visual.icon when set', () => {
        const logo = resolveDeviceLogo(
            bluDevice({
                meta: {
                    bluetoothDevice: {visual: {icon: 'fas fa-thermometer-half'}}
                }
            })
        );
        expect(logo).toEqual({
            kind: 'icon',
            faClass: 'fas fa-thermometer-half',
            accent: undefined
        });
    });

    it('falls back to generic BLU image when there is no visual and no model', () => {
        const logo = resolveDeviceLogo(bluDevice({info: {}}));
        expect(logo).toEqual({
            kind: 'image',
            src: '/images/devices/generic-blu-device.png'
        });
    });
});
