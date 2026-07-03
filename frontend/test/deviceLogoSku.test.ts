import {describe, expect, it} from 'vitest';
import {deviceImageSku} from '@/helpers/device';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';

// Regression: the devices-list card showed the generic logo for ShellyX
// because it resolved off the base model (S3MX-0A) instead of the jwt
// service/product code that the waiting-room card uses.
describe('deviceImageSku — jwt-aware CDN key', () => {
    it('prefers XT1 service type (jwt.xt1.svc0.type)', () => {
        expect(
            deviceImageSku({
                model: 'S3MX-0A',
                jwt: {xt1: {svc0: {type: 'linkedgo-st-802-hvac'}}}
            } as never)
        ).toBe('linkedgo-st-802-hvac');
    });

    it('prefers XMOD product code (jwt.p) when no xt1', () => {
        expect(
            deviceImageSku({
                model: 'S3MX-0A',
                jwt: {p: 'S3SW-001X16EU'}
            } as never)
        ).toBe('S3SW-001X16EU');
    });

    it('falls back to the base model when no jwt', () => {
        expect(deviceImageSku({model: 'SNSW-001X16EU'} as never)).toBe(
            'SNSW-001X16EU'
        );
    });
});

describe('resolveDeviceLogo — devices-list card', () => {
    it('resolves a configured ShellyX to its product image, not generic', () => {
        const logo = resolveDeviceLogo({
            info: {model: 'S3MX-0A', jwt: {p: 'S3SW-001X16EU'}}
        } as never);
        expect(logo.kind).toBe('cdn');
        expect('src' in logo && logo.src).toMatch(/S3SW-001X16EU\.png$/);
    });
});
