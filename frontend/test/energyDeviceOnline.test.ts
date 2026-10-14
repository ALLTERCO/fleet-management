import {describe, expect, it} from 'vitest';
import {
    countOnlineDevices,
    deviceOnlinePercent
} from '@/components/dashboard/energy/energyDeviceOnline';

describe('energy dashboard device online summary', () => {
    it('counts every online fleet device, independent of metering capability', () => {
        expect(
            countOnlineDevices({
                meter: {online: true},
                relayOnly: {online: true},
                offlineMeter: {online: false}
            })
        ).toBe(2);
    });

    it('reports zero percent for an empty fleet', () => {
        const devices = {};
        const deviceCount = Object.keys(devices).length;
        const onlineCount = countOnlineDevices(devices);

        expect(deviceOnlinePercent(deviceCount, onlineCount)).toBe(0);
    });
});
