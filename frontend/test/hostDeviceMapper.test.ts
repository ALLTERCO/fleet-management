import {describe, expect, it} from 'vitest';
import {deriveDomainCapabilities} from '@/shell/template-host/deviceCapabilities';
import {toHostDevice} from '@/shell/template-host/deviceMapper';

describe('Host device mapper', () => {
    it('uses the Shelly external id as the stable host device id', () => {
        const device = toHostDevice({
            shellyID: 'shellypro4pm-aabbcc',
            name: 'Main board',
            online: true,
            groupIds: [7],
            info: {model: 'SPSW-004PE16EU'},
            status: {}
        });

        expect(device.id).toBe('shellypro4pm-aabbcc');
        expect(device.presence).toBe('online');
        expect(device.groupId).toBe(7);
        expect(device.type).toBe('SPSW-004PE16EU');
    });

    it('derives relay and energy capabilities from switch status', () => {
        const capabilities = deriveDomainCapabilities({
            status: {
                'switch:0': {
                    output: true,
                    apower: 42,
                    aenergy: {total: 1200}
                }
            }
        });

        expect(capabilities.relay).toEqual({state: true});
        expect(capabilities.energy).toEqual({
            power_w: 42,
            total_energy_wh: 1200
        });
    });

    it('reads PM1 power via apower, not act_power', () => {
        const capabilities = deriveDomainCapabilities({
            status: {'pm1:0': {apower: 33, aenergy: {total: 500}}}
        });
        expect(capabilities.energy).toEqual({
            power_w: 33,
            total_energy_wh: 500
        });
    });

    it('sums a 3-phase EM across its per-phase power fields', () => {
        const capabilities = deriveDomainCapabilities({
            status: {
                'em:0': {
                    a_act_power: 100,
                    b_act_power: 150,
                    c_act_power: 200,
                    total_act_power: 450
                }
            }
        });
        expect(capabilities.energy?.power_w).toBe(450);
    });

    it('sums power across multiple metered components on one device', () => {
        const capabilities = deriveDomainCapabilities({
            status: {
                'switch:0': {output: true, apower: 10},
                'switch:1': {output: false, apower: 5},
                'pm1:0': {apower: 20}
            }
        });
        expect(capabilities.energy?.power_w).toBe(35);
    });

    it('derives BTHome sensor capabilities from component metadata', () => {
        const capabilities = deriveDomainCapabilities({
            config: {'bthomesensor:201': {obj_id: 'temperature'}},
            status: {'bthomesensor:201': {value: 21.5}}
        });

        expect(capabilities.temperature).toEqual({
            temperature_c: 21.5,
            humidity_pct: null
        });
    });
});
