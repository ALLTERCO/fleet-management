import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import EnergyVoltaine from '@/components/dashboard/energy/EnergyVoltaine.vue';
import {energyDashboardSample} from '@/components/dashboard/energy/energyDashboard.sample';

if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: () => ({
            matches: false,
            addEventListener: () => {},
            removeEventListener: () => {}
        })
    });
}

describe('EnergyVoltaine optional sections', () => {
    it('hides solar UI when the dashboard has no solar configuration', () => {
        const data = energyDashboardSample();
        data.config = {...data.config, solar: false};

        const wrapper = mount(EnergyVoltaine, {props: {d: data}});

        expect(wrapper.text()).not.toContain('Solar & Battery');
        expect(wrapper.text()).not.toContain('Solar / battery / EV roles');
        expect(wrapper.find('#solar').exists()).toBe(false);

        wrapper.unmount();
    });

    it('shows solar UI when solar data is configured', () => {
        const data = energyDashboardSample();
        data.config = {...data.config, solar: true};

        const wrapper = mount(EnergyVoltaine, {props: {d: data}});

        expect(wrapper.text()).toContain('Solar, Battery & EV');
        expect(wrapper.find('#solar').exists()).toBe(true);

        wrapper.unmount();
    });

    it('does not show solar visuals for an EV-only energy asset', () => {
        const data = energyDashboardSample();
        data.config = {...data.config, solar: true};
        data.solar = {
            ...data.solar,
            flow: {...data.solar.flow, solar: 0, battery: 0, ev: 1.2},
            generatedToday: 0,
            selfConsumed: 0,
            exported: 0,
            pv: {
                generation: 0,
                selfConsumed: 0,
                exported: 0,
                gridImport: 0,
                house: 0,
                selfConsumptionPct: 0,
                selfSufficiencyPct: 0
            },
            battery: null,
            ev: {delivered: 12, sessions: 0, avgPerSession: 0, cost: 3, co2Avoided: 0}
        };

        const wrapper = mount(EnergyVoltaine, {props: {d: data}});

        expect(wrapper.text()).toContain('EV charging');
        expect(wrapper.text()).not.toContain('Solar &');
        expect(wrapper.text()).not.toContain('PV ·');
        expect(wrapper.text()).not.toContain('Avoided by solar');
        expect(wrapper.find('#flow').exists()).toBe(false);

        wrapper.unmount();
    });
});
