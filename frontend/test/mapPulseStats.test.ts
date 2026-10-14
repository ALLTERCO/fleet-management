import {describe, expect, it} from 'vitest';
import {mapPulseStats} from '../src/helpers/mapPulseStats';

describe('map fleet pulse presentation', () => {
    it('labels the all-devices-healthy numerator instead of implying a missing site', () => {
        const rows = mapPulseStats({
            sitesOnline: 1,
            sitesTotal: 2,
            devicesOnline: 50,
            devicesTotal: 53,
            alertCount: 0,
            loadKW: -0.025
        });
        expect(rows[0]).toMatchObject({
            id: 'sites',
            label: 'healthy sites',
            value: 1,
            total: 2
        });
        expect(rows[1]).toMatchObject({value: 50, total: 53});
        expect(rows[2]).toMatchObject({value: -0.025, decimals: 1});
    });

    it('retains alert tone and site counts when all sites are healthy', () => {
        const rows = mapPulseStats({
            sitesOnline: 2,
            sitesTotal: 2,
            devicesOnline: 53,
            devicesTotal: 53,
            alertCount: 1,
            loadKW: 0.5
        });
        expect(rows[0]).toMatchObject({value: 2, total: 2});
        expect(rows[3]).toMatchObject({value: 1, tone: 'alert'});
    });
});
