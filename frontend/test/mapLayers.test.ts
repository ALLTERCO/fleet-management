import {describe, expect, it} from 'vitest';
import {__testing} from '@/helpers/map-layers';
import type {MapPin} from '@/types/map';

const {alertPulse, partitionByAlerts, pinSignature} = __testing;

describe('alertPulse', () => {
    it('keeps scale within the documented 0.85 — 1.40 window', () => {
        const samples = [0, 300, 600, 900].map(alertPulse);
        for (const s of samples) {
            expect(s.scale).toBeGreaterThanOrEqual(0.85);
            expect(s.scale).toBeLessThanOrEqual(1.4);
            expect(s.alpha).toBeGreaterThanOrEqual(50);
            expect(s.alpha).toBeLessThanOrEqual(180);
        }
    });
});

describe('partitionByAlerts', () => {
    it('routes pins with alertCount > 0 into the alerting bucket', () => {
        const pins: MapPin[] = [
            {id: '1', lat: 0, lng: 0},
            {id: '2', lat: 0, lng: 0, alertCount: 0},
            {id: '3', lat: 0, lng: 0, alertCount: 2}
        ];
        const {calm, alerting} = partitionByAlerts(pins);
        expect(calm.map((p) => p.id)).toEqual(['1', '2']);
        expect(alerting.map((p) => p.id)).toEqual(['3']);
    });
});

describe('pinSignature', () => {
    it('changes when alertCount or status changes', () => {
        const base: MapPin = {id: '1', lat: 0, lng: 0, status: 'on'};
        const withAlert: MapPin = {...base, alertCount: 1};
        const withWarn: MapPin = {...base, status: 'warn'};
        expect(pinSignature([base])).not.toEqual(pinSignature([withAlert]));
        expect(pinSignature([base])).not.toEqual(pinSignature([withWarn]));
    });
});
